/**
 * === Stripe Webhooks Handler ===
 *
 * Unified webhook endpoint for all Stripe events. Uses async signature
 * verification (HMAC-SHA256 via SubtleCrypto) for Cloudflare Workers
 * compatibility. Includes event dedup to handle Stripe retries safely.
 *
 * === Supported Events ===
 * Subscription lifecycle:
 * - customer.subscription.created
 * - customer.subscription.updated (includes pause/resume detection)
 * - customer.subscription.deleted
 *
 * Invoice events:
 * - invoice.payment_succeeded (renewal tracking)
 * - invoice.payment_failed (failure tracking + past_due status)
 * - invoice.upcoming (audit trail, skip-next deferred to Phase 3)
 *
 * Payment events (legacy, preserved from existing implementation):
 * - payment_intent.succeeded
 * - payment_intent.payment_failed
 * - checkout.session.completed
 *
 * === Security ===
 * - Async webhook signature verification via verifyWebhookSignature (HMAC-SHA256)
 * - Event ID dedup via an atomic PK-insert claim on processed_webhook_events
 *   (BMC-153): the insert itself is the gate, attempted before the handler
 *   runs, so concurrent duplicate deliveries can't both slip past a
 *   read-then-write check.
 * - HTTP 500 on processing failure triggers Stripe retry
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyWebhookSignature, getWebhookSecret } from '@/lib/stripe';
import {
  claimWebhookEvent,
  releaseWebhookEventClaim,
  cleanupOldWebhookEvents,
} from '@/lib/models/mach/subscriptions';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from './handlers/subscription-handlers';
import {
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleInvoiceUpcoming,
} from './handlers/invoice-handlers';
import { getOrderById, markOrderPaid } from '@/lib/models/mach/orders';
import { processGiftCardsForOrder } from '@/lib/services/gift-card-fulfillment';
import { resolveGiftCardTenderCents, verifyOrderChargeSufficient } from '@/lib/services/order-pricing';

/**
 * POST handler for Stripe webhook events.
 * Reads body once, verifies signature async, dedup checks, routes to handler.
 */
export async function POST(req: NextRequest) {
  // 1. Read body ONCE (Workers Request bodies are streams)
  const body = await req.text();

  // 2. Get signature header
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    console.error('[webhook] Missing stripe-signature header');
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  // 3. Verify webhook signature (async, HMAC-SHA256)
  let event: Stripe.Event;
  try {
    event = await verifyWebhookSignature(body, signature, getWebhookSecret());
  } catch (error) {
    console.error('[webhook] Signature verification failed:', error);
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 400 }
    );
  }

  // 4. Claim the event via PK insert BEFORE running the handler. This is the
  // atomic dedup gate (BMC-153): the first delivery to insert wins the claim;
  // a UNIQUE/PK violation means another delivery (concurrent or prior)
  // already claimed this event id, so this delivery is a duplicate and skips
  // processing entirely.
  const claimed = await claimWebhookEvent(event.id, event.type);
  if (!claimed) {
    console.log('[webhook] Duplicate event skipped:', event.id);
    return NextResponse.json({ received: true, duplicate: true });
  }

  // 5. Inline cleanup of old webhook events (fire-and-forget)
  cleanupOldWebhookEvents().catch((err) =>
    console.error('[webhook] Cleanup failed (non-blocking):', err)
  );

  // 6. Route to handler
  try {
    switch (event.type) {
      // ─── Subscription events ───────────────────────────
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription, event.id);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, event.id);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, event.id);
        break;

      // ─── Invoice events ────────────────────────────────
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice, event.id);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, event.id);
        break;

      case 'invoice.upcoming':
        await handleInvoiceUpcoming(event.data.object as Stripe.Invoice, event.id);
        break;

      // ─── Legacy payment events (preserved) ─────────────
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      default:
        console.log(`[webhook] Unhandled event type: ${event.type}`);
    }

    // 7. The claim in step 4 already recorded this event as processed —
    // nothing more to persist here.

    // 8. Return success
    return NextResponse.json({ received: true });
  } catch (error) {
    // 9. Processing error: release the claim so it doesn't permanently block
    // Stripe's legitimate retry (which would otherwise see the PK row from
    // this failed attempt and be skipped as a "duplicate" forever). This is
    // safe because every downstream side effect is idempotent and keyed on
    // the domain object, not the webhook event id — see
    // releaseWebhookEventClaim's doc comment for detail. Return 500 so
    // Stripe retries.
    await releaseWebhookEventClaim(event.id);
    console.error('[webhook] Processing error:', error);
    return NextResponse.json(
      { error: 'Processing failed' },
      { status: 500 }
    );
  }
}

// ─── Legacy Handlers (preserved from existing implementation) ─────

/**
 * Handle successful payment intent
 * Updates order status and triggers post-payment actions
 */
/**
 * Thrown when an event can't be fully processed yet but SHOULD be retried by
 * Stripe (e.g. the order row hasn't been persisted by the order-creation path
 * yet). It is propagated out of the handler so the POST route returns 500 and
 * does NOT record the event as processed, letting Stripe redeliver with backoff.
 */
class WebhookRetryableError extends Error {}

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log('Payment succeeded:', paymentIntent.id);

  const orderId = paymentIntent.metadata.orderId;

  if (!orderId) {
    console.error('No orderId in payment intent metadata');
    return;
  }

  try {
    // Fetch the order FIRST: we need its line items to verify the amount paid
    // BEFORE marking it paid. If the order-creation path hasn't persisted it
    // yet, throw a retryable error so the webhook returns 500 and is NOT
    // recorded as processed — Stripe redelivers with backoff, by which point
    // the order should exist. Everything below is idempotent and order-keyed,
    // so a later retry (or order creation winning the race) is safe.
    const order = await getOrderById(orderId);
    if (!order) {
      throw new WebhookRetryableError(
        `[webhook] Order ${orderId} not found yet; deferring payment confirmation to a Stripe retry`
      );
    }

    // amount_received comes from the signature-verified Stripe event, so it is
    // a trusted basis for confirming payment / issuing stored value. Use ONLY
    // the captured amount (never the authorized pi.amount); fail closed at 0.
    const paidAmountCents = paymentIntent.amount_received ?? 0;

    // BMC-131: verify the cash collected covers the catalog value of the goods
    // before marking paid. This closes the second bypass — otherwise a $0.50
    // PaymentIntent succeeding would flip an expensive order to paid here even
    // when order creation refused to. Underpayment is permanent (not a
    // transient race), so record the event as processed and leave the order
    // pending rather than triggering a Stripe retry storm.
    const giftCardTenderCents = await resolveGiftCardTenderCents(order.extensions);
    const charge = await verifyOrderChargeSufficient({
      items: order.items as any,
      paidAmountCents,
      giftCardTenderCents,
    });
    if (!charge.ok) {
      console.error(
        `[webhook] Order ${orderId}: refusing to mark paid — ${charge.reason}`
      );
      return;
    }

    // Mark the order paid directly in D1. This previously self-fetched
    // `${NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/orders`, which on the
    // deployed Worker resolved to localhost (unreachable) and silently left the
    // order 'pending'. Writing to D1 removes that env dependency entirely and
    // is idempotent (re-marking an already-paid order is a no-op).
    try {
      await markOrderPaid(orderId, {
        status: 'processing',
        notes: `Payment completed via Stripe - Payment Intent: ${paymentIntent.id}`,
      });
    } catch (updateError) {
      console.error('Error updating order status:', updateError);
    }

    // Gift card fulfillment — issue purchased cards + redeem any applied card.
    // Idempotent and keyed on the order, so it is safe even though the
    // order-creation path runs the same step (whichever sees the order wins).
    try {
      const gc = await processGiftCardsForOrder(order, { paidAmountCents });
      if (gc.issued || gc.redeemed) {
        console.log(
          `[webhook] Gift cards for ${orderId}: issued=${gc.issued} redeemed=${gc.redeemed} ($${(gc.redeemedAmount / 100).toFixed(2)})`
        );
      }
      if (gc.errors.length) {
        console.error('[webhook] Gift card fulfillment errors:', gc.errors);
      }
    } catch (gcError) {
      console.error('Error during gift card fulfillment:', gcError);
    }
  } catch (error) {
    // Retryable errors (e.g. order-not-yet-persisted) must propagate so the
    // POST route returns 500 and Stripe retries; everything else stays logged
    // and swallowed as before.
    if (error instanceof WebhookRetryableError) {
      console.warn(error.message);
      throw error;
    }
    console.error('Error updating order after payment:', error);
  }
}

/**
 * Handle failed payment intent
 * Updates order status and handles payment failure scenarios
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log('Payment failed:', paymentIntent.id);

  const orderId = paymentIntent.metadata.orderId;

  if (!orderId) {
    console.error('No orderId in payment intent metadata');
    return;
  }

  try {
    console.log(`Updating order ${orderId} to failed status`);
  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

/**
 * Handle completed checkout session
 * Processes successful checkout completion
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('Checkout session completed:', session.id);

  const orderId = session.metadata?.orderId;

  if (!orderId) {
    console.error('No orderId in checkout session metadata');
    return;
  }

  try {
    console.log(`Processing completed checkout for order ${orderId}`);
  } catch (error) {
    console.error('Error handling checkout completion:', error);
  }
}

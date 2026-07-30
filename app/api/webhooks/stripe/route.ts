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
 * Refund events:
 * - charge.refunded (BMC-213 — reconciles refunds issued outside the app, e.g.
 *   from the Stripe Dashboard, into the `extensions.refunds[]` ledger so the
 *   over-refund guard can see them)
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
import { handleChargeRefunded } from './handlers/refund-handlers';
import { getOrderById } from '@/lib/models/mach/orders';
import { finalizePaidOrder } from '@/lib/services/order-finalization';
import { logCritical } from '@/lib/utils/observe';

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

      // ─── Refund events ─────────────────────────────────
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge, event.id);
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
    // Don't page on the EXPECTED retryable race (e.g. order-not-yet-persisted):
    // it self-heals on Stripe's retry, so alerting per-retry is pure noise. Only
    // an unexpected, non-retryable processing failure pages.
    if (!(error instanceof WebhookRetryableError)) {
      logCritical('webhook', 'processing_failed', { eventType: event.type, eventId: event.id }, error);
    }
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
 * Stripe (e.g. the order row hasn't been persisted yet, or a transient D1 error
 * while pricing the catalog). It is propagated out of the handler so the POST
 * route returns 500 and does NOT record the event as processed, letting Stripe
 * redeliver with backoff.
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
    // BMC-167: a server-side pending order was persisted at PaymentIntent
    // creation, so by the time this fires an order row should exist even when
    // the client-side POST /api/orders never lands (redirect payment method
    // returning in a different browser, cleared localStorage, closed tab) — this
    // is the webhook-as-backstop that finalizes those otherwise-lost orders.
    //
    // Fetch it FIRST: we need its line items to verify the amount paid before
    // marking it paid. If it isn't there yet (a redelivery racing a slow commit,
    // or the rare case where pending-order persistence failed at PI creation),
    // throw a retryable error so Stripe redelivers with backoff. Everything below
    // is idempotent and order-keyed, so a later retry (or the client POST winning
    // the race) is safe.
    const order = await getOrderById(orderId);
    if (!order) {
      throw new WebhookRetryableError(
        `[webhook] Order ${orderId} not found yet; deferring payment confirmation to a Stripe retry`
      );
    }

    // Already finalized by the client POST (or a prior delivery) — nothing to do.
    // The CAS in finalizePaidOrder would no-op anyway; this just skips the work.
    if (order.payment_status === 'paid') {
      console.log(`[webhook] Order ${orderId} already paid; skipping`);
      return;
    }

    // amount_received comes from the signature-verified Stripe event, so it is a
    // trusted basis for confirming payment. Use ONLY the captured amount (never
    // the authorized pi.amount); fail closed at 0. The order is bound by virtue
    // of being the one named in pi.metadata.orderId.
    const paidAmountCents = paymentIntent.amount_received ?? 0;

    // Promote pending → paid via the shared finalizer (BMC-167): it re-runs the
    // BMC-131 catalog charge gate, does the guarded pending→paid CAS, and — only
    // if it wins — fulfills gift cards (with the H1 revert) and sends the
    // confirmation email. Underpayment is PERMANENT (returns { paid: false }, no
    // retry); a THROW is TRANSIENT (e.g. a D1 error pricing the catalog) and is
    // re-raised as a retryable error so Stripe redelivers (H2).
    let result: Awaited<ReturnType<typeof finalizePaidOrder>>;
    try {
      result = await finalizePaidOrder({
        order,
        paidAmountCents,
        sendEmail: true,
        paidNotes: `Payment completed via Stripe - Payment Intent: ${paymentIntent.id}`,
      });
    } catch (finalizeError) {
      throw new WebhookRetryableError(
        `[webhook] Order ${orderId}: finalization errored (${
          finalizeError instanceof Error ? finalizeError.message : 'unknown'
        }); deferring to a Stripe retry`
      );
    }

    if (!result.paid && result.reason) {
      // Permanent underpayment / unpriceable order — do NOT retry (record the
      // event processed and leave the order pending for manual review).
      console.error(`[webhook] Order ${orderId}: refusing to mark paid — ${result.reason}`);
    }
  } catch (error) {
    // Retryable errors (e.g. order-not-yet-persisted) must propagate so the
    // POST route returns 500 and Stripe retries; everything else stays logged
    // and swallowed as before.
    if (error instanceof WebhookRetryableError) {
      console.warn(error.message);
      throw error;
    }
    // Swallowed (non-retryable) failure updating a PAID order — payment landed
    // but our records may not reflect it, and Stripe will NOT retry. Alert.
    console.error('Error updating order after payment:', error);
    logCritical('webhook', 'order_paid_update_failed', { orderId }, error);
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

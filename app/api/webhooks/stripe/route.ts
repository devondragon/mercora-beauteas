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
 * - Event ID dedup via processed_webhook_events table
 * - HTTP 500 on processing failure triggers Stripe retry
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyWebhookSignature, getWebhookSecret } from '@/lib/stripe';
import {
  isWebhookEventProcessed,
  recordWebhookEvent,
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

  // 4. Dedup check
  const isDuplicate = await isWebhookEventProcessed(event.id);
  if (isDuplicate) {
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

    // 7. Record successful processing in dedup table
    await recordWebhookEvent(event.id, event.type);

    // 8. Return success
    return NextResponse.json({ received: true });
  } catch (error) {
    // 9. Processing error: return 500 for Stripe retry
    // Do NOT record in dedup table so retry will reprocess
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
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log('Payment succeeded:', paymentIntent.id);

  const orderId = paymentIntent.metadata.orderId;

  if (!orderId) {
    console.error('No orderId in payment intent metadata');
    return;
  }

  try {
    // Update order status using unified orders endpoint
    try {
      const updateRes = await fetch(`${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/orders`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.STRIPE_WEBHOOK_SECRET || '',
        },
        body: JSON.stringify({
          orderId,
          status: 'processing',
          payment_status: 'paid',
          notes: `Payment completed via Stripe - Payment Intent: ${paymentIntent.id}`,
        }),
      });

      if (!updateRes.ok) {
        console.error('Failed to update order status:', await updateRes.text());
      }
    } catch (updateError) {
      console.error('Error updating order status:', updateError);
    }
  } catch (error) {
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

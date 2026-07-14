/**
 * Invoice Webhook Handlers
 *
 * Handles invoice.payment_succeeded, invoice.payment_failed,
 * and invoice.upcoming events from Stripe.
 *
 * invoice.payment_succeeded for renewals creates audit events and sends emails.
 * invoice.payment_failed records failure details and updates status to past_due.
 * invoice.upcoming creates an audit event for observability (skip-next logic deferred to Phase 3 SUBX-06).
 *
 * NOTE: In Stripe API version 2025-08-27.basil, the `subscription` field on Invoice
 * has been replaced by `parent.subscription_details.subscription`.
 */

import type Stripe from 'stripe';
import {
  getSubscriptionByStripeId,
  getSubscriptionPlanById,
  createSubscriptionEvent,
  updateSubscriptionStatus,
  updateSubscriptionPeriod,
} from '@/lib/models/mach/subscriptions';
import { sendSubscriptionEmail } from '@/lib/utils/email';
import type { SubscriptionFrequency } from '@/lib/types/subscription';
import { BASE_URL } from '@/lib/seo/metadata';
import { getCustomerDetails, getProductName } from './utils';
import { createSubscriptionOrder } from './subscription-order';

/**
 * Extract the Stripe subscription ID from an invoice's parent field.
 * In API version 2025-08-27.basil, invoice.subscription was replaced by
 * invoice.parent.subscription_details.subscription.
 */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subDetails = invoice.parent?.subscription_details;
  if (!subDetails?.subscription) return null;
  return typeof subDetails.subscription === 'string'
    ? subDetails.subscription
    : subDetails.subscription.id;
}

/**
 * Handle invoice.payment_succeeded
 *
 * A paid subscription invoice — initial (`subscription_create`) or a recurring
 * renewal — is the authoritative "money changed hands" signal, so it is the
 * single place a fulfillable, paid order is created (BMC-171). The order is keyed
 * on the invoice id for idempotency across Stripe retries.
 *
 * For renewals it additionally writes a "renewed" audit event, advances the
 * period, and sends the renewal email. The initial invoice's welcome email +
 * `created` audit event are owned by handleSubscriptionCreated, so this handler
 * creates only the order for it and stops before the renewal-specific flow.
 */
export async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  stripeEventId: string
): Promise<void> {
  // Skip non-subscription invoices
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) {
    console.log('[webhook] invoice.payment_succeeded: non-subscription invoice, skipping');
    return;
  }

  const isInitial = invoice.billing_reason === 'subscription_create';

  const d1Sub = await getSubscriptionByStripeId(stripeSubscriptionId);
  if (!d1Sub) {
    if (isInitial) {
      // The initial invoice can be delivered before customer.subscription.created,
      // which is what creates the D1 row (and persists the shipping address). WITHIN
      // a short grace window, throw so the route 500s and Stripe retries — by then
      // the created-handler will have landed the row, and this retry creates the
      // initial order against it.
      //
      // But handleSubscriptionCreated has legitimate early-returns that NEVER create
      // the row (no price id, no plan matching the price, or missing customer_id
      // metadata — e.g. a subscription started outside our /api/subscriptions POST
      // flow, or a plan whose stripe_price_id drifted from the live Stripe price
      // after cutover). For those the row will never appear, so throwing on every
      // redelivery would loop until Stripe's retry window quietly expires — a
      // captured charge left with no order, silently. Past the grace window, stop
      // retrying and raise a loud, greppable ALERT for manual reconciliation.
      const invoiceAgeSeconds = Math.floor(Date.now() / 1000) - (invoice.created ?? 0);
      const RACE_GRACE_SECONDS = 15 * 60; // ample for customer.subscription.created to land
      if (invoiceAgeSeconds <= RACE_GRACE_SECONDS) {
        throw new Error(
          `[webhook] initial invoice ${invoice.id} arrived before subscription row for ${stripeSubscriptionId}; retrying`
        );
      }
      console.error(
        '[webhook][ALERT] subscription_order_orphaned: initial invoice paid but no D1 subscription row after grace window — captured charge with no order, needs manual reconciliation:',
        { invoiceId: invoice.id, stripeSubscriptionId, invoiceAgeSeconds }
      );
      return;
    }
    // A RENEWAL with no row is a genuinely unknown subscription (never synced to
    // D1). We can't self-heal by retrying (unlike the initial-invoice race, no
    // created-handler is inbound to land the row), but it is the same
    // "captured charge, no order" outcome BMC-171 exists to eliminate — so raise
    // the same loud, greppable ALERT as the orphaned initial invoice for manual
    // reconciliation rather than a quiet warn.
    console.error(
      '[webhook][ALERT] subscription_order_orphaned: renewal invoice paid but no D1 subscription row — captured charge with no order, needs manual reconciliation:',
      { invoiceId: invoice.id, stripeSubscriptionId }
    );
    return;
  }

  // Create the fulfillable, paid order for this shipment (initial or renewal).
  // Idempotent on the invoice id, so a Stripe redelivery cannot double-ship one
  // charge. Runs before the audit event/email so fulfillment is never skipped by
  // a later failure. invoice.id is always set for a paid invoice; guard defensively.
  if (invoice.id) {
    await createSubscriptionOrder({
      subscription: d1Sub,
      invoiceId: invoice.id,
      amountPaidMinor: invoice.amount_paid,
      currency: (invoice.currency || 'usd').toUpperCase(),
      kind: isInitial ? 'initial' : 'renewal',
    });
  } else {
    console.warn('[webhook] invoice.payment_succeeded: invoice has no id, cannot create order', stripeSubscriptionId);
  }

  // Initial invoice: order created above; the welcome email + `created` event are
  // handled by handleSubscriptionCreated. Stop before the renewal-only flow.
  if (isInitial) {
    console.log('[webhook] invoice.payment_succeeded: initial order created, skipping renewal flow');
    return;
  }

  // Create renewal audit event
  await createSubscriptionEvent({
    subscription_id: d1Sub.id,
    event_type: 'renewed',
    stripe_event_id: stripeEventId,
    details: JSON.stringify({
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
    }),
  });

  // Update period dates if available from the invoice's line item period
  if (invoice.lines?.data?.[0]?.period) {
    const period = invoice.lines.data[0].period;
    const periodStart = new Date(period.start * 1000).toISOString();
    const periodEnd = new Date(period.end * 1000).toISOString();
    await updateSubscriptionPeriod(d1Sub.id, periodStart, periodEnd);
  }

  // Send renewed email (fire-and-forget)
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id || '';
  if (customerId) {
    const customer = await getCustomerDetails(customerId);
    if (customer.email) {
      const plan = await getSubscriptionPlanById(d1Sub.plan_id);
      const productName = plan ? await getProductName(plan.product_id) : 'Your Subscription';
      sendSubscriptionEmail('renewed', {
        customerEmail: customer.email,
        customerName: customer.name || 'Valued Customer',
        productName,
        frequency: (plan?.frequency || 'monthly') as SubscriptionFrequency,
        subscriptionId: d1Sub.id,
        amount: invoice.amount_paid,
        manageUrl: `${BASE_URL}/subscriptions`,
      }).catch((err) => console.error('[webhook] Failed to send renewed email:', err));
    }
  }

  console.log('[webhook] invoice.payment_succeeded (renewal) processed for subscription:', d1Sub.id);
}

/**
 * Handle invoice.payment_failed
 *
 * Records payment failure details, updates subscription status to past_due,
 * and sends a payment_failed email with failure reason and next retry date.
 */
export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  stripeEventId: string
): Promise<void> {
  // Skip non-subscription invoices
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) {
    console.log('[webhook] invoice.payment_failed: non-subscription invoice, skipping');
    return;
  }

  const d1Sub = await getSubscriptionByStripeId(stripeSubscriptionId);
  if (!d1Sub) {
    console.warn('[webhook] invoice.payment_failed: no D1 record for subscription', stripeSubscriptionId);
    return;
  }

  const failureReason = invoice.last_finalization_error?.message || 'Unknown error';
  const nextRetryDate = invoice.next_payment_attempt
    ? new Date(invoice.next_payment_attempt * 1000).toISOString()
    : undefined;

  // Create payment_failed audit event
  await createSubscriptionEvent({
    subscription_id: d1Sub.id,
    event_type: 'payment_failed',
    stripe_event_id: stripeEventId,
    details: JSON.stringify({
      failureReason,
      nextRetryDate,
      invoiceId: invoice.id,
    }),
  });

  // Update status to past_due if not already
  if (d1Sub.status !== 'past_due') {
    await updateSubscriptionStatus(d1Sub.id, {
      status: 'past_due',
    });
  }

  // Send payment_failed email (fire-and-forget)
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id || '';
  if (customerId) {
    const customer = await getCustomerDetails(customerId);
    if (customer.email) {
      const plan = await getSubscriptionPlanById(d1Sub.plan_id);
      const productName = plan ? await getProductName(plan.product_id) : 'Your Subscription';
      sendSubscriptionEmail('payment_failed', {
        customerEmail: customer.email,
        customerName: customer.name || 'Valued Customer',
        productName,
        frequency: (plan?.frequency || 'monthly') as SubscriptionFrequency,
        subscriptionId: d1Sub.id,
        failureReason,
        nextRetryDate: nextRetryDate ? new Date(nextRetryDate).toLocaleDateString() : undefined,
        manageUrl: `${BASE_URL}/subscriptions`,
      }).catch((err) => console.error('[webhook] Failed to send payment_failed email:', err));
    }
  }

  console.log('[webhook] invoice.payment_failed processed for subscription:', d1Sub.id);
}

/**
 * Handle invoice.upcoming
 *
 * Creates an audit event for observability. The actual skip-next logic
 * (checking skip_next_renewal flag and voiding invoice via Stripe API)
 * is deferred to Phase 3 (SUBX-06). This handler establishes the webhook
 * plumbing so Phase 3 only needs to add conditional logic inside.
 */
export async function handleInvoiceUpcoming(
  invoice: Stripe.Invoice,
  stripeEventId: string
): Promise<void> {
  // Skip non-subscription invoices
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) {
    console.log('[webhook] invoice.upcoming: non-subscription invoice, skipping');
    return;
  }

  const d1Sub = await getSubscriptionByStripeId(stripeSubscriptionId);
  if (!d1Sub) {
    console.warn('[webhook] invoice.upcoming: no D1 record for subscription', stripeSubscriptionId);
    return;
  }

  // Create audit event for upcoming invoice
  await createSubscriptionEvent({
    subscription_id: d1Sub.id,
    event_type: 'updated',
    stripe_event_id: stripeEventId,
    details: JSON.stringify({
      trigger: 'invoice.upcoming',
      invoiceId: invoice.id,
      amountDue: invoice.amount_due,
    }),
  });

  console.log('[webhook] invoice.upcoming for subscription', d1Sub.id);
}

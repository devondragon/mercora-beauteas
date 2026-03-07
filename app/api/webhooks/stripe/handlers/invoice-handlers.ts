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
import { getStripeForWorkers } from '@/lib/stripe';
import { sendSubscriptionEmail } from '@/lib/utils/email';
import type { SubscriptionFrequency } from '@/lib/types/subscription';
import { BASE_URL, resolveLocalizedField } from '@/lib/seo/metadata';
import { getDbAsync } from '@/lib/db';
import { products } from '@/lib/db/schema/products';
import { eq } from 'drizzle-orm';

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
 * Retrieve Stripe customer details for email sending.
 */
async function getCustomerDetails(customerId: string): Promise<{ email: string; name: string }> {
  try {
    const stripe = getStripeForWorkers();
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return { email: '', name: '' };
    }
    return {
      email: customer.email || '',
      name: customer.name || '',
    };
  } catch (error) {
    console.error('[webhook] Failed to retrieve customer details:', error);
    return { email: '', name: '' };
  }
}

/**
 * Resolve a human-readable product name from the products table.
 * Falls back to 'Your Subscription' on any error.
 */
async function getProductName(productId: string): Promise<string> {
  try {
    const db = await getDbAsync();
    const [product] = await db
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    return product ? resolveLocalizedField(product.name, 'Your Subscription') : 'Your Subscription';
  } catch (error) {
    console.error('[webhook] Failed to resolve product name:', error);
    return 'Your Subscription';
  }
}

/**
 * Handle invoice.payment_succeeded
 *
 * For renewal invoices (not the initial subscription_create invoice),
 * creates a "renewed" audit event and sends a renewal email.
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

  const d1Sub = await getSubscriptionByStripeId(stripeSubscriptionId);
  if (!d1Sub) {
    console.warn('[webhook] invoice.payment_succeeded: no D1 record for subscription', stripeSubscriptionId);
    return;
  }

  // Only treat as renewal if this is not the first invoice
  if (invoice.billing_reason === 'subscription_create') {
    console.log('[webhook] invoice.payment_succeeded: initial invoice, skipping renewal flow');
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

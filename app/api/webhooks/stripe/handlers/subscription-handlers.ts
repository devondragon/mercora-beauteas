/**
 * Subscription Webhook Handlers
 *
 * Handles customer.subscription.created, customer.subscription.updated,
 * and customer.subscription.deleted events from Stripe.
 *
 * Stripe is the billing authority; D1 is the sync layer.
 * Each handler updates D1 state, creates an audit event, and triggers
 * the appropriate lifecycle email.
 */

import type Stripe from 'stripe';
import {
  getSubscriptionByStripeId,
  getSubscriptionPlanByStripePriceId,
  getSubscriptionPlanById,
  createCustomerSubscription,
  updateSubscriptionStatus,
  updateSubscriptionPeriod,
  createSubscriptionEvent,
} from '@/lib/models/mach/subscriptions';
import { getStripeForWorkers } from '@/lib/stripe';
import { sendSubscriptionEmail } from '@/lib/utils/email';
import type { SubscriptionFrequency } from '@/lib/types/subscription';
import { BASE_URL, resolveLocalizedField } from '@/lib/seo/metadata';
import { getDbAsync } from '@/lib/db';
import { products } from '@/lib/db/schema/products';
import { eq } from 'drizzle-orm';

/**
 * Retrieve Stripe customer details for email sending.
 * Returns email and name, falling back to empty string if not available.
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
 * Handle customer.subscription.created
 *
 * Creates a D1 subscription record and audit event.
 * Sends a "created" lifecycle email.
 */
export async function handleSubscriptionCreated(
  subscription: Stripe.Subscription,
  stripeEventId: string
): Promise<void> {
  const stripeSubscriptionId = subscription.id;
  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;
  const stripePriceId = subscription.items.data[0]?.price?.id;

  if (!stripePriceId) {
    console.warn('[webhook] subscription.created: no price ID found on subscription', stripeSubscriptionId);
    return;
  }

  // Look up the subscription plan by Stripe price ID
  const plan = await getSubscriptionPlanByStripePriceId(stripePriceId);
  if (!plan) {
    console.warn('[webhook] subscription.created: no matching plan for price', stripePriceId);
    return;
  }

  // Derive customer_id from subscription metadata if available,
  // otherwise use the stripe_customer_id as a fallback identifier
  const customerId = subscription.metadata?.customer_id || stripeCustomerId;

  // In newer Stripe API versions, period dates live on subscription items
  const firstItem = subscription.items.data[0];
  const periodStart = firstItem?.current_period_start
    ? new Date(firstItem.current_period_start * 1000).toISOString()
    : undefined;
  const periodEnd = firstItem?.current_period_end
    ? new Date(firstItem.current_period_end * 1000).toISOString()
    : undefined;

  const d1Sub = await createCustomerSubscription({
    customer_id: customerId,
    plan_id: plan.id,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: stripeCustomerId,
    status: subscription.status as 'active' | 'paused' | 'canceled' | 'past_due' | 'incomplete' | 'trialing',
    current_period_start: periodStart,
    current_period_end: periodEnd,
  });

  await createSubscriptionEvent({
    subscription_id: d1Sub.id,
    event_type: 'created',
    stripe_event_id: stripeEventId,
  });

  // Send lifecycle email (fire-and-forget)
  const customer = await getCustomerDetails(stripeCustomerId);
  if (customer.email) {
    const productName = await getProductName(plan.product_id);
    sendSubscriptionEmail('created', {
      customerEmail: customer.email,
      customerName: customer.name || 'Valued Customer',
      productName,
      frequency: plan.frequency as SubscriptionFrequency,
      subscriptionId: d1Sub.id,
      nextBillingDate: periodEnd ? new Date(periodEnd).toLocaleDateString() : undefined,
      manageUrl: `${BASE_URL}/subscriptions`,
    }).catch((err) => console.error('[webhook] Failed to send created email:', err));
  }

  console.log('[webhook] subscription.created processed:', d1Sub.id);
}

/**
 * Handle customer.subscription.updated
 *
 * Detects pause/resume via pause_collection field, cancel_at_period_end,
 * status changes, and period updates. Updates D1 state accordingly.
 */
export async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  stripeEventId: string
): Promise<void> {
  const d1Sub = await getSubscriptionByStripeId(subscription.id);
  if (!d1Sub) {
    console.warn('[webhook] subscription.updated: no D1 record for', subscription.id);
    return;
  }

  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;

  // Detect pause: pause_collection is set and D1 status is not already paused
  if (subscription.pause_collection && d1Sub.status !== 'paused') {
    await updateSubscriptionStatus(d1Sub.id, {
      status: 'paused',
      pause_collection: JSON.stringify(subscription.pause_collection),
    });
    await createSubscriptionEvent({
      subscription_id: d1Sub.id,
      event_type: 'paused',
      stripe_event_id: stripeEventId,
    });

    // Send paused email (fire-and-forget)
    const customer = await getCustomerDetails(stripeCustomerId);
    if (customer.email) {
      const plan = await getSubscriptionPlanById(d1Sub.plan_id);
      const productName = plan ? await getProductName(plan.product_id) : 'Your Subscription';
      sendSubscriptionEmail('paused', {
        customerEmail: customer.email,
        customerName: customer.name || 'Valued Customer',
        productName,
        frequency: (plan?.frequency || 'monthly') as SubscriptionFrequency,
        subscriptionId: d1Sub.id,
        manageUrl: `${BASE_URL}/subscriptions`,
      }).catch((err) => console.error('[webhook] Failed to send paused email:', err));
    }

    console.log('[webhook] subscription.updated: paused', d1Sub.id);
  }
  // Detect resume: pause_collection is null and D1 status is paused
  else if (!subscription.pause_collection && d1Sub.status === 'paused') {
    await updateSubscriptionStatus(d1Sub.id, {
      status: 'active',
      pause_collection: null,
    });
    await createSubscriptionEvent({
      subscription_id: d1Sub.id,
      event_type: 'resumed',
      stripe_event_id: stripeEventId,
    });

    // Send resumed email (fire-and-forget)
    const customer = await getCustomerDetails(stripeCustomerId);
    if (customer.email) {
      const plan = await getSubscriptionPlanById(d1Sub.plan_id);
      const productName = plan ? await getProductName(plan.product_id) : 'Your Subscription';
      sendSubscriptionEmail('resumed', {
        customerEmail: customer.email,
        customerName: customer.name || 'Valued Customer',
        productName,
        frequency: (plan?.frequency || 'monthly') as SubscriptionFrequency,
        subscriptionId: d1Sub.id,
        manageUrl: `${BASE_URL}/subscriptions`,
      }).catch((err) => console.error('[webhook] Failed to send resumed email:', err));
    }

    console.log('[webhook] subscription.updated: resumed', d1Sub.id);
  }
  // Detect cancel_at_period_end change
  else if (subscription.cancel_at_period_end && !d1Sub.cancel_at_period_end) {
    await updateSubscriptionStatus(d1Sub.id, {
      status: d1Sub.status as 'active' | 'paused' | 'canceled' | 'past_due' | 'incomplete' | 'trialing',
      cancel_at_period_end: true,
    });
    await createSubscriptionEvent({
      subscription_id: d1Sub.id,
      event_type: 'updated',
      stripe_event_id: stripeEventId,
      details: JSON.stringify({ change: 'cancel_at_period_end', value: true }),
    });

    console.log('[webhook] subscription.updated: cancel_at_period_end set', d1Sub.id);
  }
  // Detect status change (e.g., past_due)
  else if (subscription.status !== d1Sub.status) {
    await updateSubscriptionStatus(d1Sub.id, {
      status: subscription.status as 'active' | 'paused' | 'canceled' | 'past_due' | 'incomplete' | 'trialing',
    });
    await createSubscriptionEvent({
      subscription_id: d1Sub.id,
      event_type: 'updated',
      stripe_event_id: stripeEventId,
      details: JSON.stringify({ change: 'status', from: d1Sub.status, to: subscription.status }),
    });

    console.log('[webhook] subscription.updated: status changed', d1Sub.status, '->', subscription.status);
  }

  // Always update period dates (live on subscription items in newer Stripe API versions)
  const updatedFirstItem = subscription.items.data[0];
  const periodStart = updatedFirstItem?.current_period_start
    ? new Date(updatedFirstItem.current_period_start * 1000).toISOString()
    : null;
  const periodEnd = updatedFirstItem?.current_period_end
    ? new Date(updatedFirstItem.current_period_end * 1000).toISOString()
    : null;

  if (periodStart && periodEnd) {
    await updateSubscriptionPeriod(d1Sub.id, periodStart, periodEnd);
  }
}

/**
 * Handle customer.subscription.deleted
 *
 * Marks subscription as canceled in D1, creates audit event, sends email.
 */
export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  stripeEventId: string
): Promise<void> {
  const d1Sub = await getSubscriptionByStripeId(subscription.id);
  if (!d1Sub) {
    console.warn('[webhook] subscription.deleted: no D1 record for', subscription.id);
    return;
  }

  const stripeCustomerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;

  await updateSubscriptionStatus(d1Sub.id, {
    status: 'canceled',
    canceled_at: new Date().toISOString(),
  });

  await createSubscriptionEvent({
    subscription_id: d1Sub.id,
    event_type: 'canceled',
    stripe_event_id: stripeEventId,
  });

  // Send canceled email (fire-and-forget)
  const customer = await getCustomerDetails(stripeCustomerId);
  if (customer.email) {
    const plan = await getSubscriptionPlanById(d1Sub.plan_id);
    const productName = plan ? await getProductName(plan.product_id) : 'Your Subscription';
    sendSubscriptionEmail('canceled', {
      customerEmail: customer.email,
      customerName: customer.name || 'Valued Customer',
      productName,
      frequency: (plan?.frequency || 'monthly') as SubscriptionFrequency,
      subscriptionId: d1Sub.id,
      manageUrl: `${BASE_URL}/subscriptions`,
    }).catch((err) => console.error('[webhook] Failed to send canceled email:', err));
  }

  console.log('[webhook] subscription.deleted processed:', d1Sub.id);
}

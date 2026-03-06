/**
 * Subscription Model - CRUD Operations
 *
 * Business logic and data access for subscription plans,
 * customer subscriptions, subscription events, and webhook dedup.
 */

import { getDbAsync } from '@/lib/db';
import {
  subscription_plans,
  customer_subscriptions,
  subscription_events,
} from '@/lib/db/schema/subscription';
import { processed_webhook_events } from '@/lib/db/schema/webhook-events';
import { eq, and, desc, lt, sql } from 'drizzle-orm';

// ─── Subscription Plans ───────────────────────────────────────────

export async function listSubscriptionPlans(productId?: string) {
  const db = await getDbAsync();
  if (productId) {
    return db
      .select()
      .from(subscription_plans)
      .where(
        and(
          eq(subscription_plans.product_id, productId),
          eq(subscription_plans.is_active, true)
        )
      );
  }
  return db
    .select()
    .from(subscription_plans)
    .where(eq(subscription_plans.is_active, true));
}

export async function createSubscriptionPlan(data: {
  product_id: string;
  frequency: 'biweekly' | 'monthly' | 'bimonthly';
  discount_percent: number;
  stripe_price_id?: string;
}) {
  const db = await getDbAsync();
  const [plan] = await db
    .insert(subscription_plans)
    .values(data)
    .returning();
  return plan;
}

export async function getSubscriptionPlanById(id: string) {
  const db = await getDbAsync();
  const [plan] = await db
    .select()
    .from(subscription_plans)
    .where(eq(subscription_plans.id, id))
    .limit(1);
  return plan ?? undefined;
}

// ─── Customer Subscriptions ───────────────────────────────────────

export async function getSubscriptionByStripeId(stripeSubscriptionId: string) {
  const db = await getDbAsync();
  const [sub] = await db
    .select()
    .from(customer_subscriptions)
    .where(eq(customer_subscriptions.stripe_subscription_id, stripeSubscriptionId))
    .limit(1);
  return sub ?? undefined;
}

export async function getSubscriptionsByCustomer(customerId: string) {
  const db = await getDbAsync();
  return db
    .select()
    .from(customer_subscriptions)
    .where(eq(customer_subscriptions.customer_id, customerId))
    .orderBy(desc(customer_subscriptions.created_at));
}

export async function createCustomerSubscription(data: {
  customer_id: string;
  plan_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status?: 'active' | 'paused' | 'canceled' | 'past_due' | 'incomplete' | 'trialing';
  current_period_start?: string;
  current_period_end?: string;
}) {
  const db = await getDbAsync();
  const [sub] = await db
    .insert(customer_subscriptions)
    .values(data)
    .returning();
  return sub;
}

export async function updateSubscriptionStatus(
  subscriptionId: string,
  updates: {
    status: 'active' | 'paused' | 'canceled' | 'past_due' | 'incomplete' | 'trialing';
    canceled_at?: string | null;
    pause_collection?: string | null;
    cancel_at_period_end?: boolean;
  }
) {
  const db = await getDbAsync();
  await db
    .update(customer_subscriptions)
    .set({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .where(eq(customer_subscriptions.id, subscriptionId));
}

export async function updateSubscriptionPeriod(
  subscriptionId: string,
  periodStart: string,
  periodEnd: string
) {
  const db = await getDbAsync();
  await db
    .update(customer_subscriptions)
    .set({
      current_period_start: periodStart,
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    })
    .where(eq(customer_subscriptions.id, subscriptionId));
}

// ─── Subscription Events ─────────────────────────────────────────

export async function createSubscriptionEvent(data: {
  subscription_id: string;
  event_type: 'created' | 'renewed' | 'payment_failed' | 'paused' | 'resumed' | 'skipped' | 'canceled' | 'updated';
  stripe_event_id?: string;
  details?: string;
}) {
  const db = await getDbAsync();
  const [event] = await db
    .insert(subscription_events)
    .values(data)
    .returning();
  return event;
}

export async function getSubscriptionEvents(subscriptionId: string) {
  const db = await getDbAsync();
  return db
    .select()
    .from(subscription_events)
    .where(eq(subscription_events.subscription_id, subscriptionId))
    .orderBy(desc(subscription_events.created_at));
}

// ─── Stats ────────────────────────────────────────────────────────

export async function getSubscriptionStats() {
  const db = await getDbAsync();
  const [result] = await db
    .select({
      active: sql<number>`SUM(CASE WHEN ${customer_subscriptions.status} = 'active' THEN 1 ELSE 0 END)`,
      paused: sql<number>`SUM(CASE WHEN ${customer_subscriptions.status} = 'paused' THEN 1 ELSE 0 END)`,
      canceled: sql<number>`SUM(CASE WHEN ${customer_subscriptions.status} = 'canceled' THEN 1 ELSE 0 END)`,
      total: sql<number>`COUNT(*)`,
    })
    .from(customer_subscriptions);

  return {
    active: result?.active ?? 0,
    paused: result?.paused ?? 0,
    canceled: result?.canceled ?? 0,
    total: result?.total ?? 0,
  };
}

// ─── Webhook Dedup ────────────────────────────────────────────────

export async function isWebhookEventProcessed(eventId: string): Promise<boolean> {
  const db = await getDbAsync();
  const [existing] = await db
    .select()
    .from(processed_webhook_events)
    .where(eq(processed_webhook_events.event_id, eventId))
    .limit(1);
  return !!existing;
}

export async function recordWebhookEvent(eventId: string, eventType: string) {
  const db = await getDbAsync();
  await db.insert(processed_webhook_events).values({
    event_id: eventId,
    event_type: eventType,
    processed_at: new Date().toISOString(),
  });
}

export async function cleanupOldWebhookEvents() {
  const db = await getDbAsync();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .delete(processed_webhook_events)
    .where(lt(processed_webhook_events.processed_at, cutoff));
}

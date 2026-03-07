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
import { eq, and, desc, lt, sql, count, like, gte } from 'drizzle-orm';
import { customers } from '@/lib/db/schema/customer';
import { products, product_variants } from '@/lib/db/schema/products';

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

export async function getSubscriptionPlanByStripePriceId(stripePriceId: string) {
  const db = await getDbAsync();
  const [plan] = await db
    .select()
    .from(subscription_plans)
    .where(eq(subscription_plans.stripe_price_id, stripePriceId))
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

// ─── Admin Queries ────────────────────────────────────────────────

/**
 * Safely parse a JSON string, returning null on failure.
 */
function safeJsonParse<T = unknown>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Extract localized product name from JSON name field.
 * Product names are stored as {"en": "Green Tea"} or plain strings.
 */
function parseProductName(name: string | null | undefined): string {
  if (!name) return 'Unknown Product';
  const parsed = safeJsonParse<Record<string, string>>(name);
  if (parsed && typeof parsed === 'object') {
    return parsed.en || parsed[Object.keys(parsed)[0]] || 'Unknown Product';
  }
  return name;
}

/**
 * Extract variant price amount from JSON Money field.
 * Variant prices are stored as {"amount": 2499, "currency": "USD"}.
 * Returns amount in cents.
 */
function parseVariantPriceAmount(price: unknown): number {
  if (!price) return 0;
  if (typeof price === 'object' && price !== null && 'amount' in price) {
    return (price as { amount: number }).amount ?? 0;
  }
  if (typeof price === 'string') {
    const parsed = safeJsonParse<{ amount?: number }>(price);
    return parsed?.amount ?? 0;
  }
  return 0;
}

/**
 * Paginated subscription list with joined plan, product, and customer data
 * for the admin subscription table.
 */
export async function listSubscriptionsAdmin(options: {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}) {
  const db = await getDbAsync();
  const { limit, offset, status, search } = options;

  // Build conditions
  const conditions = [];
  if (status && status !== 'all') {
    conditions.push(eq(customer_subscriptions.status, status as 'active' | 'paused' | 'canceled' | 'past_due' | 'incomplete' | 'trialing'));
  }
  if (search) {
    conditions.push(like(customers.person, `%${search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Query items with joins
  const items = await db
    .select({
      subscription: customer_subscriptions,
      planFrequency: subscription_plans.frequency,
      planDiscountPercent: subscription_plans.discount_percent,
      productName: products.name,
      productSlug: products.slug,
      customerPerson: customers.person,
      variantPrice: product_variants.price,
    })
    .from(customer_subscriptions)
    .leftJoin(subscription_plans, eq(subscription_plans.id, customer_subscriptions.plan_id))
    .leftJoin(products, eq(products.id, subscription_plans.product_id))
    .leftJoin(product_variants, eq(product_variants.product_id, subscription_plans.product_id))
    .leftJoin(customers, eq(customers.id, customer_subscriptions.customer_id))
    .where(whereClause)
    .orderBy(desc(customer_subscriptions.created_at))
    .limit(limit)
    .offset(offset);

  // Count total
  const [countResult] = await db
    .select({ total: count() })
    .from(customer_subscriptions)
    .leftJoin(subscription_plans, eq(subscription_plans.id, customer_subscriptions.plan_id))
    .leftJoin(customers, eq(customers.id, customer_subscriptions.customer_id))
    .where(whereClause);

  // Deduplicate: the LEFT JOIN on product_variants may produce multiple rows
  // per subscription (one per variant). We only need the first variant price.
  const seen = new Set<string>();
  const dedupedItems = items.filter((item) => {
    const id = item.subscription.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Transform items to include parsed JSON fields
  const transformed = dedupedItems.map((item) => ({
    ...item.subscription,
    planFrequency: item.planFrequency,
    planDiscountPercent: item.planDiscountPercent,
    productName: parseProductName(item.productName),
    productSlug: item.productSlug,
    customerPerson: safeJsonParse(item.customerPerson),
    variantPriceAmount: parseVariantPriceAmount(item.variantPrice),
  }));

  return {
    items: transformed,
    total: countResult?.total ?? 0,
  };
}

/**
 * Extended KPI metrics for the admin subscription dashboard stat cards.
 */
export async function getAdminSubscriptionStats() {
  const db = await getDbAsync();

  // Active and paused counts
  const [statusCounts] = await db
    .select({
      activeCount: sql<number>`SUM(CASE WHEN ${customer_subscriptions.status} = 'active' THEN 1 ELSE 0 END)`,
      pausedCount: sql<number>`SUM(CASE WHEN ${customer_subscriptions.status} = 'paused' THEN 1 ELSE 0 END)`,
    })
    .from(customer_subscriptions);

  const activeCount = statusCounts?.activeCount ?? 0;
  const pausedCount = statusCounts?.pausedCount ?? 0;

  // MRR: For each active subscription, join to plan for discount and product variant for price
  // Deduplicate by subscription (multiple variants per product)
  const seenSubs = new Set<string>();
  const mrrItems: Array<{ discountPercent: number | null; variantPrice: unknown }> = [];
  const activeSubsForMrr = await db
    .select({
      subId: customer_subscriptions.id,
      discountPercent: subscription_plans.discount_percent,
      variantPrice: product_variants.price,
    })
    .from(customer_subscriptions)
    .leftJoin(subscription_plans, eq(subscription_plans.id, customer_subscriptions.plan_id))
    .leftJoin(product_variants, eq(product_variants.product_id, subscription_plans.product_id))
    .where(eq(customer_subscriptions.status, 'active'));

  for (const row of activeSubsForMrr) {
    if (!seenSubs.has(row.subId)) {
      seenSubs.add(row.subId);
      mrrItems.push({ discountPercent: row.discountPercent, variantPrice: row.variantPrice });
    }
  }

  let mrr = 0;
  for (const item of mrrItems) {
    const priceAmount = parseVariantPriceAmount(item.variantPrice);
    const discount = item.discountPercent ?? 0;
    // price is in cents, MRR in dollars
    mrr += (priceAmount * (1 - discount / 100)) / 100;
  }

  // Churn rate (30-day rolling)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [canceledResult] = await db
    .select({ canceledCount: count() })
    .from(subscription_events)
    .where(
      and(
        eq(subscription_events.event_type, 'canceled'),
        gte(subscription_events.created_at, thirtyDaysAgo)
      )
    );

  const canceledInPeriod = canceledResult?.canceledCount ?? 0;
  const startActive = activeCount + canceledInPeriod;
  const churnRate = startActive > 0 ? (canceledInPeriod / startActive) * 100 : 0;

  // New this month
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [newResult] = await db
    .select({ newCount: count() })
    .from(customer_subscriptions)
    .where(gte(customer_subscriptions.created_at, firstOfMonth));

  const newThisMonth = newResult?.newCount ?? 0;

  // Revenue trend: compare current month active subs vs previous month estimate
  // Simple approach: count subs created before this month vs total active
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const lastMonthEnd = firstOfMonth;

  const [lastMonthNew] = await db
    .select({ cnt: count() })
    .from(customer_subscriptions)
    .where(
      and(
        gte(customer_subscriptions.created_at, lastMonthStart),
        lt(customer_subscriptions.created_at, lastMonthEnd)
      )
    );

  const lastMonthNewCount = lastMonthNew?.cnt ?? 0;
  // Estimate: last month's active = current active - new this month + canceled this month's portion
  const lastMonthActiveEstimate = activeCount - newThisMonth + canceledInPeriod;
  const revenueTrendPercent = lastMonthActiveEstimate > 0
    ? ((activeCount - lastMonthActiveEstimate) / lastMonthActiveEstimate) * 100
    : 0;

  return {
    activeCount,
    pausedCount,
    mrr: Math.round(mrr * 100) / 100, // round to 2 decimal places
    churnRate: Math.round(churnRate * 100) / 100,
    newThisMonth,
    revenueTrendPercent: Math.round(revenueTrendPercent * 100) / 100,
  };
}

/**
 * Full subscription detail with plan, product, and customer data for the detail page.
 */
export async function getSubscriptionDetail(subscriptionId: string) {
  const db = await getDbAsync();

  const rows = await db
    .select({
      subscription: customer_subscriptions,
      plan: subscription_plans,
      productName: products.name,
      productSlug: products.slug,
      customerPerson: customers.person,
      variantPrice: product_variants.price,
    })
    .from(customer_subscriptions)
    .leftJoin(subscription_plans, eq(subscription_plans.id, customer_subscriptions.plan_id))
    .leftJoin(products, eq(products.id, subscription_plans.product_id))
    .leftJoin(product_variants, eq(product_variants.product_id, subscription_plans.product_id))
    .leftJoin(customers, eq(customers.id, customer_subscriptions.customer_id))
    .where(eq(customer_subscriptions.id, subscriptionId))
    .limit(1);

  if (!rows.length) return null;

  const row = rows[0];
  return {
    ...row.subscription,
    plan: row.plan,
    productName: parseProductName(row.productName),
    productSlug: row.productSlug,
    customerPerson: safeJsonParse(row.customerPerson),
    variantPriceAmount: parseVariantPriceAmount(row.variantPrice),
  };
}

/**
 * Update an existing subscription plan's discount_percent or is_active status.
 */
export async function updateSubscriptionPlan(
  planId: string,
  updates: { discount_percent?: number; is_active?: boolean }
) {
  const db = await getDbAsync();
  await db
    .update(subscription_plans)
    .set({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .where(eq(subscription_plans.id, planId));
}

/**
 * List plans for a product with active subscriber count.
 * Returns all plans (including inactive) for the product editor.
 */
export async function getPlansWithSubscriberCount(productId: string) {
  const db = await getDbAsync();

  const rows = await db
    .select({
      plan: subscription_plans,
      activeSubscriberCount: sql<number>`COALESCE(SUM(CASE WHEN ${customer_subscriptions.status} = 'active' THEN 1 ELSE 0 END), 0)`,
    })
    .from(subscription_plans)
    .leftJoin(customer_subscriptions, eq(customer_subscriptions.plan_id, subscription_plans.id))
    .where(eq(subscription_plans.product_id, productId))
    .groupBy(subscription_plans.id);

  return rows.map((row) => ({
    ...row.plan,
    activeSubscriberCount: row.activeSubscriberCount ?? 0,
  }));
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

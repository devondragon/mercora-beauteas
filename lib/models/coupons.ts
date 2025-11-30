// lib/models/coupons.ts - Coupon and Discount Operations

import { eq, desc, and, sql, gte, lte, or, isNull } from "drizzle-orm";
import { getDbAsync } from "@/lib/db";
import {
  coupons,
  coupon_redemptions,
  gift_subscriptions,
  subscription_bundles,
  subscription_bundle_items,
  payment_retry_attempts,
} from "@/lib/db/schema/coupons";
import { subscription_plans } from "@/lib/db/schema/subscriptions";

// =====================================================
// Types
// =====================================================

export interface Coupon {
  id: string;
  code: string;
  name: string;
  description?: string;
  discount_type: "percentage" | "fixed_amount";
  discount_value: number;
  currency_code: string;
  duration: "once" | "repeating" | "forever";
  duration_in_months?: number;
  max_redemptions?: number;
  redemption_count: number;
  min_order_amount?: number;
  applies_to_plans?: string[];
  valid_from: string;
  valid_until?: string;
  is_active: boolean;
  stripe_coupon_id?: string;
  stripe_promotion_code_id?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCouponRequest {
  code: string;
  name: string;
  description?: string;
  discount_type: "percentage" | "fixed_amount";
  discount_value: number;
  currency_code?: string;
  duration: "once" | "repeating" | "forever";
  duration_in_months?: number;
  max_redemptions?: number;
  min_order_amount?: number;
  applies_to_plans?: string[];
  valid_from?: string;
  valid_until?: string;
  metadata?: Record<string, unknown>;
}

export interface CouponRedemption {
  id: string;
  coupon_id: string;
  customer_id: string;
  subscription_id?: string;
  order_id?: string;
  discount_amount: number;
  currency_code: string;
  redeemed_at: string;
  expires_at?: string;
  status: "active" | "expired" | "revoked";
}

export interface GiftSubscription {
  id: string;
  sender_customer_id?: string;
  sender_email: string;
  sender_name: string;
  recipient_email: string;
  recipient_name: string;
  plan_id: string;
  gift_message?: string;
  redeem_code: string;
  redeemed_at?: string;
  redeemed_by_customer_id?: string;
  subscription_id?: string;
  expires_at?: string;
  amount_paid: number;
  currency_code: string;
  stripe_payment_intent_id?: string;
  status: "pending" | "paid" | "redeemed" | "expired" | "refunded";
  created_at: string;
  updated_at: string;
}

export interface SubscriptionBundle {
  id: string;
  name: string;
  description?: string;
  price_amount: number;
  currency_code: string;
  interval: "day" | "week" | "month" | "year";
  interval_count: number;
  savings_amount: number;
  savings_percentage: number;
  status: "active" | "inactive" | "archived";
  stripe_product_id?: string;
  stripe_price_id?: string;
  created_at: string;
  updated_at: string;
  items?: Array<{
    id: string;
    plan_id: string;
    quantity: number;
  }>;
}

export interface PaymentRetryAttempt {
  id: string;
  subscription_id: string;
  invoice_id?: string;
  attempt_number: number;
  amount: number;
  currency_code: string;
  status: "pending" | "succeeded" | "failed";
  failure_reason?: string;
  stripe_payment_intent_id?: string;
  scheduled_at: string;
  attempted_at?: string;
  next_retry_at?: string;
  created_at: string;
}

// =====================================================
// Utility Functions
// =====================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function generateCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// =====================================================
// Coupon Operations
// =====================================================

export async function createCoupon(data: CreateCouponRequest): Promise<Coupon> {
  const db = await getDbAsync();
  const id = generateId("coupon");

  const [coupon] = await db
    .insert(coupons)
    .values({
      id,
      code: data.code.toUpperCase(),
      name: data.name,
      description: data.description,
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      currency_code: data.currency_code ?? "USD",
      duration: data.duration,
      duration_in_months: data.duration_in_months,
      max_redemptions: data.max_redemptions,
      min_order_amount: data.min_order_amount,
      applies_to_plans: data.applies_to_plans
        ? JSON.stringify(data.applies_to_plans)
        : null,
      valid_from: data.valid_from ?? new Date().toISOString(),
      valid_until: data.valid_until,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    })
    .returning();

  return hydrateCoupon(coupon);
}

export async function getCoupon(id: string): Promise<Coupon | null> {
  const db = await getDbAsync();

  const [coupon] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.id, id))
    .limit(1);

  return coupon ? hydrateCoupon(coupon) : null;
}

export async function getCouponByCode(code: string): Promise<Coupon | null> {
  const db = await getDbAsync();

  const [coupon] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, code.toUpperCase()))
    .limit(1);

  return coupon ? hydrateCoupon(coupon) : null;
}

export async function listCoupons(activeOnly: boolean = true): Promise<Coupon[]> {
  const db = await getDbAsync();

  let query = db.select().from(coupons);

  if (activeOnly) {
    query = query.where(eq(coupons.is_active, true)) as typeof query;
  }

  const results = await query.orderBy(desc(coupons.created_at));
  return results.map(hydrateCoupon);
}

export async function updateCoupon(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    is_active: boolean;
    valid_until: string;
    max_redemptions: number;
  }>
): Promise<Coupon | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    updated_at: sql`(datetime('now'))`,
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.is_active !== undefined) updateData.is_active = data.is_active;
  if (data.valid_until !== undefined) updateData.valid_until = data.valid_until;
  if (data.max_redemptions !== undefined) updateData.max_redemptions = data.max_redemptions;

  const [coupon] = await db
    .update(coupons)
    .set(updateData)
    .where(eq(coupons.id, id))
    .returning();

  return coupon ? hydrateCoupon(coupon) : null;
}

export async function updateCouponStripeId(
  id: string,
  stripeCouponId: string,
  stripePromotionCodeId?: string
): Promise<void> {
  const db = await getDbAsync();

  await db
    .update(coupons)
    .set({
      stripe_coupon_id: stripeCouponId,
      stripe_promotion_code_id: stripePromotionCodeId,
      updated_at: sql`(datetime('now'))`,
    })
    .where(eq(coupons.id, id));
}

export async function validateCoupon(
  code: string,
  planId?: string,
  orderAmount?: number
): Promise<{ valid: boolean; coupon?: Coupon; error?: string }> {
  const coupon = await getCouponByCode(code);

  if (!coupon) {
    return { valid: false, error: "Coupon not found" };
  }

  if (!coupon.is_active) {
    return { valid: false, error: "Coupon is no longer active" };
  }

  const now = new Date();

  if (new Date(coupon.valid_from) > now) {
    return { valid: false, error: "Coupon is not yet valid" };
  }

  if (coupon.valid_until && new Date(coupon.valid_until) < now) {
    return { valid: false, error: "Coupon has expired" };
  }

  if (coupon.max_redemptions && coupon.redemption_count >= coupon.max_redemptions) {
    return { valid: false, error: "Coupon has reached maximum redemptions" };
  }

  if (coupon.min_order_amount && orderAmount && orderAmount < coupon.min_order_amount) {
    return {
      valid: false,
      error: `Minimum order amount is $${(coupon.min_order_amount / 100).toFixed(2)}`,
    };
  }

  if (coupon.applies_to_plans && planId && !coupon.applies_to_plans.includes(planId)) {
    return { valid: false, error: "Coupon does not apply to this plan" };
  }

  return { valid: true, coupon };
}

export async function redeemCoupon(data: {
  coupon_id: string;
  customer_id: string;
  subscription_id?: string;
  order_id?: string;
  discount_amount: number;
  currency_code?: string;
}): Promise<CouponRedemption> {
  const db = await getDbAsync();
  const id = generateId("redemption");

  // Increment redemption count
  await db
    .update(coupons)
    .set({
      redemption_count: sql`redemption_count + 1`,
      updated_at: sql`(datetime('now'))`,
    })
    .where(eq(coupons.id, data.coupon_id));

  // Get coupon to check duration
  const coupon = await getCoupon(data.coupon_id);
  let expiresAt: string | undefined;

  if (coupon?.duration === "repeating" && coupon.duration_in_months) {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + coupon.duration_in_months);
    expiresAt = expiry.toISOString();
  }

  const [redemption] = await db
    .insert(coupon_redemptions)
    .values({
      id,
      coupon_id: data.coupon_id,
      customer_id: data.customer_id,
      subscription_id: data.subscription_id,
      order_id: data.order_id,
      discount_amount: data.discount_amount,
      currency_code: data.currency_code ?? "USD",
      expires_at: expiresAt,
    })
    .returning();

  return hydrateRedemption(redemption);
}

export async function calculateDiscount(
  coupon: Coupon,
  amount: number
): number {
  if (coupon.discount_type === "percentage") {
    return Math.round((amount * coupon.discount_value) / 100);
  }
  return Math.min(coupon.discount_value, amount);
}

function hydrateCoupon(record: typeof coupons.$inferSelect): Coupon {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    description: record.description ?? undefined,
    discount_type: record.discount_type as Coupon["discount_type"],
    discount_value: record.discount_value,
    currency_code: record.currency_code ?? "USD",
    duration: record.duration as Coupon["duration"],
    duration_in_months: record.duration_in_months ?? undefined,
    max_redemptions: record.max_redemptions ?? undefined,
    redemption_count: record.redemption_count ?? 0,
    min_order_amount: record.min_order_amount ?? undefined,
    applies_to_plans: record.applies_to_plans
      ? JSON.parse(record.applies_to_plans as string)
      : undefined,
    valid_from: record.valid_from,
    valid_until: record.valid_until ?? undefined,
    is_active: record.is_active ?? true,
    stripe_coupon_id: record.stripe_coupon_id ?? undefined,
    stripe_promotion_code_id: record.stripe_promotion_code_id ?? undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
    metadata: record.metadata ? JSON.parse(record.metadata as string) : undefined,
  };
}

function hydrateRedemption(
  record: typeof coupon_redemptions.$inferSelect
): CouponRedemption {
  return {
    id: record.id,
    coupon_id: record.coupon_id,
    customer_id: record.customer_id,
    subscription_id: record.subscription_id ?? undefined,
    order_id: record.order_id ?? undefined,
    discount_amount: record.discount_amount,
    currency_code: record.currency_code ?? "USD",
    redeemed_at: record.redeemed_at,
    expires_at: record.expires_at ?? undefined,
    status: record.status as CouponRedemption["status"],
  };
}

// =====================================================
// Gift Subscription Operations
// =====================================================

export async function createGiftSubscription(data: {
  sender_customer_id?: string;
  sender_email: string;
  sender_name: string;
  recipient_email: string;
  recipient_name: string;
  plan_id: string;
  gift_message?: string;
  amount_paid: number;
  currency_code?: string;
  expires_at?: string;
}): Promise<GiftSubscription> {
  const db = await getDbAsync();
  const id = generateId("gift");
  const redeemCode = generateCode();

  const [gift] = await db
    .insert(gift_subscriptions)
    .values({
      id,
      sender_customer_id: data.sender_customer_id,
      sender_email: data.sender_email,
      sender_name: data.sender_name,
      recipient_email: data.recipient_email,
      recipient_name: data.recipient_name,
      plan_id: data.plan_id,
      gift_message: data.gift_message,
      redeem_code: redeemCode,
      amount_paid: data.amount_paid,
      currency_code: data.currency_code ?? "USD",
      expires_at: data.expires_at,
      status: "pending",
    })
    .returning();

  return hydrateGift(gift);
}

export async function getGiftSubscription(id: string): Promise<GiftSubscription | null> {
  const db = await getDbAsync();

  const [gift] = await db
    .select()
    .from(gift_subscriptions)
    .where(eq(gift_subscriptions.id, id))
    .limit(1);

  return gift ? hydrateGift(gift) : null;
}

export async function getGiftByRedeemCode(code: string): Promise<GiftSubscription | null> {
  const db = await getDbAsync();

  const [gift] = await db
    .select()
    .from(gift_subscriptions)
    .where(eq(gift_subscriptions.redeem_code, code.toUpperCase()))
    .limit(1);

  return gift ? hydrateGift(gift) : null;
}

export async function updateGiftSubscription(
  id: string,
  data: Partial<{
    status: GiftSubscription["status"];
    stripe_payment_intent_id: string;
    redeemed_at: string;
    redeemed_by_customer_id: string;
    subscription_id: string;
  }>
): Promise<GiftSubscription | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {
    updated_at: sql`(datetime('now'))`,
  };

  if (data.status !== undefined) updateData.status = data.status;
  if (data.stripe_payment_intent_id !== undefined)
    updateData.stripe_payment_intent_id = data.stripe_payment_intent_id;
  if (data.redeemed_at !== undefined) updateData.redeemed_at = data.redeemed_at;
  if (data.redeemed_by_customer_id !== undefined)
    updateData.redeemed_by_customer_id = data.redeemed_by_customer_id;
  if (data.subscription_id !== undefined) updateData.subscription_id = data.subscription_id;

  const [gift] = await db
    .update(gift_subscriptions)
    .set(updateData)
    .where(eq(gift_subscriptions.id, id))
    .returning();

  return gift ? hydrateGift(gift) : null;
}

function hydrateGift(record: typeof gift_subscriptions.$inferSelect): GiftSubscription {
  return {
    id: record.id,
    sender_customer_id: record.sender_customer_id ?? undefined,
    sender_email: record.sender_email,
    sender_name: record.sender_name,
    recipient_email: record.recipient_email,
    recipient_name: record.recipient_name,
    plan_id: record.plan_id,
    gift_message: record.gift_message ?? undefined,
    redeem_code: record.redeem_code,
    redeemed_at: record.redeemed_at ?? undefined,
    redeemed_by_customer_id: record.redeemed_by_customer_id ?? undefined,
    subscription_id: record.subscription_id ?? undefined,
    expires_at: record.expires_at ?? undefined,
    amount_paid: record.amount_paid,
    currency_code: record.currency_code ?? "USD",
    stripe_payment_intent_id: record.stripe_payment_intent_id ?? undefined,
    status: record.status as GiftSubscription["status"],
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

// =====================================================
// Bundle Operations
// =====================================================

export async function createBundle(data: {
  name: string;
  description?: string;
  price_amount: number;
  currency_code?: string;
  interval: SubscriptionBundle["interval"];
  interval_count?: number;
  savings_amount?: number;
  savings_percentage?: number;
  plan_ids: string[];
}): Promise<SubscriptionBundle> {
  const db = await getDbAsync();
  const id = generateId("bundle");

  const [bundle] = await db
    .insert(subscription_bundles)
    .values({
      id,
      name: data.name,
      description: data.description,
      price_amount: data.price_amount,
      currency_code: data.currency_code ?? "USD",
      interval: data.interval,
      interval_count: data.interval_count ?? 1,
      savings_amount: data.savings_amount ?? 0,
      savings_percentage: data.savings_percentage ?? 0,
    })
    .returning();

  // Add bundle items
  for (const planId of data.plan_ids) {
    await db.insert(subscription_bundle_items).values({
      id: generateId("bundleitem"),
      bundle_id: id,
      plan_id: planId,
    });
  }

  return hydrateBundle(bundle);
}

export async function getBundle(id: string): Promise<SubscriptionBundle | null> {
  const db = await getDbAsync();

  const [bundle] = await db
    .select()
    .from(subscription_bundles)
    .where(eq(subscription_bundles.id, id))
    .limit(1);

  if (!bundle) return null;

  const items = await db
    .select()
    .from(subscription_bundle_items)
    .where(eq(subscription_bundle_items.bundle_id, id));

  return {
    ...hydrateBundle(bundle),
    items: items.map((item) => ({
      id: item.id,
      plan_id: item.plan_id,
      quantity: item.quantity ?? 1,
    })),
  };
}

export async function listBundles(activeOnly: boolean = true): Promise<SubscriptionBundle[]> {
  const db = await getDbAsync();

  let query = db.select().from(subscription_bundles);

  if (activeOnly) {
    query = query.where(eq(subscription_bundles.status, "active")) as typeof query;
  }

  const bundles = await query.orderBy(desc(subscription_bundles.created_at));
  return bundles.map(hydrateBundle);
}

function hydrateBundle(record: typeof subscription_bundles.$inferSelect): SubscriptionBundle {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? undefined,
    price_amount: record.price_amount,
    currency_code: record.currency_code ?? "USD",
    interval: record.interval as SubscriptionBundle["interval"],
    interval_count: record.interval_count ?? 1,
    savings_amount: record.savings_amount ?? 0,
    savings_percentage: record.savings_percentage ?? 0,
    status: record.status as SubscriptionBundle["status"],
    stripe_product_id: record.stripe_product_id ?? undefined,
    stripe_price_id: record.stripe_price_id ?? undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

// =====================================================
// Payment Retry Operations (Dunning)
// =====================================================

export async function createPaymentRetryAttempt(data: {
  subscription_id: string;
  invoice_id?: string;
  attempt_number: number;
  amount: number;
  currency_code?: string;
  scheduled_at: string;
}): Promise<PaymentRetryAttempt> {
  const db = await getDbAsync();
  const id = generateId("retry");

  const [attempt] = await db
    .insert(payment_retry_attempts)
    .values({
      id,
      subscription_id: data.subscription_id,
      invoice_id: data.invoice_id,
      attempt_number: data.attempt_number,
      amount: data.amount,
      currency_code: data.currency_code ?? "USD",
      status: "pending",
      scheduled_at: data.scheduled_at,
    })
    .returning();

  return hydrateRetryAttempt(attempt);
}

export async function updatePaymentRetryAttempt(
  id: string,
  data: Partial<{
    status: PaymentRetryAttempt["status"];
    failure_reason: string;
    stripe_payment_intent_id: string;
    attempted_at: string;
    next_retry_at: string;
  }>
): Promise<PaymentRetryAttempt | null> {
  const db = await getDbAsync();

  const updateData: Record<string, unknown> = {};

  if (data.status !== undefined) updateData.status = data.status;
  if (data.failure_reason !== undefined) updateData.failure_reason = data.failure_reason;
  if (data.stripe_payment_intent_id !== undefined)
    updateData.stripe_payment_intent_id = data.stripe_payment_intent_id;
  if (data.attempted_at !== undefined) updateData.attempted_at = data.attempted_at;
  if (data.next_retry_at !== undefined) updateData.next_retry_at = data.next_retry_at;

  const [attempt] = await db
    .update(payment_retry_attempts)
    .set(updateData)
    .where(eq(payment_retry_attempts.id, id))
    .returning();

  return attempt ? hydrateRetryAttempt(attempt) : null;
}

export async function getPendingRetryAttempts(
  beforeDate: Date
): Promise<PaymentRetryAttempt[]> {
  const db = await getDbAsync();

  const attempts = await db
    .select()
    .from(payment_retry_attempts)
    .where(
      and(
        eq(payment_retry_attempts.status, "pending"),
        lte(payment_retry_attempts.scheduled_at, beforeDate.toISOString())
      )
    )
    .orderBy(payment_retry_attempts.scheduled_at);

  return attempts.map(hydrateRetryAttempt);
}

export async function getSubscriptionRetryAttempts(
  subscriptionId: string
): Promise<PaymentRetryAttempt[]> {
  const db = await getDbAsync();

  const attempts = await db
    .select()
    .from(payment_retry_attempts)
    .where(eq(payment_retry_attempts.subscription_id, subscriptionId))
    .orderBy(desc(payment_retry_attempts.created_at));

  return attempts.map(hydrateRetryAttempt);
}

function hydrateRetryAttempt(
  record: typeof payment_retry_attempts.$inferSelect
): PaymentRetryAttempt {
  return {
    id: record.id,
    subscription_id: record.subscription_id,
    invoice_id: record.invoice_id ?? undefined,
    attempt_number: record.attempt_number,
    amount: record.amount,
    currency_code: record.currency_code ?? "USD",
    status: record.status as PaymentRetryAttempt["status"],
    failure_reason: record.failure_reason ?? undefined,
    stripe_payment_intent_id: record.stripe_payment_intent_id ?? undefined,
    scheduled_at: record.scheduled_at,
    attempted_at: record.attempted_at ?? undefined,
    next_retry_at: record.next_retry_at ?? undefined,
    created_at: record.created_at,
  };
}

// =====================================================
// Dunning Configuration
// =====================================================

export const DUNNING_CONFIG = {
  maxAttempts: 4,
  // Days between retry attempts
  retrySchedule: [1, 3, 5, 7],
  // After all retries fail, wait this many days before cancelling
  gracePeriodDays: 3,
};

export function getNextRetryDate(attemptNumber: number): Date | null {
  if (attemptNumber >= DUNNING_CONFIG.maxAttempts) {
    return null;
  }

  const daysToWait = DUNNING_CONFIG.retrySchedule[attemptNumber] || 7;
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + daysToWait);
  return nextDate;
}

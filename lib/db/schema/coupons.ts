// lib/db/schema/coupons.ts - Coupon and Discount Schema

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { customers } from "./customer";
import { orders } from "./order";
import { subscriptions, subscription_plans, subscription_invoices } from "./subscriptions";

/**
 * Coupons Table
 * Stores discount codes and promotion rules
 */
export const coupons = sqliteTable("coupons", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),

  // Discount configuration
  discount_type: text("discount_type", {
    enum: ["percentage", "fixed_amount"],
  }).notNull(),
  discount_value: integer("discount_value").notNull(),
  currency_code: text("currency_code", { length: 3 }).default("USD"),

  // Duration settings
  duration: text("duration", {
    enum: ["once", "repeating", "forever"],
  }).notNull(),
  duration_in_months: integer("duration_in_months"),

  // Restrictions
  max_redemptions: integer("max_redemptions"),
  redemption_count: integer("redemption_count").default(0),
  min_order_amount: integer("min_order_amount"),
  applies_to_plans: text("applies_to_plans", { mode: "json" }),

  // Validity period
  valid_from: text("valid_from").notNull().default(sql`(datetime('now'))`),
  valid_until: text("valid_until"),

  // Status
  is_active: integer("is_active", { mode: "boolean" }).default(true),

  // Stripe integration
  stripe_coupon_id: text("stripe_coupon_id").unique(),
  stripe_promotion_code_id: text("stripe_promotion_code_id"),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),

  // MACH compliance
  metadata: text("metadata", { mode: "json" }),
  extensions: text("extensions", { mode: "json" }),
});

/**
 * Coupon Redemptions Table
 * Tracks coupon usage by customers
 */
export const coupon_redemptions = sqliteTable("coupon_redemptions", {
  id: text("id").primaryKey(),
  coupon_id: text("coupon_id").notNull().references(() => coupons.id),
  customer_id: text("customer_id").notNull().references(() => customers.id),
  subscription_id: text("subscription_id").references(() => subscriptions.id),
  order_id: text("order_id").references(() => orders.id),

  // Discount applied
  discount_amount: integer("discount_amount").notNull(),
  currency_code: text("currency_code", { length: 3 }).default("USD"),

  // Timestamps
  redeemed_at: text("redeemed_at").notNull().default(sql`(datetime('now'))`),
  expires_at: text("expires_at"),

  // Status
  status: text("status", {
    enum: ["active", "expired", "revoked"],
  }).notNull().default("active"),
});

/**
 * Gift Subscriptions Table
 * Stores gift subscription purchases
 */
export const gift_subscriptions = sqliteTable("gift_subscriptions", {
  id: text("id").primaryKey(),

  // Sender info
  sender_customer_id: text("sender_customer_id").references(() => customers.id),
  sender_email: text("sender_email").notNull(),
  sender_name: text("sender_name").notNull(),

  // Recipient info
  recipient_email: text("recipient_email").notNull(),
  recipient_name: text("recipient_name").notNull(),

  // Gift details
  plan_id: text("plan_id").notNull().references(() => subscription_plans.id),
  gift_message: text("gift_message"),

  // Redemption
  redeem_code: text("redeem_code").notNull().unique(),
  redeemed_at: text("redeemed_at"),
  redeemed_by_customer_id: text("redeemed_by_customer_id").references(() => customers.id),
  subscription_id: text("subscription_id").references(() => subscriptions.id),

  // Validity
  expires_at: text("expires_at"),

  // Payment
  amount_paid: integer("amount_paid").notNull(),
  currency_code: text("currency_code", { length: 3 }).default("USD"),
  stripe_payment_intent_id: text("stripe_payment_intent_id"),

  // Status
  status: text("status", {
    enum: ["pending", "paid", "redeemed", "expired", "refunded"],
  }).notNull().default("pending"),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),

  // MACH compliance
  metadata: text("metadata", { mode: "json" }),
  extensions: text("extensions", { mode: "json" }),
});

/**
 * Subscription Bundles Table
 * Groups multiple plans into a discounted bundle
 */
export const subscription_bundles = sqliteTable("subscription_bundles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),

  // Pricing
  price_amount: integer("price_amount").notNull(),
  currency_code: text("currency_code", { length: 3 }).default("USD"),
  interval: text("interval", {
    enum: ["day", "week", "month", "year"],
  }).notNull(),
  interval_count: integer("interval_count").default(1),

  // Savings info
  savings_amount: integer("savings_amount").default(0),
  savings_percentage: integer("savings_percentage").default(0),

  // Status
  status: text("status", {
    enum: ["active", "inactive", "archived"],
  }).notNull().default("active"),

  // Stripe integration
  stripe_product_id: text("stripe_product_id"),
  stripe_price_id: text("stripe_price_id"),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),

  // MACH compliance
  metadata: text("metadata", { mode: "json" }),
  extensions: text("extensions", { mode: "json" }),
});

/**
 * Subscription Bundle Items Table
 * Links plans to bundles
 */
export const subscription_bundle_items = sqliteTable("subscription_bundle_items", {
  id: text("id").primaryKey(),
  bundle_id: text("bundle_id").notNull().references(() => subscription_bundles.id, { onDelete: "cascade" }),
  plan_id: text("plan_id").notNull().references(() => subscription_plans.id),
  quantity: integer("quantity").default(1),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});

/**
 * Payment Retry Attempts Table
 * Tracks failed payment retry attempts for dunning
 */
export const payment_retry_attempts = sqliteTable("payment_retry_attempts", {
  id: text("id").primaryKey(),
  subscription_id: text("subscription_id").notNull().references(() => subscriptions.id),
  invoice_id: text("invoice_id").references(() => subscription_invoices.id),

  // Attempt details
  attempt_number: integer("attempt_number").notNull(),
  amount: integer("amount").notNull(),
  currency_code: text("currency_code", { length: 3 }).default("USD"),

  // Result
  status: text("status", {
    enum: ["pending", "succeeded", "failed"],
  }).notNull(),
  failure_reason: text("failure_reason"),
  stripe_payment_intent_id: text("stripe_payment_intent_id"),

  // Scheduling
  scheduled_at: text("scheduled_at").notNull(),
  attempted_at: text("attempted_at"),
  next_retry_at: text("next_retry_at"),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// =====================================================
// Relations
// =====================================================

export const couponRelations = relations(coupons, ({ many }) => ({
  redemptions: many(coupon_redemptions),
}));

export const couponRedemptionRelations = relations(coupon_redemptions, ({ one }) => ({
  coupon: one(coupons, {
    fields: [coupon_redemptions.coupon_id],
    references: [coupons.id],
  }),
  customer: one(customers, {
    fields: [coupon_redemptions.customer_id],
    references: [customers.id],
  }),
  subscription: one(subscriptions, {
    fields: [coupon_redemptions.subscription_id],
    references: [subscriptions.id],
  }),
}));

export const giftSubscriptionRelations = relations(gift_subscriptions, ({ one }) => ({
  senderCustomer: one(customers, {
    fields: [gift_subscriptions.sender_customer_id],
    references: [customers.id],
  }),
  recipientCustomer: one(customers, {
    fields: [gift_subscriptions.redeemed_by_customer_id],
    references: [customers.id],
  }),
  plan: one(subscription_plans, {
    fields: [gift_subscriptions.plan_id],
    references: [subscription_plans.id],
  }),
  subscription: one(subscriptions, {
    fields: [gift_subscriptions.subscription_id],
    references: [subscriptions.id],
  }),
}));

export const subscriptionBundleRelations = relations(subscription_bundles, ({ many }) => ({
  items: many(subscription_bundle_items),
}));

export const subscriptionBundleItemRelations = relations(subscription_bundle_items, ({ one }) => ({
  bundle: one(subscription_bundles, {
    fields: [subscription_bundle_items.bundle_id],
    references: [subscription_bundles.id],
  }),
  plan: one(subscription_plans, {
    fields: [subscription_bundle_items.plan_id],
    references: [subscription_plans.id],
  }),
}));

export const paymentRetryAttemptRelations = relations(payment_retry_attempts, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [payment_retry_attempts.subscription_id],
    references: [subscriptions.id],
  }),
  invoice: one(subscription_invoices, {
    fields: [payment_retry_attempts.invoice_id],
    references: [subscription_invoices.id],
  }),
}));

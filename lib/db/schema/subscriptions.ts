// lib/db/schema/subscriptions.ts - SQLite Subscription Schema

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { customers } from "./customer";
import { products, product_variants } from "./products";
import { orders } from "./order";

/**
 * Subscription Plans Table
 * Defines recurring product offerings with pricing and billing configuration
 */
export const subscription_plans = sqliteTable("subscription_plans", {
  // Core identification
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),

  // Product linkage
  product_id: text("product_id").references(() => products.id),
  variant_id: text("variant_id").references(() => product_variants.id),

  // Billing configuration
  interval: text("interval", {
    enum: ["day", "week", "month", "year"]
  }).notNull(),
  interval_count: integer("interval_count").notNull().default(1),
  price_amount: integer("price_amount").notNull(), // Amount in cents
  currency_code: text("currency_code", { length: 3 }).notNull().default("USD"),

  // Trial and fees
  trial_period_days: integer("trial_period_days").default(0),
  setup_fee_amount: integer("setup_fee_amount").default(0),

  // Stripe integration
  stripe_product_id: text("stripe_product_id"),
  stripe_price_id: text("stripe_price_id"),

  // Status and metadata
  status: text("status", {
    enum: ["active", "inactive", "archived"]
  }).notNull().default("active"),
  features: text("features", { mode: "json" }), // JSON array of feature strings
  metadata: text("metadata", { mode: "json" }), // JSON object

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),

  // MACH compliance
  external_references: text("external_references", { mode: "json" }),
  extensions: text("extensions", { mode: "json" }),
});

/**
 * Customer Subscriptions Table
 * Active subscription instances for customers
 */
export const subscriptions = sqliteTable("subscriptions", {
  // Core identification
  id: text("id").primaryKey(),
  customer_id: text("customer_id").notNull().references(() => customers.id),
  plan_id: text("plan_id").notNull().references(() => subscription_plans.id),

  // Stripe integration
  stripe_subscription_id: text("stripe_subscription_id").unique(),
  stripe_customer_id: text("stripe_customer_id"),

  // Status
  status: text("status", {
    enum: ["pending", "trialing", "active", "paused", "past_due", "cancelled", "expired"]
  }).notNull().default("pending"),

  // Billing cycle
  current_period_start: text("current_period_start"),
  current_period_end: text("current_period_end"),
  trial_start: text("trial_start"),
  trial_end: text("trial_end"),

  // Cancellation
  cancel_at_period_end: integer("cancel_at_period_end", { mode: "boolean" }).default(false),
  cancelled_at: text("cancelled_at"),
  cancel_reason: text("cancel_reason"),
  ended_at: text("ended_at"),

  // Shipping
  shipping_address: text("shipping_address", { mode: "json" }), // JSON Address object

  // Quantity
  quantity: integer("quantity").notNull().default(1),

  // Pause handling
  paused_at: text("paused_at"),
  resume_at: text("resume_at"),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),

  // MACH compliance
  external_references: text("external_references", { mode: "json" }),
  extensions: text("extensions", { mode: "json" }),
});

/**
 * Subscription Items Table
 * For multi-product subscriptions
 */
export const subscription_items = sqliteTable("subscription_items", {
  id: text("id").primaryKey(),
  subscription_id: text("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  plan_id: text("plan_id").notNull().references(() => subscription_plans.id),

  // Stripe integration
  stripe_subscription_item_id: text("stripe_subscription_item_id"),

  // Quantity
  quantity: integer("quantity").notNull().default(1),

  // Price override
  price_amount: integer("price_amount"),
  currency_code: text("currency_code", { length: 3 }),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

/**
 * Subscription Invoices Table
 * Billing history and order generation
 */
export const subscription_invoices = sqliteTable("subscription_invoices", {
  id: text("id").primaryKey(),
  subscription_id: text("subscription_id").notNull().references(() => subscriptions.id),

  // Stripe integration
  stripe_invoice_id: text("stripe_invoice_id").unique(),
  stripe_payment_intent_id: text("stripe_payment_intent_id"),

  // Amounts (in cents)
  subtotal_amount: integer("subtotal_amount").notNull(),
  discount_amount: integer("discount_amount").default(0),
  tax_amount: integer("tax_amount").default(0),
  total_amount: integer("total_amount").notNull(),
  amount_paid: integer("amount_paid").default(0),
  amount_due: integer("amount_due").notNull(),
  currency_code: text("currency_code", { length: 3 }).notNull().default("USD"),

  // Status
  status: text("status", {
    enum: ["draft", "open", "paid", "void", "uncollectible"]
  }).notNull(),

  // Billing period
  period_start: text("period_start"),
  period_end: text("period_end"),

  // Dates
  due_date: text("due_date"),
  paid_at: text("paid_at"),
  voided_at: text("voided_at"),

  // Generated order
  order_id: text("order_id").references(() => orders.id),

  // Invoice details
  invoice_number: text("invoice_number"),
  invoice_pdf_url: text("invoice_pdf_url"),
  hosted_invoice_url: text("hosted_invoice_url"),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),

  // MACH compliance
  external_references: text("external_references", { mode: "json" }),
  extensions: text("extensions", { mode: "json" }),
});

/**
 * Customer Payment Methods Table
 * For subscription billing
 */
export const customer_payment_methods = sqliteTable("customer_payment_methods", {
  id: text("id").primaryKey(),
  customer_id: text("customer_id").notNull().references(() => customers.id),

  // Stripe integration
  stripe_payment_method_id: text("stripe_payment_method_id").unique().notNull(),
  stripe_customer_id: text("stripe_customer_id"),

  // Payment method details
  type: text("type", {
    enum: ["card", "bank_account", "sepa_debit", "us_bank_account", "link"]
  }).notNull(),

  // Card details
  card_brand: text("card_brand"),
  card_last4: text("card_last4"),
  card_exp_month: integer("card_exp_month"),
  card_exp_year: integer("card_exp_year"),
  card_funding: text("card_funding"),

  // Bank account details
  bank_name: text("bank_name"),
  bank_last4: text("bank_last4"),

  // Status
  is_default: integer("is_default", { mode: "boolean" }).default(false),
  status: text("status", {
    enum: ["active", "expired", "failed", "removed"]
  }).default("active"),

  // Billing address
  billing_address: text("billing_address", { mode: "json" }),

  // Timestamps
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),

  // MACH compliance
  extensions: text("extensions", { mode: "json" }),
});

/**
 * Subscription Events Table
 * Audit log for subscription lifecycle
 */
export const subscription_events = sqliteTable("subscription_events", {
  id: text("id").primaryKey(),
  subscription_id: text("subscription_id").notNull().references(() => subscriptions.id),

  // Event details
  event_type: text("event_type", {
    enum: [
      "created", "activated", "trial_started", "trial_ended", "renewed",
      "payment_succeeded", "payment_failed", "paused", "resumed",
      "cancelled", "expired", "plan_changed", "quantity_changed", "price_changed"
    ]
  }).notNull(),

  // Event data
  data: text("data", { mode: "json" }),
  previous_status: text("previous_status"),
  new_status: text("new_status"),

  // Stripe event reference
  stripe_event_id: text("stripe_event_id"),

  // Timestamp
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// =====================================================
// Relations
// =====================================================

export const subscriptionPlanRelations = relations(subscription_plans, ({ one, many }) => ({
  product: one(products, {
    fields: [subscription_plans.product_id],
    references: [products.id],
  }),
  variant: one(product_variants, {
    fields: [subscription_plans.variant_id],
    references: [product_variants.id],
  }),
  subscriptions: many(subscriptions),
}));

export const subscriptionRelations = relations(subscriptions, ({ one, many }) => ({
  customer: one(customers, {
    fields: [subscriptions.customer_id],
    references: [customers.id],
  }),
  plan: one(subscription_plans, {
    fields: [subscriptions.plan_id],
    references: [subscription_plans.id],
  }),
  items: many(subscription_items),
  invoices: many(subscription_invoices),
  events: many(subscription_events),
}));

export const subscriptionItemRelations = relations(subscription_items, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscription_items.subscription_id],
    references: [subscriptions.id],
  }),
  plan: one(subscription_plans, {
    fields: [subscription_items.plan_id],
    references: [subscription_plans.id],
  }),
}));

export const subscriptionInvoiceRelations = relations(subscription_invoices, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscription_invoices.subscription_id],
    references: [subscriptions.id],
  }),
  order: one(orders, {
    fields: [subscription_invoices.order_id],
    references: [orders.id],
  }),
}));

export const subscriptionEventRelations = relations(subscription_events, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscription_events.subscription_id],
    references: [subscriptions.id],
  }),
}));

export const customerPaymentMethodRelations = relations(customer_payment_methods, ({ one }) => ({
  customer: one(customers, {
    fields: [customer_payment_methods.customer_id],
    references: [customers.id],
  }),
}));

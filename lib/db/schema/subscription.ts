import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const subscription_plans = sqliteTable(
  'subscription_plans',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `PLN-${nanoid(8).toUpperCase()}`),
    product_id: text('product_id').notNull(),
    frequency: text('frequency', {
      enum: ['biweekly', 'monthly', 'bimonthly']
    }).notNull(),
    discount_percent: integer('discount_percent').notNull().default(10),
    stripe_price_id: text('stripe_price_id'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    productIdx: index('idx_sub_plans_product').on(table.product_id),
  })
);

export const customer_subscriptions = sqliteTable(
  'customer_subscriptions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `SUB-${nanoid(8).toUpperCase()}`),
    customer_id: text('customer_id').notNull(),
    plan_id: text('plan_id').notNull(),
    stripe_subscription_id: text('stripe_subscription_id').notNull().unique(),
    stripe_customer_id: text('stripe_customer_id').notNull(),
    status: text('status', {
      enum: ['active', 'paused', 'canceled', 'past_due', 'incomplete', 'trialing']
    }).notNull().default('active'),
    current_period_start: text('current_period_start'),
    current_period_end: text('current_period_end'),
    cancel_at_period_end: integer('cancel_at_period_end', { mode: 'boolean' }).default(false),
    pause_collection: text('pause_collection'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    canceled_at: text('canceled_at'),
  },
  (table) => ({
    customerIdx: index('idx_cust_subs_customer').on(table.customer_id),
    stripeIdIdx: index('idx_cust_subs_stripe_id').on(table.stripe_subscription_id),
    statusIdx: index('idx_cust_subs_status').on(table.status),
  })
);

export const subscription_events = sqliteTable(
  'subscription_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `EVT-${nanoid(8).toUpperCase()}`),
    subscription_id: text('subscription_id').notNull(),
    event_type: text('event_type', {
      enum: ['created', 'renewed', 'payment_failed', 'paused', 'resumed', 'skipped', 'canceled', 'updated']
    }).notNull(),
    stripe_event_id: text('stripe_event_id'),
    details: text('details'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    subscriptionIdx: index('idx_sub_events_subscription').on(table.subscription_id),
    typeIdx: index('idx_sub_events_type').on(table.event_type),
  })
);

export type SubscriptionPlanRow = typeof subscription_plans.$inferSelect;
export type SubscriptionPlanInsert = typeof subscription_plans.$inferInsert;
export type CustomerSubscriptionRow = typeof customer_subscriptions.$inferSelect;
export type CustomerSubscriptionInsert = typeof customer_subscriptions.$inferInsert;
export type SubscriptionEventRow = typeof subscription_events.$inferSelect;
export type SubscriptionEventInsert = typeof subscription_events.$inferInsert;

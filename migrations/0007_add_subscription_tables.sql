-- Migration: 0007_add_subscription_tables.sql
-- Description: Add subscription plans, customer subscriptions, subscription events, and webhook dedup tables

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('biweekly', 'monthly', 'bimonthly')),
  discount_percent INTEGER NOT NULL DEFAULT 10,
  stripe_price_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'canceled', 'past_due', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  pause_collection TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  canceled_at TEXT
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES customer_subscriptions(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'renewed', 'payment_failed', 'paused', 'resumed', 'skipped', 'canceled', 'updated')),
  stripe_event_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sub_plans_product ON subscription_plans(product_id);
CREATE INDEX IF NOT EXISTS idx_cust_subs_customer ON customer_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_subs_stripe_id ON customer_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_cust_subs_status ON customer_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sub_events_subscription ON subscription_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at ON processed_webhook_events(processed_at);

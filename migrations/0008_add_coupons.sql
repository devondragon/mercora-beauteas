-- Migration: Add Coupons/Discounts System
-- Description: Adds tables for managing coupons and promotions for subscriptions

-- Coupons table
CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,

    -- Discount type and value
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount')),
    discount_value INTEGER NOT NULL, -- Percentage (e.g., 20 for 20%) or fixed amount in cents
    currency_code TEXT DEFAULT 'USD',

    -- Duration
    duration TEXT NOT NULL CHECK (duration IN ('once', 'repeating', 'forever')),
    duration_in_months INTEGER, -- For repeating duration

    -- Restrictions
    max_redemptions INTEGER, -- NULL for unlimited
    redemption_count INTEGER DEFAULT 0,
    min_order_amount INTEGER, -- Minimum order amount in cents
    applies_to_plans TEXT, -- JSON array of plan IDs, NULL for all plans

    -- Validity
    valid_from TEXT NOT NULL DEFAULT (datetime('now')),
    valid_until TEXT,

    -- Status
    is_active INTEGER DEFAULT 1,

    -- Stripe integration
    stripe_coupon_id TEXT UNIQUE,
    stripe_promotion_code_id TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- MACH compliance
    metadata TEXT, -- JSON object
    extensions TEXT -- JSON object
);

-- Coupon redemptions table (tracks who used what coupon)
CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL REFERENCES coupons(id),
    customer_id TEXT NOT NULL REFERENCES customers(id),
    subscription_id TEXT REFERENCES subscriptions(id),
    order_id TEXT REFERENCES orders(id),

    -- Discount applied
    discount_amount INTEGER NOT NULL, -- Actual discount amount in cents
    currency_code TEXT DEFAULT 'USD',

    -- Timestamps
    redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT, -- When the discount expires (for repeating coupons)

    -- Status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked'))
);

-- Gift subscriptions table
CREATE TABLE IF NOT EXISTS gift_subscriptions (
    id TEXT PRIMARY KEY,

    -- Sender info
    sender_customer_id TEXT REFERENCES customers(id),
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,

    -- Recipient info
    recipient_email TEXT NOT NULL,
    recipient_name TEXT NOT NULL,

    -- Gift details
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
    gift_message TEXT,

    -- Redemption
    redeem_code TEXT NOT NULL UNIQUE,
    redeemed_at TEXT,
    redeemed_by_customer_id TEXT REFERENCES customers(id),
    subscription_id TEXT REFERENCES subscriptions(id),

    -- Validity
    expires_at TEXT,

    -- Payment
    amount_paid INTEGER NOT NULL,
    currency_code TEXT DEFAULT 'USD',
    stripe_payment_intent_id TEXT,

    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'redeemed', 'expired', 'refunded')),

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- MACH compliance
    metadata TEXT,
    extensions TEXT
);

-- Subscription bundles table
CREATE TABLE IF NOT EXISTS subscription_bundles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,

    -- Pricing
    price_amount INTEGER NOT NULL,
    currency_code TEXT DEFAULT 'USD',
    interval TEXT NOT NULL CHECK (interval IN ('day', 'week', 'month', 'year')),
    interval_count INTEGER DEFAULT 1,

    -- Discount from buying separately
    savings_amount INTEGER DEFAULT 0, -- Savings in cents compared to individual plans
    savings_percentage INTEGER DEFAULT 0, -- Savings as percentage

    -- Status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),

    -- Stripe integration
    stripe_product_id TEXT,
    stripe_price_id TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- MACH compliance
    metadata TEXT,
    extensions TEXT
);

-- Bundle items (plans included in a bundle)
CREATE TABLE IF NOT EXISTS subscription_bundle_items (
    id TEXT PRIMARY KEY,
    bundle_id TEXT NOT NULL REFERENCES subscription_bundles(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
    quantity INTEGER DEFAULT 1,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Payment retry attempts (for dunning)
CREATE TABLE IF NOT EXISTS payment_retry_attempts (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
    invoice_id TEXT REFERENCES subscription_invoices(id),

    -- Attempt details
    attempt_number INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency_code TEXT DEFAULT 'USD',

    -- Result
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    failure_reason TEXT,
    stripe_payment_intent_id TEXT,

    -- Scheduling
    scheduled_at TEXT NOT NULL,
    attempted_at TEXT,
    next_retry_at TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add coupon reference to subscriptions
ALTER TABLE subscriptions ADD COLUMN coupon_id TEXT REFERENCES coupons(id);

-- Add bundle reference to subscriptions
ALTER TABLE subscriptions ADD COLUMN bundle_id TEXT REFERENCES subscription_bundles(id);

-- Add pause_duration_days to subscriptions for auto-resume
ALTER TABLE subscriptions ADD COLUMN pause_duration_days INTEGER;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_customer ON coupon_redemptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_subscription ON coupon_redemptions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_gift_subscriptions_redeem_code ON gift_subscriptions(redeem_code);
CREATE INDEX IF NOT EXISTS idx_gift_subscriptions_recipient ON gift_subscriptions(recipient_email);
CREATE INDEX IF NOT EXISTS idx_payment_retry_subscription ON payment_retry_attempts(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payment_retry_scheduled ON payment_retry_attempts(scheduled_at);

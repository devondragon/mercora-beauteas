-- Subscription System Schema
-- Adds support for recurring billing and subscription management

-- =====================================================
-- Subscription Plans (Product offerings with recurring billing)
-- =====================================================

CREATE TABLE subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,

    -- Product linkage (optional - for product-based subscriptions)
    product_id TEXT REFERENCES products(id),
    variant_id TEXT REFERENCES product_variants(id),

    -- Billing configuration
    interval TEXT NOT NULL CHECK (interval IN ('day', 'week', 'month', 'year')),
    interval_count INTEGER NOT NULL DEFAULT 1,
    price_amount INTEGER NOT NULL,              -- Amount in cents
    currency_code TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency_code) = 3),

    -- Trial and fees
    trial_period_days INTEGER DEFAULT 0,
    setup_fee_amount INTEGER DEFAULT 0,

    -- Stripe integration
    stripe_product_id TEXT,
    stripe_price_id TEXT,

    -- Status and metadata
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    features TEXT,                              -- JSON: array of feature descriptions
    metadata TEXT,                              -- JSON: additional plan data

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- MACH compliance
    external_references TEXT,
    extensions TEXT
);

CREATE INDEX idx_subscription_plans_status ON subscription_plans(status);
CREATE INDEX idx_subscription_plans_product ON subscription_plans(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_subscription_plans_stripe_price ON subscription_plans(stripe_price_id) WHERE stripe_price_id IS NOT NULL;
CREATE INDEX idx_subscription_plans_interval ON subscription_plans(interval, interval_count);
CREATE INDEX idx_subscription_plans_created ON subscription_plans(created_at);

-- =====================================================
-- Customer Subscriptions (Active subscription instances)
-- =====================================================

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),

    -- Stripe integration
    stripe_subscription_id TEXT UNIQUE,
    stripe_customer_id TEXT,

    -- Status management
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',          -- Created, awaiting payment
        'trialing',         -- In trial period
        'active',           -- Paid and active
        'paused',           -- Temporarily paused
        'past_due',         -- Payment failed, retrying
        'cancelled',        -- Cancelled by user/admin
        'expired'           -- Ended after cancellation period
    )),

    -- Billing cycle
    current_period_start TEXT,
    current_period_end TEXT,
    trial_start TEXT,
    trial_end TEXT,

    -- Cancellation handling
    cancel_at_period_end INTEGER DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
    cancelled_at TEXT,
    cancel_reason TEXT,
    ended_at TEXT,

    -- Shipping (for physical subscriptions)
    shipping_address TEXT,                      -- JSON: Address object

    -- Quantity and customization
    quantity INTEGER NOT NULL DEFAULT 1,

    -- Pause handling
    paused_at TEXT,
    resume_at TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- MACH compliance
    external_references TEXT,
    extensions TEXT
);

CREATE INDEX idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_subscriptions_period_end ON subscriptions(current_period_end);
CREATE INDEX idx_subscriptions_customer_status ON subscriptions(customer_id, status);
CREATE INDEX idx_subscriptions_created ON subscriptions(created_at);

-- =====================================================
-- Subscription Items (For multi-product subscriptions)
-- =====================================================

CREATE TABLE subscription_items (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),

    -- Stripe integration
    stripe_subscription_item_id TEXT,

    -- Quantity
    quantity INTEGER NOT NULL DEFAULT 1,

    -- Price override (if different from plan)
    price_amount INTEGER,
    currency_code TEXT CHECK (length(currency_code) = 3),

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_subscription_items_subscription ON subscription_items(subscription_id);
CREATE INDEX idx_subscription_items_plan ON subscription_items(plan_id);
CREATE INDEX idx_subscription_items_stripe ON subscription_items(stripe_subscription_item_id) WHERE stripe_subscription_item_id IS NOT NULL;

-- =====================================================
-- Subscription Invoices (Billing history and order generation)
-- =====================================================

CREATE TABLE subscription_invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),

    -- Stripe integration
    stripe_invoice_id TEXT UNIQUE,
    stripe_payment_intent_id TEXT,

    -- Amounts (in cents)
    subtotal_amount INTEGER NOT NULL,
    discount_amount INTEGER DEFAULT 0,
    tax_amount INTEGER DEFAULT 0,
    total_amount INTEGER NOT NULL,
    amount_paid INTEGER DEFAULT 0,
    amount_due INTEGER NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency_code) = 3),

    -- Status
    status TEXT NOT NULL CHECK (status IN (
        'draft',            -- Being prepared
        'open',             -- Awaiting payment
        'paid',             -- Successfully paid
        'void',             -- Cancelled
        'uncollectible'     -- Failed to collect
    )),

    -- Billing period
    period_start TEXT,
    period_end TEXT,

    -- Dates
    due_date TEXT,
    paid_at TEXT,
    voided_at TEXT,

    -- Generated fulfillment order (for physical subscriptions)
    order_id TEXT REFERENCES orders(id),

    -- Invoice details
    invoice_number TEXT,
    invoice_pdf_url TEXT,
    hosted_invoice_url TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- MACH compliance
    external_references TEXT,
    extensions TEXT
);

CREATE INDEX idx_subscription_invoices_subscription ON subscription_invoices(subscription_id);
CREATE INDEX idx_subscription_invoices_stripe ON subscription_invoices(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX idx_subscription_invoices_status ON subscription_invoices(status);
CREATE INDEX idx_subscription_invoices_order ON subscription_invoices(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_subscription_invoices_due_date ON subscription_invoices(due_date);
CREATE INDEX idx_subscription_invoices_created ON subscription_invoices(created_at);

-- =====================================================
-- Customer Payment Methods (For subscription billing)
-- =====================================================

CREATE TABLE customer_payment_methods (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),

    -- Stripe integration
    stripe_payment_method_id TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT,

    -- Payment method details
    type TEXT NOT NULL CHECK (type IN ('card', 'bank_account', 'sepa_debit', 'us_bank_account', 'link')),

    -- Card details (if type = 'card')
    card_brand TEXT,
    card_last4 TEXT,
    card_exp_month INTEGER,
    card_exp_year INTEGER,
    card_funding TEXT,                          -- 'credit', 'debit', 'prepaid', 'unknown'

    -- Bank account details (if type = 'bank_account' or 'us_bank_account')
    bank_name TEXT,
    bank_last4 TEXT,

    -- Status
    is_default INTEGER DEFAULT 0 CHECK (is_default IN (0, 1)),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'failed', 'removed')),

    -- Billing address
    billing_address TEXT,                       -- JSON: Address object

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- MACH compliance
    extensions TEXT
);

CREATE INDEX idx_payment_methods_customer ON customer_payment_methods(customer_id);
CREATE INDEX idx_payment_methods_stripe ON customer_payment_methods(stripe_payment_method_id);
CREATE INDEX idx_payment_methods_stripe_customer ON customer_payment_methods(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_payment_methods_type ON customer_payment_methods(type);
CREATE INDEX idx_payment_methods_default ON customer_payment_methods(customer_id, is_default) WHERE is_default = 1;
CREATE INDEX idx_payment_methods_status ON customer_payment_methods(status);

-- =====================================================
-- Subscription Events (Audit log for subscription lifecycle)
-- =====================================================

CREATE TABLE subscription_events (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),

    -- Event details
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created',
        'activated',
        'trial_started',
        'trial_ended',
        'renewed',
        'payment_succeeded',
        'payment_failed',
        'paused',
        'resumed',
        'cancelled',
        'expired',
        'plan_changed',
        'quantity_changed',
        'price_changed'
    )),

    -- Event data
    data TEXT,                                  -- JSON: event-specific data
    previous_status TEXT,
    new_status TEXT,

    -- Stripe event reference
    stripe_event_id TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_subscription_events_subscription ON subscription_events(subscription_id);
CREATE INDEX idx_subscription_events_type ON subscription_events(event_type);
CREATE INDEX idx_subscription_events_stripe ON subscription_events(stripe_event_id) WHERE stripe_event_id IS NOT NULL;
CREATE INDEX idx_subscription_events_created ON subscription_events(created_at);

-- =====================================================
-- Add stripe_customer_id to customers table
-- =====================================================

ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT;
CREATE INDEX idx_customers_stripe ON customers(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

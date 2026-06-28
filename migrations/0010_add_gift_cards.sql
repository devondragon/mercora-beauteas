-- Migration: 0010_add_gift_cards.sql
-- Description: Gift cards (stored-value) — gift_cards ledger-backed balances,
--              gift_card_transactions append-only ledger, plus a seeded
--              "gift-card" product type and digital gift-card product with
--              $25 / $50 / $100 denomination variants.

-- Stored-value gift cards. `balance` is the source of truth for redemption;
-- every change to it is mirrored by a row in gift_card_transactions.
CREATE TABLE IF NOT EXISTS gift_cards (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  initial_balance INTEGER NOT NULL,            -- cents
  balance INTEGER NOT NULL,                     -- cents, remaining
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'disabled', 'expired')),
  purchaser_customer_id TEXT,
  purchaser_email TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  gift_message TEXT,
  order_id TEXT,                                -- order the card was purchased on (issuance idempotency key)
  order_line_id TEXT,                           -- per-line idempotency within an order
  expires_at TEXT,
  delivered_at TEXT,                            -- when the recipient email was sent
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Append-only ledger of every balance change (issue / redeem / refund / adjust).
CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id TEXT PRIMARY KEY,
  gift_card_id TEXT NOT NULL REFERENCES gift_cards(id),
  type TEXT NOT NULL CHECK (type IN ('issue', 'redeem', 'refund', 'adjust')),
  amount INTEGER NOT NULL,                      -- cents, signed (negative for redeem)
  balance_after INTEGER NOT NULL,              -- cents, balance after this entry
  order_id TEXT,                               -- order this entry is associated with
  customer_id TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);
CREATE INDEX IF NOT EXISTS idx_gift_cards_order ON gift_cards(order_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_recipient ON gift_cards(recipient_email);
CREATE INDEX IF NOT EXISTS idx_gift_card_tx_card ON gift_card_transactions(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_gift_card_tx_order ON gift_card_transactions(order_id);

-- ─── Seed: gift-card product type + digital product with denominations ───
-- Product type (attribute_definitions is NOT NULL; gift cards carry a denomination).
INSERT OR IGNORE INTO product_types (id, name, attribute_definitions, status, description, created_at, updated_at)
VALUES (
  'gift-card',
  '"Gift Card"',
  '{"denomination":{"type":"money","label":"Denomination","required":true}}',
  'active',
  '"A BeauTeas digital gift card, delivered by email and redeemable at checkout."',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- The gift-card product (digital fulfillment; no shipment).
INSERT OR IGNORE INTO products (id, name, type, status, slug, brand, fulfillment_type, description, tax_category, created_at, updated_at)
VALUES (
  'gift-card',
  'BeauTeas Gift Card',
  'gift-card',
  'active',
  'gift-card',
  'BeauTeas',
  'digital',
  'Give the gift of glow. A BeauTeas digital gift card is delivered straight to your recipient''s inbox and can be redeemed against any order at checkout.',
  'txcd_10000000',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Denomination variants. option_values + price are NOT NULL JSON; digital → shipping_required = 0.
INSERT OR IGNORE INTO product_variants (id, product_id, sku, option_values, price, status, position, shipping_required, created_at, updated_at)
VALUES
  ('gift-card-25',  'gift-card', 'GIFTCARD-25',  '[{"option_id":"denomination","value":"$25"}]',  '{"amount":2500,"currency":"USD"}',  'active', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gift-card-50',  'gift-card', 'GIFTCARD-50',  '[{"option_id":"denomination","value":"$50"}]',  '{"amount":5000,"currency":"USD"}',  'active', 2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gift-card-100', 'gift-card', 'GIFTCARD-100', '[{"option_id":"denomination","value":"$100"}]', '{"amount":10000,"currency":"USD"}', 'active', 3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

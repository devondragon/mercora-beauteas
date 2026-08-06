-- 0028_withdraw_box_variants_and_single_shipping_method.sql
--
-- Two owner-directed changes for the going-out-of-business sale. Data-only and
-- additive (no DROP/RENAME/DELETE), so it is safe to auto-apply on deploy.
--
-- === 1. Withdraw the 3-box variants (owner decision) ===
--
-- The whole sale design assumes one cart unit is one box: `countBoxes`
-- (lib/sale/rules.ts) is line quantity and nothing else. The "Three boxes (30
-- tea bags)" variants break that invariant — they would undercharge shipping,
-- block honest carts against the 10-box minimum on a single line, and get
-- repriced to the flat $2/box sale price for 30 tea bags. The owner's call:
-- withdraw them. Three blends, one SKU each, one box each.
--
-- Verified against production (read-only, 2026-08-06) before writing this:
-- BTCCM1/BTCCA1/BTCCE1 = "One box (10 tea bags)" (KEEP), BTCCM3/BTCCA3/BTCCE3 =
-- "Three boxes (30 tea bags)" (WITHDRAW), all six currently status='active'.
--
-- Keyed on SKU, not a numeric id. `status = 'discontinued'` is allowed by the
-- CHECK constraint on product_variants.status ('active','inactive',
-- 'discontinued'). The UPDATE only touches rows not already discontinued, so
-- re-running is a no-op. This alone does not hide the variants from the
-- storefront UI — ProductDisplay/ProductCard filtering is a separate,
-- non-migration fix (see git history for this branch).
UPDATE product_variants
SET status = 'discontinued', updated_at = CURRENT_TIMESTAMP
WHERE sku IN ('BTCCM3', 'BTCCA3', 'BTCCE3')
  AND status != 'discontinued';

-- === 2. Single Standard shipping method ===
--
-- resolveShippingOptions (lib/services/shipping-options.ts) applies the
-- resolved tier cost to EVERY enabled method, so with all three methods
-- enabled a customer picking Overnight or Express pays the Standard tier
-- rate. The owner decided on a single Standard method for the sale; this was
-- never implemented. Disable express and overnight rather than deleting them,
-- so the shape survives for any future use, and preserve the JSON shape and
-- labels EXACTLY, including the EN dash (–, U+2013) in "Standard (5–7 days)"
-- and "Express (2–3 days)" — correct punctuation, not an em dash, and out of
-- the em-dash sweep's scope.
--
-- Guarded on the exact current value (the shape seeded in
-- lib/db/schema/settings.ts defaultSettings and confirmed on production) so
-- this is idempotent on re-run AND will not clobber a value an admin has
-- since edited through the settings UI — if the stored value no longer
-- matches this literal, the row is left alone.
UPDATE admin_settings
SET value = '[{"id":"standard","label":"Standard (5–7 days)","cost":5.99,"estimatedDays":5,"enabled":true},{"id":"express","label":"Express (2–3 days)","cost":9.99,"estimatedDays":2,"enabled":false},{"id":"overnight","label":"Overnight","cost":19.99,"estimatedDays":1,"enabled":false}]',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'shipping.methods'
  AND value = '[{"id":"standard","label":"Standard (5–7 days)","cost":5.99,"estimatedDays":5,"enabled":true},{"id":"express","label":"Express (2–3 days)","cost":9.99,"estimatedDays":2,"enabled":true},{"id":"overnight","label":"Overnight","cost":19.99,"estimatedDays":1,"enabled":true}]';

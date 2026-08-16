-- 0032_seed_per_box_shipping.sql
--
-- Per-box shipping for the closing sale: $1.00 for every box in the cart.
--
-- Data-only and additive (no DROP/RENAME/DELETE), so it is safe to auto-apply
-- on deploy.
--
-- WHY A PER-BOX RATE RATHER THAN THE BANDS IN `shipping.tiers`
-- Measured postage for the sale is about $10 for 10 boxes and about $9 for 20
-- (larger orders ship as several parcels rather than one, because a single
-- 40-box parcel prices at $160). Banded pricing recovers that, but it puts a
-- cliff at every boundary: with $10 bands of ten, the 20th box costs $10 of
-- shipping while the 19th costs nothing, which is both a sticker shock at
-- checkout and a reason to stop at 19. A flat $1 a box is the peak of those
-- same bands (10 boxes for $10 is $1.00 a box), tracks real postage closely,
-- and states in four words. `shipping.tiers` stays EMPTY and its resolver
-- stays in place unused, so switching back is one settings write.
--
-- SAFE IF THIS ROW IS NEVER READ: `normalizePerBoxCost` (lib/sale/rules.ts)
-- treats absent, zero, negative, and non-numeric alike as "not configured",
-- which leaves the flat `shipping.methods` rates in force rather than shipping
-- anything free. That is the same posture 0025 took with an empty
-- `shipping.tiers`.
--
-- ORDERING WITH THE DEPLOY: migrations apply from the predeploy hook, BEFORE
-- the build, so this row exists for a few minutes while the Worker still runs
-- code that has never heard of it. That older code ignores the key entirely and
-- keeps charging the flat rate, so the window is a no-op rather than a
-- mispriced one.
--
-- INSERT OR IGNORE leaves an operator's existing choice untouched on re-run,
-- matching 0025.

INSERT OR IGNORE INTO admin_settings (key, value, category, description, data_type)
VALUES
  (
    'shipping.per_box_cost',
    '1',
    'shipping',
    'Flat shipping cost in dollars PER BOX. When above zero it prices the whole cart and overrides both shipping.tiers and the flat shipping.methods rates. ZERO means not configured.',
    'number'
  );

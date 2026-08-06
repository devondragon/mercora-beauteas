-- 0025_seed_goob_sale_settings.sql
--
-- Settings for the going-out-of-business sale.
--
-- Data-only and additive. INSERT OR IGNORE leaves an operator's existing choice
-- untouched on re-run, matching 0021. The UPDATE at the bottom is deliberate and
-- is the ONE value that must change rather than be inserted — see below.
--
-- WHY free_methods IS EMPTIED RATHER THAN ZEROING THE THRESHOLD
-- resolveShippingOptions reads `settings['store.free_shipping_threshold'] || 75`.
-- A falsy value — 0, null, absent — therefore RESTORES the $75 threshold rather
-- than disabling it. Free shipping is switched off by removing every method from
-- `shipping.free_methods`, which makes the `freeMethods.includes(m.id)` test
-- false for all methods regardless of the threshold.
--
-- WHY shipping.tiers SEEDS EMPTY RATHER THAN WITH PLACEHOLDER BANDS
-- resolveShippingOptions (lib/services/shipping-options.ts, line 99) checks
-- `tiers.length > 0` to decide if tiers are configured. Any non-empty array
-- means "configured" and overrides the per-method cost, even if each tier has
-- cost: 0 as a placeholder. So seeded placeholder bands would ship every live
-- order free between the deploy and an admin entering real prices. Empty array
-- keeps the flat rates in force ($5.99, $9.99, $19.99) until tiers are entered
-- deliberately in the admin editor.

INSERT OR IGNORE INTO admin_settings (key, value, category, description, data_type)
VALUES
  (
    'sale.minimum_boxes',
    '10',
    'sale',
    'Minimum number of boxes required to check out',
    'number'
  ),
  (
    'sale.final_sale',
    'true',
    'sale',
    'All sales are final (no returns); damaged or lost shipments are still made right',
    'boolean'
  ),
  (
    'sale.subscriptions_enabled',
    'false',
    'sale',
    'Show subscription options on the storefront',
    'boolean'
  ),
  (
    'shipping.tiers',
    '[]',
    'shipping',
    'Quantity-tiered shipping cost in dollars; the last entry has a null max_boxes and covers everything above. EMPTY means not configured — the flat shipping.methods rates stay in force.',
    'object'
  ),
  (
    'promotions.banner_link',
    '"/thank-you"',
    'promotions',
    'URL the promotional banner links to',
    'string'
  );

-- Free shipping OFF. This row already exists on every deployed database (it is in
-- the initial settings seed), so INSERT OR IGNORE would no-op — it must be an
-- UPDATE. Guarded so it cannot create a row on a database that somehow lacks one.
UPDATE admin_settings
SET value = '[]', updated_at = CURRENT_TIMESTAMP
WHERE key = 'shipping.free_methods';

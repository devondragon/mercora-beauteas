-- 0033_repair_double_encoded_variant_json.sql
--
-- Repair variant rows whose JSON columns were stored DOUBLE-ENCODED, and set the
-- Evening blend's on-hand count to the recount the admin UI failed to save.
--
-- WHAT WENT WRONG
-- `updateProduct` (lib/models/mach/products.ts) JSON.stringify'd each variant
-- value before handing it to Drizzle. Every JSON-shaped column on
-- `product_variants` is declared `mode: 'json'` (lib/db/schema/products.ts), so
-- Drizzle serializes on write itself: the stringified string got stringified
-- again and the column ended up holding `"{\"quantity\":250}"` — a JSON *text*
-- scalar rather than an object. Any product saved or archived through
-- /admin/products took this damage; on production that is BTCCE1, BTCCE3,
-- BTCCFP, and BTCCSP (the Evening blend's two variants, plus the two bundles
-- archived during the sale rollout).
--
-- WHY IT MATTERED, GIVEN EVERY JS READER SURVIVED IT
-- `parseInventoryField`, `parseMoneyField`, `priceToCents`, and
-- `Money.fromStored` all re-parse a string that starts with `{`, so prices and
-- the storefront kept working and nothing errored. SQL does not re-parse. The
-- guarded stock decrement in lib/services/inventory-adjustment.ts matches on
-- `json_extract(inventory, '$.quantity')`, which is NULL for a text scalar, so
-- `COALESCE(json_extract(...), 0) >= quantity` was false for every line: the
-- compare-and-swap matched zero rows, stock never moved, and each sale was
-- flagged oversold for manual review instead. `boxesLeft` (lib/sale/year-supply)
-- likewise read no quantity, which is why the Evening PDP lost its year-supply
-- offer while Morning kept it.
--
-- THE REPAIR
-- `json_extract(col, '$')` on a JSON text scalar returns the inner text, which
-- is the correctly-encoded object; writing that back makes `json_type(col)`
-- report `object` again. Each column is guarded on `json_type(col) = 'text'`, so
-- a healthy row is left untouched and re-running this is a no-op. Verified
-- read-only against production before being written down.
--
-- Data-only and additive (no DROP/RENAME/DELETE), so it is safe to auto-apply.
-- The code fix ships in the same deploy, so nothing re-corrupts these rows after
-- the repair.

UPDATE product_variants
SET
  inventory        = CASE WHEN json_type(inventory)        = 'text' THEN json_extract(inventory,        '$') ELSE inventory        END,
  price            = CASE WHEN json_type(price)            = 'text' THEN json_extract(price,            '$') ELSE price            END,
  compare_at_price = CASE WHEN json_type(compare_at_price) = 'text' THEN json_extract(compare_at_price, '$') ELSE compare_at_price END,
  cost             = CASE WHEN json_type(cost)             = 'text' THEN json_extract(cost,             '$') ELSE cost             END,
  weight           = CASE WHEN json_type(weight)           = 'text' THEN json_extract(weight,           '$') ELSE weight           END,
  dimensions       = CASE WHEN json_type(dimensions)       = 'text' THEN json_extract(dimensions,       '$') ELSE dimensions       END,
  media            = CASE WHEN json_type(media)            = 'text' THEN json_extract(media,            '$') ELSE media            END,
  attributes       = CASE WHEN json_type(attributes)       = 'text' THEN json_extract(attributes,       '$') ELSE attributes       END,
  option_values    = CASE WHEN json_type(option_values)    = 'text' THEN json_extract(option_values,    '$') ELSE option_values    END,
  updated_at       = CURRENT_TIMESTAMP
WHERE json_type(inventory)        = 'text'
   OR json_type(price)            = 'text'
   OR json_type(compare_at_price) = 'text'
   OR json_type(cost)             = 'text'
   OR json_type(weight)           = 'text'
   OR json_type(dimensions)       = 'text'
   OR json_type(media)            = 'text'
   OR json_type(attributes)       = 'text'
   OR json_type(option_values)    = 'text';

-- The Evening recount (250 -> 144) that the admin editor reported as saved and
-- did not save. Guarded on the stale value so it cannot clobber a later, correct
-- edit made through the fixed UI, and on json_type so it only runs against a
-- repaired row. Runs after the repair above, in the same migration, on purpose:
-- json_set on a text scalar would produce another malformed value.
UPDATE product_variants
SET inventory = json_set(inventory, '$.quantity', 144),
    updated_at = CURRENT_TIMESTAMP
WHERE sku = 'BTCCE1'
  AND json_type(inventory) = 'object'
  AND json_extract(inventory, '$.quantity') = 250;

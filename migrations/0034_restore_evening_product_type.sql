-- 0034_restore_evening_product_type.sql
--
-- Restore `products.type` for the Evening blend, overwritten with 'simple' by an
-- admin save.
--
-- WHAT WENT WRONG
-- The Product Type control in components/admin/ProductEditor.tsx is a <select>
-- with a fixed list (simple / configurable / bundle / digital / subscription /
-- service). The catalog's real values are free text from the Shopify ETL: "Tea
-- Bags", "Drinkware", "Gift Card". A controlled <select> whose value matches no
-- <option> renders with nothing selected, so the field showed blank on a product
-- whose type was "Tea Bags", and one interaction wrote 'simple' over it.
--
-- WHY IT MATTERED
-- `isSoldByTheBox` (lib/sale/year-supply.ts) gates the entire box-count feature
-- on the type normalizing to "teabags". With 'simple' stored, the Evening PDP
-- silently lost its "boxes left" count and its year-supply offer while Morning
-- and Afternoon kept both. Nothing errored: the predicate is written to fail
-- toward showing LESS, so a wrong type is indistinguishable from a product that
-- was never sold by the box.
--
-- Only Evening was affected (audited across the whole catalog before writing
-- this). The editor fix ships in the same deploy, so an admin save can no longer
-- discard a type that is outside the dropdown's list.
--
-- Guarded on the exact wrong value so this cannot clobber a deliberate later
-- edit, and re-running is a no-op. Data-only and additive.

UPDATE products
SET type = 'Tea Bags',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'clearly-calendula-evening'
  AND type = 'simple';

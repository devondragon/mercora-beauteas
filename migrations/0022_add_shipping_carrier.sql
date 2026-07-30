-- Migration: 0022_add_shipping_carrier
-- Date: 2026-07-30
-- Ticket: BMC-216A
--
-- Adds the typed carrier column that the fulfillment workflow owns, and
-- backfills it from the two places legacy carrier data actually lives.
--
-- Precedence (see lib/fulfillment/tracking.ts::normalizeLegacyCarrier — the
-- rules below are the SQL mirror of that function; change both together):
--   1. extensions.carrier  — the admin form's old write target; authoritative.
--   2. shipping_method     — ONLY when it matches a UPS/FedEx token.
--      shipping_method mostly holds real shipping methods ("standard"), so an
--      unconditional fallback would pollute the column with "other".
--
-- Normalization: UPS/FedEx variants -> 'ups'/'fedex'; any other non-empty
-- value -> 'other' (renders as a bare tracking number, no link); empty/null
-- stays NULL.
--
-- extensions.carrier is deliberately NOT deleted. It is the lossless record of
-- what an 'other' value originally was; this migration only stops anything
-- reading it (the app now reads shipping_carrier, and BMC-216F strips
-- client-supplied `carrier`/`trackingUrl` keys in mergeExtensions).
--
-- No tracking_url column is added: customer-facing tracking links are derived
-- at the response/email boundary from (shipping_carrier, tracking_number).

ALTER TABLE orders ADD COLUMN shipping_carrier TEXT;

-- Step 1: copy the legacy extensions.carrier value verbatim.
-- The CASE guard is what keeps json_extract away from a non-JSON extensions
-- blob: SQLite evaluates only the CASE branches it needs, whereas AND operand
-- order in a WHERE clause is not a documented short-circuit guarantee.
-- json_type(...) returns NULL when the path is absent, so '= ''text''' also
-- filters out non-string carrier values.
UPDATE orders
   SET shipping_carrier = json_extract(extensions, '$.carrier')
 WHERE shipping_carrier IS NULL
   AND CASE WHEN json_valid(extensions) THEN json_type(extensions, '$.carrier') END = 'text';

-- Step 2: normalize the copied values in place. Operates on a plain column, so
-- no JSON functions and no long LIKE patterns (D1 caps LIKE patterns at 50
-- chars; every pattern here is under 20). Idempotent: rows already holding a
-- canonical code are excluded.
UPDATE orders
   SET shipping_carrier = CASE
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') = ''
       THEN NULL
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'fedex%'
       THEN 'fedex'
     WHEN replace(replace(replace(replace(lower(trim(shipping_carrier)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'federalexpress%'
       THEN 'fedex'
     ELSE 'other'
   END
 WHERE shipping_carrier IS NOT NULL
   AND shipping_carrier NOT IN ('ups', 'fedex', 'other');

-- Step 3: narrow shipping_method fallback for rows still NULL. Only recognized
-- UPS/FedEx tokens qualify — "standard", "expedited", etc. stay NULL rather
-- than becoming 'other'.
UPDATE orders
   SET shipping_carrier = CASE
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
       THEN 'ups'
     ELSE 'fedex'
   END
 WHERE shipping_carrier IS NULL
   AND shipping_method IS NOT NULL
   AND (
        replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'fedex%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'federalexpress%'
   );

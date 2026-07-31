-- Migration: 0022_add_shipping_carrier
-- Date: 2026-07-30
-- Ticket: BMC-216A
--
-- Adds the typed carrier column that the fulfillment workflow owns, and
-- backfills it from the two places legacy carrier data actually lives.
--
-- Precedence (see lib/fulfillment/tracking.ts::normalizeLegacyCarrier — the
-- rules below approximate that function for the common case; change both
-- together, but note they are NOT an exact mirror: SQLite trim()/replace()
-- only strip ASCII space/./-/_ , while the JS version's .trim() + /[\s._-]/g
-- also strips tab, CR, LF, NBSP and other Unicode whitespace. ANY of that —
-- not just non-ASCII — normalizes differently in each: a leading/interior
-- ASCII tab ("\tUPS", "Fed\tEx") or a whitespace-only value ("\t") already
-- diverges (SQL falls through to 'other'/NULL, JS resolves to 'ups'/'fedex'/
-- null), before Unicode is even in play. This is a one-time backfill over a
-- handful of rows (verified prod=1, dev=5 at authoring time);
-- extensions.carrier is preserved losslessly so any mismatch is correctable
-- by re-deriving from it later.
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
-- what an 'other' value originally was. Later tickets will migrate the app to
-- read shipping_carrier exclusively and strip client-supplied
-- `carrier`/`trackingUrl` keys in mergeExtensions (BMC-216F); as of this
-- migration neither control exists yet, so both extensions.carrier and
-- shipping_carrier remain live reads until that lands.
--
-- No tracking_url column is added: `lib/fulfillment/tracking.ts::buildTrackingUrl`
-- exists to derive customer-facing tracking links from (shipping_carrier,
-- tracking_number) at the response/email boundary, but as of this migration
-- it has no production call sites yet — the live email/admin paths still read
-- the legacy `extensions.trackingUrl` (see tracking.ts's own header note).
-- Wiring buildTrackingUrl in is ticket B/F's job, not this one's.

ALTER TABLE orders ADD COLUMN shipping_carrier TEXT;

-- Step 1: copy the legacy extensions.carrier value verbatim.
-- The nested CASE is what keeps json_extract away from a non-JSON extensions
-- blob: SQLite evaluates only the CASE branches it needs, whereas AND operand
-- order in a WHERE/CASE-condition list is not a documented short-circuit
-- guarantee — every json_* call here is gated by a json_valid() on the exact
-- value it is about to parse, never combined with AND.
--
-- Handles two shapes:
--   1. extensions is a JSON object   -> {"carrier": "UPS Ground", ...}
--   2. extensions is DOUBLE-ENCODED  -> "{\"carrier\": \"UPS Ground\", ...}"
--      i.e. a JSON *string* whose value is itself a JSON object. The app
--      tolerates this: `extensions` is a Drizzle mode:"json" column (parsed
--      once by Drizzle) and lib/models/mach/orders.ts's parseJsonField parses
--      AGAIN when the result is still a string, so some stored rows really
--      are shaped this way and their carrier must not be silently dropped.
-- json_type(...) returns NULL when a path is absent, so '= ''text''' also
-- filters out non-string carrier values (e.g. {"carrier": 123}).
UPDATE orders
   SET shipping_carrier = CASE WHEN json_valid(extensions) THEN
     CASE
       WHEN json_type(extensions, '$.carrier') = 'text'
         THEN json_extract(extensions, '$.carrier')
       WHEN json_type(extensions) = 'text'
            AND json_valid(json_extract(extensions, '$'))
         THEN CASE WHEN json_type(json_extract(extensions, '$'), '$.carrier') = 'text'
           THEN json_extract(json_extract(extensions, '$'), '$.carrier')
         END
     END
   END
 WHERE shipping_carrier IS NULL;

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
--
-- The four patterns in the WHERE and the four WHENs below are deliberately the
-- same set, which makes `ELSE NULL` unreachable today. It is kept as the safe
-- terminator, not as live logic: if a pattern is ever added to the WHERE
-- without a matching WHEN, the extra rows fall to NULL (left for a later,
-- deliberate backfill) rather than being silently mislabelled as a carrier
-- they are not. Add to both lists together.
UPDATE orders
   SET shipping_carrier = CASE
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
       THEN 'ups'
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'fedex%'
       THEN 'fedex'
     WHEN replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'federalexpress%'
       THEN 'fedex'
     ELSE NULL
   END
 WHERE shipping_carrier IS NULL
   AND shipping_method IS NOT NULL
   AND (
        replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'ups%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'unitedparcel%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'fedex%'
     OR replace(replace(replace(replace(lower(trim(shipping_method)), ' ', ''), '.', ''), '-', ''), '_', '') LIKE 'federalexpress%'
   );

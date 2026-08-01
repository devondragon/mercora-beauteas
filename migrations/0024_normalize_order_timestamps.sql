-- 0024_normalize_order_timestamps.sql
--
-- Normalize `orders.created_at` / `orders.updated_at` to ISO-8601 UTC (BMC-228 F-10).
--
-- THE BUG
-- Both columns held two incompatible TEXT encodings at once:
--
--   "2026-07-27 23:19:37"       -- SQLite CURRENT_TIMESTAMP column default, which
--                                  fired because buildOrderRecord omitted the column
--   "2026-07-28T01:35:32.122Z"  -- JS new Date().toISOString(), written by
--                                  app/api/orders/route.ts and lib/fulfillment/service.ts
--
-- SQLite compares TEXT byte-wise. `' '` is 0x20 and `'T'` is 0x54, so EVERY
-- space-encoded row sorts before EVERY ISO row no matter the actual instant. The
-- admin fulfillment queue sorts `created_at ASC` (oldest-first) and paginates on
-- that same order, so a mixed column can present a materially newer order as the
-- oldest and scatter rows onto the wrong pages.
--
-- Secondary: consumers render with `new Date(created_at)`. V8 parses the ISO form
-- as UTC but the space-separated form as LOCAL time, so the same instant renders
-- as a different time — and near midnight, a different DAY.
--
-- WHY ISO IS THE CANONICAL FORM (not a coin flip)
-- `shipped_at` and `updated_at` are already compare-and-swap markers matched for
-- exact string equality against a JS-generated toISOString() value
-- (lib/fulfillment/service.ts:156,331; lib/payments/refund-ledger-store.ts:42).
-- The database layer must therefore speak ISO.
--
-- THE WRITER IS FIXED SEPARATELY
-- lib/models/mach/orders.ts now always writes both columns explicitly in ISO, so
-- the CURRENT_TIMESTAMP default can no longer fire for an order row. This
-- migration only repairs rows that already exist. Without the writer fix the mix
-- would re-form on the next order.
--
-- SAFETY
--   * Idempotent — a row is rewritten only when strftime() would actually
--     CHANGE it, so re-running is a no-op.
--   * Lossless — strftime() returns NULL for a value it cannot parse, and the
--     `IS NOT NULL` guard means such a row is left untouched rather than nulled.
--   * Narrow — only rows NOT already canonical are rewritten.
--
-- WHY NO LIKE/GLOB PATTERN HERE
-- The obvious guard is a GLOB matching the canonical shape
-- ('[0-9][0-9][0-9][0-9]-[0-9][0-9]-...'), and it does NOT work: D1/workerd
-- builds SQLite with SQLITE_LIMIT_LIKE_PATTERN_LENGTH at 50 bytes, and that
-- pattern is ~92. It fails with "LIKE or GLOB pattern too complex:
-- SQLITE_ERROR" — meaning the migration could never apply, to any environment.
-- Since `npm run deploy:*` now auto-applies pending migrations before the build
-- (BMC-239) and aborts the deploy on failure, that would have broken deploys,
-- not just this migration.
--
-- Comparing the column against strftime()'s OWN output avoids pattern matching
-- altogether: a row is rewritten exactly when normalizing would change it.
--
-- Known limit, deliberately accepted: SQLite cannot parse a lowercase
-- '2026-07-29t11:00:00.000z' — strftime() returns NULL for it — so such a row
-- is left alone rather than repaired. That is the correct trade (the
-- IS NOT NULL guard is what stops unparseable values being nulled out), and it
-- is not reachable in practice: every writer emits uppercase via
-- Date#toISOString().
--
-- The canonical form is exactly what Date#toISOString() emits:
--   YYYY-MM-DDTHH:MM:SS.sssZ
--
-- NOTE: `shipped_at` / `delivered_at` are deliberately NOT touched. Those columns
-- carry no DEFAULT, so the space-encoded form was never reachable for them — they
-- are either NULL or already ISO, and `shipped_at` doubles as a live CAS marker.

UPDATE orders
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE created_at IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
  AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);

UPDATE orders
SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
WHERE updated_at IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL
  AND updated_at <> strftime('%Y-%m-%dT%H:%M:%fZ', updated_at);

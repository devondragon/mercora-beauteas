-- 0035_normalize_legacy_setting_values.sql
--
-- JSON-encode the eleven `admin_settings` rows whose values are bare strings.
--
-- WHY THESE ROWS EXIST
-- Every row the application writes stores JSON (`"USD"`, `true`, `[]`, `{...}`).
-- These eleven predate that convention, from the original seed and the Shopify
-- ETL, and hold raw text instead:
--
--   currency = USD                     store_name = BeauTeas
--   promo_link = /sale                 store_tagline = Build Your Beauty from Within
--   promo_link_text = Shop Now         store_description = Organic skincare teas...
--   promo_message = 🍵 Holiday Sale...  social_facebook / _instagram / _linkedin
--                                      / _pinterest = https://...
--
-- WHAT THEY COST
-- On 2026-08-17 the admin settings page called `JSON.parse(setting.value)`
-- unguarded while loading. The first of these rows threw, the load aborted, and
-- every field silently fell back to its hardcoded default — so the next Save
-- wrote those defaults over all 31 real settings: per-box shipping off, free
-- shipping over $75 restored during the closing sale, the express and overnight
-- methods that migration 0028 disabled turned back on, and the sale banner copy
-- replaced. The reader is now defensive (lib/admin/settings-parse.ts) and that
-- is the actual fix; this migration removes the landmine itself so the next
-- unguarded `JSON.parse` written against this table — in a script, an export, a
-- future admin surface — has nothing to trip over.
--
-- SAFE FOR EVERY READER
-- `getSettings` (lib/utils/settings.ts) already parses JSON and falls back to
-- the raw string, so `"USD"` and `USD` resolve to the same value `USD` for its
-- callers. No code reads these keys directly (audited across app/, lib/, and
-- components/ before writing this) — they are orphans, which is why normalizing
-- them cannot change a rendered page.
--
-- `json_quote` does the escaping, including the quote characters inside
-- `store_description` and the emoji in `promo_message`.
--
-- Idempotent: after this runs `json_valid(value)` is 1 for these rows, so a
-- re-run matches nothing. Guarded so it can only ever touch a row that is NOT
-- already valid JSON — it cannot double-encode a healthy row, which is the
-- mistake that corrupted product variants two days ago.
--
-- Data-only and additive (no DROP/RENAME/DELETE).

UPDATE admin_settings
SET value = json_quote(value),
    updated_at = CURRENT_TIMESTAMP
WHERE json_valid(value) = 0;

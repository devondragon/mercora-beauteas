-- Migration: 0031_goob_copy_fixes_and_banner_text
-- Date: 2026-08-11
--
-- Copy fixes from the pre-launch content review of the closing sale:
--
-- 1. `promotions.banner_text` still holds the pre-sale free-shipping message.
--    The banner is currently disabled, but its link already points at
--    /thank-you (0025), so whoever enables it would ship "Free shipping on
--    orders over $75!" during a sale with free shipping OFF and a 10 box
--    minimum. This rewrites the text to the closing-sale message. It does NOT
--    enable the banner: migrations apply at deploy time (Phase 1), while the
--    $3 reprice is Phase 4 of docs/goob-rollout-runbook.md, and the banner
--    must not quote $3 next to a $14.99 PDP. Enabling it is a runbook step
--    after the reprice, via /admin/settings -> Promotions.
--
-- 2. /thank-you: "fulfil" -> "fulfill" (the page is otherwise US English),
--    and the "now is the time" sentence gains a link back to the catalog.
--    Eight legacy product URLs 301 to /thank-you (0026), so without a link
--    the buyers arriving on those redirects dead-end in a goodbye.
--
-- 3. faq: "favourite" -> "favorite" in the box-math answer 0030 appended
--    (lib/ai/deterministic-answers.ts carries the same fix in code).
--
-- These are UPDATEs to rows 0026/0030 already wrote. The fixes live here, in
-- a NEW migration, rather than as edits to 0026/0030, because those files are
-- applied on dev: Wrangler tracks applied migrations by filename, so editing
-- an applied file would fix prod-to-be while leaving dev's rows stale.
--
-- Idempotent: every UPDATE is guarded on the presence of the text it replaces,
-- so a second application is a no-op.
--
-- No em dashes (U+2014) anywhere below - 0027 swept them from customer-facing
-- content and has already run, so it will not clean up after this file.

-- ============================================================================
-- 1. Banner text. Guarded on the stale free-shipping message so an
--    admin-entered text is never clobbered; deliberately cannot create a row.
-- ============================================================================

UPDATE admin_settings
SET value = '"We''re closing BeauTeas. Everything is $3 a box while it lasts."',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'promotions.banner_text'
  AND value LIKE '%Free shipping on orders over%';

-- ============================================================================
-- 2. /thank-you: spelling + the catalog link. Snapshot first, 0026-style.
-- ============================================================================

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0031'
FROM pages
WHERE slug = 'thank-you'
  AND (content LIKE '%to fulfil.%' OR content LIKE '%now is the time.</p>%');

UPDATE pages
SET content = REPLACE(content, 'to fulfil.', 'to fulfill.'),
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'thank-you'
  AND content LIKE '%to fulfil.%';

UPDATE pages
SET content = REPLACE(
      content,
      'now is the time.</p>',
      '<a href="/category/clearly-calendula">now is the time</a>.</p>'
    ),
    version = version + 1,
    updated_at = unixepoch()
-- The NOT LIKE guard is a truncated form of the anchor text: D1 caps LIKE
-- patterns at 50 bytes (see tests/unit/migrations/sql-pattern-limits.test.ts),
-- and the full '<a href="...">now is the time</a>' literal is 60.
WHERE slug = 'thank-you'
  AND content LIKE '%now is the time.</p>%'
  AND content NOT LIKE '%calendula">now is the time</a>%';

-- ============================================================================
-- 3. faq: US spelling in the 0030 box-math answer.
-- ============================================================================

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0031'
FROM pages
WHERE slug = 'faq'
  AND content LIKE '%favourite%';

UPDATE pages
SET content = REPLACE(content, 'favourite', 'favorite'),
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'faq'
  AND content LIKE '%favourite%';

-- Migration: 0030_goob_box_math_content
-- Date: 2026-08-09
--
-- The closing sale's "a year of tea is 36 boxes" framing rests on one fact that
-- is currently stored NOWHERE in this system: a box holds 10 tea bags. It is not
-- in the product descriptions, not in the CMS pages, and not on the variant
-- records. Chai therefore had no grounding for "how long does a box last?" and
-- would answer from vector context that does not contain the number.
--
-- This writes the fact into the two places that reach both a customer and the
-- vector index: the FAQ page and the three blend descriptions.
--
-- Idempotent: every UPDATE is guarded on the ABSENCE of the new text, so a
-- second application is a no-op. Guarding on absence rather than on a copy of
-- the old text also means these do not have to track 0026's and 0027's
-- rewrites of the same rows.
--
-- No em dashes (U+2014) anywhere below - 0027 swept them from customer-facing
-- content and has already run, so it will not clean up after this file.
-- Verified by grepping this file for the character before committing.

UPDATE "pages"
SET "content" = "content" ||
  '<h2>How many cups is a box?</h2>' ||
  '<p>Each box holds 10 tea bags, so a box is 10 cups. At a cup a day that is about ten days. ' ||
  'Most of our subscribers went through 3 boxes a month of their favourite blend, which is why 36 boxes works out to a year.</p>'
WHERE "slug" = 'faq'
  AND "content" NOT LIKE '%How many cups is a box%';

UPDATE "products"
SET "description" = json_set(
      "description",
      '$.en',
      json_extract("description", '$.en') || ' Each box holds 10 tea bags, so a box is 10 cups, about ten days at a cup a day.'
    )
WHERE "slug" IN (
    'clearly-calendula-morning',
    'clearly-calendula-afternoon',
    'clearly-calendula-evening'
  )
  AND json_extract("description", '$.en') NOT LIKE '%10 tea bags%';

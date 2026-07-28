-- Migration: 0019_restructure_footer_pages
-- Date: 2026-07-27
--
-- Applies the Structured Guide design (Tasks 1-8) to the footer-linked CMS
-- pages: Brewing Directions, FAQ, Contact, About Us, Subscriptions, and the
-- four legal pages.
--
-- Deliberately minimal: Shopify cruft removal and FAQ heading promotion
-- happen at render time in lib/cms/page-html.ts, so this migration only sets
-- what cannot be derived — the template column, ledes for pages with no
-- intro paragraph, the additive convention markup on Brewing Directions, and
-- the R2 image URLs for the two remaining Shopify-hosted images.
--
-- NOT included: any redirect_map row. middleware.ts only consults
-- redirect_map for paths under /products/, /collections/, /pages/, so a
-- /about row there would never fire; the /about -> /about-us redirect is
-- handled in next.config.ts by Task 10 instead. The duplicate `about`
-- placeholder page (seeded by 0003, "an AI-powered eCommerce platform") is
-- simply archived and pulled from nav below; `about-us` holds the real
-- founder story and is the page every link should point to.
--
-- Idempotent. Guards use short LIKE patterns because D1 rejects LIKE
-- patterns over 50 characters ("LIKE or GLOB pattern too complex"). Every
-- statement tolerates a missing row: dev has no `about` page, prod does.
--
-- Timestamps use unixepoch() (INTEGER), matching page_versions.created_at's
-- column default and pages.updated_at's column type -- NOT CURRENT_TIMESTAMP,
-- which returns a TEXT datetime string and would store the wrong type.
--
-- Snapshot pattern mirrors 0016: each page_versions INSERT below carries the
-- exact same guard as the UPDATE it precedes (content guard for the three
-- content-rewriting pages, `excerpt IS NULL` for the three lede-only pages,
-- a `column != new-value` guard for the four pages that only get a template
-- or status flip). That way a snapshot is captured only once, right before
-- the row it documents actually changes -- re-running this file by hand
-- inserts nothing new into page_versions.

-- Brewing Directions: snapshot before the full content rewrite below.
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'brewing-directions' AND content NOT LIKE '%class="blend"%';

-- About Us: snapshot before its Shopify image URL is repointed to R2.
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'about-us' AND content LIKE '%85A6329%';

-- Subscriptions: snapshot before its Shopify image URL is repointed to R2.
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'subscriptions' AND content LIKE '%85A6547%';

-- FAQ / Shipping / Refund: snapshot before their one-time lede is set.
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'faq' AND excerpt IS NULL;

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'shipping-policy' AND excerpt IS NULL;

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'refund-policy' AND excerpt IS NULL;

-- Contact: snapshot before its template flips from 'default' to 'contact'.
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'contact' AND template != 'contact';

-- Privacy / Terms: snapshot only if their template isn't already 'legal'
-- (it already is, seeded that way by 0003, so this is a no-op guard on
-- fresh and existing DBs alike -- included for parity with the other two
-- legal pages and to protect against a future re-seed that doesn't set it).
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'privacy-policy' AND template != 'legal';

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'terms-of-service' AND template != 'legal';

-- About: snapshot before it is archived below.
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0019'
FROM pages WHERE slug = 'about' AND status != 'archived';

-- ── Templates ────────────────────────────────────────────────────────────────
UPDATE pages SET template = 'guide'   WHERE slug = 'brewing-directions';
UPDATE pages SET template = 'faq'     WHERE slug = 'faq';
UPDATE pages SET template = 'contact' WHERE slug = 'contact';
UPDATE pages SET template = 'story'   WHERE slug IN ('about-us', 'subscriptions');
UPDATE pages SET template = 'legal'
  WHERE slug IN ('shipping-policy', 'refund-policy', 'privacy-policy', 'terms-of-service');

-- ── Ledes for the three pages with no intro paragraph of their own ───────────
-- Brewing Directions, Contact, About Us, Subscriptions, Privacy and Terms all
-- open with a real intro paragraph, which the renderer promotes automatically.
UPDATE pages SET excerpt = 'Ingredients, caffeine, brewing and subscriptions — the things people ask us most.'
  WHERE slug = 'faq' AND excerpt IS NULL;
UPDATE pages SET excerpt = 'How and when your order gets to you.'
  WHERE slug = 'shipping-policy' AND excerpt IS NULL;
UPDATE pages SET excerpt = 'What to do if something isn''t right.'
  WHERE slug = 'refund-policy' AND excerpt IS NULL;

-- ── Brewing Directions: add specs chips, blend links and callouts ────────────
-- Full replacement rather than a chain of REPLACE() calls. The words are
-- unchanged; the caveats move into <blockquote> and the blends are linked.
-- Guard is short: D1 caps LIKE patterns at 50 characters.
UPDATE pages SET
  content = '<p>Brewing your tea correctly will help ensure that it tastes delicious and that you are getting the most benefits from the organic herbs and flowers in our tea blends.  Don''t stress out over the precise temperatures, or freak out if you let it steep a little too long, these are just guidelines to help you get the most out of your tea.</p>
<h2>Black Teas</h2>
<ul class="specs"><li>205–212°F water</li><li>Steep 3–5 minutes</li></ul>
<p>For Black teas, like our Clearly Calendula Morning, which is an Earl Grey based tea, we recommend using water that is between 205 and 212 degrees Fahrenheit.</p>
<p>It''s best to boil water, and then let it cool for 30 seconds or so before pouring it into your tea cup.  But you can use boiling water if you''re in a rush:)</p>
<p>Add the tea bag to the hot water in the cup, and let it steep for 3-5 minutes, before removing the tea bag.</p>
<blockquote>If you let it steep too long the tea can taste too strong and slightly bitter (it''s still safe to drink).</blockquote>
<figure class="blend"><a href="/product/clearly-calendula-morning">Clearly Calendula Morning</a></figure>
<h2>Green Teas</h2>
<ul class="specs"><li>175°F water</li><li>Steep 2–4 minutes</li></ul>
<p>For Green teas, like our Clearly Calendula Afternoon, which is a Green tea, we recommend using water that is around 175 degrees Fahrenheit.</p>
<p>It''s best to boil water, and then let it cool for 3 minutes or so before pouring it into your tea cup.  Or you can get a kettle which allows you to set the target temperature for 175 degrees.</p>
<p>Add the tea bag to the hot water in the cup, and let it steep for 2-4 minutes, before removing the tea bag.</p>
<blockquote>If you let it steep too long the tea can taste too strong and slightly bitter (it''s still safe to drink).</blockquote>
<figure class="blend"><a href="/product/clearly-calendula-afternoon">Clearly Calendula Afternoon</a></figure>
<h2>Herbal Teas</h2>
<ul class="specs"><li>212°F water</li><li>Steep 5+ minutes</li></ul>
<p>For Herbal teas, like our Clearly Calendula Evening, which is a herbal tea, we recommend using water that is around 212 degrees Fahrenheit.</p>
<p>It''s best to boil water, and immediately pour it into your tea cup.</p>
<p>Add the tea bag to the hot water in the cup, and let it steep for at least 5 minutes, you don''t have to remove the tea bag.</p>
<blockquote>Generally letting herbal teas steep longer can make them taste a little stronger, but they won''t become bitter or unpleasant to drink.</blockquote>
<figure class="blend"><a href="/product/clearly-calendula-evening">Clearly Calendula Evening</a></figure>
<h2>Iced Teas</h2>
<ul class="specs"><li>Cold brew 2+ hours</li><li>1 bag per 8–16 oz</li></ul>
<p>Iced tea can be a super refreshing way to drink your tea, especially in warm weather, or at the gym.  Luckily it''s easy to make!  You can easily brew up a large amount of tea, using multiple tea bags in a pitcher.  Generally you will want one bag for every 8-16 oz of water, depending on how strong you like it.</p>
<p><img src="/media/pages/brewing-iced-tea-pour.jpg" alt="Pouring freshly brewed iced tea into a travel bottle"></p>
<p>Black teas must be hot brewed, using the directions above, and then chilled.  It''s usually best to let the hot tea cool to room temperature on your counter, and then move it into the refrigerator.</p>
<p>For Green and Herbal teas, you can hot brew, and then chill like with Black teas. However you can also cold brew these teas as well, which might be easier.  Cold brewing is basically just adding your tea bags to cold water, and letting it steep for at least two hours and up to several days.</p>
<p>You can do this inside a water bottle, mason jar, or large pitcher.  You can drink it with ice, or just chilled from the fridge.</p>
<p>Play around with amounts and timing to figure out what you like best!</p>',
  version = version + 1,
  updated_at = unixepoch()
WHERE slug = 'brewing-directions' AND content NOT LIKE '%class="blend"%';

-- ── Repoint the remaining Shopify images at R2 ──────────────────────────────
UPDATE pages SET
  content = replace(
    content,
    'https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6329_e90889c6-2175-4c97-ab75-96eac46c1115_1024x1024.jpg?v=1626361061',
    '/media/pages/about-us-vanity-ritual.jpg'
  ),
  version = version + 1,
  updated_at = unixepoch()
WHERE slug = 'about-us' AND content LIKE '%85A6329%';

UPDATE pages SET
  content = replace(
    content,
    'https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6547_1024x1024.jpg?v=1625358249',
    '/media/pages/subscriptions-vanity-flatlay.jpg'
  ),
  version = version + 1,
  updated_at = unixepoch()
WHERE slug = 'subscriptions' AND content LIKE '%85A6547%';

-- ── Retire the duplicate About placeholder ──────────────────────────────────
-- `about` is the generic page seeded by 0003 ("an AI-powered eCommerce
-- platform"); `about-us` holds the real founder story. Prod has both, dev has
-- only `about-us`, so this is a no-op where the row is absent.
UPDATE pages SET status = 'archived', show_in_nav = 0 WHERE slug = 'about';

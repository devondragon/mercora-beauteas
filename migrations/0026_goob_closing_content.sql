-- Migration: 0026_goob_closing_content
-- Date: 2026-08-06
--
-- GOOB closing sale: the last surface that still contradicted the sale was the
-- CMS pages. Chai already agrees with the sale (0025 + code from Task 11) and
-- the checkout notice does (Task 12); this migration brings the storefront's
-- own content pages into agreement.
--
-- Ordering note: 0025 and 0027 are BOTH still pending on every database, so
-- this file (0026) slots between them by filename. 0027 rewrites `faq`,
-- `shipping-policy`, `contact` and `privacy-policy` guarded on the OLD
-- (pre-0026) text. This migration rewrites `shipping-policy` and `contact`
-- first, so 0027's guard for those two rows will no longer match and 0027
-- will silently no-op for them on any database that applies both. That is
-- safe only because the replacement text below is itself already free of
-- em-dashes (Task 12b's sweep) -- verified by grepping this file for the em
-- dash character before committing.
--
-- Idempotent throughout: every UPDATE is guarded on a short LIKE fragment (or,
-- for `faq`'s excerpt, an exact match) unique to the OLD text, so a second
-- application of this file is a no-op. Re-run to confirm before deploying.
--
-- Refund wording (the highest-value fix here): all four places that state the
-- closing-sale refund stance -- this migration's `refund-policy` page,
-- components/checkout/FinalSaleNotice.tsx, the order-confirmation email in
-- lib/utils/email.ts, and refundWindowAnswer's final-sale branch in
-- lib/ai/deterministic-answers.ts -- agree in substance: all sales are final,
-- no returns or exchanges, but a damaged, lost, or incorrect order is always
-- made right. See task-13-report.md for all four quoted side by side.

-- ============================================================================
-- 1. /thank-you -- new page, owner-approved copy (frozen, used verbatim).
--    Template 'closing' is new (added in lib/cms/page-template.ts this same
--    commit): same narrative layout as 'story', but with no CTA band, so the
--    shared story CTA (which used to link to /subscriptions) cannot appear
--    under a page that just told the reader subscriptions are off. No
--    'thank-you' row exists on any database today (verified against remote
--    dev), so INSERT OR IGNORE creates it everywhere; the follow-up UPDATE is
--    kept anyway per the project's INSERT-then-UPDATE convention (0014, 0016,
--    0019) so a stray pre-existing row with different content is corrected to
--    the approved copy rather than silently left stale.
-- ============================================================================

INSERT OR IGNORE INTO pages (title, slug, content, status, template, meta_description, show_in_nav, sort_order) VALUES
(
    'Thank You',
    'thank-you',
    '<p>BeauTeas is closing. After a lot of thought, and more than a few late nights with a cup of our Evening blend, we''ve decided to wind the shop down for good.</p>' ||
    '<p>Before anything else, thank you. For every order, for the notes about how your skin was doing, for telling your friends. A small tea company only exists because people choose it on purpose, and you did that.</p>' ||
    '<h2>Why we''re closing</h2>' ||
    '<p>We''d rather give you the real reasons than a press release.</p>' ||
    '<p>Advertising got expensive. The cost of putting BeauTeas in front of someone who would love it roughly doubled, and for a small brand that is most of the battle. Shipping went up too, so every box costs meaningfully more to send than it did when we started. And people are being careful with money right now, which we understand completely. Organic skincare tea is a lovely thing to have, but it is an extra, and extras are the first thing to go when budgets get tight.</p>' ||
    '<p>We could have worked around any one of those. All three at once added up to a math problem we couldn''t solve at our size. Rather than slowly get worse at this, with thinner inventory and slower shipping and corners cut on the formulations, we''d rather finish honestly and say a proper goodbye.</p>' ||
    '<h2>What this means for you</h2>' ||
    '<p>Everything left is priced to clear, and once it''s gone it''s gone. A few specifics so nothing catches you out at checkout:</p>' ||
    '<ul>' ||
    '<li>All sales are final. No returns or exchanges, because we won''t be here to process them. If your order arrives damaged or never turns up, we will absolutely make that right.</li>' ||
    '<li>There is a 10 box minimum. Mix and match however you like across Morning, Afternoon and Evening. It all counts toward the same total, and it keeps shipping affordable while we clear the last of the stock.</li>' ||
    '<li>Shipping is priced by how many boxes you order. You''ll see the exact cost at checkout before you pay.</li>' ||
    '<li>Subscriptions are switched off. We can''t promise a recurring delivery we won''t be around to fulfil.</li>' ||
    '</ul>' ||
    '<h2>About the tea itself</h2>' ||
    '<p>We want to be straight with you about this part.</p>' ||
    '<p>Our remaining stock has been in sealed, airtight storage for several years. It has been kept carefully, sealed and dry and out of the light, and it is still lovely to drink. The aroma is a little gentler than a fresh harvest, which is exactly why everything is priced the way it is.</p>' ||
    '<p>We''d rather say that plainly than leave you wondering. If a gentler cup isn''t what you''re after, we understand completely. If you''ve been meaning to stock up on a blend you already love, now is the time.</p>' ||
    '<h2>Thank you, again</h2>' ||
    '<p>Building this was one of the best things we have done. The notes you sent, the before and afters, the people who wrote just to say that a blend had become part of their evening: we kept all of it.</p>' ||
    '<p>Thank you for letting BeauTeas be part of your day 💕</p>',
    'published',
    'closing',
    'Why BeauTeas is closing, what it means for your order, and a proper thank you.',
    0,
    0
);

UPDATE pages
SET
    title = 'Thank You',
    content =
    '<p>BeauTeas is closing. After a lot of thought, and more than a few late nights with a cup of our Evening blend, we''ve decided to wind the shop down for good.</p>' ||
    '<p>Before anything else, thank you. For every order, for the notes about how your skin was doing, for telling your friends. A small tea company only exists because people choose it on purpose, and you did that.</p>' ||
    '<h2>Why we''re closing</h2>' ||
    '<p>We''d rather give you the real reasons than a press release.</p>' ||
    '<p>Advertising got expensive. The cost of putting BeauTeas in front of someone who would love it roughly doubled, and for a small brand that is most of the battle. Shipping went up too, so every box costs meaningfully more to send than it did when we started. And people are being careful with money right now, which we understand completely. Organic skincare tea is a lovely thing to have, but it is an extra, and extras are the first thing to go when budgets get tight.</p>' ||
    '<p>We could have worked around any one of those. All three at once added up to a math problem we couldn''t solve at our size. Rather than slowly get worse at this, with thinner inventory and slower shipping and corners cut on the formulations, we''d rather finish honestly and say a proper goodbye.</p>' ||
    '<h2>What this means for you</h2>' ||
    '<p>Everything left is priced to clear, and once it''s gone it''s gone. A few specifics so nothing catches you out at checkout:</p>' ||
    '<ul>' ||
    '<li>All sales are final. No returns or exchanges, because we won''t be here to process them. If your order arrives damaged or never turns up, we will absolutely make that right.</li>' ||
    '<li>There is a 10 box minimum. Mix and match however you like across Morning, Afternoon and Evening. It all counts toward the same total, and it keeps shipping affordable while we clear the last of the stock.</li>' ||
    '<li>Shipping is priced by how many boxes you order. You''ll see the exact cost at checkout before you pay.</li>' ||
    '<li>Subscriptions are switched off. We can''t promise a recurring delivery we won''t be around to fulfil.</li>' ||
    '</ul>' ||
    '<h2>About the tea itself</h2>' ||
    '<p>We want to be straight with you about this part.</p>' ||
    '<p>Our remaining stock has been in sealed, airtight storage for several years. It has been kept carefully, sealed and dry and out of the light, and it is still lovely to drink. The aroma is a little gentler than a fresh harvest, which is exactly why everything is priced the way it is.</p>' ||
    '<p>We''d rather say that plainly than leave you wondering. If a gentler cup isn''t what you''re after, we understand completely. If you''ve been meaning to stock up on a blend you already love, now is the time.</p>' ||
    '<h2>Thank you, again</h2>' ||
    '<p>Building this was one of the best things we have done. The notes you sent, the before and afters, the people who wrote just to say that a blend had become part of their evening: we kept all of it.</p>' ||
    '<p>Thank you for letting BeauTeas be part of your day 💕</p>',
    status = 'published',
    template = 'closing',
    meta_description = 'Why BeauTeas is closing, what it means for your order, and a proper thank you.',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'thank-you'
  -- Short guard: D1 caps LIKE patterns at 50 characters.
  AND (content IS NULL OR content NOT LIKE '%cup of our Evening blend%');

-- `closing` template: makes the kind selectable in the admin editor's Template
-- dropdown (which reads from THIS table, not lib/cms/page-template.ts -- see
-- docs/cms-pages.md). Mirrors migration 0020's seeding pattern exactly.
INSERT OR IGNORE INTO page_templates (name, display_name, description, fields, default_content) VALUES
(
    'closing',
    'Closing Announcement',
    'Long-form goodbye page. Same layout as Story, but with no shop or subscriptions call-to-action band, for the closing-sale announcement.',
    '{"title": {"type": "text", "required": true}, "content": {"type": "richtext", "required": true}, "excerpt": {"type": "textarea", "required": false}}',
    '<p>Open with the news, plainly.</p><h2>Why we are closing</h2><p>The real reasons.</p><h2>What this means for you</h2><p>The practical specifics.</p>'
);

-- ============================================================================
-- 2. refund-policy -- final sale, not a 30-day return window.
--    Substance matches FinalSaleNotice.tsx, the order-confirmation email, and
--    Chai's refundWindowAnswer final-sale branch: all sales final, no returns
--    or exchanges, but a damaged, lost, or incorrect order is made right.
-- ============================================================================

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0026'
FROM pages WHERE slug = 'refund-policy' AND content LIKE '%You may request a return within%';

UPDATE pages
SET
    content =
    '<p><strong>Last Updated:</strong> ' || date('now') || '</p>' ||
    '<h2>All Sales Are Final</h2><p>BeauTeas is closing, and every order placed during our closing sale is final. We are not able to offer returns or exchanges, because our team will not be here afterward to process them.</p>' ||
    '<h2>Damaged, Lost, or Incorrect Orders</h2><p>Final sale does not mean you are on your own. If your order arrives damaged, never turns up, or is not what you ordered, contact us at <a href="mailto:info@beauteas.com">info@beauteas.com</a> with your order number and we will make it right with a replacement or a refund.</p>' ||
    '<h2>Why We Are Not Accepting Returns</h2><p>Remaining stock is priced to clear and is being packed and shipped by a small team as we wind down. Reopening returns would mean holding inventory and staff well past the point we can support it responsibly, so every sale is final instead.</p>' ||
    '<h2>Subscriptions</h2><p>Subscriptions are switched off for the closing sale. Every order is a one-time purchase.</p>' ||
    '<h2>Questions</h2><p>Reach us any time at <a href="mailto:info@beauteas.com">info@beauteas.com</a> and a member of our team will be happy to help.</p>',
    meta_description = 'BeauTeas closing sale refund policy: all sales are final, but a damaged, lost, or incorrect order is always made right.',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'refund-policy' AND content LIKE '%You may request a return within%';

-- ============================================================================
-- 3. shipping-policy -- one Standard method, priced by box-count tier. No
--    dollar amounts here: tiers are entered in admin after the owner weighs
--    boxes and are not known yet (0025's shipping.tiers seeds empty).
--    Hardcoding a price here would be a new drift source of exactly the kind
--    this project has been closing. This is the page Chai's shippingRatesAnswer
--    links customers to, so it is the most urgent of the four content pages.
-- ============================================================================

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0026'
FROM pages WHERE slug = 'shipping-policy' AND content LIKE '%Overnight</strong>%';

UPDATE pages
SET
    content =
    '<p><strong>Last Updated:</strong> ' || date('now') || '</p>' ||
    '<h2>Order Processing</h2><p>Orders are processed and packed within 1 to 2 business days (Monday through Friday, excluding holidays). You will receive a confirmation email with tracking as soon as your order ships.</p>' ||
    '<h2>Our Closing Sale Shipping</h2><p>We ship one Standard method within the United States, priced by how many boxes you order rather than a flat rate. The more boxes in your order, the better the shipping cost per box. You will see the exact shipping cost for your order at checkout before you pay, and there is a 10 box minimum on every order while we clear the last of our stock.</p>' ||
    '<h2>Delivery Estimates</h2><p>Standard shipping typically arrives in 5 to 7 business days once your order leaves our facility. Carrier delays, weather, and peak periods can occasionally affect delivery windows.</p>' ||
    '<h2>Tracking Your Order</h2><p>Once your order ships, you can track your package using the link in your shipping confirmation email or from your order history in your account.</p>' ||
    '<h2>Lost or Delayed Packages</h2><p>If your tracking has not updated or your package has not arrived within the estimated window, contact us at <a href="mailto:info@beauteas.com">info@beauteas.com</a> and we will help track it down. A package that is genuinely lost is covered by our <a href="/refund-policy">Refund Policy</a>: we will make it right.</p>' ||
    '<h2>International Orders</h2><p>We are not shipping internationally during our closing sale. If you are outside the United States, email us at <a href="mailto:info@beauteas.com">info@beauteas.com</a> and we will let you know if that changes.</p>',
    meta_description = 'How BeauTeas ships during our closing sale: one Standard method priced by box count, with the exact cost shown at checkout before you pay.',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'shipping-policy' AND content LIKE '%Overnight</strong>%';

-- ============================================================================
-- 4. contact -- drop the stale subscription mentions.
-- ============================================================================

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0026'
FROM pages WHERE slug = 'contact' AND content LIKE '%your order, a subscription%';

UPDATE pages
SET
    content =
    '<p>We would love to hear from you. We are closing BeauTeas for good, but our team is still here to help with your order or any question about our teas.</p>' ||
    '<h2>Email Us</h2><p>The fastest way to reach us is by email at <a href="mailto:info@beauteas.com">info@beauteas.com</a>. We aim to respond to every message within 1 to 2 business days.</p>' ||
    '<h2>Customer Support Hours</h2><p>Our support team is available Monday through Friday, 9:00 AM to 5:00 PM Mountain Time, excluding public holidays.</p>' ||
    '<h2>Order and Shipping Questions</h2><p>For help with an existing order, please include your order number so we can assist you as quickly as possible. You can also review our <a href="/shipping-policy">Shipping Policy</a> and <a href="/refund-policy">Refund &amp; Return Policy</a> for quick answers to common questions.</p>' ||
    '<h2>Frequently Asked Questions</h2><p>Many questions are answered on our <a href="/faq">FAQ page</a>, a great first stop for details about our ingredients and brewing.</p>' ||
    '<h2>Stay Connected</h2><p>Follow along on Instagram, Facebook, and Pinterest as we wind things down.</p>',
    meta_description = 'Get in touch with the BeauTeas team. Email us at info@beauteas.com for questions about your order, shipping, or our closing sale.',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'contact' AND content LIKE '%your order, a subscription%';

-- ============================================================================
-- 5. faq -- excerpt mentioned subscriptions and carried an em-dash. Body Q&A
--    (organic certification, caffeine, pregnancy, audience) is unrelated to
--    the sale and needs no change.
-- ============================================================================

UPDATE pages
SET excerpt = 'Ingredients, caffeine, and brewing: the things people ask us most.',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'faq'
  -- Prefix-only match (not the full old string): the old excerpt contains an
  -- em dash, which this migration's own text must not (grep -c on this file
  -- must be 0), so the guard is written to avoid embedding that character.
  AND excerpt LIKE 'Ingredients, caffeine, brewing and subscriptions%';

-- ============================================================================
-- 6. subscriptions -- switched off for the sale. Archived, not deleted:
--    subscriptions are a preserved upstreaming target. next.config.ts adds a
--    static redirect /subscriptions -> /thank-you (a bare /subscriptions
--    matches none of the five redirect_map prefixes middleware.ts checks, so
--    a redirect_map row here would never fire -- same reasoning already
--    documented for /about -> /about-us).
-- ============================================================================

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0026'
FROM pages WHERE slug = 'subscriptions' AND status != 'archived';

UPDATE pages SET status = 'archived', show_in_nav = 0, updated_at = unixepoch()
WHERE slug = 'subscriptions' AND status != 'archived';

-- ============================================================================
-- 7. Withdrawal redirects for the two discontinued bundle SKUs.
--
--    `clearly-calendula-sample-pack` and `clearly-calendula-full-package` are
--    confirmed live in the catalog (checked against remote dev). The task
--    brief also named a third slug, `clearly-calendula-sample-pack-on-sale`;
--    it does not exist anywhere in the products table, and no redirect_map row
--    references it either -- but it DOES exist as its own row in `pages`
--    (id 7 on remote dev): published, template 'default', content = '' (empty
--    string). It is a leftover from the Shopify ETL for what was evidently a
--    one-off promotional landing page, not a catalog product, and it is
--    handled separately in section 8 below rather than as a redirect_map row.
--
--    Verified against docs/redirects.md and middleware.ts: middleware only
--    consults redirect_map for paths under /products/, /collections/,
--    /pages/, /blogs/, /policies/. The live Mercora route is the SINGULAR
--    /product/<slug>, which middleware never checks against redirect_map at
--    all -- a row with source_path = '/product/<slug>' would silently never
--    fire, which is exactly the kind of dead row this project has been
--    closing. So: (a) the 6 existing legacy-Shopify rows whose target_path
--    already points at these two products are repointed at /thank-you, and
--    (b) two new rows are added for the bare /products/<slug> shape (no
--    collection prefix), which had no existing row and was falling through to
--    the structural fallback (-> /product/<slug>, the still-live PDP).
--
--    NOT done here: the live /product/<slug> pages themselves are unaffected
--    and remain purchasable (both products are still status = 'active'). See
--    task-13-report.md Concerns -- withdrawing them for real is a product
--    status decision (Task 1's mechanism), out of this CMS-content task's
--    scope, and is flagged rather than silently decided.
-- ============================================================================

UPDATE redirect_map SET target_path = '/thank-you'
WHERE source_path = '/collections/best-selling-products/products/clearly-calendula-full-package'
  AND target_path = '/product/clearly-calendula-full-package';

UPDATE redirect_map SET target_path = '/thank-you'
WHERE source_path = '/collections/best-selling-products/products/clearly-calendula-sample-pack'
  AND target_path = '/product/clearly-calendula-sample-pack';

UPDATE redirect_map SET target_path = '/thank-you'
WHERE source_path = '/collections/clearly-calendula/products/clearly-calendula-full-package'
  AND target_path = '/product/clearly-calendula-full-package';

UPDATE redirect_map SET target_path = '/thank-you'
WHERE source_path = '/collections/clearly-calendula/products/clearly-calendula-sample-pack'
  AND target_path = '/product/clearly-calendula-sample-pack';

UPDATE redirect_map SET target_path = '/thank-you'
WHERE source_path = '/collections/newest-products/products/clearly-calendula-full-package'
  AND target_path = '/product/clearly-calendula-full-package';

UPDATE redirect_map SET target_path = '/thank-you'
WHERE source_path = '/collections/newest-products/products/clearly-calendula-sample-pack'
  AND target_path = '/product/clearly-calendula-sample-pack';

INSERT OR IGNORE INTO redirect_map (source_path, target_path, status_code, entity_type) VALUES
('/products/clearly-calendula-full-package', '/thank-you', 301, 'product'),
('/products/clearly-calendula-sample-pack', '/thank-you', 301, 'product');

-- ============================================================================
-- 8. clearly-calendula-sample-pack-on-sale -- the brief's third "SKU" is
--    actually this empty, published `pages` row (see section 7's note above).
--    Archived rather than deleted, same as `subscriptions`. next.config.ts
--    adds a static redirect to /thank-you for the same reason /subscriptions
--    needs one: a bare top-level slug matches none of the five redirect_map
--    prefixes middleware.ts checks, so a redirect_map row would never fire.
-- ============================================================================

INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, unixepoch(), 'migration-0026'
FROM pages WHERE slug = 'clearly-calendula-sample-pack-on-sale' AND status != 'archived';

UPDATE pages SET status = 'archived', show_in_nav = 0, updated_at = unixepoch()
WHERE slug = 'clearly-calendula-sample-pack-on-sale' AND status != 'archived';

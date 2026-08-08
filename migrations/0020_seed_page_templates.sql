-- 0020_seed_page_templates.sql
--
-- Makes every render kind selectable in the admin editor.
--
-- WHY: `pages.template` drives the layout (lib/cms/page-template.ts:
-- guide|faq|contact|legal|story), but the admin editor's Template dropdown is
-- populated from the `page_templates` TABLE, which migration 0003 seeded with
-- only `default`, `legal` and `about`. Migration 0019 set pages.template to
-- `guide`/`faq`/`contact`/`story` in raw SQL, so those pages render correctly
-- but show an EMPTY dropdown in the admin — and the moment an editor touches
-- that dropdown their only options are default/about (both of which render as
-- `story`), silently downgrading the page's design. A legal page would lose its
-- contents rail and gain a "Shop the teas" CTA.
--
-- Data-only and idempotent: `page_templates.name` is UNIQUE, so INSERT OR IGNORE
-- is a no-op on re-run and leaves the pre-existing `legal` row untouched.
--
-- NOTE on timestamps: created_at is INTEGER unixepoch() in this schema, not a
-- CURRENT_TIMESTAMP string — the column default handles it, so it is omitted here.

INSERT OR IGNORE INTO page_templates (name, display_name, description, fields, default_content) VALUES
(
    'guide',
    'Structured Guide',
    'Sectioned how-to page. <h2> starts a section; <ul class="specs"> becomes chips, <blockquote> a callout, and <figure class="blend"> with a link to /product/<slug> adds a shoppable column.',
    '{"title": {"type": "text", "required": true}, "content": {"type": "richtext", "required": true}, "excerpt": {"type": "textarea", "required": false}}',
    '<p>One or two sentences introducing the guide.</p><h2>First step</h2><p>What to do.</p><ul class="specs"><li>205°F</li><li>3 minutes</li></ul><blockquote>A short aside worth pulling out.</blockquote><figure class="blend"><a href="/product/clearly-calendula-morning">Clearly Calendula Morning</a></figure><h2>Second step</h2><p>What to do next.</p>'
),
(
    'faq',
    'FAQ',
    'Questions as an accordion. Each <h2> is a question; a bold paragraph ending in a question mark is promoted to one automatically. Text before the first question renders above the list.',
    '{"title": {"type": "text", "required": true}, "content": {"type": "richtext", "required": true}, "excerpt": {"type": "textarea", "required": false}}',
    '<h2>Are your teas organic?</h2><p>Yes, every blend is USDA-certified organic.</p><h2>How long does shipping take?</h2><p>Orders ship within two business days.</p>'
),
(
    'contact',
    'Contact',
    'Short sections rendered as an info grid, each with an icon chosen from its heading.',
    '{"title": {"type": "text", "required": true}, "content": {"type": "richtext", "required": true}, "excerpt": {"type": "textarea", "required": false}}',
    '<h2>Email us</h2><p>hello@beauteas.com</p><h2>Support hours</h2><p>Monday to Friday, 9am–5pm ET.</p><h2>Orders and shipping</h2><p>Include your order number and we will get right back to you.</p>'
),
(
    'story',
    'Story',
    'Long-form narrative page with a shop CTA. This is also the layout used when a page has no recognized template.',
    '{"title": {"type": "text", "required": true}, "content": {"type": "richtext", "required": true}, "excerpt": {"type": "textarea", "required": false}, "hero_image": {"type": "image", "required": false}}',
    '<p>Open with the idea the page is about.</p><h2>Our story</h2><p>Tell it here.</p><h2>Our mission</h2><p>What drives us.</p>'
);

-- The `about` template predates `story` and renders identically to it (both land
-- on the story layout). Hide it from the dropdown rather than deleting the row,
-- so any page still storing `about` keeps resolving and no FK-less reference breaks.
UPDATE page_templates SET is_active = 0 WHERE name = 'about';

-- `default` stays active: it is the `pages.template` column default, so every
-- page created outside the admin arrives with it. Make the consequence explicit
-- rather than leaving editors to discover it.
UPDATE page_templates
SET description = 'Standard content page. Renders with the Story layout. Pick a specific template above for a designed page.'
WHERE name = 'default';

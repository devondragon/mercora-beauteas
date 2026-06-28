-- Rebrand seeded CMS content from the prior outdoor-gear / Mercora brand to
-- BeauTeas (organic skincare teas). The original copy was inserted by
-- migration 0003 and has already been applied to existing databases, so
-- editing 0003 alone does not update existing rows — this migration updates
-- them in place. Fresh databases are seeded correctly by the updated 0003.
--
-- Each update is guarded by a LIKE on the original seeded copy so that an
-- About/Terms page already edited via the CMS is never clobbered, and the
-- migration is safe to re-run (idempotent). Before each change we snapshot the
-- current content into page_versions and bump the page version, preserving
-- history.

-- Terms of Service: snapshot, then replace only the "Description of Service"
-- sentence that references gear (preserving the original "Last Updated" date).
INSERT INTO page_versions (page_id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, change_summary, created_at, created_by)
SELECT id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, 'Snapshot before BeauTeas rebrand (migration 0009)', unixepoch(), 'migration'
FROM pages
WHERE slug = 'terms-of-service'
  AND content LIKE '%outdoor gear and equipment%';

UPDATE pages
SET content = REPLACE(
        content,
        'We provide an AI-powered eCommerce platform for outdoor gear and equipment.',
        'We provide an AI-powered eCommerce platform for organic skincare teas.'
    ),
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'terms-of-service'
  AND content LIKE '%outdoor gear and equipment%';

-- About Us: the entire body is outdoor-gear copy. Snapshot, then replace it
-- wholesale to match the BeauTeas content now seeded by 0003. Guarded on the
-- original "About Mercora" heading so a re-branded page is left untouched.
INSERT INTO page_versions (page_id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, change_summary, created_at, created_by)
SELECT id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, 'Snapshot before BeauTeas rebrand (migration 0009)', unixepoch(), 'migration'
FROM pages
WHERE slug = 'about'
  AND content LIKE '%About Mercora%';

UPDATE pages
SET content = '<h1>About BeauTeas</h1><h2>Our Story</h2><p>BeauTeas is an AI-powered eCommerce platform specializing in USDA-certified organic skincare teas. We combine cutting-edge artificial intelligence with a passion for natural beauty and wellness.</p><h2>Our Mission</h2><p>To help you build your beauty from within through intelligent recommendations, personalized service, and expert knowledge of organic botanicals powered by AI.</p><h2>Why Choose Us</h2><ul><li><strong>AI-Powered Recommendations:</strong> Our intelligent assistant Chai helps you find the perfect blend for your skin</li><li><strong>Expert Knowledge:</strong> Comprehensive product information and organic skincare expertise</li><li><strong>Quality Products:</strong> Carefully curated selection of USDA-certified organic tea blends</li><li><strong>Fast Shipping:</strong> Quick delivery to start your beauty ritual sooner</li></ul><h2>Contact Us</h2><p>Have questions? Our team is here to help you find the perfect tea blend for your beauty ritual.</p>',
    meta_description = 'Learn about our mission to help you build your beauty from within through organic skincare teas.',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'about'
  AND content LIKE '%About Mercora%';

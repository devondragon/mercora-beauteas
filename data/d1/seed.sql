-- BeauTeas Database Seed Data
-- Organic Skincare Tea E-Commerce Platform
-- Based on Mercora MACH Alliance Open Data Model

-- =====================================================
-- Categories Data
-- =====================================================

-- Clear existing categories
DELETE FROM categories;

-- BeauTeas tea categories
INSERT INTO categories (id, name, description, slug, status, parent_id, position, path, created_at, updated_at, product_count, attributes, tags, primary_image, seo, extensions) VALUES
('cat_featured', '{"en": "Featured"}', '{"en": "Our most popular organic skincare teas, handpicked for their beauty-boosting benefits."}', 'featured', 'active', NULL, 1, '/featured', datetime('now'), datetime('now'), 0, '{}', '["featured", "bestseller", "popular"]', '{"url": "categories/featured.png", "alt_text": "Featured teas"}', '{"meta_title": "Featured Teas - BeauTeas", "meta_description": "Our most popular organic skincare teas for glowing skin from within."}', '{}'),

('cat_sale', '{"en": "Sale"}', '{"en": "Limited-time deals on our organic skincare tea blends."}', 'sale', 'active', NULL, 2, '/sale', datetime('now'), datetime('now'), 0, '{}', '["sale", "discount", "deals"]', '{"url": "categories/sale.png", "alt_text": "Sale teas"}', '{"meta_title": "Sale - BeauTeas", "meta_description": "Save on organic skincare teas - limited time offers."}', '{}'),

('cat_black_tea', '{"en": "Black Tea"}', '{"en": "Energizing organic black tea blends for morning skincare rituals."}', 'black-tea', 'active', NULL, 3, '/black-tea', datetime('now'), datetime('now'), 0, '{}', '["black tea", "caffeinated", "morning", "energy"]', '{"url": "categories/black-tea.png", "alt_text": "Black tea blends"}', '{"meta_title": "Black Tea - BeauTeas", "meta_description": "Organic black tea blends for energizing mornings and healthy skin."}', '{}'),

('cat_green_tea', '{"en": "Green Tea"}', '{"en": "Refreshing organic green tea blends for sustained focus and skin health."}', 'green-tea', 'active', NULL, 4, '/green-tea', datetime('now'), datetime('now'), 0, '{}', '["green tea", "caffeinated", "afternoon", "antioxidants"]', '{"url": "categories/green-tea.png", "alt_text": "Green tea blends"}', '{"meta_title": "Green Tea - BeauTeas", "meta_description": "Organic green tea blends rich in antioxidants for beautiful skin."}', '{}'),

('cat_herbal_tea', '{"en": "Herbal Tea"}', '{"en": "Caffeine-free organic herbal blends for evening relaxation and skin repair."}', 'herbal-tea', 'active', NULL, 5, '/herbal-tea', datetime('now'), datetime('now'), 0, '{}', '["herbal tea", "caffeine-free", "evening", "relaxation"]', '{"url": "categories/herbal-tea.png", "alt_text": "Herbal tea blends"}', '{"meta_title": "Herbal Tea - BeauTeas", "meta_description": "Caffeine-free organic herbal teas for relaxation and skin repair."}', '{}'),

('cat_skincare', '{"en": "Skincare Teas"}', '{"en": "All our teas are formulated to improve skin health from within."}', 'skincare-teas', 'active', NULL, 6, '/skincare-teas', datetime('now'), datetime('now'), 0, '{}', '["skincare", "beauty", "acne", "collagen", "anti-aging"]', '{"url": "categories/skincare.png", "alt_text": "Skincare teas"}', '{"meta_title": "Skincare Teas - BeauTeas", "meta_description": "Organic teas designed to fight acne, boost collagen, and improve skin health."}', '{}'),

('cat_bundles', '{"en": "Bundles & Samplers"}', '{"en": "Try our curated tea collections and sample packs."}', 'bundles', 'active', NULL, 7, '/bundles', datetime('now'), datetime('now'), 0, '{}', '["bundle", "sampler", "collection", "gift"]', '{"url": "categories/bundles.png", "alt_text": "Tea bundles"}', '{"meta_title": "Bundles & Samplers - BeauTeas", "meta_description": "Curated tea collections and sample packs to discover your favorites."}', '{}');

-- Update all categories to have empty children arrays
UPDATE categories SET children = '[]' WHERE parent_id IS NULL;

-- =====================================================
-- Products Data - Clearly Calendula Collection
-- =====================================================

-- Clear existing products
DELETE FROM products;

-- BeauTeas products
INSERT INTO products (id, name, description, slug, status, external_references, created_at, updated_at, brand, categories, tags, options, default_variant_id, fulfillment_type, tax_category, primary_image, media, seo, rating, related_products, extensions) VALUES

-- Clearly Calendula Morning (Black Tea)
('prod_morning', 'Clearly Calendula Morning', '{"en": "Start your day with our energizing organic black tea blend designed for skincare benefits. This enhanced Earl Grey combines premium Assam and Qu Hao black teas with lavender, spearmint, vanilla, peppermint, and calendula petals. The smooth Earl Grey flavor with hints of mint and vanilla provides lasting energy while fighting acne-causing bacteria, healing skin damage, increasing collagen production, and delivering powerful antioxidants. Drink one or two cups in the morning to energize while rehydrating and repairing skin. 100% USDA Certified Organic."}', 'clearly-calendula-morning', 'active', '{"shopify_id": "6652098674855"}', datetime('now'), datetime('now'), 'BeauTeas', '["cat_featured", "cat_sale", "cat_black_tea", "cat_skincare"]', '["morning", "black tea", "Earl Grey", "energizing", "calendula", "acne", "collagen", "organic", "USDA"]', '[{"id": "quantity", "name": "Quantity", "type": "select", "values": [{"id": "1box", "value": "One Box (10 bags)"}, {"id": "3box", "value": "Three Boxes (30 bags)"}]}]', 'variant_morning_1box', 'physical', 'food', '{"url": "products/clearly-calendula-morning.jpg", "alt_text": "Clearly Calendula Morning - Organic Black Tea"}', '[{"url": "products/clearly-calendula-morning.jpg", "alt_text": "Clearly Calendula Morning - Organic Black Tea"}, {"url": "products/clearly-calendula-morning-2.jpg", "alt_text": "Clearly Calendula Morning - Tea Bags"}, {"url": "products/clearly-calendula-morning-3.jpg", "alt_text": "Clearly Calendula Morning - Back of Box"}]', '{"meta_title": "Clearly Calendula Morning - Organic Black Tea for Skincare | BeauTeas", "meta_description": "Energizing organic Earl Grey black tea with calendula for glowing skin. Fights acne, boosts collagen, rich in antioxidants. USDA Certified Organic."}', '{"average": 4.5, "count": 2}', '["prod_afternoon", "prod_evening", "prod_sample_pack"]', '{"ingredients": "Organic Assam Black Tea, Organic Qu Hao Black Tea, organic lavender, organic spearmint, organic vanilla flavoring, organic peppermint, organic calendula petals", "caffeine": "caffeinated", "servings": "10 tea bags per box", "benefits": ["Fights acne-causing bacteria", "Heals acne and skin damage", "Increases collagen production", "Reduces hormone swings", "Smooth lasting energy", "Rich in antioxidants"], "certifications": ["USDA Organic"], "brewing": {"temp": "212°F", "time": "3-5 minutes"}}'),

-- Clearly Calendula Afternoon (Green Tea)
('prod_afternoon', 'Clearly Calendula Afternoon', '{"en": "Power through your afternoon with our refreshing organic green tea blend designed for skin health and sustained energy. This unique blend combines premium Dragonwell and Sencha green teas with lemon verbena, spearmint, peppermint, and calendula petals. Perfect hot or iced, at work, school, or the gym. The calendula fights bacteria and stimulates collagen, spearmint provides anti-inflammatory benefits, and lemon verbena combats acne-causing bacteria. Enjoy smooth, long-lasting energy while supporting your skin health journey. 100% USDA Certified Organic."}', 'clearly-calendula-afternoon', 'active', '{"shopify_id": "6652098707623"}', datetime('now'), datetime('now'), 'BeauTeas', '["cat_featured", "cat_sale", "cat_green_tea", "cat_skincare"]', '["afternoon", "green tea", "Dragonwell", "Sencha", "refreshing", "calendula", "weight loss", "antioxidants", "organic", "USDA"]', '[{"id": "quantity", "name": "Quantity", "type": "select", "values": [{"id": "1box", "value": "One Box (10 bags)"}, {"id": "3box", "value": "Three Boxes (30 bags)"}]}]', 'variant_afternoon_1box', 'physical', 'food', '{"url": "products/clearly-calendula-afternoon.jpg", "alt_text": "Clearly Calendula Afternoon - Organic Green Tea"}', '[{"url": "products/clearly-calendula-afternoon.jpg", "alt_text": "Clearly Calendula Afternoon - Organic Green Tea"}, {"url": "products/clearly-calendula-afternoon-2.jpg", "alt_text": "Clearly Calendula Afternoon - Tea Bags"}, {"url": "products/clearly-calendula-afternoon-3.jpg", "alt_text": "Clearly Calendula Afternoon - Back of Box"}]', '{"meta_title": "Clearly Calendula Afternoon - Organic Green Tea for Skincare | BeauTeas", "meta_description": "Refreshing organic green tea with calendula for healthy, glowing skin. Fights acne, aids weight loss, rich in antioxidants. USDA Certified Organic."}', '{"average": 4.6, "count": 3}', '["prod_morning", "prod_evening", "prod_sample_pack"]', '{"ingredients": "Organic Dragonwell Green Tea, Organic Sencha Green Tea, organic lemon verbena, organic spearmint, organic peppermint, organic calendula petals", "caffeine": "caffeinated", "servings": "10 tea bags per box", "benefits": ["Fights acne-causing bacteria", "Heals acne and skin damage", "Aids weight loss", "Reduces hormone swings", "Smooth long-lasting energy", "Rich in antioxidants"], "certifications": ["USDA Organic"], "brewing": {"temp": "175°F", "time": "2-3 minutes"}}'),

-- Clearly Calendula Evening (Herbal Tea)
('prod_evening', 'Clearly Calendula Evening', '{"en": "Wind down your day with our soothing caffeine-free herbal blend designed for evening relaxation and overnight skin repair. This calming tea combines organic chamomile, rooibos, spearmint, peppermint, and calendula petals. Chamomile promotes relaxation, calendula heals and fights bacteria, spearmint controls hormone-based acne, peppermint reduces oil production, and rooibos delivers antioxidants plus natural alpha hydroxy acids (AHA) for gentle skin renewal. Enjoy before bed for a restful sleep while your skin repairs. 100% USDA Certified Organic and completely caffeine-free."}', 'clearly-calendula-evening', 'active', '{"shopify_id": "6652098740391"}', datetime('now'), datetime('now'), 'BeauTeas', '["cat_featured", "cat_sale", "cat_herbal_tea", "cat_skincare"]', '["evening", "herbal tea", "caffeine-free", "chamomile", "rooibos", "relaxation", "calendula", "AHA", "organic", "USDA"]', '[{"id": "quantity", "name": "Quantity", "type": "select", "values": [{"id": "1box", "value": "One Box (10 bags)"}, {"id": "3box", "value": "Three Boxes (30 bags)"}]}]', 'variant_evening_1box', 'physical', 'food', '{"url": "products/clearly-calendula-evening.jpg", "alt_text": "Clearly Calendula Evening - Organic Herbal Tea"}', '[{"url": "products/clearly-calendula-evening.jpg", "alt_text": "Clearly Calendula Evening - Organic Herbal Tea"}, {"url": "products/clearly-calendula-evening-2.jpg", "alt_text": "Clearly Calendula Evening - Tea Bags"}, {"url": "products/clearly-calendula-evening-3.jpg", "alt_text": "Clearly Calendula Evening - Back of Box"}]', '{"meta_title": "Clearly Calendula Evening - Caffeine-Free Herbal Tea for Skincare | BeauTeas", "meta_description": "Soothing caffeine-free herbal tea with calendula and chamomile for overnight skin repair. Contains natural AHA. USDA Certified Organic."}', '{"average": 4.8, "count": 5}', '["prod_morning", "prod_afternoon", "prod_sample_pack"]', '{"ingredients": "Organic chamomile, organic rooibos, organic spearmint, organic peppermint, organic calendula petals", "caffeine": "caffeine-free", "servings": "10 tea bags per box", "benefits": ["Fights acne-causing bacteria", "Heals acne and skin damage", "Contains alpha hydroxy acid (AHA)", "Reduces hormone-based acne", "Soothing and calming", "Rich in antioxidants"], "certifications": ["USDA Organic"], "brewing": {"temp": "212°F", "time": "5-7 minutes"}}'),

-- Clearly Calendula Sample Pack
('prod_sample_pack', 'Clearly Calendula Sample Pack', '{"en": "Discover the complete Clearly Calendula collection with our sample pack featuring one box (10 tea bags) each of Morning (black tea), Afternoon (green tea), and Evening (herbal tea). Experience the full day of skincare tea benefits - energize in the morning, maintain focus in the afternoon, and relax in the evening while your skin heals and rejuvenates around the clock. All teas are 100% USDA Certified Organic with compostable tea bags made from sugarcane. The perfect introduction to beauty from within or a thoughtful gift for tea and skincare enthusiasts."}', 'clearly-calendula-sample-pack', 'active', '{"shopify_id": "6652098773159", "sku": "BTCCSP"}', datetime('now'), datetime('now'), 'BeauTeas', '["cat_featured", "cat_sale", "cat_bundles", "cat_skincare"]', '["sample pack", "bundle", "collection", "gift", "variety", "calendula", "organic", "USDA", "all day"]', null, 'variant_sample_pack', 'physical', 'food', '{"url": "products/clearly-calendula-sample-pack.jpg", "alt_text": "Clearly Calendula Sample Pack - All Three Blends"}', '[{"url": "products/clearly-calendula-sample-pack.jpg", "alt_text": "Clearly Calendula Sample Pack - All Three Blends"}, {"url": "products/clearly-calendula-sample-pack-2.jpg", "alt_text": "Clearly Calendula Sample Pack - Contents"}, {"url": "products/clearly-calendula-sample-pack-3.jpg", "alt_text": "Clearly Calendula Sample Pack - Gift Box"}]', '{"meta_title": "Clearly Calendula Sample Pack - Try All Three Organic Skincare Teas | BeauTeas", "meta_description": "Sample all three Clearly Calendula organic skincare teas - Morning, Afternoon, and Evening blends. Perfect gift. USDA Certified Organic."}', '{"average": 4.75, "count": 8}', '["prod_morning", "prod_afternoon", "prod_evening"]', '{"contents": ["1x Clearly Calendula Morning (10 bags)", "1x Clearly Calendula Afternoon (10 bags)", "1x Clearly Calendula Evening (10 bags)"], "total_servings": "30 tea bags", "packaging": "Compostable tea bags made with sugarcane", "benefits": ["100% USDA Certified Organic", "Fights and heals acne", "Increases collagen production", "Rich in antioxidants", "Hydrating and flavorful", "Sugar-free/zero calorie", "All-natural clean beauty"], "certifications": ["USDA Organic"]}');

-- =====================================================
-- Product Variants Data
-- =====================================================

-- Clear existing variants
DELETE FROM product_variants;

-- Product variants with pricing
INSERT INTO product_variants (id, product_id, sku, option_values, price, status, position, compare_at_price, cost, weight, dimensions, barcode, inventory, tax_category, shipping_required, media, attributes, created_at, updated_at) VALUES

-- Morning variants
('variant_morning_1box', 'prod_morning', 'BTCC-MOR-1', '[{"option_id": "quantity", "value": "One Box (10 bags)"}]', '{"amount": 1499, "currency": "USD"}', 'active', 1, '{"amount": 2000, "currency": "USD"}', '{"amount": 500, "currency": "USD"}', '{"value": 0.15, "unit": "lbs"}', '{"length": 4, "width": 3, "height": 2, "unit": "inches"}', 'BTCCMOR1', '{"quantity": 100, "status": "in_stock", "track_inventory": true}', 'food', 1, '[]', '{"servings": 10, "tea_type": "Black Tea", "caffeine": "Yes"}', datetime('now'), datetime('now')),

('variant_morning_3box', 'prod_morning', 'BTCC-MOR-3', '[{"option_id": "quantity", "value": "Three Boxes (30 bags)"}]', '{"amount": 3499, "currency": "USD"}', 'active', 2, '{"amount": 6000, "currency": "USD"}', '{"amount": 1400, "currency": "USD"}', '{"value": 0.45, "unit": "lbs"}', '{"length": 8, "width": 4, "height": 3, "unit": "inches"}', 'BTCCMOR3', '{"quantity": 50, "status": "in_stock", "track_inventory": true}', 'food', 1, '[]', '{"servings": 30, "tea_type": "Black Tea", "caffeine": "Yes"}', datetime('now'), datetime('now')),

-- Afternoon variants
('variant_afternoon_1box', 'prod_afternoon', 'BTCC-AFT-1', '[{"option_id": "quantity", "value": "One Box (10 bags)"}]', '{"amount": 1499, "currency": "USD"}', 'active', 1, '{"amount": 2000, "currency": "USD"}', '{"amount": 500, "currency": "USD"}', '{"value": 0.15, "unit": "lbs"}', '{"length": 4, "width": 3, "height": 2, "unit": "inches"}', 'BTCCAFT1', '{"quantity": 100, "status": "in_stock", "track_inventory": true}', 'food', 1, '[]', '{"servings": 10, "tea_type": "Green Tea", "caffeine": "Yes"}', datetime('now'), datetime('now')),

('variant_afternoon_3box', 'prod_afternoon', 'BTCC-AFT-3', '[{"option_id": "quantity", "value": "Three Boxes (30 bags)"}]', '{"amount": 3499, "currency": "USD"}', 'active', 2, '{"amount": 6000, "currency": "USD"}', '{"amount": 1400, "currency": "USD"}', '{"value": 0.45, "unit": "lbs"}', '{"length": 8, "width": 4, "height": 3, "unit": "inches"}', 'BTCCAFT3', '{"quantity": 50, "status": "in_stock", "track_inventory": true}', 'food', 1, '[]', '{"servings": 30, "tea_type": "Green Tea", "caffeine": "Yes"}', datetime('now'), datetime('now')),

-- Evening variants
('variant_evening_1box', 'prod_evening', 'BTCC-EVE-1', '[{"option_id": "quantity", "value": "One Box (10 bags)"}]', '{"amount": 1499, "currency": "USD"}', 'active', 1, '{"amount": 2000, "currency": "USD"}', '{"amount": 500, "currency": "USD"}', '{"value": 0.15, "unit": "lbs"}', '{"length": 4, "width": 3, "height": 2, "unit": "inches"}', 'BTCCEVE1', '{"quantity": 100, "status": "in_stock", "track_inventory": true}', 'food', 1, '[]', '{"servings": 10, "tea_type": "Herbal Tea", "caffeine": "No"}', datetime('now'), datetime('now')),

('variant_evening_3box', 'prod_evening', 'BTCC-EVE-3', '[{"option_id": "quantity", "value": "Three Boxes (30 bags)"}]', '{"amount": 3499, "currency": "USD"}', 'active', 2, '{"amount": 6000, "currency": "USD"}', '{"amount": 1400, "currency": "USD"}', '{"value": 0.45, "unit": "lbs"}', '{"length": 8, "width": 4, "height": 3, "unit": "inches"}', 'BTCCEVE3', '{"quantity": 50, "status": "in_stock", "track_inventory": true}', 'food', 1, '[]', '{"servings": 30, "tea_type": "Herbal Tea", "caffeine": "No"}', datetime('now'), datetime('now')),

-- Sample Pack variant
('variant_sample_pack', 'prod_sample_pack', 'BTCC-SP', '[]', '{"amount": 3499, "currency": "USD"}', 'active', 1, '{"amount": 4375, "currency": "USD"}', '{"amount": 1400, "currency": "USD"}', '{"value": 0.45, "unit": "lbs"}', '{"length": 8, "width": 6, "height": 3, "unit": "inches"}', 'BTCCSP', '{"quantity": 75, "status": "in_stock", "track_inventory": true}', 'food', 1, '[]', '{"servings": 30, "tea_types": ["Black Tea", "Green Tea", "Herbal Tea"], "boxes_included": 3}', datetime('now'), datetime('now'));

-- =====================================================
-- Pricing Data
-- =====================================================

-- Clear existing pricing
DELETE FROM pricing;

-- Pricing entries for BeauTeas products (all on sale)
INSERT INTO pricing (id, product_id, list_price, sale_price, type, status, external_references, created_at, updated_at, valid_from, valid_to, campaign_id, pricelist_id, catalog_id, tax, currency_code, minimum_quantity, customer_segment_id, channel_id, region_id, extensions) VALUES

-- Morning pricing
('price_morning_1', 'prod_morning', '2000', '1499', 'retail', 'active', '{}', datetime('now'), datetime('now'), datetime('now'), '2024-12-31', 'holiday_sale_2024', NULL, NULL, '{"included": false, "rate": 0, "type": "food_exempt"}', 'USD', 1, NULL, NULL, 'US', '{"on_sale": true, "discount_percent": 25}'),

-- Afternoon pricing
('price_afternoon_1', 'prod_afternoon', '2000', '1499', 'retail', 'active', '{}', datetime('now'), datetime('now'), datetime('now'), '2024-12-31', 'holiday_sale_2024', NULL, NULL, '{"included": false, "rate": 0, "type": "food_exempt"}', 'USD', 1, NULL, NULL, 'US', '{"on_sale": true, "discount_percent": 25}'),

-- Evening pricing
('price_evening_1', 'prod_evening', '2000', '1499', 'retail', 'active', '{}', datetime('now'), datetime('now'), datetime('now'), '2024-12-31', 'holiday_sale_2024', NULL, NULL, '{"included": false, "rate": 0, "type": "food_exempt"}', 'USD', 1, NULL, NULL, 'US', '{"on_sale": true, "discount_percent": 25}'),

-- Sample Pack pricing
('price_sample_pack', 'prod_sample_pack', '4375', '3499', 'retail', 'active', '{}', datetime('now'), datetime('now'), datetime('now'), '2024-12-31', 'holiday_sale_2024', NULL, NULL, '{"included": false, "rate": 0, "type": "food_exempt"}', 'USD', 1, NULL, NULL, 'US', '{"on_sale": true, "discount_percent": 20}');

-- =====================================================
-- Settings Data
-- =====================================================

-- Update store settings for BeauTeas
DELETE FROM settings WHERE key IN ('store_name', 'store_tagline', 'store_description', 'social_instagram', 'social_facebook', 'social_pinterest', 'social_linkedin', 'currency', 'tax_enabled');

INSERT INTO settings (key, value, type, created_at, updated_at) VALUES
('store_name', 'BeauTeas', 'string', datetime('now'), datetime('now')),
('store_tagline', 'Build Your Beauty from Within', 'string', datetime('now'), datetime('now')),
('store_description', 'Organic skincare teas designed to improve your beauty from within. USDA certified organic tea blends with calendula, chamomile, and more.', 'string', datetime('now'), datetime('now')),
('social_instagram', 'https://instagram.com/beauteas', 'string', datetime('now'), datetime('now')),
('social_facebook', 'https://facebook.com/beauteas', 'string', datetime('now'), datetime('now')),
('social_pinterest', 'https://pinterest.com/beauteas', 'string', datetime('now'), datetime('now')),
('social_linkedin', 'https://linkedin.com/company/beauteas', 'string', datetime('now'), datetime('now')),
('currency', 'USD', 'string', datetime('now'), datetime('now')),
('tax_enabled', 'false', 'boolean', datetime('now'), datetime('now'));

-- =====================================================
-- Promotional Banner
-- =====================================================

-- Add holiday sale promotional banner
DELETE FROM settings WHERE key LIKE 'promo_%';

INSERT INTO settings (key, value, type, created_at, updated_at) VALUES
('promo_enabled', 'true', 'boolean', datetime('now'), datetime('now')),
('promo_message', '🍵 Holiday Sale: 30% off all teas through December 31st! Use code GLOW30', 'string', datetime('now'), datetime('now')),
('promo_link', '/sale', 'string', datetime('now'), datetime('now')),
('promo_link_text', 'Shop Now', 'string', datetime('now'), datetime('now'));

-- =====================================================
-- Content Pages
-- =====================================================

-- Clear existing pages
DELETE FROM pages;

-- BeauTeas content pages
INSERT INTO pages (title, slug, content, excerpt, meta_title, meta_description, meta_keywords, status, published_at, template, sort_order, show_in_nav, nav_title, version, created_at, updated_at) VALUES

-- About Us Page
('About BeauTeas', 'about', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Our Story</h1>

  <p class="text-lg mb-6">BeauTeas was born from a simple belief: true beauty starts from within. We combine the ancient wisdom of herbal remedies with modern skincare science to create organic tea blends that nourish your skin while delighting your taste buds.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">The Calendula Difference</h2>
  <p class="mb-6">At the heart of every BeauTeas blend is calendula—a remarkable flower used for centuries to heal and beautify skin. When combined with carefully selected organic teas and herbs, calendula works from the inside out to fight acne, boost collagen production, and deliver powerful antioxidants where your skin needs them most.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">Our Mission</h2>
  <p class="mb-6">We believe that skincare shouldn''t require harsh chemicals or complicated routines. Our mission is to help you achieve glowing, healthy skin through the simple ritual of drinking tea. Each cup is a moment of self-care that works while you work, rest, or play.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">Quality You Can Trust</h2>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li><strong>100% USDA Certified Organic</strong> – Every ingredient is certified organic, ensuring purity and potency</li>
    <li><strong>Sustainably Sourced</strong> – We partner with farms that share our commitment to environmental responsibility</li>
    <li><strong>Compostable Packaging</strong> – Our tea bags are made from sugarcane, not plastic</li>
    <li><strong>Small Batch Blending</strong> – We carefully blend each batch to ensure optimal freshness and flavor</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">Join Our Community</h2>
  <p class="mb-6">Thousands of tea lovers have discovered the beauty benefits of BeauTeas. We invite you to join our community and start your journey to healthier, more radiant skin—one delicious cup at a time.</p>
</div>
', 'BeauTeas combines ancient herbal wisdom with modern skincare science to create organic tea blends that nourish your skin from within.', 'About BeauTeas - Organic Skincare Teas | Build Your Beauty from Within', 'Learn about BeauTeas, our mission to create organic skincare teas with calendula, and our commitment to sustainable, USDA certified organic ingredients.', 'about, beauteas, organic tea, skincare, calendula, mission, story', 'published', strftime(''%s'', ''now''), 'about', 1, 1, 'About Us', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Brewing Directions Page
('Brewing Directions', 'brewing-directions', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">How to Brew the Perfect Cup</h1>

  <p class="text-lg mb-8">Getting the most from your BeauTeas is easy. Follow these simple guidelines for each tea type, and remember—these are starting points. Feel free to adjust to your personal taste!</p>

  <div class="bg-surface-light rounded-lg p-6 mb-8">
    <h2 class="text-2xl font-serif mb-4">☀️ Morning Blend (Black Tea)</h2>
    <ul class="space-y-2">
      <li><strong>Water Temperature:</strong> 205-212°F (just off boiling)</li>
      <li><strong>Steep Time:</strong> 3-5 minutes</li>
      <li><strong>Tip:</strong> Let boiling water cool for 30 seconds before pouring for optimal flavor extraction</li>
    </ul>
  </div>

  <div class="bg-surface-light rounded-lg p-6 mb-8">
    <h2 class="text-2xl font-serif mb-4">🌿 Afternoon Blend (Green Tea)</h2>
    <ul class="space-y-2">
      <li><strong>Water Temperature:</strong> 175°F (cooler than black tea)</li>
      <li><strong>Steep Time:</strong> 2-4 minutes</li>
      <li><strong>Tip:</strong> Let boiling water cool for about 3 minutes, or use a temperature-controlled kettle. Green tea can become bitter if the water is too hot.</li>
    </ul>
  </div>

  <div class="bg-surface-light rounded-lg p-6 mb-8">
    <h2 class="text-2xl font-serif mb-4">🌙 Evening Blend (Herbal Tea)</h2>
    <ul class="space-y-2">
      <li><strong>Water Temperature:</strong> 212°F (full boiling)</li>
      <li><strong>Steep Time:</strong> 5-7 minutes (or longer!)</li>
      <li><strong>Tip:</strong> Unlike other teas, herbal blends won''t become bitter with extended steeping. Feel free to leave the bag in for a stronger brew.</li>
    </ul>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-4">Making Iced Tea</h2>
  <p class="mb-4">All our blends make excellent iced tea! Here are two methods:</p>

  <h3 class="text-xl font-serif mt-6 mb-3">Hot Brew Method (Fastest)</h3>
  <ol class="list-decimal pl-6 mb-6 space-y-2">
    <li>Brew tea at double strength using the directions above</li>
    <li>Let cool to room temperature</li>
    <li>Pour over ice and enjoy</li>
  </ol>

  <h3 class="text-xl font-serif mt-6 mb-3">Cold Brew Method (Smoothest)</h3>
  <ol class="list-decimal pl-6 mb-6 space-y-2">
    <li>Add 1 tea bag per 8-16 oz of cold water (depending on desired strength)</li>
    <li>Refrigerate for at least 2 hours (or overnight for best results)</li>
    <li>Remove tea bag and serve over ice</li>
  </ol>

  <div class="bg-primary-100 rounded-lg p-6 mt-8">
    <h3 class="text-xl font-serif mb-3">Pro Tip: Consistency is Key</h3>
    <p>For best skincare results, enjoy 1-2 cups daily. The beneficial compounds in our teas work cumulatively, so regular consumption leads to the best outcomes for your skin.</p>
  </div>
</div>
', 'Learn how to brew BeauTeas for maximum flavor and skincare benefits. Includes instructions for black, green, and herbal teas plus iced tea methods.', 'Brewing Directions - How to Brew BeauTeas | BeauTeas', 'Step-by-step brewing instructions for BeauTeas organic skincare teas. Learn optimal temperatures, steep times, and iced tea methods for black, green, and herbal blends.', 'brewing, directions, how to brew, tea instructions, iced tea, steep time, temperature', 'published', strftime(''%s'', ''now''), 'default', 2, 1, 'Brewing Guide', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- How Our Teas Work Page
('How Our Teas Work', 'how-it-works', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">The Science of Skincare Tea</h1>

  <p class="text-lg mb-8">BeauTeas work from the inside out, delivering powerful skin-loving compounds directly into your bloodstream where they can reach every cell of your skin. Here''s how each ingredient contributes to your glow:</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">🌼 Calendula: The Skin Healer</h2>
  <p class="mb-4">Calendula has been used for centuries to heal and beautify skin. Modern research confirms what herbalists have long known:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li><strong>Antibacterial properties</strong> – Fights acne-causing bacteria</li>
    <li><strong>Anti-inflammatory effects</strong> – Reduces redness and irritation</li>
    <li><strong>Wound healing</strong> – Accelerates skin repair and reduces scarring</li>
    <li><strong>Collagen stimulation</strong> – Helps maintain skin elasticity and firmness</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">🍃 Spearmint: The Hormone Balancer</h2>
  <p class="mb-4">Spearmint is particularly effective for hormonal acne:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Helps regulate androgen levels that contribute to breakouts</li>
    <li>Reduces excess oil production</li>
    <li>Provides anti-inflammatory benefits</li>
    <li>Adds a refreshing flavor to every blend</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">🫖 Rooibos: The Antioxidant Powerhouse</h2>
  <p class="mb-4">Our Evening blend features rooibos, which offers unique benefits:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li><strong>Natural AHA</strong> – Contains alpha hydroxy acids for gentle exfoliation</li>
    <li><strong>Rich in antioxidants</strong> – Fights free radicals that cause aging</li>
    <li><strong>Caffeine-free</strong> – Perfect for evening relaxation</li>
    <li><strong>Mineral-rich</strong> – Contains zinc, which supports skin health</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">🌿 Chamomile: The Calming Flower</h2>
  <p class="mb-4">Chamomile in our Evening blend provides:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Powerful anti-inflammatory properties</li>
    <li>Promotes relaxation and better sleep (essential for skin repair)</li>
    <li>Antioxidant protection</li>
    <li>Gentle, soothing flavor</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">🍵 Premium Tea Bases</h2>
  <p class="mb-4">Our tea bases provide their own benefits:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li><strong>Black Tea (Morning)</strong> – Rich in antioxidants, provides sustained energy without jitters</li>
    <li><strong>Green Tea (Afternoon)</strong> – Contains EGCG, a powerful compound that protects skin from UV damage and supports weight management</li>
    <li><strong>Herbal Base (Evening)</strong> – Caffeine-free blend that works while you sleep</li>
  </ul>

  <div class="bg-primary-100 rounded-lg p-6 mt-10">
    <h3 class="text-xl font-serif mb-3">Results Timeline</h3>
    <p class="mb-4">While everyone''s skin is different, here''s what many customers experience:</p>
    <ul class="space-y-2">
      <li><strong>Week 1-2:</strong> Improved hydration and energy</li>
      <li><strong>Week 3-4:</strong> Reduced redness and fewer new breakouts</li>
      <li><strong>Month 2+:</strong> Clearer, more radiant skin with improved texture</li>
    </ul>
  </div>
</div>
', 'Discover the science behind BeauTeas skincare teas. Learn how calendula, spearmint, rooibos, and premium teas work together to improve your skin.', 'How Our Teas Work - The Science of Skincare Tea | BeauTeas', 'Learn how BeauTeas organic skincare teas work. Discover the benefits of calendula, spearmint, rooibos, and other ingredients for clearer, healthier skin.', 'how it works, skincare science, calendula benefits, spearmint acne, rooibos AHA, tea for skin', 'published', strftime(''%s'', ''now''), 'default', 3, 1, 'How It Works', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- FAQ Page
('Frequently Asked Questions', 'faq', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Frequently Asked Questions</h1>

  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">How long until I see results?</h3>
      <p>Most customers notice improved hydration and energy within the first week. Visible skin improvements typically appear after 3-4 weeks of daily use. For best results, we recommend drinking 1-2 cups per day consistently.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Are BeauTeas really organic?</h3>
      <p>Yes! All BeauTeas products are 100% USDA Certified Organic. Every ingredient—from our tea leaves to our calendula petals—is certified organic and sourced from trusted suppliers who share our commitment to quality.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Which blend should I start with?</h3>
      <p>We recommend starting with our <a href="/product/clearly-calendula-sample-pack" class="text-primary-600 hover:text-primary-700 underline">Sample Pack</a>, which includes all three blends. This lets you experience the full day of skincare benefits and discover which flavors you love most.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Can I drink BeauTeas if I''m pregnant or nursing?</h3>
      <p>While our teas are made with gentle, organic ingredients, we recommend consulting with your healthcare provider before consuming any herbal products during pregnancy or while nursing.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Do your teas contain caffeine?</h3>
      <p>Our Morning (black tea) and Afternoon (green tea) blends contain caffeine. Our Evening blend is completely caffeine-free, making it perfect for your nighttime routine.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Are the tea bags compostable?</h3>
      <p>Yes! Our tea bags are made from sugarcane fiber, not plastic. They''re fully compostable and break down naturally, reducing environmental impact.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">How should I store my tea?</h3>
      <p>Store your BeauTeas in a cool, dry place away from direct sunlight. The box is designed to protect freshness, but you can also transfer bags to an airtight container if preferred. Use within 12 months of purchase for best flavor.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Do you offer subscriptions?</h3>
      <p>Yes! Subscribe and save 10% on every order. Choose monthly or bi-monthly delivery, and you can pause, skip, or cancel anytime. Subscribers never run out of their favorite teas.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">What is your return policy?</h3>
      <p>We want you to love your BeauTeas! If you''re not satisfied with your purchase, contact us within 30 days for a full refund or exchange. We stand behind our products 100%.</p>
    </div>

    <div class="pb-6">
      <h3 class="text-xl font-serif mb-3">How can I contact you?</h3>
      <p>We''d love to hear from you! Email us at hello@beauteas.com or reach out through our social media channels. We typically respond within 24 hours.</p>
    </div>
  </div>
</div>
', 'Find answers to common questions about BeauTeas organic skincare teas, including brewing, ingredients, results, and more.', 'FAQ - Frequently Asked Questions | BeauTeas', 'Get answers to frequently asked questions about BeauTeas organic skincare teas. Learn about ingredients, brewing, results timeline, subscriptions, and more.', 'faq, questions, answers, help, support, organic tea, skincare', 'published', strftime(''%s'', ''now''), 'default', 4, 1, 'FAQ', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Shipping & Returns Page
('Shipping & Returns', 'shipping-returns', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Shipping & Returns</h1>

  <h2 class="text-2xl font-serif mt-8 mb-4">Shipping Information</h2>

  <h3 class="text-xl font-serif mt-6 mb-3">Domestic Shipping (United States)</h3>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li><strong>Standard Shipping:</strong> 5-7 business days — $4.99 (Free on orders over $35)</li>
    <li><strong>Expedited Shipping:</strong> 2-3 business days — $9.99</li>
    <li><strong>Overnight Shipping:</strong> 1 business day — $19.99</li>
  </ul>
  <p class="mb-6">Orders placed before 2 PM EST Monday-Friday ship the same day. Weekend orders ship the next business day.</p>

  <h3 class="text-xl font-serif mt-6 mb-3">International Shipping</h3>
  <p class="mb-6">We currently ship to Canada, UK, and Australia. International shipping rates are calculated at checkout based on destination and order weight. Please note that international orders may be subject to customs duties and taxes, which are the responsibility of the recipient.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">Order Tracking</h2>
  <p class="mb-6">Once your order ships, you''ll receive an email with tracking information. You can also track your order by logging into your account or contacting our customer service team.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">Returns & Exchanges</h2>

  <h3 class="text-xl font-serif mt-6 mb-3">Our Satisfaction Guarantee</h3>
  <p class="mb-6">We want you to love your BeauTeas! If you''re not completely satisfied with your purchase, we offer a 30-day money-back guarantee.</p>

  <h3 class="text-xl font-serif mt-6 mb-3">How to Return</h3>
  <ol class="list-decimal pl-6 mb-6 space-y-2">
    <li>Email us at hello@beauteas.com with your order number and reason for return</li>
    <li>We''ll provide a prepaid return label (for US orders)</li>
    <li>Ship the product back in its original packaging</li>
    <li>Receive your refund within 5-7 business days of receipt</li>
  </ol>

  <h3 class="text-xl font-serif mt-6 mb-3">Damaged or Incorrect Orders</h3>
  <p class="mb-6">If your order arrives damaged or you received the wrong items, please contact us immediately at hello@beauteas.com. We''ll send a replacement right away at no cost to you.</p>

  <div class="bg-primary-100 rounded-lg p-6 mt-8">
    <h3 class="text-xl font-serif mb-3">Questions?</h3>
    <p>Our customer service team is here to help! Email us at hello@beauteas.com and we''ll get back to you within 24 hours.</p>
  </div>
</div>
', 'Learn about BeauTeas shipping options, delivery times, and our 30-day satisfaction guarantee return policy.', 'Shipping & Returns - BeauTeas', 'BeauTeas shipping information, delivery times, and return policy. Free shipping on orders over $35. 30-day satisfaction guarantee.', 'shipping, returns, delivery, refund, exchange, policy, guarantee', 'published', strftime(''%s'', ''now''), 'default', 5, 1, 'Shipping', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Contact Us Page
('Contact Us', 'contact', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Get in Touch</h1>

  <p class="text-lg mb-8">We love hearing from our customers! Whether you have a question about our teas, need help with an order, or just want to share your skincare tea journey, we''re here for you.</p>

  <div class="grid md:grid-cols-2 gap-8 mb-10">
    <div class="bg-surface-light rounded-lg p-6">
      <h2 class="text-xl font-serif mb-4">📧 Email Us</h2>
      <p class="mb-2"><a href="mailto:hello@beauteas.com" class="text-primary-600 hover:text-primary-700">hello@beauteas.com</a></p>
      <p class="text-text-secondary text-sm">We typically respond within 24 hours</p>
    </div>

    <div class="bg-surface-light rounded-lg p-6">
      <h2 class="text-xl font-serif mb-4">📱 Follow Us</h2>
      <p class="mb-2">Connect with us on social media for tea tips, skincare advice, and community inspiration.</p>
      <div class="flex gap-4 mt-4">
        <a href="https://instagram.com/beauteas" class="text-primary-600 hover:text-primary-700">Instagram</a>
        <a href="https://facebook.com/beauteas" class="text-primary-600 hover:text-primary-700">Facebook</a>
        <a href="https://pinterest.com/beauteas" class="text-primary-600 hover:text-primary-700">Pinterest</a>
      </div>
    </div>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-4">Common Questions</h2>
  <p class="mb-4">Before reaching out, you might find your answer in our <a href="/faq" class="text-primary-600 hover:text-primary-700 underline">FAQ page</a>. We''ve compiled answers to the most common questions about our teas, shipping, and more.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">Business Inquiries</h2>
  <p class="mb-4">Interested in wholesale partnerships, press features, or collaborations? Please email <a href="mailto:partnerships@beauteas.com" class="text-primary-600 hover:text-primary-700">partnerships@beauteas.com</a> with details about your inquiry.</p>

  <div class="bg-primary-100 rounded-lg p-6 mt-10">
    <h3 class="text-xl font-serif mb-3">Join Our Community</h3>
    <p>Sign up for our newsletter to receive exclusive offers, skincare tips, and be the first to know about new products. We promise not to spam—just good tea vibes!</p>
  </div>
</div>
', 'Contact BeauTeas for questions about our organic skincare teas, orders, or partnerships. We''d love to hear from you!', 'Contact Us - BeauTeas', 'Get in touch with BeauTeas. Email us at hello@beauteas.com for questions about organic skincare teas, orders, or partnerships.', 'contact, email, support, customer service, help', 'published', strftime(''%s'', ''now''), 'default', 6, 1, 'Contact', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now''));

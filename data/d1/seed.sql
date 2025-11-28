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

-- About Us Page (with Founder Story) - Elevated Luxury Tone
('About BeauTeas', 'about', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">Our Story</h1>
  <p class="text-xl text-center text-text-secondary mb-12 italic">Where ancient botanical wisdom meets modern skincare science</p>

  <div class="bg-gradient-to-br from-primary-50 to-surface-light rounded-lg p-10 mb-12">
    <h2 class="text-2xl font-serif mb-6">A Legacy of Radiance</h2>
    <p class="mb-4 leading-relaxed">BeauTeas was born from a revelation passed down through generations. Our founder, Sarah, had spent years searching for solutions to persistent adult acne—consulting dermatologists, trying countless serums and treatments, investing thousands in products that promised transformation but delivered only frustration.</p>
    <p class="mb-4 leading-relaxed">The answer came not from a laboratory, but from her grandmother''s garden. Well into her eighties, her grandmother possessed remarkably luminous skin—the kind that seemed to glow from within. Her secret was elegantly simple: a daily ritual of herbal tea infused with golden calendula petals she cultivated herself.</p>
    <p class="mb-4 leading-relaxed"><em>"True beauty cannot be applied,"</em> she would say, pressing a warm cup into Sarah''s hands. <em>"It must be cultivated from within."</em></p>
    <p class="leading-relaxed">This wisdom sparked a journey. Sarah partnered with master herbalists and tea sommeliers to translate this ancestral knowledge into the Clearly Calendula collection—three meticulously crafted organic blends designed to nurture skin health from morning through night.</p>
  </div>

  <div class="border-l-4 border-primary-300 pl-8 py-4 my-12">
    <p class="text-xl italic mb-4">"I founded BeauTeas because I believe radiant skin should be accessible to everyone—and that the path to beauty should be as pleasurable as the destination. Every cup is an invitation to slow down, to nourish yourself, to glow."</p>
    <p class="font-medium">— Sarah, Founder & CEO</p>
  </div>

  <h2 class="text-2xl font-serif mt-12 mb-6">The Calendula Heritage</h2>
  <p class="mb-6 leading-relaxed">At the heart of every BeauTeas blend lies <em>Calendula officinalis</em>—the golden flower revered for centuries by healers and beauty practitioners across cultures. Hand-harvested at peak bloom, our organic calendula petals deliver nature''s most elegant solution to skin concerns: antibacterial protection, anti-inflammatory calm, accelerated healing, and collagen-stimulating renewal.</p>
  <p class="mb-6 leading-relaxed">When united with our carefully curated selection of premium organic teas and botanicals, calendula transforms your daily cup into a powerful ritual of inside-out beauty.</p>

  <h2 class="text-2xl font-serif mt-12 mb-6">Our Philosophy</h2>
  <p class="mb-6 leading-relaxed">We believe that extraordinary skincare need not be complicated, harsh, or synthetic. True radiance emerges from the simplest rituals, practiced with intention. Each BeauTeas blend is an invitation to pause, to breathe, to invest a few precious minutes in your own wellbeing—knowing that as you savor the experience, powerful botanicals are working to reveal your most luminous self.</p>

  <h2 class="text-2xl font-serif mt-12 mb-6">Uncompromising Standards</h2>
  <div class="grid md:grid-cols-2 gap-6 mb-8">
    <div class="flex items-start gap-4">
      <span class="text-primary-600 text-xl">✦</span>
      <div>
        <h4 class="font-medium mb-1">100% USDA Certified Organic</h4>
        <p class="text-sm text-text-secondary">Every ingredient, without exception, meets the highest organic standards</p>
      </div>
    </div>
    <div class="flex items-start gap-4">
      <span class="text-primary-600 text-xl">✦</span>
      <div>
        <h4 class="font-medium mb-1">Ethically Sourced</h4>
        <p class="text-sm text-text-secondary">Hand-selected from family estates and sustainable farms worldwide</p>
      </div>
    </div>
    <div class="flex items-start gap-4">
      <span class="text-primary-600 text-xl">✦</span>
      <div>
        <h4 class="font-medium mb-1">Artisan Small-Batch Blending</h4>
        <p class="text-sm text-text-secondary">Crafted in limited quantities to ensure peak freshness and potency</p>
      </div>
    </div>
    <div class="flex items-start gap-4">
      <span class="text-primary-600 text-xl">✦</span>
      <div>
        <h4 class="font-medium mb-1">Sustainable Luxury</h4>
        <p class="text-sm text-text-secondary">Plant-based sachets and eco-conscious packaging throughout</p>
      </div>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mt-12 text-center">
    <h2 class="text-2xl font-serif mb-4">Begin Your Journey</h2>
    <p class="text-text-secondary mb-6 max-w-2xl mx-auto">Join the community of discerning individuals who have discovered that true beauty is cultivated from within. Your most radiant self awaits.</p>
    <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-10 py-4 rounded-lg hover:bg-primary-700 transition-colors font-medium text-lg">Experience the Collection</a>
  </div>
</div>
', 'BeauTeas was founded on ancestral wisdom and the belief that true beauty is cultivated from within. Discover our founder''s story and philosophy.', 'About BeauTeas - Our Heritage & Philosophy | Luxury Organic Skincare Teas', 'Discover the BeauTeas story: ancestral wisdom meets modern skincare science. Learn about our founder, our organic calendula heritage, and our commitment to radiant beauty from within.', 'about, beauteas, organic tea, skincare, calendula, luxury, heritage, founder, philosophy', 'published', strftime(''%s'', ''now''), 'about', 1, 1, 'About Us', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Brewing Directions Page - Elevated Luxury Tone
('The Art of Brewing', 'brewing-directions', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">The Art of Brewing</h1>
  <p class="text-xl text-center text-text-secondary mb-12 italic">Mastering the ritual for optimal flavor and botanical potency</p>

  <div class="bg-gradient-to-r from-primary-50 to-surface-light rounded-lg p-8 mb-12">
    <p class="text-lg text-center leading-relaxed">The perfect cup of BeauTeas is more than a beverage—it''s an experience. These brewing guidelines will help you unlock the full depth of flavor and maximize the skin-nourishing benefits of our carefully crafted blends. Consider these your starting point; with time, you''ll discover your own perfect ritual.</p>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mb-8">
    <h2 class="text-2xl font-serif mb-6">☀️ Morning Blend</h2>
    <p class="text-text-secondary italic mb-4">Premium Black Tea with Bergamot, Lavender & Calendula</p>
    <div class="grid md:grid-cols-3 gap-6">
      <div class="text-center">
        <p class="text-3xl mb-2">205-212°F</p>
        <p class="text-sm text-text-secondary">Water Temperature</p>
        <p class="text-xs mt-1">Just off the boil</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-2">3-5 min</p>
        <p class="text-sm text-text-secondary">Steeping Time</p>
        <p class="text-xs mt-1">Adjust to taste</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-2">8 oz</p>
        <p class="text-sm text-text-secondary">Per Sachet</p>
        <p class="text-xs mt-1">One perfect cup</p>
      </div>
    </div>
    <p class="mt-6 text-sm text-text-secondary"><strong>Ritual note:</strong> Allow boiling water to rest for 30 seconds before pouring—this coaxes out the bergamot''s aromatic oils and the lavender''s delicate floral notes without scorching the leaves.</p>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mb-8">
    <h2 class="text-2xl font-serif mb-6">🌿 Afternoon Blend</h2>
    <p class="text-text-secondary italic mb-4">Dragonwell & Sencha Green Tea with Lemon Verbena & Calendula</p>
    <div class="grid md:grid-cols-3 gap-6">
      <div class="text-center">
        <p class="text-3xl mb-2">175°F</p>
        <p class="text-sm text-text-secondary">Water Temperature</p>
        <p class="text-xs mt-1">Cooler is key</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-2">2-4 min</p>
        <p class="text-sm text-text-secondary">Steeping Time</p>
        <p class="text-xs mt-1">Watch carefully</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-2">8 oz</p>
        <p class="text-sm text-text-secondary">Per Sachet</p>
        <p class="text-xs mt-1">One perfect cup</p>
      </div>
    </div>
    <p class="mt-6 text-sm text-text-secondary"><strong>Ritual note:</strong> Green tea rewards patience. Allow your water to cool for 3 minutes after boiling, or use a temperature-controlled kettle. This gentler approach preserves the delicate vegetal sweetness and prevents any trace of bitterness.</p>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mb-8">
    <h2 class="text-2xl font-serif mb-6">🌙 Evening Blend</h2>
    <p class="text-text-secondary italic mb-4">Chamomile & Rooibos with Spearmint & Calendula (Caffeine-Free)</p>
    <div class="grid md:grid-cols-3 gap-6">
      <div class="text-center">
        <p class="text-3xl mb-2">212°F</p>
        <p class="text-sm text-text-secondary">Water Temperature</p>
        <p class="text-xs mt-1">Full rolling boil</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-2">5-7+ min</p>
        <p class="text-sm text-text-secondary">Steeping Time</p>
        <p class="text-xs mt-1">Linger as long as you like</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-2">8 oz</p>
        <p class="text-sm text-text-secondary">Per Sachet</p>
        <p class="text-xs mt-1">One perfect cup</p>
      </div>
    </div>
    <p class="mt-6 text-sm text-text-secondary"><strong>Ritual note:</strong> Unlike other teas, herbal infusions only deepen in character with time. Feel free to leave the sachet in as you sip—the chamomile grows more soothing, the rooibos more honeyed.</p>
  </div>

  <h2 class="text-2xl font-serif mt-12 mb-6 text-center">The Iced Tea Experience</h2>
  <p class="text-center text-text-secondary mb-8">Our blends are equally exquisite over ice. Two approaches, equally rewarding:</p>

  <div class="grid md:grid-cols-2 gap-8 mb-12">
    <div class="border border-border rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">Flash Brew Method</h3>
      <p class="text-sm text-text-secondary mb-4">For when you want refreshment now</p>
      <ol class="text-sm space-y-2">
        <li><span class="font-medium">1.</span> Brew at double strength using guidelines above</li>
        <li><span class="font-medium">2.</span> Allow to cool to room temperature</li>
        <li><span class="font-medium">3.</span> Pour over ice and savor</li>
      </ol>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">Cold Brew Method</h3>
      <p class="text-sm text-text-secondary mb-4">For the smoothest, most nuanced result</p>
      <ol class="text-sm space-y-2">
        <li><span class="font-medium">1.</span> Place one sachet in 8-16 oz cold filtered water</li>
        <li><span class="font-medium">2.</span> Refrigerate for 4-8 hours (overnight is ideal)</li>
        <li><span class="font-medium">3.</span> Remove sachet and serve over ice</li>
      </ol>
    </div>
  </div>

  <div class="bg-primary-100 rounded-lg p-8 mb-12">
    <h3 class="text-xl font-serif mb-4 text-center">The Key to Results: Consistency</h3>
    <p class="text-center">The botanical compounds in BeauTeas work cumulatively—each cup builds upon the last. For optimal skin benefits, we recommend incorporating 1-2 cups into your daily ritual. Within weeks, the difference reveals itself.</p>
  </div>

  <h2 class="text-2xl font-serif mb-6">Perfecting Your Brew</h2>
  <div class="space-y-6">
    <div class="flex gap-4 items-start border-b border-border pb-6">
      <span class="text-primary-600">Q:</span>
      <div>
        <p class="font-medium mb-2">Notes of bitterness in my cup?</p>
        <p class="text-text-secondary text-sm">Water too hot or steeping too long is typically the cause. Green tea is particularly sensitive—ensure water has cooled to 175°F and limit steeping to 3 minutes. Black tea is more forgiving but benefits from the same care.</p>
      </div>
    </div>
    <div class="flex gap-4 items-start border-b border-border pb-6">
      <span class="text-primary-600">Q:</span>
      <div>
        <p class="font-medium mb-2">The flavor seems light?</p>
        <p class="text-text-secondary text-sm">Fresh, filtered water at the proper temperature makes all the difference. Ensure adequate steeping time within the recommended range, or try two sachets for a more robust infusion.</p>
      </div>
    </div>
    <div class="flex gap-4 items-start pb-6">
      <span class="text-primary-600">Q:</span>
      <div>
        <p class="font-medium mb-2">May I re-steep my sachet?</p>
        <p class="text-text-secondary text-sm">While a second steeping is possible, we recommend a fresh sachet for each cup to ensure you receive the full spectrum of skin-nourishing botanicals.</p>
      </div>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mt-8 text-center">
    <h3 class="text-xl font-serif mb-3">Questions About Your Ritual?</h3>
    <p class="text-text-secondary">Our team delights in helping you perfect your brewing practice. <a href="/contact" class="text-primary-600 hover:text-primary-700 underline">Reach out anytime</a>.</p>
  </div>
</div>
', 'Master the art of brewing BeauTeas for optimal flavor and botanical potency. Detailed guidance for each blend, plus iced tea methods.', 'The Art of Brewing - BeauTeas Preparation Guide | BeauTeas', 'Master the art of brewing BeauTeas organic skincare teas. Optimal temperatures, steeping times, and techniques for black, green, and herbal blends.', 'brewing, art of tea, preparation, steep time, temperature, ritual, iced tea, cold brew', 'published', strftime(''%s'', ''now''), 'default', 2, 1, 'Brewing Guide', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- How Our Teas Work Page - Elevated Luxury Tone
('The Science of Radiance', 'how-it-works', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">The Science of Radiance</h1>
  <p class="text-xl text-center text-text-secondary mb-12 italic">How botanical alchemy transforms your skin from within</p>

  <div class="bg-gradient-to-r from-primary-50 to-surface-light rounded-lg p-10 mb-12">
    <p class="text-lg text-center leading-relaxed">True radiance cannot be applied—it must be cultivated. BeauTeas delivers a symphony of skin-loving botanicals directly into your bloodstream, where they can nourish every cell, calm inflammation at its source, and support your skin''s natural renewal processes. This is inside-out beauty, elevated to an art form.</p>
  </div>

  <h2 class="text-2xl font-serif mb-8 text-center">The Botanical Orchestra</h2>

  <div class="bg-surface-light rounded-lg p-8 mb-8">
    <h3 class="text-2xl font-serif mb-4">🌼 Calendula Officinalis</h3>
    <p class="text-text-secondary italic mb-4">The Golden Healer — Foundation of Every Blend</p>
    <p class="mb-4 leading-relaxed">Revered for centuries by healers and beauty practitioners across cultures, calendula is nature''s most elegant solution to troubled skin. Hand-harvested at peak bloom, our organic calendula petals deliver:</p>
    <div class="grid md:grid-cols-2 gap-4">
      <div class="flex items-start gap-3">
        <span class="text-primary-600">✦</span>
        <div>
          <p class="font-medium">Antibacterial Protection</p>
          <p class="text-sm text-text-secondary">Targets acne-causing bacteria at the source</p>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <span class="text-primary-600">✦</span>
        <div>
          <p class="font-medium">Anti-Inflammatory Calm</p>
          <p class="text-sm text-text-secondary">Soothes redness and irritation systemically</p>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <span class="text-primary-600">✦</span>
        <div>
          <p class="font-medium">Accelerated Healing</p>
          <p class="text-sm text-text-secondary">Promotes tissue repair and reduces scarring</p>
        </div>
      </div>
      <div class="flex items-start gap-3">
        <span class="text-primary-600">✦</span>
        <div>
          <p class="font-medium">Collagen Stimulation</p>
          <p class="text-sm text-text-secondary">Supports elasticity and youthful firmness</p>
        </div>
      </div>
    </div>
  </div>

  <div class="grid md:grid-cols-2 gap-8 mb-8">
    <div class="border border-border rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">🍃 Spearmint</h3>
      <p class="text-text-secondary italic text-sm mb-3">The Hormone Harmonizer</p>
      <p class="text-sm leading-relaxed">Clinical studies have shown spearmint''s remarkable ability to regulate androgen levels—the hormones often responsible for persistent breakouts. Present in every blend, it works quietly to rebalance while adding a refreshing clarity to each sip.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">🫖 Rooibos</h3>
      <p class="text-text-secondary italic text-sm mb-3">The Midnight Renewer</p>
      <p class="text-sm leading-relaxed">This South African treasure contains natural alpha hydroxy acids (AHA) for gentle cellular renewal, plus zinc and a wealth of antioxidants. Caffeine-free and mineral-rich, it''s the cornerstone of our Evening Blend''s restorative power.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">🌿 Chamomile</h3>
      <p class="text-text-secondary italic text-sm mb-3">The Serene Soother</p>
      <p class="text-sm leading-relaxed">Ancient Egyptians dedicated this flower to their sun god for its healing properties. Its powerful anti-inflammatory compounds calm both skin and spirit, while promoting the deep, restorative sleep essential for cellular repair.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">🍵 Premium Tea Bases</h3>
      <p class="text-text-secondary italic text-sm mb-3">The Elegant Foundation</p>
      <p class="text-sm leading-relaxed">Our black and green tea bases—hand-selected Assam, Dragonwell, and Sencha—provide their own antioxidant wealth, including EGCG for UV protection and theaflavins for sustained, jitter-free vitality.</p>
    </div>
  </div>

  <div class="bg-primary-100 rounded-lg p-8 my-12">
    <h3 class="text-2xl font-serif mb-6 text-center">The Journey to Radiance</h3>
    <p class="text-center mb-6">Every skin is unique, yet most of our clients experience a similar unfolding:</p>
    <div class="grid md:grid-cols-3 gap-6">
      <div class="text-center">
        <p class="text-3xl font-serif text-primary-600 mb-2">Week 1-2</p>
        <p class="text-sm">Enhanced hydration and a subtle new vitality. The ritual takes hold.</p>
      </div>
      <div class="text-center">
        <p class="text-3xl font-serif text-primary-600 mb-2">Week 3-4</p>
        <p class="text-sm">Visible calming of redness. Fewer new concerns. A quieting of inflammation.</p>
      </div>
      <div class="text-center">
        <p class="text-3xl font-serif text-primary-600 mb-2">Month 2+</p>
        <p class="text-sm">The transformation reveals itself. Clearer, more luminous skin with refined texture.</p>
      </div>
    </div>
  </div>

  <h2 class="text-2xl font-serif mb-6 text-center">Experience the Collection</h2>
  <div class="grid md:grid-cols-3 gap-6">
    <div class="bg-surface-light rounded-lg p-6 text-center">
      <h3 class="text-xl font-serif mb-2">☀️ Morning</h3>
      <p class="text-sm text-text-secondary mb-4">Bergamot-kissed black tea for elegant awakening</p>
      <a href="/product/clearly-calendula-morning" class="inline-block bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 transition-colors">Discover</a>
    </div>
    <div class="bg-surface-light rounded-lg p-6 text-center">
      <h3 class="text-xl font-serif mb-2">🌿 Afternoon</h3>
      <p class="text-sm text-text-secondary mb-4">Refined green tea for midday renewal</p>
      <a href="/product/clearly-calendula-afternoon" class="inline-block bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 transition-colors">Discover</a>
    </div>
    <div class="bg-surface-light rounded-lg p-6 text-center">
      <h3 class="text-xl font-serif mb-2">🌙 Evening</h3>
      <p class="text-sm text-text-secondary mb-4">Caffeine-free botanicals for overnight restoration</p>
      <a href="/product/clearly-calendula-evening" class="inline-block bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 transition-colors">Discover</a>
    </div>
  </div>

  <div class="text-center mt-10">
    <p class="text-text-secondary mb-4">Experience all three blends in one elegant collection</p>
    <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-10 py-4 rounded-lg hover:bg-primary-700 transition-colors font-medium text-lg">The Complete Ritual Collection</a>
  </div>
</div>
', 'Discover the botanical science behind BeauTeas. Learn how calendula, spearmint, rooibos, and premium teas work in harmony to reveal radiant skin.', 'The Science of Radiance - How BeauTeas Work | BeauTeas', 'Explore the science behind BeauTeas organic skincare teas. Discover how calendula, spearmint, rooibos, and premium botanicals transform skin from within.', 'how it works, botanical science, calendula, spearmint, rooibos, skincare, radiance, transformation', 'published', strftime(''%s'', ''now''), 'default', 3, 1, 'How It Works', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- FAQ Page (Expanded)
('Frequently Asked Questions', 'faq', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Frequently Asked Questions</h1>

  <h2 class="text-2xl font-serif mt-8 mb-6">Getting Started</h2>
  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">How long until I see results?</h3>
      <p>Most customers notice improved hydration and energy within the first week. Visible skin improvements typically appear after 3-4 weeks of daily use. For best results, we recommend drinking 1-2 cups per day consistently.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Which blend should I start with?</h3>
      <p>We recommend starting with our <a href="/product/clearly-calendula-sample-pack" class="text-primary-600 hover:text-primary-700 underline">Sample Pack</a>, which includes all three blends. This lets you experience the full day of skincare benefits and discover which flavors you love most.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">How many cups should I drink per day?</h3>
      <p>We recommend 1-2 cups daily for optimal skin benefits. You can drink one blend or mix and match throughout the day—Morning with breakfast, Afternoon for a midday boost, and Evening before bed. Consistency matters more than quantity.</p>
    </div>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Skin Types & Concerns</h2>
  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Will BeauTeas work for my skin type?</h3>
      <p>Our teas are formulated to benefit all skin types. The calendula and other botanical ingredients work from within, targeting inflammation, bacteria, and collagen production—processes that affect everyone''s skin. Whether you have oily, dry, combination, or sensitive skin, you can benefit from our blends.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Can BeauTeas help with hormonal acne?</h3>
      <p>Yes! Spearmint, featured in all our blends, has been shown in studies to help regulate androgen levels that contribute to hormonal breakouts. Many customers with hormonal acne find our teas helpful as part of their routine. For persistent hormonal acne, we also recommend consulting a dermatologist.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">I have sensitive skin. Are your teas safe for me?</h3>
      <p>Our teas are gentle and work from the inside out, so they''re suitable for sensitive skin. Unlike topical products that can irritate, the beneficial compounds are delivered through your bloodstream. However, if you have known allergies to any of our ingredients, please consult your healthcare provider first.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Can men drink BeauTeas too?</h3>
      <p>Absolutely! Healthy skin isn''t gendered, and our teas work for everyone. The anti-inflammatory, antibacterial, and antioxidant benefits of calendula and our other ingredients support skin health regardless of gender. Many of our customers are men who appreciate clear, healthy skin.</p>
    </div>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Ingredients & Safety</h2>
  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Are BeauTeas really organic?</h3>
      <p>Yes! All BeauTeas products are 100% USDA Certified Organic. Every ingredient—from our tea leaves to our calendula petals—is certified organic and sourced from trusted suppliers who share our commitment to quality.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Do your teas contain common allergens?</h3>
      <p>Our teas are naturally free from gluten, dairy, nuts, and soy. They contain no artificial flavors, colors, or preservatives. If you have specific plant allergies, please check our <a href="/ingredients" class="text-primary-600 hover:text-primary-700 underline">ingredients page</a> for a complete list of botanicals in each blend.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Can I drink BeauTeas if I''m pregnant or nursing?</h3>
      <p>While our teas are made with gentle, organic ingredients, we recommend consulting with your healthcare provider before consuming any herbal products during pregnancy or while nursing. Some herbs may not be suitable during pregnancy.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Do your teas contain caffeine?</h3>
      <p>Our Morning (black tea) and Afternoon (green tea) blends contain caffeine. Our Evening blend is completely caffeine-free, making it perfect for your nighttime routine. If you''re caffeine-sensitive, you can enjoy the Evening blend anytime.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Can I drink BeauTeas with medications?</h3>
      <p>If you take prescription medications, especially blood thinners or hormone-related medications, please consult your healthcare provider before adding any herbal tea to your routine. While our teas are gentle, some herbs can interact with medications.</p>
    </div>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Product & Packaging</h2>
  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Are the tea bags compostable?</h3>
      <p>Yes! Our tea bags are made from sugarcane fiber, not plastic. They''re fully compostable and break down naturally, reducing environmental impact. The boxes are also recyclable.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">How should I store my tea?</h3>
      <p>Store your BeauTeas in a cool, dry place away from direct sunlight. The box is designed to protect freshness, but you can also transfer bags to an airtight container if preferred. Use within 12 months of purchase for best flavor and potency.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Do you offer loose leaf tea?</h3>
      <p>Currently, we only offer our teas in convenient tea bags. This ensures consistent dosing of the beneficial herbs for optimal skincare results, and makes brewing quick and easy. We''re exploring loose leaf options for the future.</p>
    </div>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Orders & Subscriptions</h2>
  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Do you offer subscriptions?</h3>
      <p>Yes! Subscribe and save 10% on every order. Choose monthly or bi-monthly delivery, and you can pause, skip, or cancel anytime. Subscribers never run out of their favorite teas. <a href="/subscriptions" class="text-primary-600 hover:text-primary-700 underline">Learn more about subscriptions</a>.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">What is your return policy?</h3>
      <p>We want you to love your BeauTeas! If you''re not satisfied with your purchase, contact us within 30 days for a full refund or exchange. We stand behind our products 100%. <a href="/shipping-returns" class="text-primary-600 hover:text-primary-700 underline">View full policy</a>.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Do you ship internationally?</h3>
      <p>Yes! We ship to Canada, UK, and Australia. International shipping rates are calculated at checkout. Please note that international orders may be subject to customs duties and taxes.</p>
    </div>

    <div class="pb-6">
      <h3 class="text-xl font-serif mb-3">How can I contact you?</h3>
      <p>We''d love to hear from you! Email us at hello@beauteas.com or reach out through our social media channels. We typically respond within 24 hours. <a href="/contact" class="text-primary-600 hover:text-primary-700 underline">Visit our contact page</a>.</p>
    </div>
  </div>
</div>
', 'Find answers to common questions about BeauTeas organic skincare teas, including brewing, ingredients, skin types, allergies, and more.', 'FAQ - Frequently Asked Questions | BeauTeas', 'Get answers to frequently asked questions about BeauTeas organic skincare teas. Learn about ingredients, skin types, allergies, subscriptions, and more.', 'faq, questions, answers, help, support, organic tea, skincare, allergies, skin type', 'published', strftime(''%s'', ''now''), 'default', 4, 1, 'FAQ', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Shipping & Returns Page - Elevated Luxury Tone
('Shipping & Delivery', 'shipping-returns', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">Shipping & Delivery</h1>
  <p class="text-xl text-center text-text-secondary mb-12 italic">Thoughtfully packaged and delivered to your door</p>

  <div class="bg-gradient-to-r from-primary-50 to-surface-light rounded-lg p-8 mb-12 text-center">
    <p class="text-lg">Every BeauTeas order is carefully packaged to preserve freshness and arrives ready to become part of your daily ritual. We take as much care in delivery as we do in blending.</p>
  </div>

  <h2 class="text-2xl font-serif mb-6">Delivery Options</h2>

  <div class="bg-surface-light rounded-lg p-6 mb-8">
    <h3 class="text-xl font-serif mb-4">United States</h3>
    <div class="space-y-4">
      <div class="flex justify-between items-center border-b border-border pb-4">
        <div>
          <p class="font-medium">Complimentary Standard Shipping</p>
          <p class="text-sm text-text-secondary">5-7 business days</p>
        </div>
        <p class="font-serif">Free on orders $35+</p>
      </div>
      <div class="flex justify-between items-center border-b border-border pb-4">
        <div>
          <p class="font-medium">Standard Shipping</p>
          <p class="text-sm text-text-secondary">5-7 business days</p>
        </div>
        <p class="font-serif">$4.99</p>
      </div>
      <div class="flex justify-between items-center border-b border-border pb-4">
        <div>
          <p class="font-medium">Expedited Delivery</p>
          <p class="text-sm text-text-secondary">2-3 business days</p>
        </div>
        <p class="font-serif">$9.99</p>
      </div>
      <div class="flex justify-between items-center">
        <div>
          <p class="font-medium">Priority Overnight</p>
          <p class="text-sm text-text-secondary">Next business day</p>
        </div>
        <p class="font-serif">$19.99</p>
      </div>
    </div>
    <p class="text-sm text-text-secondary mt-4">Orders placed before 2 PM EST Monday-Friday ship same day.</p>
  </div>

  <div class="border border-border rounded-lg p-6 mb-8">
    <h3 class="text-xl font-serif mb-3">International Delivery</h3>
    <p class="text-text-secondary mb-4">We''re delighted to ship to Canada, the United Kingdom, and Australia. International rates are calculated at checkout based on destination. Please note that orders may be subject to local customs duties.</p>
  </div>

  <h2 class="text-2xl font-serif mt-12 mb-6">Our Satisfaction Promise</h2>

  <div class="bg-primary-100 rounded-lg p-8 mb-8">
    <p class="text-lg text-center mb-4">We stand behind every sachet we create.</p>
    <p class="text-center">If BeauTeas doesn''t meet your expectations for any reason, we offer a complete 30-day satisfaction guarantee. Your happiness is our priority.</p>
  </div>

  <div class="grid md:grid-cols-2 gap-6 mb-8">
    <div class="border border-border rounded-lg p-6">
      <h4 class="font-serif text-lg mb-3">Easy Returns</h4>
      <p class="text-sm text-text-secondary">Simply contact us within 30 days. We''ll provide a prepaid return label for US orders and process your refund within 5-7 business days of receipt.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h4 class="font-serif text-lg mb-3">Damaged Orders</h4>
      <p class="text-sm text-text-secondary">If your order arrives less than perfect, contact us immediately. We''ll dispatch a replacement at once, at no additional cost.</p>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-8 text-center">
    <h3 class="text-xl font-serif mb-3">Questions About Your Order?</h3>
    <p class="text-text-secondary mb-4">Our client care team responds within 24 hours.</p>
    <a href="mailto:hello@beauteas.com" class="text-primary-600 hover:text-primary-700 font-medium">hello@beauteas.com</a>
  </div>
</div>
', 'BeauTeas shipping options, delivery times, and our 30-day satisfaction guarantee. Thoughtfully packaged and delivered.', 'Shipping & Delivery | BeauTeas', 'BeauTeas shipping and delivery information. Free shipping on orders over $35, expedited options available. 30-day satisfaction guarantee.', 'shipping, delivery, returns, satisfaction guarantee, free shipping', 'published', strftime(''%s'', ''now''), 'default', 5, 1, 'Shipping', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Contact Us Page - Elevated Luxury Tone
('Contact Us', 'contact', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">We''d Love to Hear From You</h1>
  <p class="text-xl text-center text-text-secondary mb-12 italic">Questions, reflections, or simply a desire to connect—we''re here</p>

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
', 'Contact BeauTeas for questions about our organic skincare teas, orders, or partnerships. We''d love to hear from you!', 'Contact Us - BeauTeas', 'Get in touch with BeauTeas. Email us at hello@beauteas.com for questions about organic skincare teas, orders, or partnerships.', 'contact, email, support, customer service, help', 'published', strftime(''%s'', ''now''), 'default', 6, 1, 'Contact', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Privacy Policy Page
('Privacy Policy', 'privacy-policy', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4">Privacy Policy</h1>
  <p class="text-text-secondary mb-8">Last updated: November 2024</p>

  <p class="text-lg mb-6">At BeauTeas, we take your privacy seriously. This policy describes how we collect, use, and protect your personal information when you visit our website or make a purchase.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">1. Information We Collect</h2>

  <h3 class="text-xl font-serif mt-6 mb-3">Information You Provide</h3>
  <p class="mb-4">When you make a purchase, create an account, or contact us, we may collect:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Name and contact information (email address, phone number, shipping address)</li>
    <li>Payment information (processed securely through our payment provider)</li>
    <li>Order history and preferences</li>
    <li>Communications with our customer service team</li>
    <li>Newsletter subscription preferences</li>
  </ul>

  <h3 class="text-xl font-serif mt-6 mb-3">Information Collected Automatically</h3>
  <p class="mb-4">When you browse our website, we automatically collect:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Device information (browser type, operating system)</li>
    <li>IP address and approximate location</li>
    <li>Pages visited and time spent on site</li>
    <li>Referral sources</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">2. How We Use Your Information</h2>
  <p class="mb-4">We use your information to:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Process and fulfill your orders</li>
    <li>Send order confirmations and shipping updates</li>
    <li>Respond to customer service inquiries</li>
    <li>Send marketing communications (with your consent)</li>
    <li>Improve our website and products</li>
    <li>Prevent fraud and ensure security</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">3. Information Sharing</h2>
  <p class="mb-4">We do not sell your personal information. We may share your information with:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li><strong>Service providers</strong> – Companies that help us operate (payment processors, shipping carriers, email services)</li>
    <li><strong>Legal requirements</strong> – When required by law or to protect our rights</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">4. Cookies and Tracking</h2>
  <p class="mb-4">We use cookies and similar technologies to:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Remember your preferences and cart contents</li>
    <li>Analyze website traffic and usage patterns</li>
    <li>Provide personalized content and offers</li>
  </ul>
  <p class="mb-4">You can control cookies through your browser settings. Note that disabling cookies may affect site functionality.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">5. Data Security</h2>
  <p class="mb-4">We implement industry-standard security measures to protect your information, including:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>SSL encryption for all data transmission</li>
    <li>Secure payment processing (we never store full credit card numbers)</li>
    <li>Regular security audits and updates</li>
    <li>Limited employee access to personal data</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">6. Your Rights</h2>
  <p class="mb-4">You have the right to:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Access the personal information we hold about you</li>
    <li>Request correction of inaccurate information</li>
    <li>Request deletion of your information</li>
    <li>Opt out of marketing communications</li>
    <li>Request a copy of your data</li>
  </ul>
  <p class="mb-4">To exercise these rights, contact us at privacy@beauteas.com.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">7. Children''s Privacy</h2>
  <p class="mb-4">Our website is not intended for children under 13. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">8. Changes to This Policy</h2>
  <p class="mb-4">We may update this privacy policy from time to time. We will notify you of significant changes by posting a notice on our website or sending an email.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">9. Contact Us</h2>
  <p class="mb-4">If you have questions about this privacy policy or your personal information, contact us at:</p>
  <p class="mb-2">Email: <a href="mailto:privacy@beauteas.com" class="text-primary-600 hover:text-primary-700">privacy@beauteas.com</a></p>
</div>
', 'BeauTeas Privacy Policy - Learn how we collect, use, and protect your personal information.', 'Privacy Policy | BeauTeas', 'BeauTeas privacy policy. Learn how we collect, use, and protect your personal information when you shop with us.', 'privacy, policy, data, security, personal information, GDPR, CCPA', 'published', strftime(''%s'', ''now''), 'legal', 7, 1, 'Privacy', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Terms of Service Page
('Terms of Service', 'terms-of-service', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4">Terms of Service</h1>
  <p class="text-text-secondary mb-8">Last updated: November 2024</p>

  <p class="text-lg mb-6">Welcome to BeauTeas! By accessing our website and making purchases, you agree to these terms of service. Please read them carefully.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">1. Acceptance of Terms</h2>
  <p class="mb-4">By using the BeauTeas website (beauteas.com), you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, please do not use our website.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">2. Products and Orders</h2>

  <h3 class="text-xl font-serif mt-6 mb-3">Product Information</h3>
  <p class="mb-4">We strive to display our products accurately, including descriptions, images, and pricing. However, we cannot guarantee that all information is error-free. We reserve the right to correct any errors and update information without notice.</p>

  <h3 class="text-xl font-serif mt-6 mb-3">Orders</h3>
  <p class="mb-4">Placing an order constitutes an offer to purchase. We reserve the right to accept or decline any order. We may cancel orders due to:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Product availability issues</li>
    <li>Pricing errors</li>
    <li>Suspected fraud</li>
    <li>Verification failures</li>
  </ul>

  <h3 class="text-xl font-serif mt-6 mb-3">Pricing</h3>
  <p class="mb-4">All prices are displayed in USD unless otherwise noted. Prices are subject to change without notice. Promotional prices are valid only during the stated promotion period.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">3. Shipping and Delivery</h2>
  <p class="mb-4">We ship to addresses within the United States and select international destinations. Shipping times are estimates and not guarantees. We are not responsible for delays caused by carriers, weather, customs, or other circumstances beyond our control.</p>
  <p class="mb-4">For full shipping details, please see our <a href="/shipping-returns" class="text-primary-600 hover:text-primary-700 underline">Shipping & Returns</a> page.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">4. Returns and Refunds</h2>
  <p class="mb-4">We offer a 30-day satisfaction guarantee on all purchases. If you''re not satisfied with your order, contact us for a refund or exchange. Refunds will be issued to the original payment method within 5-7 business days of receiving the returned product.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">5. Health Disclaimers</h2>
  <p class="mb-4"><strong>Important:</strong> BeauTeas products are food/beverage products and are not intended to diagnose, treat, cure, or prevent any disease. Our teas are designed to support overall wellness as part of a healthy lifestyle.</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Results may vary between individuals</li>
    <li>Consult your healthcare provider before use if you are pregnant, nursing, taking medications, or have a medical condition</li>
    <li>If you experience any adverse reactions, discontinue use and consult a healthcare provider</li>
    <li>Do not exceed recommended consumption</li>
  </ul>

  <h2 class="text-2xl font-serif mt-10 mb-4">6. Intellectual Property</h2>
  <p class="mb-4">All content on the BeauTeas website—including text, images, logos, graphics, and product formulations—is our property or licensed to us. You may not copy, reproduce, distribute, or create derivative works without our written permission.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">7. User Accounts</h2>
  <p class="mb-4">If you create an account, you are responsible for:</p>
  <ul class="list-disc pl-6 mb-6 space-y-2">
    <li>Maintaining the confidentiality of your login credentials</li>
    <li>All activity that occurs under your account</li>
    <li>Notifying us immediately of any unauthorized use</li>
  </ul>
  <p class="mb-4">We reserve the right to suspend or terminate accounts that violate these terms.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">8. Limitation of Liability</h2>
  <p class="mb-4">To the maximum extent permitted by law, BeauTeas shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of our website or products. Our total liability shall not exceed the amount you paid for the product in question.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">9. Governing Law</h2>
  <p class="mb-4">These terms are governed by the laws of the State of California, United States. Any disputes shall be resolved in the courts of California.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">10. Changes to Terms</h2>
  <p class="mb-4">We may update these terms at any time. Continued use of our website after changes constitutes acceptance of the new terms.</p>

  <h2 class="text-2xl font-serif mt-10 mb-4">11. Contact Us</h2>
  <p class="mb-4">Questions about these terms? Contact us at:</p>
  <p class="mb-2">Email: <a href="mailto:legal@beauteas.com" class="text-primary-600 hover:text-primary-700">legal@beauteas.com</a></p>
</div>
', 'BeauTeas Terms of Service - Review the terms and conditions for using our website and purchasing products.', 'Terms of Service | BeauTeas', 'BeauTeas terms of service and conditions. Read about ordering, shipping, returns, health disclaimers, and more.', 'terms, service, conditions, legal, agreement, policy', 'published', strftime(''%s'', ''now''), 'legal', 8, 1, 'Terms', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Subscription Details Page
('Tea Subscriptions', 'subscriptions', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Subscribe & Save</h1>

  <p class="text-lg mb-8">Never run out of your favorite skincare teas! Subscribe and save 10% on every order, plus enjoy free shipping on all subscription deliveries.</p>

  <div class="bg-primary-100 rounded-lg p-8 mb-10">
    <h2 class="text-2xl font-serif mb-4">Subscription Benefits</h2>
    <ul class="space-y-3">
      <li class="flex items-start">
        <span class="text-primary-600 mr-3">✓</span>
        <span><strong>Save 10%</strong> on every order, automatically applied</span>
      </li>
      <li class="flex items-start">
        <span class="text-primary-600 mr-3">✓</span>
        <span><strong>Free shipping</strong> on all subscription deliveries</span>
      </li>
      <li class="flex items-start">
        <span class="text-primary-600 mr-3">✓</span>
        <span><strong>Flexible scheduling</strong> — choose monthly or bi-monthly delivery</span>
      </li>
      <li class="flex items-start">
        <span class="text-primary-600 mr-3">✓</span>
        <span><strong>Easy management</strong> — skip, pause, or cancel anytime</span>
      </li>
      <li class="flex items-start">
        <span class="text-primary-600 mr-3">✓</span>
        <span><strong>Early access</strong> to new products and exclusive offers</span>
      </li>
    </ul>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">How It Works</h2>

  <div class="grid md:grid-cols-3 gap-6 mb-10">
    <div class="text-center">
      <div class="w-16 h-16 bg-primary-200 rounded-full flex items-center justify-center mx-auto mb-4">
        <span class="text-2xl">1</span>
      </div>
      <h3 class="font-serif text-xl mb-2">Choose Your Teas</h3>
      <p class="text-text-secondary">Select your favorite blends or try the Sample Pack to experience all three</p>
    </div>
    <div class="text-center">
      <div class="w-16 h-16 bg-primary-200 rounded-full flex items-center justify-center mx-auto mb-4">
        <span class="text-2xl">2</span>
      </div>
      <h3 class="font-serif text-xl mb-2">Set Your Schedule</h3>
      <p class="text-text-secondary">Pick monthly or bi-monthly delivery — we''ll remind you before each shipment</p>
    </div>
    <div class="text-center">
      <div class="w-16 h-16 bg-primary-200 rounded-full flex items-center justify-center mx-auto mb-4">
        <span class="text-2xl">3</span>
      </div>
      <h3 class="font-serif text-xl mb-2">Enjoy & Save</h3>
      <p class="text-text-secondary">Your tea arrives automatically with 10% off and free shipping every time</p>
    </div>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Subscription FAQ</h2>

  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">Can I change my products?</h3>
      <p>Yes! Log into your account to swap products, adjust quantities, or try different blends anytime before your next shipment.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">What if I need to skip a month?</h3>
      <p>No problem! Skip any delivery through your account or by contacting us. You can skip as many months as you like without canceling.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">How do I cancel my subscription?</h3>
      <p>You can cancel anytime—no commitments or fees. Log into your account or email us at hello@beauteas.com. Cancellations take effect before your next billing date.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-3">When will I be charged?</h3>
      <p>You''ll be charged when you first subscribe, then on the same date each month (or every other month). We''ll send a reminder email 3 days before each charge.</p>
    </div>

    <div class="pb-6">
      <h3 class="text-xl font-serif mb-3">Can I give a subscription as a gift?</h3>
      <p>Yes! Gift subscriptions are available for 3, 6, or 12-month terms. The recipient can choose their preferred blends and delivery schedule. <a href="/contact" class="text-primary-600 hover:text-primary-700 underline">Contact us</a> to set up a gift subscription.</p>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mt-10 text-center">
    <h3 class="text-2xl font-serif mb-4">Ready to Subscribe?</h3>
    <p class="mb-6">Start with our best-selling Sample Pack and experience all three blends.</p>
    <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium">Subscribe to Sample Pack</a>
  </div>
</div>
', 'Subscribe to BeauTeas and save 10% on organic skincare teas. Free shipping, flexible scheduling, cancel anytime.', 'Tea Subscriptions - Save 10% | BeauTeas', 'Subscribe to BeauTeas organic skincare teas and save 10% on every order. Free shipping, flexible delivery, easy to manage. Cancel anytime.', 'subscription, subscribe, save, discount, delivery, monthly, organic tea', 'published', strftime(''%s'', ''now''), 'default', 9, 0, 'Subscriptions', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Skin Concern Guide Page (SEO-focused)
('Skin Concern Guide', 'skin-concerns', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Tea for Your Skin Concerns</h1>

  <p class="text-lg mb-8">Different skin concerns call for different approaches. Learn how BeauTeas can help address your specific needs with our targeted skincare tea guide.</p>

  <div class="bg-surface-light rounded-lg p-8 mb-10">
    <h2 class="text-2xl font-serif mb-4" id="acne">Acne & Breakouts</h2>
    <p class="mb-4">Acne affects millions of people and can be caused by bacteria, inflammation, excess oil, or hormonal imbalances. Our teas address all these factors from within.</p>

    <h3 class="text-xl font-serif mt-6 mb-3">How BeauTeas Helps:</h3>
    <ul class="list-disc pl-6 mb-6 space-y-2">
      <li><strong>Calendula</strong> fights acne-causing bacteria (P. acnes) and reduces inflammation</li>
      <li><strong>Spearmint</strong> helps regulate androgens that trigger hormonal breakouts</li>
      <li><strong>Peppermint</strong> reduces excess oil production</li>
      <li><strong>Rooibos</strong> provides natural AHA for gentle exfoliation</li>
    </ul>

    <h3 class="text-xl font-serif mt-6 mb-3">Recommended Routine:</h3>
    <p class="mb-4">For acne-prone skin, we recommend drinking 2 cups daily:</p>
    <ul class="list-disc pl-6 mb-4 space-y-2">
      <li><a href="/product/clearly-calendula-morning" class="text-primary-600 hover:text-primary-700 underline">Morning Blend</a> or <a href="/product/clearly-calendula-afternoon" class="text-primary-600 hover:text-primary-700 underline">Afternoon Blend</a> with breakfast</li>
      <li><a href="/product/clearly-calendula-evening" class="text-primary-600 hover:text-primary-700 underline">Evening Blend</a> before bed for overnight repair</li>
    </ul>
    <p class="text-sm text-text-secondary">Most customers see reduced breakouts within 3-4 weeks of consistent use.</p>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mb-10">
    <h2 class="text-2xl font-serif mb-4" id="aging">Anti-Aging & Wrinkles</h2>
    <p class="mb-4">Aging skin loses collagen and elasticity over time. Free radicals from sun exposure and environmental factors accelerate this process.</p>

    <h3 class="text-xl font-serif mt-6 mb-3">How BeauTeas Helps:</h3>
    <ul class="list-disc pl-6 mb-6 space-y-2">
      <li><strong>Calendula</strong> stimulates collagen production for firmer skin</li>
      <li><strong>Green tea EGCG</strong> (in Afternoon Blend) protects against UV damage</li>
      <li><strong>Antioxidants</strong> in all blends fight free radicals that cause premature aging</li>
      <li><strong>Rooibos</strong> contains zinc and alpha hydroxy acids for skin renewal</li>
    </ul>

    <h3 class="text-xl font-serif mt-6 mb-3">Recommended Routine:</h3>
    <p class="mb-4">For anti-aging benefits, focus on antioxidant-rich blends:</p>
    <ul class="list-disc pl-6 mb-4 space-y-2">
      <li><a href="/product/clearly-calendula-afternoon" class="text-primary-600 hover:text-primary-700 underline">Afternoon Blend</a> (green tea) for EGCG protection</li>
      <li><a href="/product/clearly-calendula-evening" class="text-primary-600 hover:text-primary-700 underline">Evening Blend</a> for overnight collagen support</li>
    </ul>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mb-10">
    <h2 class="text-2xl font-serif mb-4" id="redness">Redness & Inflammation</h2>
    <p class="mb-4">Skin redness can result from rosacea, sensitivity, sun damage, or general inflammation. Calming ingredients work from within to soothe irritated skin.</p>

    <h3 class="text-xl font-serif mt-6 mb-3">How BeauTeas Helps:</h3>
    <ul class="list-disc pl-6 mb-6 space-y-2">
      <li><strong>Chamomile</strong> (in Evening Blend) is a powerful anti-inflammatory</li>
      <li><strong>Calendula</strong> soothes irritation and promotes healing</li>
      <li><strong>Lavender</strong> (in Morning Blend) calms stressed skin</li>
      <li><strong>All blends</strong> hydrate from within to reduce dryness-related redness</li>
    </ul>

    <h3 class="text-xl font-serif mt-6 mb-3">Recommended Routine:</h3>
    <p class="mb-4">For calming redness, the Evening Blend is particularly beneficial:</p>
    <ul class="list-disc pl-6 mb-4 space-y-2">
      <li><a href="/product/clearly-calendula-evening" class="text-primary-600 hover:text-primary-700 underline">Evening Blend</a> 1-2 cups daily for maximum anti-inflammatory benefits</li>
      <li>Caffeine-free, so you can enjoy it anytime</li>
    </ul>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mb-10">
    <h2 class="text-2xl font-serif mb-4" id="dryness">Dryness & Dehydration</h2>
    <p class="mb-4">Dry skin lacks both oil and water. While topical moisturizers help externally, true hydration comes from within.</p>

    <h3 class="text-xl font-serif mt-6 mb-3">How BeauTeas Helps:</h3>
    <ul class="list-disc pl-6 mb-6 space-y-2">
      <li><strong>Hydration</strong> — drinking tea adds essential fluids to your system</li>
      <li><strong>Calendula</strong> promotes skin healing and moisture retention</li>
      <li><strong>No caffeine dehydration</strong> — Evening Blend is caffeine-free</li>
      <li><strong>Antioxidants</strong> protect the skin barrier from environmental damage</li>
    </ul>

    <h3 class="text-xl font-serif mt-6 mb-3">Recommended Routine:</h3>
    <p class="mb-4">Stay hydrated throughout the day:</p>
    <ul class="list-disc pl-6 mb-4 space-y-2">
      <li>Any blend, 2-3 cups daily</li>
      <li>Try the <a href="/product/clearly-calendula-sample-pack" class="text-primary-600 hover:text-primary-700 underline">Sample Pack</a> to enjoy variety while staying hydrated</li>
    </ul>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mb-10">
    <h2 class="text-2xl font-serif mb-4" id="hormonal">Hormonal Skin Issues</h2>
    <p class="mb-4">Hormonal fluctuations—from menstrual cycles, PCOS, or life changes—can cause breakouts, oiliness, and skin changes.</p>

    <h3 class="text-xl font-serif mt-6 mb-3">How BeauTeas Helps:</h3>
    <ul class="list-disc pl-6 mb-6 space-y-2">
      <li><strong>Spearmint</strong> has been studied for its anti-androgen effects</li>
      <li><strong>Regular consumption</strong> helps regulate hormone-related breakouts over time</li>
      <li><strong>Calendula</strong> heals existing hormonal acne while preventing new breakouts</li>
    </ul>

    <h3 class="text-xl font-serif mt-6 mb-3">Recommended Routine:</h3>
    <p class="mb-4">Consistency is key for hormonal concerns:</p>
    <ul class="list-disc pl-6 mb-4 space-y-2">
      <li>1-2 cups daily of any blend (all contain spearmint)</li>
      <li>Continue through your full cycle to see best results</li>
      <li>Many customers notice improvements after 2-3 cycles</li>
    </ul>
  </div>

  <div class="bg-primary-100 rounded-lg p-8 mt-10 text-center">
    <h3 class="text-2xl font-serif mb-4">Not Sure Where to Start?</h3>
    <p class="mb-6">Try our Sample Pack to experience all three blends and find what works best for your skin.</p>
    <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium">Get the Sample Pack</a>
  </div>
</div>
', 'Find the right BeauTeas blend for your skin concerns: acne, aging, redness, dryness, and hormonal issues.', 'Skin Concern Guide - Tea for Acne, Anti-Aging & More | BeauTeas', 'Find the best BeauTeas organic tea for your skin concerns. Solutions for acne, anti-aging, redness, dryness, and hormonal skin issues.', 'skin concerns, acne, anti-aging, wrinkles, redness, dryness, hormonal acne, skincare tea', 'published', strftime(''%s'', ''now''), 'default', 10, 0, 'Skin Guide', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Our Ingredients Page
('Our Ingredients', 'ingredients', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Our Ingredients</h1>

  <p class="text-lg mb-8">Every BeauTeas ingredient is 100% USDA Certified Organic and carefully selected for its skin-supporting benefits. Here''s a closer look at what makes our teas special.</p>

  <div class="bg-primary-100 rounded-lg p-6 mb-10">
    <p class="text-center"><strong>All BeauTeas are:</strong> USDA Certified Organic • Non-GMO • Gluten-Free • Dairy-Free • Nut-Free • Soy-Free • No Artificial Flavors or Colors</p>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">🌼 Hero Ingredient: Calendula</h2>
  <div class="bg-surface-light rounded-lg p-6 mb-8">
    <p class="mb-4"><strong>Found in:</strong> All BeauTeas blends</p>
    <p class="mb-4">Calendula officinalis, also known as pot marigold, has been used for centuries in traditional medicine for wound healing and skin conditions. Modern research confirms its remarkable properties:</p>
    <ul class="list-disc pl-6 mb-4 space-y-2">
      <li><strong>Antibacterial</strong> — fights P. acnes and other acne-causing bacteria</li>
      <li><strong>Anti-inflammatory</strong> — reduces redness and swelling</li>
      <li><strong>Wound healing</strong> — accelerates skin repair and reduces scarring</li>
      <li><strong>Collagen stimulation</strong> — promotes skin elasticity and firmness</li>
      <li><strong>Antioxidant</strong> — protects against free radical damage</li>
    </ul>
    <p class="text-sm text-text-secondary">Our calendula petals are sustainably harvested and certified organic.</p>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Tea Bases</h2>

  <div class="grid md:grid-cols-2 gap-6 mb-8">
    <div class="bg-surface-light rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">☀️ Black Tea (Morning)</h3>
      <p class="text-sm text-text-secondary mb-3">Organic Assam & Qu Hao black teas</p>
      <p class="mb-4">Rich in theaflavins and antioxidants, black tea provides smooth, sustained energy without jitters. It also contains polyphenols that support skin health and may help reduce the appearance of aging.</p>
      <p><strong>Caffeine:</strong> ~40-60mg per cup</p>
    </div>

    <div class="bg-surface-light rounded-lg p-6">
      <h3 class="text-xl font-serif mb-3">🌿 Green Tea (Afternoon)</h3>
      <p class="text-sm text-text-secondary mb-3">Organic Dragonwell & Sencha green teas</p>
      <p class="mb-4">Green tea is prized for its EGCG content—a powerful catechin that protects skin from UV damage, supports weight management, and delivers potent antioxidant benefits.</p>
      <p><strong>Caffeine:</strong> ~25-35mg per cup</p>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-6 mb-8">
    <h3 class="text-xl font-serif mb-3">🌙 Herbal Base (Evening)</h3>
    <p class="text-sm text-text-secondary mb-3">Organic Chamomile & Rooibos</p>
    <p class="mb-4"><strong>Chamomile:</strong> A powerful anti-inflammatory that promotes relaxation and better sleep—essential for skin repair. Contains apigenin, which has been shown to reduce anxiety.</p>
    <p class="mb-4"><strong>Rooibos:</strong> A South African herb rich in antioxidants and naturally containing alpha hydroxy acids (AHA) for gentle skin renewal. Also provides zinc, which supports skin health.</p>
    <p><strong>Caffeine:</strong> None (completely caffeine-free)</p>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Supporting Botanicals</h2>

  <div class="space-y-6">
    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-2">🍃 Spearmint</h3>
      <p class="text-sm text-text-secondary mb-2">Found in: All blends</p>
      <p>Spearmint has been studied for its anti-androgen properties, making it particularly helpful for hormonal acne. It also provides a refreshing flavor and anti-inflammatory benefits.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-2">🌿 Peppermint</h3>
      <p class="text-sm text-text-secondary mb-2">Found in: All blends</p>
      <p>Peppermint helps reduce excess oil production and provides a cooling, refreshing sensation. It also aids digestion, which can positively impact skin health.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-2">💜 Lavender</h3>
      <p class="text-sm text-text-secondary mb-2">Found in: Morning Blend</p>
      <p>Lavender is known for its calming properties and pleasant aroma. It helps reduce stress (a common acne trigger) and has antibacterial and anti-inflammatory properties.</p>
    </div>

    <div class="border-b border-border pb-6">
      <h3 class="text-xl font-serif mb-2">🍋 Lemon Verbena</h3>
      <p class="text-sm text-text-secondary mb-2">Found in: Afternoon Blend</p>
      <p>This fragrant herb has been shown to combat acne-causing bacteria. It adds a bright, citrusy note to our green tea blend while supporting skin clarity.</p>
    </div>

    <div class="pb-6">
      <h3 class="text-xl font-serif mb-2">🌸 Vanilla</h3>
      <p class="text-sm text-text-secondary mb-2">Found in: Morning Blend</p>
      <p>Organic vanilla flavoring adds warmth and sweetness to our Earl Grey-inspired Morning Blend. Vanilla also contains antioxidants that support overall wellness.</p>
    </div>
  </div>

  <h2 class="text-2xl font-serif mt-10 mb-6">Complete Ingredient Lists</h2>

  <div class="space-y-4">
    <div class="bg-surface-light rounded-lg p-4">
      <h4 class="font-serif font-medium mb-2"><a href="/product/clearly-calendula-morning" class="text-primary-600 hover:text-primary-700 underline">Morning Blend:</a></h4>
      <p class="text-sm">Organic Assam Black Tea, Organic Qu Hao Black Tea, Organic Lavender, Organic Spearmint, Organic Vanilla Flavoring, Organic Peppermint, Organic Calendula Petals</p>
    </div>
    <div class="bg-surface-light rounded-lg p-4">
      <h4 class="font-serif font-medium mb-2"><a href="/product/clearly-calendula-afternoon" class="text-primary-600 hover:text-primary-700 underline">Afternoon Blend:</a></h4>
      <p class="text-sm">Organic Dragonwell Green Tea, Organic Sencha Green Tea, Organic Lemon Verbena, Organic Spearmint, Organic Peppermint, Organic Calendula Petals</p>
    </div>
    <div class="bg-surface-light rounded-lg p-4">
      <h4 class="font-serif font-medium mb-2"><a href="/product/clearly-calendula-evening" class="text-primary-600 hover:text-primary-700 underline">Evening Blend:</a></h4>
      <p class="text-sm">Organic Chamomile, Organic Rooibos, Organic Spearmint, Organic Peppermint, Organic Calendula Petals</p>
    </div>
  </div>

  <div class="bg-primary-100 rounded-lg p-6 mt-10">
    <h3 class="text-xl font-serif mb-3">Questions About Ingredients?</h3>
    <p>If you have specific allergies or dietary concerns, please <a href="/contact" class="text-primary-600 hover:text-primary-700 underline">contact us</a>. We''re happy to provide additional information to ensure our teas are right for you.</p>
  </div>
</div>
', 'Learn about the organic ingredients in BeauTeas skincare teas: calendula, spearmint, chamomile, rooibos, and more.', 'Our Ingredients - Organic Tea Ingredients | BeauTeas', 'Discover the organic ingredients in BeauTeas skincare teas. Learn about calendula, spearmint, chamomile, rooibos, and other botanicals that support healthy skin.', 'ingredients, organic, calendula, spearmint, chamomile, rooibos, green tea, black tea, skincare', 'published', strftime(''%s'', ''now''), 'default', 11, 0, 'Ingredients', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Testimonials Page
('Customer Stories', 'testimonials', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-8">Customer Stories</h1>

  <p class="text-lg mb-10">Real results from real people. Here''s what our customers are saying about their BeauTeas journey.</p>

  <div class="space-y-8">
    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-center mb-4">
        <div class="text-primary-500 text-xl">★★★★★</div>
        <span class="ml-2 text-text-secondary">Verified Purchase</span>
      </div>
      <p class="text-lg italic mb-4">"I''ve struggled with hormonal acne for years. After just one month of drinking BeauTeas daily, my skin has never looked better. The Evening blend has become my nightly ritual—I look forward to it every day."</p>
      <p class="font-medium">— Sarah M., 28</p>
      <p class="text-sm text-text-secondary">Drinks: Evening Blend</p>
    </div>

    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-center mb-4">
        <div class="text-primary-500 text-xl">★★★★★</div>
        <span class="ml-2 text-text-secondary">Verified Purchase</span>
      </div>
      <p class="text-lg italic mb-4">"I was skeptical that tea could help my skin, but I''m a believer now! The Morning blend replaced my coffee and I have more stable energy. My coworkers have commented on how much clearer my skin looks."</p>
      <p class="font-medium">— Jennifer L., 34</p>
      <p class="text-sm text-text-secondary">Drinks: Morning Blend</p>
    </div>

    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-center mb-4">
        <div class="text-primary-500 text-xl">★★★★★</div>
        <span class="ml-2 text-text-secondary">Verified Purchase</span>
      </div>
      <p class="text-lg italic mb-4">"The Sample Pack was the perfect way to try all three. I love having a tea for every part of my day. My skin is less oily and I haven''t had a major breakout in weeks. Plus, they taste amazing!"</p>
      <p class="font-medium">— Michael T., 26</p>
      <p class="text-sm text-text-secondary">Drinks: Sample Pack (all three)</p>
    </div>

    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-center mb-4">
        <div class="text-primary-500 text-xl">★★★★★</div>
        <span class="ml-2 text-text-secondary">Verified Purchase</span>
      </div>
      <p class="text-lg italic mb-4">"As someone with sensitive skin, I was nervous to try something new. But since these work from the inside, there''s no irritation like with topical products. My redness has definitely reduced."</p>
      <p class="font-medium">— Amanda R., 41</p>
      <p class="text-sm text-text-secondary">Drinks: Evening Blend</p>
    </div>

    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-center mb-4">
        <div class="text-primary-500 text-xl">★★★★★</div>
        <span class="ml-2 text-text-secondary">Verified Purchase</span>
      </div>
      <p class="text-lg italic mb-4">"I bought these for the skincare benefits, but I stayed for the taste. The Afternoon blend is now my favorite part of my workday. And yes, my skin does look better—my partner noticed before I did!"</p>
      <p class="font-medium">— David K., 32</p>
      <p class="text-sm text-text-secondary">Drinks: Afternoon Blend</p>
    </div>

    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-center mb-4">
        <div class="text-primary-500 text-xl">★★★★★</div>
        <span class="ml-2 text-text-secondary">Verified Purchase</span>
      </div>
      <p class="text-lg italic mb-4">"I bought the subscription for myself but ended up getting one for my daughter too. We both have clearer skin and it''s become our little bonding ritual. Love that it''s organic and actually works!"</p>
      <p class="font-medium">— Patricia W., 52</p>
      <p class="text-sm text-text-secondary">Drinks: Sample Pack (subscription)</p>
    </div>
  </div>

  <div class="bg-primary-100 rounded-lg p-8 mt-12">
    <h2 class="text-2xl font-serif mb-4 text-center">Results Take Time</h2>
    <p class="text-center mb-4">Most customers see noticeable improvements in 3-4 weeks of daily use. Skin concerns that took months or years to develop won''t disappear overnight, but with consistent use, our teas support your skin''s natural healing processes.</p>
    <p class="text-center text-sm text-text-secondary">Individual results may vary. BeauTeas are designed to support skin health as part of a healthy lifestyle.</p>
  </div>

  <div class="text-center mt-12">
    <h3 class="text-2xl font-serif mb-4">Ready to Start Your Journey?</h3>
    <p class="mb-6">Join thousands of happy customers who''ve discovered the power of skincare tea.</p>
    <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium">Try the Sample Pack</a>
  </div>

  <div class="border-t border-border mt-12 pt-8">
    <h3 class="text-xl font-serif mb-4 text-center">Share Your Story</h3>
    <p class="text-center text-text-secondary">Have BeauTeas made a difference in your skin? We''d love to hear from you! Email us at <a href="mailto:hello@beauteas.com" class="text-primary-600 hover:text-primary-700">hello@beauteas.com</a> or tag us on Instagram <a href="https://instagram.com/beauteas" class="text-primary-600 hover:text-primary-700">@beauteas</a>.</p>
  </div>
</div>
', 'Read customer reviews and success stories from BeauTeas organic skincare tea users. Real results from real people.', 'Customer Stories & Reviews | BeauTeas', 'Read reviews and success stories from BeauTeas customers. Discover how organic skincare teas have helped with acne, skin clarity, and overall wellness.', 'testimonials, reviews, customer stories, success, results, before after, organic tea', 'published', strftime(''%s'', ''now''), 'default', 12, 0, 'Testimonials', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- The BeauTeas Ritual Page (Luxury Lifestyle)
('The BeauTeas Ritual', 'ritual', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">The Art of the BeauTeas Ritual</h1>
  <p class="text-xl text-center text-text-secondary mb-12 italic">A moment of intention. A practice of self-care. A daily commitment to your most radiant self.</p>

  <div class="bg-surface-light rounded-lg p-10 mb-12">
    <p class="text-lg leading-relaxed mb-6">In our fast-paced world, true luxury isn''t found in things—it''s found in moments. The BeauTeas Ritual transforms your daily tea into a sacred pause, a few precious minutes devoted entirely to yourself and your wellbeing.</p>
    <p class="text-lg leading-relaxed">This isn''t just about drinking tea. It''s about creating space for intention, for presence, for the quiet confidence that comes from investing in yourself every single day.</p>
  </div>

  <h2 class="text-3xl font-serif text-center mb-10">Your Daily Ritual</h2>

  <div class="space-y-12">
    <div class="grid md:grid-cols-2 gap-8 items-center">
      <div>
        <h3 class="text-2xl font-serif mb-4">☀️ The Morning Awakening</h3>
        <p class="text-text-secondary italic mb-4">6:00 - 9:00 AM</p>
        <p class="mb-4">Before the world demands your attention, take this moment for yourself. As the warm, bergamot-kissed aroma of our Morning Blend rises from your cup, set an intention for your day.</p>
        <p class="mb-4">The premium Assam and Qu Hao black teas provide sustained, elegant energy—no harsh caffeine spike, just a gentle awakening that carries you through your morning with grace.</p>
        <div class="bg-primary-50 rounded-lg p-4 mt-6">
          <p class="text-sm italic">"I hold the warm cup in my hands, breathe in the lavender and vanilla, and remind myself: today, I choose to glow."</p>
        </div>
      </div>
      <div class="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-8 text-center">
        <p class="text-6xl mb-4">🌅</p>
        <p class="font-serif text-xl">Intention</p>
        <p class="text-text-secondary">Energy • Clarity • Purpose</p>
      </div>
    </div>

    <div class="border-t border-border pt-12 grid md:grid-cols-2 gap-8 items-center">
      <div class="md:order-2">
        <h3 class="text-2xl font-serif mb-4">🌿 The Afternoon Reset</h3>
        <p class="text-text-secondary italic mb-4">12:00 - 3:00 PM</p>
        <p class="mb-4">When the midday lull arrives, resist the temptation to push through. Instead, honor your body''s need for renewal. Step away from the screen. Find a quiet corner. Prepare your Afternoon Blend with care.</p>
        <p class="mb-4">The delicate Dragonwell and Sencha green teas, brightened with lemon verbena and mint, offer a moment of refreshing clarity. This is your permission to pause, to reset, to return to your afternoon with renewed focus.</p>
        <div class="bg-primary-50 rounded-lg p-4 mt-6">
          <p class="text-sm italic">"In the quiet ritual of brewing, I find my center again. The afternoon stretches ahead, full of possibility."</p>
        </div>
      </div>
      <div class="md:order-1 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-8 text-center">
        <p class="text-6xl mb-4">🍃</p>
        <p class="font-serif text-xl">Renewal</p>
        <p class="text-text-secondary">Focus • Balance • Vitality</p>
      </div>
    </div>

    <div class="border-t border-border pt-12 grid md:grid-cols-2 gap-8 items-center">
      <div>
        <h3 class="text-2xl font-serif mb-4">🌙 The Evening Sanctuary</h3>
        <p class="text-text-secondary italic mb-4">7:00 - 10:00 PM</p>
        <p class="mb-4">As daylight fades, so too should the day''s demands. The Evening Blend signals to your mind and body that it''s time to release, to soften, to prepare for restorative sleep.</p>
        <p class="mb-4">Caffeine-free chamomile and rooibos embrace you like a warm blanket. This is when your skin does its deepest repair work—and you''ve given it everything it needs to restore overnight.</p>
        <div class="bg-primary-50 rounded-lg p-4 mt-6">
          <p class="text-sm italic">"The last sip is a promise to myself: tomorrow, I will wake renewed. Tonight, I rest knowing I''ve nourished myself completely."</p>
        </div>
      </div>
      <div class="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-8 text-center">
        <p class="text-6xl mb-4">✨</p>
        <p class="font-serif text-xl">Restoration</p>
        <p class="text-text-secondary">Peace • Repair • Dreams</p>
      </div>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-10 mt-16">
    <h2 class="text-2xl font-serif mb-6 text-center">The Ritual Elements</h2>
    <div class="grid md:grid-cols-3 gap-8">
      <div class="text-center">
        <p class="text-3xl mb-3">🫖</p>
        <h4 class="font-serif text-lg mb-2">The Vessel</h4>
        <p class="text-sm text-text-secondary">Choose a cup that brings you joy. Something beautiful, perhaps handmade. This is your daily companion in self-care.</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-3">⏱️</p>
        <h4 class="font-serif text-lg mb-2">The Pause</h4>
        <p class="text-sm text-text-secondary">As your tea steeps, resist multitasking. Watch the color deepen. Breathe in the botanicals. These minutes belong to you.</p>
      </div>
      <div class="text-center">
        <p class="text-3xl mb-3">🙏</p>
        <h4 class="font-serif text-lg mb-2">The Intention</h4>
        <p class="text-sm text-text-secondary">With each sip, reaffirm your commitment to yourself. You are worthy of this care. You are investing in your radiance.</p>
      </div>
    </div>
  </div>

  <div class="text-center mt-16">
    <h2 class="text-2xl font-serif mb-4">Begin Your Ritual</h2>
    <p class="text-text-secondary mb-8 max-w-2xl mx-auto">The complete Clearly Calendula collection gives you everything you need for a full day of intentional self-care. Three blends, three moments, one beautiful commitment to yourself.</p>
    <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-10 py-4 rounded-lg hover:bg-primary-700 transition-colors font-medium text-lg">Experience the Collection</a>
  </div>
</div>
', 'Discover the BeauTeas Ritual—a daily practice of intentional self-care through the art of tea. Morning, afternoon, and evening moments of luxury.', 'The BeauTeas Ritual - Daily Self-Care Tea Practice | BeauTeas', 'Transform your daily tea into a ritual of self-care and intention. Discover the art of the BeauTeas morning, afternoon, and evening skincare tea ritual.', 'ritual, self-care, mindfulness, tea ceremony, luxury, wellness, daily practice, intention', 'published', strftime(''%s'', ''now''), 'default', 13, 1, 'The Ritual', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Gift Guide Page
('Gift Guide', 'gifts', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">The Art of Gifting Wellness</h1>
  <p class="text-xl text-center text-text-secondary mb-12">Thoughtful gifts for those who deserve a moment of luxury</p>

  <div class="bg-gradient-to-r from-primary-50 to-primary-100 rounded-lg p-10 mb-12 text-center">
    <p class="text-lg mb-4">Give more than a gift—give a daily ritual of self-care, a path to radiant skin, and the simple pleasure of exceptional tea.</p>
    <p class="text-text-secondary">Every BeauTeas order arrives beautifully packaged, ready to delight.</p>
  </div>

  <h2 class="text-3xl font-serif text-center mb-10">Curated Gift Selections</h2>

  <div class="space-y-8">
    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-start justify-between flex-wrap gap-4">
        <div>
          <span class="text-sm font-medium text-primary-600 uppercase tracking-wider">Most Popular Gift</span>
          <h3 class="text-2xl font-serif mt-2 mb-3">The Complete Ritual Collection</h3>
          <p class="text-text-secondary mb-4">Our signature Sample Pack featuring all three Clearly Calendula blends—Morning, Afternoon, and Evening. The perfect introduction to the BeauTeas experience.</p>
          <ul class="text-sm space-y-1 mb-4">
            <li>✓ 30 individually wrapped tea sachets</li>
            <li>✓ Complete day-to-night skincare ritual</li>
            <li>✓ Elegantly presented in a keepsake box</li>
            <li>✓ Includes brewing guide</li>
          </ul>
        </div>
        <div class="text-right">
          <p class="text-2xl font-serif">$34.99</p>
          <p class="text-sm text-text-secondary line-through">$43.75</p>
          <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-6 py-2 rounded mt-3 hover:bg-primary-700 transition-colors">Shop Now</a>
        </div>
      </div>
    </div>

    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-start justify-between flex-wrap gap-4">
        <div>
          <span class="text-sm font-medium text-primary-600 uppercase tracking-wider">For the Early Riser</span>
          <h3 class="text-2xl font-serif mt-2 mb-3">Morning Glow Set</h3>
          <p class="text-text-secondary mb-4">Three boxes of our beloved Morning Blend—the enhanced Earl Grey that energizes while it beautifies. Perfect for the person who treasures their morning ritual.</p>
          <ul class="text-sm space-y-1 mb-4">
            <li>✓ 30 morning tea sachets</li>
            <li>✓ Smooth, sustained energy</li>
            <li>✓ Notes of bergamot, lavender, and vanilla</li>
          </ul>
        </div>
        <div class="text-right">
          <p class="text-2xl font-serif">$34.99</p>
          <p class="text-sm text-text-secondary line-through">$60.00</p>
          <a href="/product/clearly-calendula-morning" class="inline-block bg-primary-600 text-white px-6 py-2 rounded mt-3 hover:bg-primary-700 transition-colors">Shop Now</a>
        </div>
      </div>
    </div>

    <div class="bg-surface-light rounded-lg p-8">
      <div class="flex items-start justify-between flex-wrap gap-4">
        <div>
          <span class="text-sm font-medium text-primary-600 uppercase tracking-wider">For the Night Owl</span>
          <h3 class="text-2xl font-serif mt-2 mb-3">Evening Serenity Set</h3>
          <p class="text-text-secondary mb-4">Three boxes of our caffeine-free Evening Blend for the person who values their wind-down routine. Chamomile and rooibos for peaceful nights and glowing mornings.</p>
          <ul class="text-sm space-y-1 mb-4">
            <li>✓ 30 evening tea sachets</li>
            <li>✓ 100% caffeine-free</li>
            <li>✓ Contains natural AHA for overnight renewal</li>
          </ul>
        </div>
        <div class="text-right">
          <p class="text-2xl font-serif">$34.99</p>
          <p class="text-sm text-text-secondary line-through">$60.00</p>
          <a href="/product/clearly-calendula-evening" class="inline-block bg-primary-600 text-white px-6 py-2 rounded mt-3 hover:bg-primary-700 transition-colors">Shop Now</a>
        </div>
      </div>
    </div>
  </div>

  <h2 class="text-3xl font-serif text-center mt-16 mb-10">Perfect For Every Occasion</h2>

  <div class="grid md:grid-cols-2 gap-6">
    <div class="border border-border rounded-lg p-6">
      <h3 class="font-serif text-xl mb-3">🎄 Holiday Gifting</h3>
      <p class="text-text-secondary text-sm">Wellness gifts are the holiday trend that keeps growing. Give something they''ll actually use—and love—every single day.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="font-serif text-xl mb-3">💐 Mother''s Day</h3>
      <p class="text-text-secondary text-sm">Show mom she deserves daily moments of peace. The gift of self-care is the gift of love.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="font-serif text-xl mb-3">👰 Bridal Party</h3>
      <p class="text-text-secondary text-sm">Thank your bridesmaids with the gift of pre-wedding glow. Beautiful, practical, and utterly thoughtful.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="font-serif text-xl mb-3">🎂 Birthdays</h3>
      <p class="text-text-secondary text-sm">Another year calls for another level of self-care. Help them enter their new year glowing.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="font-serif text-xl mb-3">🏠 Hostess Gifts</h3>
      <p class="text-text-secondary text-sm">Elevate beyond wine with a gift that shows real thoughtfulness. Perfect for the host who has everything.</p>
    </div>
    <div class="border border-border rounded-lg p-6">
      <h3 class="font-serif text-xl mb-3">💝 Just Because</h3>
      <p class="text-text-secondary text-sm">The best gifts need no occasion. Surprise someone you love with a reason to pause and pamper themselves.</p>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mt-12">
    <h2 class="text-2xl font-serif mb-6 text-center">The Gift of Ongoing Glow</h2>
    <div class="grid md:grid-cols-2 gap-8 items-center">
      <div>
        <h3 class="text-xl font-serif mb-3">Gift Subscriptions Available</h3>
        <p class="text-text-secondary mb-4">Give the gift that keeps arriving. Our gift subscriptions deliver monthly wellness for 3, 6, or 12 months. The recipient chooses their favorite blends and delivery schedule.</p>
        <ul class="text-sm space-y-2">
          <li>✓ Customizable by recipient</li>
          <li>✓ Includes a beautiful gift announcement</li>
          <li>✓ No commitment for you—prepaid in full</li>
        </ul>
        <a href="/contact" class="inline-block text-primary-600 hover:text-primary-700 font-medium mt-4">Contact us to arrange a gift subscription →</a>
      </div>
      <div class="bg-primary-50 rounded-lg p-6 text-center">
        <p class="text-4xl mb-3">🎁</p>
        <p class="font-serif text-xl mb-2">3, 6, or 12 Months</p>
        <p class="text-sm text-text-secondary">of delivered self-care</p>
      </div>
    </div>
  </div>

  <div class="bg-primary-100 rounded-lg p-8 mt-12 text-center">
    <h3 class="text-xl font-serif mb-3">Corporate & Bulk Gifting</h3>
    <p class="text-text-secondary mb-4">Planning gifts for your team, clients, or event? We offer special pricing and custom packaging for orders of 10+ units.</p>
    <a href="/contact" class="inline-block text-primary-600 hover:text-primary-700 font-medium">Inquire about corporate gifting →</a>
  </div>
</div>
', 'Find the perfect BeauTeas gift for tea lovers and skincare enthusiasts. Curated gift sets for every occasion.', 'Gift Guide - Luxury Tea Gifts | BeauTeas', 'Shop BeauTeas gift sets and subscriptions. Perfect wellness gifts for holidays, birthdays, bridal parties, and anyone who deserves daily self-care.', 'gifts, gift guide, presents, holiday, birthday, bridal, tea gifts, wellness gifts, luxury', 'published', strftime(''%s'', ''now''), 'default', 14, 1, 'Gifts', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Our Promise / Quality Page
('Our Promise', 'our-promise', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">Our Promise to You</h1>
  <p class="text-xl text-center text-text-secondary mb-12 italic">Uncompromising quality in every leaf, every petal, every sip</p>

  <div class="bg-gradient-to-br from-primary-50 to-surface-light rounded-lg p-10 mb-12">
    <p class="text-lg text-center leading-relaxed">At BeauTeas, we believe that what you put into your body matters as much as what you put on your skin. That''s why we hold ourselves to the highest standards—sourcing only the finest organic botanicals, partnering with ethical suppliers, and crafting each blend with meticulous attention to detail.</p>
  </div>

  <h2 class="text-3xl font-serif text-center mb-10">The BeauTeas Standard</h2>

  <div class="space-y-8">
    <div class="flex gap-6 items-start">
      <div class="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
        <span class="text-2xl">🌿</span>
      </div>
      <div>
        <h3 class="text-xl font-serif mb-2">100% USDA Certified Organic</h3>
        <p class="text-text-secondary">Every single ingredient in every BeauTeas blend is certified organic by the USDA. No exceptions, no "natural flavoring" loopholes, no compromises. From our premium tea leaves to our hand-harvested calendula petals, you can trust that what you''re drinking is pure.</p>
      </div>
    </div>

    <div class="flex gap-6 items-start">
      <div class="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
        <span class="text-2xl">🌍</span>
      </div>
      <div>
        <h3 class="text-xl font-serif mb-2">Ethically & Sustainably Sourced</h3>
        <p class="text-text-secondary">We personally vet every supplier in our chain. Our teas come from family-owned estates that pay fair wages and practice sustainable agriculture. Our botanicals are harvested at peak potency by farmers who share our values. When you choose BeauTeas, you''re supporting a more ethical tea industry.</p>
      </div>
    </div>

    <div class="flex gap-6 items-start">
      <div class="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
        <span class="text-2xl">🔬</span>
      </div>
      <div>
        <h3 class="text-xl font-serif mb-2">Third-Party Tested for Purity</h3>
        <p class="text-text-secondary">Every batch of BeauTeas undergoes rigorous third-party testing for pesticides, heavy metals, and contaminants. We don''t just meet safety standards—we exceed them. Our testing reports are available upon request because we believe in complete transparency.</p>
      </div>
    </div>

    <div class="flex gap-6 items-start">
      <div class="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
        <span class="text-2xl">✨</span>
      </div>
      <div>
        <h3 class="text-xl font-serif mb-2">Small-Batch Artisan Blending</h3>
        <p class="text-text-secondary">We don''t mass-produce. Each BeauTeas blend is crafted in small batches by our master blenders, ensuring precise botanical ratios and peak freshness. When you open a box of BeauTeas, you''re experiencing tea that was blended with intention, not churned out by machines.</p>
      </div>
    </div>

    <div class="flex gap-6 items-start">
      <div class="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
        <span class="text-2xl">♻️</span>
      </div>
      <div>
        <h3 class="text-xl font-serif mb-2">Sustainable Packaging</h3>
        <p class="text-text-secondary">Our tea sachets are made from plant-based materials (sugarcane fiber), not plastic. Our boxes are printed with soy-based inks on recycled cardboard. Even our shipping materials are recyclable or compostable. Beautiful skin shouldn''t cost the earth.</p>
      </div>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mt-12">
    <h2 class="text-2xl font-serif mb-6 text-center">Our Sourcing Story</h2>
    <div class="grid md:grid-cols-3 gap-6">
      <div class="text-center">
        <p class="text-sm font-medium text-primary-600 uppercase tracking-wider mb-2">Black Tea</p>
        <p class="font-serif text-lg mb-2">Assam & Yunnan</p>
        <p class="text-sm text-text-secondary">From family estates in India and China, our black teas are hand-selected for smooth, malty depth and rich antioxidant content.</p>
      </div>
      <div class="text-center">
        <p class="text-sm font-medium text-primary-600 uppercase tracking-wider mb-2">Green Tea</p>
        <p class="font-serif text-lg mb-2">Zhejiang & Shizuoka</p>
        <p class="text-sm text-text-secondary">Our Dragonwell and Sencha come from the renowned tea regions of China and Japan, prized for their EGCG content and delicate flavor.</p>
      </div>
      <div class="text-center">
        <p class="text-sm font-medium text-primary-600 uppercase tracking-wider mb-2">Calendula</p>
        <p class="font-serif text-lg mb-2">Pacific Northwest</p>
        <p class="text-sm text-text-secondary">Our signature calendula petals are grown by organic farmers in Oregon and Washington, harvested at peak bloom for maximum potency.</p>
      </div>
    </div>
  </div>

  <div class="border border-border rounded-lg p-8 mt-12">
    <h2 class="text-2xl font-serif mb-6 text-center">Our Guarantees</h2>
    <div class="grid md:grid-cols-2 gap-6">
      <div class="flex items-start gap-4">
        <span class="text-primary-600 text-xl">✓</span>
        <div>
          <h4 class="font-medium mb-1">30-Day Satisfaction Guarantee</h4>
          <p class="text-sm text-text-secondary">Not in love with your tea? Return it within 30 days for a full refund. No questions asked.</p>
        </div>
      </div>
      <div class="flex items-start gap-4">
        <span class="text-primary-600 text-xl">✓</span>
        <div>
          <h4 class="font-medium mb-1">Freshness Guarantee</h4>
          <p class="text-sm text-text-secondary">Every order ships within 48 hours. Our teas are blended in small batches to ensure you receive the freshest product possible.</p>
        </div>
      </div>
      <div class="flex items-start gap-4">
        <span class="text-primary-600 text-xl">✓</span>
        <div>
          <h4 class="font-medium mb-1">Transparency Guarantee</h4>
          <p class="text-sm text-text-secondary">We''ll always tell you exactly what''s in our products and where it comes from. Have questions? We''ll answer them honestly.</p>
        </div>
      </div>
      <div class="flex items-start gap-4">
        <span class="text-primary-600 text-xl">✓</span>
        <div>
          <h4 class="font-medium mb-1">Results Guarantee</h4>
          <p class="text-sm text-text-secondary">Drink BeauTeas daily for 30 days. If you don''t notice a difference in your skin, we''ll refund your purchase.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="text-center mt-16">
    <h2 class="text-2xl font-serif mb-4">Experience the Difference</h2>
    <p class="text-text-secondary mb-8 max-w-2xl mx-auto">Quality you can taste. Ingredients you can trust. Results you can see. This is the BeauTeas promise.</p>
    <a href="/product/clearly-calendula-sample-pack" class="inline-block bg-primary-600 text-white px-10 py-4 rounded-lg hover:bg-primary-700 transition-colors font-medium text-lg">Try BeauTeas Risk-Free</a>
  </div>
</div>
', 'Discover the BeauTeas commitment to quality: USDA organic, ethically sourced, third-party tested, and sustainably packaged.', 'Our Promise - Quality & Sourcing | BeauTeas', 'Learn about BeauTeas quality standards: 100% USDA organic, ethically sourced ingredients, third-party testing, small-batch blending, and sustainable packaging.', 'quality, organic, sourcing, ethical, sustainable, promise, guarantee, standards, purity', 'published', strftime(''%s'', ''now''), 'default', 15, 1, 'Our Promise', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now'')),

-- Press & Features Page
('Press & Media', 'press', '
<div class="max-w-4xl mx-auto">
  <h1 class="text-4xl font-serif mb-4 text-center">In the Press</h1>
  <p class="text-xl text-center text-text-secondary mb-12">What the beauty and wellness world is saying about BeauTeas</p>

  <div class="bg-gradient-to-r from-primary-50 to-surface-light rounded-lg p-10 mb-12 text-center">
    <p class="text-2xl font-serif italic mb-4">"The skincare-tea trend is here to stay, and BeauTeas is leading the way with their science-backed, genuinely delicious blends."</p>
    <p class="text-text-secondary">— Beauty Industry Insider</p>
  </div>

  <h2 class="text-2xl font-serif mb-8 text-center">Featured In</h2>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16 items-center justify-items-center opacity-60">
    <div class="text-center">
      <p class="text-2xl font-serif text-text-secondary">Vogue</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-serif text-text-secondary">Allure</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-serif text-text-secondary">Well+Good</p>
    </div>
    <div class="text-center">
      <p class="text-2xl font-serif text-text-secondary">Byrdie</p>
    </div>
  </div>

  <h2 class="text-2xl font-serif mb-8">What They''re Saying</h2>

  <div class="space-y-8">
    <div class="border-l-4 border-primary-300 pl-6 py-2">
      <p class="text-lg italic mb-3">"Finally, a beauty tea that actually works. After three weeks of the full routine, my skin was clearer than it had been in years. The fact that it tastes incredible is just a bonus."</p>
      <p class="text-text-secondary font-medium">— Wellness Blogger</p>
    </div>

    <div class="border-l-4 border-primary-300 pl-6 py-2">
      <p class="text-lg italic mb-3">"BeauTeas has cracked the code on drinkable skincare. The calendula-spearmint combination isn''t just effective—it''s the future of inside-out beauty."</p>
      <p class="text-text-secondary font-medium">— Clean Beauty Magazine</p>
    </div>

    <div class="border-l-4 border-primary-300 pl-6 py-2">
      <p class="text-lg italic mb-3">"In a market flooded with wellness teas that overpromise and underdeliver, BeauTeas stands apart with their commitment to organic ingredients and genuine results."</p>
      <p class="text-text-secondary font-medium">— Natural Health Review</p>
    </div>

    <div class="border-l-4 border-primary-300 pl-6 py-2">
      <p class="text-lg italic mb-3">"The packaging is gorgeous, the ritual is lovely, and yes—my hormonal breakouts have significantly reduced since I started drinking these teas daily."</p>
      <p class="text-text-secondary font-medium">— Skincare Influencer, 500K+ followers</p>
    </div>
  </div>

  <div class="bg-surface-light rounded-lg p-8 mt-16">
    <h2 class="text-2xl font-serif mb-6 text-center">Recognition & Awards</h2>
    <div class="grid md:grid-cols-3 gap-6 text-center">
      <div>
        <p class="text-3xl mb-2">🏆</p>
        <p class="font-serif">Best New Wellness Brand</p>
        <p class="text-sm text-text-secondary">Clean Beauty Awards 2024</p>
      </div>
      <div>
        <p class="text-3xl mb-2">⭐</p>
        <p class="font-serif">Editor''s Choice</p>
        <p class="text-sm text-text-secondary">Natural Products Expo</p>
      </div>
      <div>
        <p class="text-3xl mb-2">🌿</p>
        <p class="font-serif">Sustainability Excellence</p>
        <p class="text-sm text-text-secondary">Green Business Certification</p>
      </div>
    </div>
  </div>

  <div class="bg-primary-100 rounded-lg p-8 mt-12">
    <h2 class="text-2xl font-serif mb-4 text-center">Media & Press Inquiries</h2>
    <p class="text-center text-text-secondary mb-6">Interested in featuring BeauTeas? We''d love to work with you.</p>
    <div class="text-center">
      <p class="mb-4">For press inquiries, product samples, or interview requests:</p>
      <a href="mailto:press@beauteas.com" class="text-primary-600 hover:text-primary-700 font-medium text-lg">press@beauteas.com</a>
    </div>
  </div>

  <div class="border border-border rounded-lg p-8 mt-12">
    <h2 class="text-2xl font-serif mb-4 text-center">Collaboration Opportunities</h2>
    <div class="grid md:grid-cols-2 gap-8">
      <div>
        <h3 class="font-serif text-xl mb-3">Influencer Partnerships</h3>
        <p class="text-text-secondary text-sm mb-4">We partner with authentic voices in the wellness, beauty, and lifestyle spaces. If you''re passionate about clean beauty and would love to share BeauTeas with your audience, we''d love to hear from you.</p>
        <a href="mailto:partnerships@beauteas.com" class="text-primary-600 hover:text-primary-700 font-medium">partnerships@beauteas.com →</a>
      </div>
      <div>
        <h3 class="font-serif text-xl mb-3">Affiliate Program</h3>
        <p class="text-text-secondary text-sm mb-4">Earn commission by sharing products you genuinely love. Our affiliate program offers competitive rates and exclusive perks for our brand advocates.</p>
        <a href="/contact" class="text-primary-600 hover:text-primary-700 font-medium">Apply to our affiliate program →</a>
      </div>
    </div>
  </div>
</div>
', 'BeauTeas in the press: media features, reviews, awards, and press inquiries. See what the wellness world is saying.', 'Press & Media | BeauTeas', 'Read BeauTeas press coverage, reviews, and awards. Media inquiries, influencer partnerships, and affiliate program information.', 'press, media, features, reviews, awards, influencer, affiliate, partnerships, coverage', 'published', strftime(''%s'', ''now''), 'default', 16, 0, 'Press', 1, strftime(''%s'', ''now''), strftime(''%s'', ''now''));

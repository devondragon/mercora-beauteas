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

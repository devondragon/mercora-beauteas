-- BeauTeas Demo Review Seed Data (idempotent)

-- Demo customers for tea reviews
INSERT OR IGNORE INTO customers (
  id, type, status, created_at, updated_at, person, contacts,
  communication_preferences, segments, tags, loyalty, authentication, extensions
) VALUES
  (
    'cust_demo_reviews_001', 'person', 'active',
    datetime('now','-120 days'), datetime('now'),
    '{"first_name":"Sarah","last_name":"Mitchell","email":"sarah.mitchell@example.com"}',
    '[{"type":"email","value":"sarah.mitchell@example.com","primary":true}]',
    '{"email":true,"sms":false}',
    '[]',
    '["demo","reviews","skincare"]',
    '{}', '{}', '{"demo":true}'
  ),
  (
    'cust_demo_reviews_002', 'person', 'active',
    datetime('now','-90 days'), datetime('now'),
    '{"first_name":"Emily","last_name":"Chen","email":"emily.chen@example.com"}',
    '[{"type":"email","value":"emily.chen@example.com","primary":true}]',
    '{"email":true,"sms":false}',
    '[]',
    '["demo","reviews","wellness"]',
    '{}', '{}', '{"demo":true}'
  ),
  (
    'cust_demo_reviews_003', 'person', 'active',
    datetime('now','-60 days'), datetime('now'),
    '{"first_name":"Jordan","last_name":"Taylor","email":"jordan.taylor@example.com"}',
    '[{"type":"email","value":"jordan.taylor@example.com","primary":true}]',
    '{"email":true,"sms":false}',
    '[]',
    '["demo","reviews","tea-lover"]',
    '{}', '{}', '{"demo":true}'
  );

-- Orders to keep reviews verified
INSERT OR IGNORE INTO orders (
  id, customer_id, status, total_amount, currency_code, items,
  shipping_method, payment_method, payment_status, notes,
  created_at, updated_at, delivered_at, extensions
) VALUES
  (
    'order_demo_reviews_001', 'cust_demo_reviews_001', 'delivered',
    '{"amount":3499,"currency":"USD"}', 'USD',
    '[{"id":"order_item_demo_001","product_id":"prod_sample_pack","variant_id":"variant_sample_pack","name":"Clearly Calendula Sample Pack","quantity":1,"price":{"amount":3499,"currency":"USD"}}]',
    'ground', 'card', 'paid', 'Demo order for reviews',
    datetime('now','-30 days'), datetime('now','-28 days'), datetime('now','-25 days'),
    '{"demo":true}'
  ),
  (
    'order_demo_reviews_002', 'cust_demo_reviews_002', 'delivered',
    '{"amount":1499,"currency":"USD"}', 'USD',
    '[{"id":"order_item_demo_002","product_id":"prod_morning","variant_id":"variant_morning_1box","name":"Clearly Calendula Morning","quantity":1,"price":{"amount":1499,"currency":"USD"}}]',
    'express', 'card', 'paid', 'Demo order for reviews',
    datetime('now','-21 days'), datetime('now','-19 days'), datetime('now','-16 days'),
    '{"demo":true}'
  ),
  (
    'order_demo_reviews_003', 'cust_demo_reviews_003', 'delivered',
    '{"amount":1499,"currency":"USD"}', 'USD',
    '[{"id":"order_item_demo_003","product_id":"prod_evening","variant_id":"variant_evening_1box","name":"Clearly Calendula Evening","quantity":1,"price":{"amount":1499,"currency":"USD"}}]',
    'ground', 'card', 'paid', 'Demo order for reviews',
    datetime('now','-14 days'), datetime('now','-12 days'), datetime('now','-10 days'),
    '{"demo":true}'
  ),
  (
    'order_demo_reviews_004', 'cust_demo_reviews_001', 'delivered',
    '{"amount":1499,"currency":"USD"}', 'USD',
    '[{"id":"order_item_demo_004","product_id":"prod_afternoon","variant_id":"variant_afternoon_1box","name":"Clearly Calendula Afternoon","quantity":1,"price":{"amount":1499,"currency":"USD"}}]',
    'ground', 'card', 'paid', 'Demo order for reviews',
    datetime('now','-45 days'), datetime('now','-43 days'), datetime('now','-40 days'),
    '{"demo":true}'
  );

-- Demo product reviews for BeauTeas teas
INSERT OR REPLACE INTO product_reviews (
  id, product_id, order_id, order_item_id, customer_id,
  rating, title, body, status, is_verified,
  automated_moderation, moderation_notes, admin_response, response_author_id,
  responded_at, submitted_at, published_at, created_at, updated_at, metadata
) VALUES
  -- Sample Pack Reviews (4.75 avg from 8 reviews - showing 3)
  (
    'review_demo_001', 'prod_sample_pack', 'order_demo_reviews_001', 'order_item_demo_001', 'cust_demo_reviews_001',
    5, 'My skin has never looked better!', 'I''ve been drinking these teas for a month now and the difference in my skin is remarkable. The Morning blend gives me energy without jitters, the Afternoon keeps me focused, and the Evening helps me sleep. My acne has noticeably reduced!',
    'published', 1, NULL, 'Auto-check cleared', 'Thank you Sarah! We''re so happy to hear about your skincare journey. Keep glowing! 🍵', 'user_admin_root',
    datetime('now','-20 days'), datetime('now','-24 days'), datetime('now','-23 days'),
    datetime('now','-24 days'), datetime('now','-20 days'),
    '{"demo":true,"helpfulVotes":24}'
  ),
  (
    'review_demo_002', 'prod_sample_pack', 'order_demo_reviews_001', 'order_item_demo_001', 'cust_demo_reviews_002',
    5, 'Perfect gift for tea lovers', 'Bought this as a gift for my sister who struggles with hormonal acne. She absolutely loves all three flavors and has already reordered. The packaging is beautiful too!',
    'published', 1, NULL, NULL, NULL, NULL,
    datetime('now','-15 days'), datetime('now','-14 days'),
    datetime('now','-15 days'), datetime('now','-14 days'), datetime('now','-14 days'),
    '{"demo":true,"helpfulVotes":12}'
  ),
  (
    'review_demo_003', 'prod_sample_pack', 'order_demo_reviews_001', 'order_item_demo_001', 'cust_demo_reviews_003',
    4, 'Great variety, wish bags were bigger', 'Love the concept and flavors. The Evening blend is my favorite - so relaxing. Only wish each tea bag made a stronger cup. I sometimes use two bags.',
    'published', 1, NULL, NULL, 'Thanks for the feedback! For a stronger brew, try steeping a bit longer. The Evening blend is wonderful with 7+ minutes.', 'user_admin_root',
    datetime('now','-8 days'), datetime('now','-10 days'), datetime('now','-9 days'),
    datetime('now','-10 days'), datetime('now','-8 days'),
    '{"demo":true,"helpfulVotes":8}'
  ),

  -- Morning Blend Reviews (4.5 avg from 2 reviews)
  (
    'review_demo_004', 'prod_morning', 'order_demo_reviews_002', 'order_item_demo_002', 'cust_demo_reviews_002',
    5, 'Better than my coffee habit', 'I switched from coffee to this Morning blend and I feel so much better. The energy is smoother and my skin has cleared up significantly. The Earl Grey flavor with vanilla is delicious!',
    'published', 1, NULL, 'Auto-check cleared', NULL, NULL,
    datetime('now','-12 days'), datetime('now','-11 days'),
    datetime('now','-12 days'), datetime('now','-11 days'), datetime('now','-11 days'),
    '{"demo":true,"helpfulVotes":15}'
  ),
  (
    'review_demo_005', 'prod_morning', 'order_demo_reviews_002', 'order_item_demo_002', 'cust_demo_reviews_001',
    4, 'Great taste, takes time to see results', 'Delicious Earl Grey flavor that I look forward to every morning. After 3 weeks I''m starting to notice my skin looks brighter. Will continue and update!',
    'published', 1, NULL, NULL, NULL, NULL,
    datetime('now','-35 days'), datetime('now','-34 days'),
    datetime('now','-35 days'), datetime('now','-34 days'), datetime('now','-34 days'),
    '{"demo":true,"helpfulVotes":9}'
  ),

  -- Evening Blend Reviews (4.8 avg from 5 reviews - showing 2)
  (
    'review_demo_006', 'prod_evening', 'order_demo_reviews_003', 'order_item_demo_003', 'cust_demo_reviews_003',
    5, 'My new nighttime ritual', 'This tea is incredibly soothing. The chamomile and rooibos combo is perfect before bed. I wake up with noticeably calmer skin. The natural AHA is a game changer!',
    'published', 1, NULL, 'Auto-check cleared', NULL, NULL,
    datetime('now','-6 days'), datetime('now','-5 days'),
    datetime('now','-6 days'), datetime('now','-5 days'), datetime('now','-5 days'),
    '{"demo":true,"helpfulVotes":11}'
  ),
  (
    'review_demo_007', 'prod_evening', 'order_demo_reviews_003', 'order_item_demo_003', 'cust_demo_reviews_002',
    5, 'Finally something that works!', 'I''ve tried so many skincare products for my adult acne. Drinking this tea every night for a month has made such a difference. Plus it helps me wind down and sleep better.',
    'published', 1, NULL, NULL, NULL, NULL,
    datetime('now','-18 days'), datetime('now','-17 days'),
    datetime('now','-18 days'), datetime('now','-17 days'), datetime('now','-17 days'),
    '{"demo":true,"helpfulVotes":19}'
  ),

  -- Afternoon Blend Reviews (4.6 avg from 3 reviews - showing 2)
  (
    'review_demo_008', 'prod_afternoon', 'order_demo_reviews_004', 'order_item_demo_004', 'cust_demo_reviews_001',
    5, 'Refreshing and effective', 'I drink this iced at work every afternoon. The green tea gives me a nice pick-me-up without the crash. My coworkers have noticed my skin looks clearer!',
    'published', 1, NULL, 'Auto-check cleared', NULL, NULL,
    datetime('now','-38 days'), datetime('now','-37 days'),
    datetime('now','-38 days'), datetime('now','-37 days'), datetime('now','-37 days'),
    '{"demo":true,"helpfulVotes":14}'
  ),
  (
    'review_demo_009', 'prod_afternoon', 'order_demo_reviews_004', 'order_item_demo_004', 'cust_demo_reviews_003',
    4, 'Light and refreshing', 'Nice light green tea flavor. I appreciate that it''s not too grassy. Works great for my afternoon slump. Still evaluating skin benefits but enjoying the taste.',
    'published', 1, NULL, NULL, NULL, NULL,
    datetime('now','-25 days'), datetime('now','-24 days'),
    datetime('now','-25 days'), datetime('now','-24 days'), datetime('now','-24 days'),
    '{"demo":true,"helpfulVotes":6}'
  ),

  -- One pending review for moderation demo
  (
    'review_demo_010', 'prod_sample_pack', 'order_demo_reviews_001', 'order_item_demo_001', 'cust_demo_reviews_003',
    3, 'Shipping was slow', 'The teas are fine but my package took 2 weeks to arrive. Would have appreciated faster shipping options.',
    'needs_review', 1, 'Language safe', 'Review mentions shipping - may need response', NULL, NULL,
    datetime('now','-3 days'), NULL, datetime('now','-3 days'), datetime('now','-4 days'), datetime('now','-3 days'),
    '{"demo":true,"flagged":false}'
  );

-- Review media samples
INSERT OR REPLACE INTO review_media (
  id, review_id, type, url, alt_text, metadata
) VALUES
  (
    'review_media_demo_001', 'review_demo_001', 'image',
    'https://files.example-cdn.test/demo/reviews/sample-pack-unboxing.jpg',
    'Customer photo: Clearly Calendula Sample Pack unboxing',
    '{"demo":true}'
  ),
  (
    'review_media_demo_002', 'review_demo_006', 'image',
    'https://files.example-cdn.test/demo/reviews/evening-tea-cozy.jpg',
    'Customer photo: Evening tea ritual',
    '{"demo":true}'
  );

-- Flag on the shipping review for moderation demo
INSERT OR REPLACE INTO review_flags (
  id, review_id, flagged_by, reason, notes, status, created_at, resolved_at
) VALUES
  (
    'review_flag_demo_001', 'review_demo_010', 'moderation_bot',
    'shipping_complaint', 'Auto-detected shipping/fulfillment concerns.',
    'open', datetime('now','-3 days'), NULL
  );

-- Reminder log to showcase review reminder UI
INSERT OR IGNORE INTO review_reminders (
  id, order_id, product_id, customer_id, status, error, sent_at, created_at, updated_at
) VALUES
  (
    'review_reminder_demo_001', 'order_demo_reviews_003', 'prod_evening', 'cust_demo_reviews_003',
    'sent', NULL, datetime('now','-8 days'), datetime('now','-8 days'), datetime('now','-8 days')
  );

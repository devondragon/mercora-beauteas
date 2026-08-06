-- Migration: Add customer policy pages (Refund/Return, Shipping, Contact)
-- Date: 2026-07-10
-- Description: Seeds three published CMS pages that the storefront footer and
--   checkout link to. Missing policy pages (and dead footer links that 404) are
--   a common trigger for payment-processor account holds (BMC-173).
--
--   Reuses the INSERT pattern from 0003_add_cms_pages.sql (same `pages` columns,
--   status = 'published', legal/default templates). Content is placeholder legal
--   copy that MUST be reviewed by counsel before go-live.
--
--   The refund copy reflects the live `refund.*` admin_settings:
--     refund.return_window_days      = 30   (30-day return window)
--     refund.restocking_fee_percent  = 0    (no restocking fee)
--     refund.minimum_refund_amount   = 500  ($5.00 minimum refund)
--
--   show_in_nav = 0: these are placed explicitly in the curated footer columns
--   (lib/brand.config.ts) rather than the auto-populated nav column, so they do
--   not double-list.
--
--   INSERT OR IGNORE: `pages.slug` is UNIQUE. If an environment already has one
--   of these slugs (e.g. a page an admin created by hand), a plain INSERT would
--   hit the UNIQUE constraint and abort the whole migration, blocking that
--   deployment. OR IGNORE skips only the conflicting row and leaves the existing
--   page untouched, so this is safe to apply everywhere.

INSERT OR IGNORE INTO pages (title, slug, content, status, template, meta_description, show_in_nav, sort_order) VALUES
(
    'Refund & Return Policy',
    'refund-policy',
    '<p><strong>Last Updated:</strong> ' || date('now') || '</p>' ||
    '<h2>Our Promise</h2><p>We want you to love your BeauTeas ritual. If you are not completely satisfied with your purchase, we are here to help.</p>' ||
    '<h2>Return Window</h2><p>You may request a return within <strong>30 days</strong> of your delivery date. Because our teas are consumable products, items must be unopened and in their original, resalable packaging to be eligible, for health and safety reasons. Opened or partially used items cannot be returned unless they arrived damaged, defective, or incorrect.</p>' ||
    '<h2>How to Start a Return</h2><p>Email our team at <a href="mailto:hello@beauteas.com">hello@beauteas.com</a> with your order number and the item(s) you would like to return, and we will send you return instructions. Please do not ship items back before contacting us.</p>' ||
    '<h2>Refunds</h2><ul>' ||
    '<li><strong>No restocking fee.</strong> We never charge a restocking fee on returned items.</li>' ||
    '<li>Once we receive and inspect your return, your refund is issued to your original payment method.</li>' ||
    '<li>Refunds are typically processed within 5 to 10 business days after we receive your return, though your bank or card issuer may take additional time to post the credit.</li>' ||
    '<li>The minimum refund we process is <strong>$5.00</strong>. Amounts below this may be issued as store credit instead.</li>' ||
    '<li>Original shipping charges are non-refundable except where an item arrived damaged, defective, or incorrect.</li>' ||
    '</ul>' ||
    '<h2>Damaged, Defective, or Incorrect Items</h2><p>If your order arrives damaged or you receive the wrong item, please contact us within 30 days of delivery and we will make it right with a replacement or a full refund, including any shipping costs, at no charge to you.</p>' ||
    '<h2>Subscriptions</h2><p>You can change, pause, or cancel a tea subscription at any time from your account before your next renewal. Subscription orders that have already shipped follow the same 30-day return policy described above.</p>' ||
    '<h2>Questions</h2><p>Reach us any time at <a href="mailto:hello@beauteas.com">hello@beauteas.com</a> and a member of our team will be happy to help.</p>',
    'published',
    'legal',
    'How to return an item and request a refund from BeauTeas: 30-day return window, no restocking fee, and refunds to your original payment method.',
    0,
    110
),
(
    'Shipping Policy',
    'shipping-policy',
    '<p><strong>Last Updated:</strong> ' || date('now') || '</p>' ||
    '<h2>Order Processing</h2><p>Orders are processed and packed within 1 to 2 business days (Monday through Friday, excluding holidays). You will receive a confirmation email with tracking as soon as your order ships.</p>' ||
    '<h2>Shipping Methods and Delivery Times</h2><p>We currently ship within the United States. At checkout you can choose from:</p><ul>' ||
    '<li><strong>Standard</strong>: estimated 5 to 7 business days.</li>' ||
    '<li><strong>Express</strong>: estimated 2 to 3 business days.</li>' ||
    '<li><strong>Overnight</strong>: next business day where available.</li>' ||
    '</ul><p>Delivery estimates begin once your order leaves our facility and do not include processing time. Carrier delays, weather, and peak periods can occasionally affect delivery windows.</p>' ||
    '<h2>Shipping Rates</h2><p>Shipping is calculated at checkout based on the method you select and your destination. Any active free-shipping promotion is applied automatically to qualifying orders.</p>' ||
    '<h2>Tracking Your Order</h2><p>Once your order ships, you can track your package using the link in your shipping confirmation email or from your order history in your account.</p>' ||
    '<h2>Lost or Delayed Packages</h2><p>If your tracking has not updated or your package has not arrived within the estimated window, contact us at <a href="mailto:hello@beauteas.com">hello@beauteas.com</a> and we will help track it down.</p>' ||
    '<h2>International Orders</h2><p>We are not shipping internationally at this time. If you are outside the United States and would like to order, please reach out and we will let you know when international shipping becomes available.</p>',
    'published',
    'legal',
    'BeauTeas shipping information: order processing times, domestic shipping methods and estimated delivery windows, tracking, and lost-package help.',
    0,
    111
),
(
    'Contact Us',
    'contact',
    '<p>We would love to hear from you. Whether you have a question about our organic skincare teas, your order, a subscription, or you just want to say hello, our team is here to help.</p>' ||
    '<h2>Email Us</h2><p>The fastest way to reach us is by email at <a href="mailto:hello@beauteas.com">hello@beauteas.com</a>. We aim to respond to every message within 1 to 2 business days.</p>' ||
    '<h2>Customer Support Hours</h2><p>Our support team is available Monday through Friday, 9:00 AM to 5:00 PM Mountain Time, excluding public holidays.</p>' ||
    '<h2>Order and Shipping Questions</h2><p>For help with an existing order, please include your order number so we can assist you as quickly as possible. You can also review our <a href="/shipping-policy">Shipping Policy</a> and <a href="/refund-policy">Refund &amp; Return Policy</a> for quick answers to common questions.</p>' ||
    '<h2>Frequently Asked Questions</h2><p>Many questions are answered on our <a href="/faq">FAQ page</a>, a great first stop for details about our ingredients, brewing, and subscriptions.</p>' ||
    '<h2>Stay Connected</h2><p>Follow along for beauty tips, new blends, and special offers on Instagram, Facebook, and Pinterest.</p>',
    'published',
    'default',
    'Get in touch with the BeauTeas team. Email us at hello@beauteas.com for questions about our organic skincare teas, orders, shipping, or subscriptions.',
    0,
    112
);

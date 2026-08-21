-- Migration: Rewrite Privacy Policy & Terms; remove dead Shopify CCPA pages
-- Date: 2026-07-13
-- Description: BMC-183. The Privacy Policy and Terms of Service seeded by
--   migration 0003 were generic ~4-section boilerplate: no processor
--   disclosure, no CCPA/GDPR rights, no retention terms, no cookie disclosure,
--   no business address. Separately, three pages carried over from the old
--   Shopify store — ccpa-opt-out ("Do not sell my personal information"),
--   ccpa-compliance, and gdpr-compliance (seeded via data/d1/seed.sql) — are
--   built on Shopify jQuery wired to a backend that no longer exists;
--   PageRenderer strips their inline scripts, leaving an INERT legal opt-out,
--   which is worse than none for CA residents.
--
--   This migration patches EXISTING databases (dev, prod). Fresh databases are
--   seeded correctly by the updated migration 0003 (Privacy/Terms) and by the
--   updated data/d1/seed.sql with the CCPA rows removed.
--
--   Pattern mirrors 0009_rebrand_cms_pages.sql: snapshot the current row into
--   page_versions, then UPDATE guarded by a LIKE on the original boilerplate so
--   a page an admin has already edited via the CMS is never clobbered. The
--   guards also make each UPDATE idempotent (the new copy no longer matches the
--   guard, so a re-run is a no-op).
--
--   NOTE: the rewritten legal copy reflects the store's actual data practices
--   (processors: Stripe, Clerk, Resend, Cloudflare, Cloudflare Workers AI) but
--   is best-effort and MUST be reviewed by counsel before go-live — same
--   caveat carried by 0014_add_policy_pages.sql.

-- ---------------------------------------------------------------------------
-- Privacy Policy: snapshot, then replace the 0003 boilerplate.
-- Guard: the original seeded copy contained "We do not sell, trade, or
-- otherwise transfer"; only rows still showing that phrase are updated.
-- (LIKE substring kept short — D1 caps LIKE patterns at 50 chars.)
-- ---------------------------------------------------------------------------
INSERT INTO page_versions (page_id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, change_summary, created_at, created_by)
SELECT id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, 'Snapshot before legal rewrite (migration 0016, BMC-183)', unixepoch(), 'migration'
FROM pages
WHERE slug = 'privacy-policy'
  AND content LIKE '%We do not sell, trade%';

UPDATE pages
SET content =
    '<p><strong>Last Updated:</strong> ' || date('now') || '</p>' ||
    '<p>This Privacy Policy explains how BeauTeas ("we," "us," or "our") collects, uses, and shares personal information when you visit beauteas.com, create an account, place an order, subscribe, or chat with our AI assistant. We are committed to handling your information responsibly and giving you meaningful control over it.</p>' ||
    '<h2>1. Information We Collect</h2><p>We collect the following categories of personal information:</p><ul>' ||
    '<li><strong>Account information</strong>: your name, email address, and login credentials, managed on our behalf by our authentication provider.</li>' ||
    '<li><strong>Order and transaction information</strong>: the products you buy, your order history, and your shipping and billing addresses.</li>' ||
    '<li><strong>Payment information</strong>: your card details are collected and processed directly by our payment processor. We do not store full card numbers on our systems; we retain only limited details such as the card brand, the last four digits, and a payment reference.</li>' ||
    '<li><strong>Subscription information</strong>: the plans you enroll in and their status and renewal schedule.</li>' ||
    '<li><strong>AI assistant interactions</strong>: the messages you send to Chai, our shopping assistant, which are processed to generate responses and recommendations.</li>' ||
    '<li><strong>Approximate location</strong>: a coarse, city-level location derived from your network connection, used to tailor content such as shipping estimates.</li>' ||
    '<li><strong>Technical and usage data</strong>: information such as your browser type, device, and how you interact with the site, collected to operate and secure the service.</li>' ||
    '</ul>' ||
    '<h2>2. How We Use Your Information</h2><p>We use personal information to:</p><ul>' ||
    '<li>Process and fulfill your orders and manage your subscriptions;</li>' ||
    '<li>Create and maintain your account and authenticate you;</li>' ||
    '<li>Provide the AI assistant and personalize product recommendations;</li>' ||
    '<li>Send transactional messages such as order confirmations, shipping updates, and review reminders;</li>' ||
    '<li>Provide customer support and respond to your inquiries;</li>' ||
    '<li>Detect, prevent, and address fraud, abuse, and security issues; and</li>' ||
    '<li>Comply with our legal, tax, and accounting obligations.</li>' ||
    '</ul>' ||
    '<h2>3. Service Providers We Share Information With</h2><p>We do not sell your personal information. We share it only with the service providers (processors) that help us operate the store, and only as needed to provide the service:</p>' ||
    '<table><thead><tr><th>Provider</th><th>Purpose</th><th>Information involved</th></tr></thead><tbody>' ||
    '<tr><td>Stripe</td><td>Payment processing and subscription billing</td><td>Payment and billing details</td></tr>' ||
    '<tr><td>Clerk</td><td>Account authentication and identity management</td><td>Name, email, login credentials</td></tr>' ||
    '<tr><td>Resend</td><td>Sending transactional email</td><td>Name, email, order details</td></tr>' ||
    '<tr><td>Cloudflare</td><td>Website hosting, database, media storage, and content delivery</td><td>Data processed by the site</td></tr>' ||
    '<tr><td>Cloudflare Workers AI</td><td>Powering the Chai AI assistant and search</td><td>Your chat messages and related product context</td></tr>' ||
    '</tbody></table>' ||
    '<p>We may also disclose information when required by law, to enforce our terms, or in connection with a business transfer such as a merger or acquisition.</p>' ||
    '<h2>4. Cookies and Tracking</h2><p>We use cookies and similar technologies that are strictly necessary to operate the site, for example to keep you signed in and to maintain your shopping cart. We do not currently use third-party advertising or marketing tracking pixels. If that changes, we will update this policy and, where required, provide a cookie consent choice.</p>' ||
    '<h2>5. Data Retention</h2><p>We keep personal information only as long as necessary for the purposes described in this policy. Order and transaction records are retained for the period required by tax, accounting, and legal obligations (generally several years). Account information is retained while your account is active and is deleted or anonymized after you close your account or request deletion, unless we are required to keep it.</p>' ||
    '<h2>6. Your Privacy Rights</h2><p>Depending on where you live, you may have some or all of the following rights regarding your personal information:</p><ul>' ||
    '<li><strong>Access / know</strong>: request a copy of the personal information we hold about you and how we use it;</li>' ||
    '<li><strong>Correction</strong>: ask us to correct inaccurate information;</li>' ||
    '<li><strong>Deletion</strong>: ask us to delete your personal information;</li>' ||
    '<li><strong>Portability</strong>: receive your information in a portable format;</li>' ||
    '<li><strong>Objection / restriction</strong>: object to or restrict certain processing; and</li>' ||
    '<li><strong>Withdraw consent</strong>: withdraw consent where we rely on it, without affecting processing already carried out.</li>' ||
    '</ul>' ||
    '<p><strong>California residents (CCPA/CPRA):</strong> You have the right to know, delete, and correct your personal information, and the right to opt out of the sale or sharing of personal information. <strong>We do not sell or share your personal information for cross-context behavioral advertising or for monetary or other valuable consideration</strong>, so there is no such opt-out for you to exercise. We will not discriminate against you for exercising your rights.</p>' ||
    '<p><strong>EU / UK residents (GDPR / UK GDPR):</strong> In addition to the rights above, you may lodge a complaint with your local data protection authority. We process your information on the legal bases of performing our contract with you, our legitimate interests in operating and securing the store, your consent where applicable, and compliance with legal obligations.</p>' ||
    '<p>To exercise any of these rights, contact us using the details below. We will verify your request and respond within the time required by applicable law.</p>' ||
    '<h2>7. Data Security</h2><p>We use administrative and technical safeguards, and rely on reputable providers, to protect personal information. No method of transmission or storage is completely secure, however, and we cannot guarantee absolute security.</p>' ||
    '<h2>8. Children''s Privacy</h2><p>Our store is not directed to children under 16, and we do not knowingly collect personal information from them. If you believe a child has provided us information, please contact us and we will delete it.</p>' ||
    '<h2>9. Changes to This Policy</h2><p>We may update this Privacy Policy from time to time. When we do, we will revise the "Last Updated" date above and, where appropriate, provide additional notice.</p>' ||
    '<h2>10. Contact Us</h2><p>If you have questions about this Privacy Policy or wish to exercise your privacy rights, contact us at:</p>' ||
    '<p>BeauTeas<br>5504 S. Lilly Creek Ct.<br>Byers, CO 80103<br>Email: <a href="mailto:hello@beauteas.com">hello@beauteas.com</a></p>',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'privacy-policy'
  AND content LIKE '%We do not sell, trade%';

-- ---------------------------------------------------------------------------
-- Terms of Service: snapshot, then replace the 0003 boilerplate.
-- Guard: the original seeded copy contained "to be bound by the terms and
-- provision of this agreement" (unchanged by the 0009 rebrand, which only
-- touched the Description-of-Service sentence). LIKE substring kept short —
-- D1 caps LIKE patterns at 50 chars.
-- ---------------------------------------------------------------------------
INSERT INTO page_versions (page_id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, change_summary, created_at, created_by)
SELECT id, title, content, excerpt, meta_title, meta_description, meta_keywords, version, 'Snapshot before legal rewrite (migration 0016, BMC-183)', unixepoch(), 'migration'
FROM pages
WHERE slug = 'terms-of-service'
  AND content LIKE '%to be bound by the terms%';

UPDATE pages
SET content =
    '<p><strong>Last Updated:</strong> ' || date('now') || '</p>' ||
    '<p>These Terms of Service ("Terms") govern your access to and use of beauteas.com and any purchases you make from BeauTeas ("we," "us," or "our"). By using the site or placing an order, you agree to these Terms. If you do not agree, please do not use the site.</p>' ||
    '<h2>1. Eligibility and Accounts</h2><p>You must be at least 18 years old, or the age of majority where you live, to purchase from us. If you create an account, you are responsible for keeping your login credentials confidential and for all activity that occurs under your account. Please notify us promptly of any unauthorized use.</p>' ||
    '<h2>2. Products and Orders</h2><p>Our products are organic teas formulated to support skin health. We describe our products as accurately as possible, but we do not warrant that product descriptions, ingredients, or other content are complete or error-free. All orders are subject to acceptance and availability, and we may refuse or cancel an order at our discretion, including where we suspect fraud or an error in pricing or product information.</p>' ||
    '<h2>3. Pricing and Payment</h2><p>Prices are shown in U.S. dollars and may change at any time. Applicable taxes and shipping are calculated at checkout. Payment is processed by our third-party payment processor, and by placing an order you authorize us to charge your selected payment method for the total amount of your order.</p>' ||
    '<h2>4. Subscriptions and Recurring Billing</h2><p>If you enroll in a subscription, you authorize us to charge your payment method on a recurring basis according to the plan you selected until you cancel. You may pause, change, or cancel your subscription at any time from your account before the next renewal date. Cancellation stops future renewals; it does not retroactively refund an order that has already been processed.</p>' ||
    '<h2>5. Shipping, Returns, and Refunds</h2><p>Shipping timeframes, returns, and refunds are governed by our <a href="/shipping-policy">Shipping Policy</a> and our <a href="/refund-policy">Refund &amp; Return Policy</a>, which are incorporated into these Terms by reference.</p>' ||
    '<h2>6. Health Disclaimer</h2><p>Our products are not intended to diagnose, treat, cure, or prevent any disease, and our content is not medical advice. Consult a qualified healthcare professional before using our products if you are pregnant, nursing, taking medication, or have a medical condition or known allergies. Discontinue use and seek advice if you experience an adverse reaction.</p>' ||
    '<h2>7. AI Assistant</h2><p>Our AI shopping assistant, Chai, provides automated product information and suggestions and may occasionally be inaccurate or incomplete. Its responses are offered for convenience only and are not professional, medical, or legal advice. Please verify important details before relying on them.</p>' ||
    '<h2>8. Acceptable Use</h2><p>You agree not to misuse the site, including by attempting to gain unauthorized access, interfering with its operation, scraping or harvesting data, or using it for any unlawful purpose.</p>' ||
    '<h2>9. Intellectual Property</h2><p>The site and its content, including text, graphics, logos, and images, are owned by us or our licensors and are protected by intellectual property laws. You may not copy, reproduce, or distribute our content without our permission.</p>' ||
    '<h2>10. Disclaimers and Limitation of Liability</h2><p>The site and products are provided on an "as is" and "as available" basis, without warranties of any kind, whether express or implied, to the fullest extent permitted by law. To the maximum extent permitted by law, we will not be liable for any indirect, incidental, or consequential damages arising from your use of the site or products, and our total liability for any claim will not exceed the amount you paid for the order giving rise to the claim.</p>' ||
    '<h2>11. Governing Law</h2><p>These Terms are governed by the laws of the State of Colorado, without regard to its conflict-of-laws rules. Any dispute will be subject to the exclusive jurisdiction of the state and federal courts located in Colorado.</p>' ||
    '<h2>12. Changes to These Terms</h2><p>We may update these Terms from time to time. Changes take effect when we post the revised Terms and update the "Last Updated" date above. Your continued use of the site after changes take effect constitutes acceptance of the revised Terms.</p>' ||
    '<h2>13. Contact Us</h2><p>Questions about these Terms? Contact us at:</p>' ||
    '<p>BeauTeas<br>5504 S. Lilly Creek Ct.<br>Byers, CO 80103<br>Email: <a href="mailto:hello@beauteas.com">hello@beauteas.com</a></p>',
    version = version + 1,
    updated_at = unixepoch()
WHERE slug = 'terms-of-service'
  AND content LIKE '%to be bound by the terms%';

-- ---------------------------------------------------------------------------
-- Remove the dead Shopify CCPA/GDPR pages. Their opt-out form is inert (the
-- Shopify backend is gone and PageRenderer strips the inline scripts), so a
-- non-functional legal opt-out must not be presented to customers. These are
-- leaf pages (no child pages reference them), and ON DELETE CASCADE on
-- page_versions removes any snapshot history. Safe to re-run.
-- ---------------------------------------------------------------------------
DELETE FROM pages WHERE slug IN ('ccpa-opt-out', 'ccpa-compliance', 'gdpr-compliance');

# Domain Pitfalls

**Domain:** Shopify-to-Mercora e-commerce migration (organic skincare teas), Stripe subscriptions, SEO preservation
**Researched:** 2026-03-04
**Overall confidence:** MEDIUM (training data only -- WebSearch and WebFetch unavailable; verified against codebase analysis)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, revenue loss, or major ranking drops.

---

### Pitfall 1: Stripe Webhook Verification is Broken for Production

**What goes wrong:** The `CloudflareStripe` class in `lib/stripe.ts` (lines 192-202) has a `webhooks.constructEvent` method that does NOT verify webhook signatures -- it just `JSON.parse()`s the payload. In production, `getStripeClient()` returns `CloudflareStripe` (because `NODE_ENV === 'production'` always triggers the Workers path at line 229). The main webhook handler at `app/api/webhooks/stripe/route.ts` uses `getStripe()` (the Node.js SDK), which does proper verification. But any NEW webhook handling code that uses `getStripeClient()` will silently bypass signature verification.

**Why it happens:** The codebase has two Stripe clients (Node SDK and CloudflareStripe) with different capabilities. Developers adding subscription webhook handlers may use the wrong one.

**Consequences:** Subscription webhooks that use `CloudflareStripe.webhooks.constructEvent()` would accept forged events. An attacker could POST fake `invoice.payment_succeeded` events to grant themselves free subscription renewals.

**Prevention:**
- Before adding ANY subscription webhook handling, implement proper HMAC-SHA256 verification in `CloudflareStripe.webhooks.constructEvent()` using the Web Crypto API (available in Cloudflare Workers).
- Alternatively, ensure ALL webhook handlers use `getStripe()` (the Node.js SDK) for signature verification, never `getStripeClient()`.
- Add a test that verifies a forged webhook is rejected.

**Detection:** Review any webhook handler that calls `getStripeClient()` or `CloudflareStripe`. If `constructEvent` is called on a CloudflareStripe instance, verification is a no-op.

**Phase:** Must be fixed in Subscription System phase, before any subscription webhooks go live.

**Confidence:** HIGH (verified in codebase at `lib/stripe.ts` lines 192-202 and lines 218-234).

---

### Pitfall 2: Using PaymentIntent Instead of SetupIntent + Subscription for Recurring Billing

**What goes wrong:** The existing checkout flow uses `PaymentIntent` for one-time payments. Developers often try to reuse the same pattern for subscriptions by creating a `PaymentIntent` and then attaching the payment method to a subscription. This does not work correctly with Stripe's subscription billing. Subscriptions require either: (a) `Subscription` creation with `payment_behavior: 'default_incomplete'` returning a `client_secret` from the subscription's latest invoice's payment intent, or (b) a `SetupIntent` to collect a payment method first, then create the subscription server-side.

**Why it happens:** The existing Mercora codebase only has `createPaymentIntent` in `lib/stripe.ts`. The pattern is well-understood for one-time checkout. Extending it to "also do subscriptions" feels natural but is architecturally wrong.

**Consequences:** If you create a PaymentIntent for the first subscription payment manually and then try to create a Stripe Subscription separately, you get double charges, mismatched records, and Stripe's automatic retry/dunning logic does not work because the subscription is not linked to the initial payment properly.

**Prevention:**
- Use Stripe's recommended subscription creation flow: create a `Subscription` with `payment_behavior: 'default_incomplete'` and `expand: ['latest_invoice.payment_intent']`. Pass the PaymentIntent's `client_secret` to the frontend for confirmation with `confirmCardPayment()`.
- OR: Use `SetupIntent` to save the payment method, then create the subscription server-side with the saved payment method. This is cleaner for "Subscribe & Save" because the customer is charged immediately by Stripe upon subscription creation.
- Do NOT create a standalone PaymentIntent for subscription first payments.
- Add `createSubscription`, `cancelSubscription`, `updateSubscription`, and `pauseSubscription` methods to the CloudflareStripe class (or use the Node SDK directly for these operations).

**Detection:** If you see code that calls `createPaymentIntent` followed by `subscriptions.create` as separate operations, the flow is wrong.

**Phase:** Subscription checkout flow phase.

**Confidence:** HIGH (Stripe's subscription API is well-documented; the existing `CloudflareStripe` class only implements PaymentIntent and Tax -- no subscription methods exist).

---

### Pitfall 3: Missing Critical Subscription Webhook Events

**What goes wrong:** The existing webhook handler at `app/api/webhooks/stripe/route.ts` only handles 4 event types, and only `payment_intent.succeeded` actually does anything (the others are just `console.log`). Subscriptions generate a completely different set of webhook events. If you only listen for the events you already handle, subscription lifecycle changes (upgrades, downgrades, payment failures, cancellations, trial endings) will be silently ignored.

**Why it happens:** One-time payment webhooks are simple (payment succeeded/failed). Subscription webhooks have 15+ event types with complex state transitions.

**Consequences:** Subscriptions could be cancelled in Stripe but remain "active" in D1. Payment failures would not trigger dunning emails or status updates. Customers would continue receiving products after cancellation, or stop receiving them while still being charged.

**Prevention:** Handle at minimum these subscription webhook events:
- `customer.subscription.created` -- record new subscription in D1
- `customer.subscription.updated` -- handle plan changes, pause/resume, status transitions
- `customer.subscription.deleted` -- mark subscription as cancelled in D1
- `invoice.payment_succeeded` -- renew subscription period, create renewal order
- `invoice.payment_failed` -- update subscription status, trigger dunning email
- `invoice.upcoming` -- optional but useful for "your renewal is coming" emails
- `customer.subscription.paused` -- if using Stripe's pause feature
- `customer.subscription.resumed` -- if using Stripe's resume feature

Also handle: `invoice.finalized`, `payment_intent.requires_action` (for SCA/3DS on renewals).

**Detection:** Count handled webhook event types. If fewer than 6 subscription-specific events are handled, you are almost certainly missing critical lifecycle events.

**Phase:** Subscription system phase (webhook handling must be complete before going live).

**Confidence:** HIGH (well-known Stripe subscription pattern).

---

### Pitfall 4: Shopify URL Structure Mismatch Causes SEO Ranking Loss

**What goes wrong:** Shopify uses `/products/[handle]` and `/collections/[handle]` URL patterns. Mercora uses `/product/[slug]` and `/category/[slug]`. Without comprehensive 301 redirects, every inbound link, every Google-indexed URL, and every bookmarked page returns a 404. Google drops pages from the index within days of encountering persistent 404s.

**Why it happens:** The URL difference seems small ("products" vs "product"), but search engines treat them as completely different pages. One missing redirect means that page's accumulated link equity and ranking are lost.

**Consequences:** For a small store like BeauTeas (~30 products), the absolute number of URLs is manageable, but organic search traffic typically takes 3-6 months to recover from a botched migration even with redirects in place. Without redirects, rankings may never recover for competitive keywords.

**Prevention:**
- Crawl the existing Shopify site to get every public URL before DNS cutover. Tools like Screaming Frog or even a simple `sitemap.xml` download will suffice.
- Implement 301 redirects in `middleware.ts` (runs on every request, perfect for this) for ALL Shopify URL patterns:
  - `/products/[handle]` -> `/product/[slug]`
  - `/collections/[handle]` -> `/category/[slug]`
  - `/pages/[handle]` -> `/[slug]` (CMS pages)
  - `/blogs/[blog]/[article]` -> appropriate destination or 410
  - `/account/*` -> Clerk sign-in or account pages
  - Shopify pagination: `/collections/[handle]?page=2` -> appropriate destination
  - Shopify variant URLs: `/products/[handle]?variant=123456` -> `/product/[slug]`
- Verify every redirect with `curl -I` before DNS cutover.
- Map Shopify handles to Mercora slugs explicitly (they may differ -- Shopify auto-generates handles from product titles, and your Mercora slugs may have been set differently).

**Detection:** After DNS cutover, monitor Google Search Console for 404 spikes. If 404s appear for URLs with the `/products/` or `/collections/` prefix, redirects are missing.

**Phase:** SEO phase -- must be implemented and tested BEFORE DNS cutover. This is a launch blocker.

**Confidence:** HIGH (standard SEO migration knowledge, verified that no redirects currently exist in middleware.ts or next.config.ts).

---

### Pitfall 5: D1 as Subscription State Authority Instead of Stripe

**What goes wrong:** Developers build subscription management CRUD directly in D1 (create subscription record, update status, handle pause/resume) and then try to sync state TO Stripe. This inverts the correct flow. Stripe should be the billing authority; D1 should be a sync layer that mirrors Stripe's state via webhooks.

**Why it happens:** The existing codebase follows a D1-first pattern for orders: create the order in D1, then create the PaymentIntent in Stripe. It is natural to extend this to subscriptions. But subscriptions have ongoing billing cycles, automatic retries, proration calculations, and dunning -- all managed by Stripe. Trying to replicate this logic in D1 creates an impossible state reconciliation problem.

**Consequences:** Split-brain state: D1 says subscription is active but Stripe has cancelled it (or vice versa). Payment retry logic must be reimplemented. Proration calculations must be reimplemented. Every Stripe billing feature must be manually replicated.

**Prevention:**
- **Stripe is the source of truth for all subscription state.** D1 is a read cache updated via webhooks.
- Create subscriptions by calling Stripe's API first, then recording the result in D1.
- Never update subscription status in D1 directly from user actions -- always call Stripe first, then let the webhook update D1.
- The D1 subscription table should store: `stripe_subscription_id`, `stripe_customer_id`, `status` (mirrored from Stripe), `current_period_start`, `current_period_end`, `cancel_at_period_end`, and metadata.
- Implement an idempotent webhook handler that can safely process the same event multiple times (Stripe sends events at-least-once).

**Detection:** If code exists that writes to the D1 subscriptions table without it being triggered by a Stripe webhook, the flow is inverted.

**Phase:** Subscription schema and system design phase.

**Confidence:** HIGH (PROJECT.md explicitly states "Stripe manages billing cycles" -- this pitfall documents what happens if that principle is violated).

---

### Pitfall 6: CloudflareStripe Adapter Lacks Subscription API Methods

**What goes wrong:** The existing `CloudflareStripe` class in `lib/stripe.ts` only implements `createPaymentIntent`, `calculateTax`, and a broken `webhooks.constructEvent`. It has no methods for `subscriptions.create`, `subscriptions.update`, `subscriptions.cancel`, `customers.create`, `setupIntents.create`, `prices.create`, or any of the other ~15 Stripe API endpoints needed for subscription management.

**Why it happens:** The CloudflareStripe adapter was built for the minimum viable one-time payment flow. Subscriptions require a much larger API surface.

**Consequences:** Developers must either: (a) extend CloudflareStripe with every needed method (error-prone, each method needs correct URL-encoding for nested params), or (b) find a way to use the Node.js Stripe SDK in Cloudflare Workers.

**Prevention:**
- **Option A (recommended):** Check if the official Stripe Node.js SDK (v18.4.0, already installed) works in Cloudflare Workers with the `nodejs_compat` compatibility flag (already enabled in `wrangler.jsonc`). Recent versions of the Stripe SDK use `fetch` internally and may work without the custom adapter. If so, deprecate `CloudflareStripe` entirely.
- **Option B:** If the Node SDK does not work in Workers, systematically extend `CloudflareStripe` to cover: `customers.create/retrieve/update`, `subscriptions.create/retrieve/update/cancel`, `setupIntents.create/confirm`, `prices.list`, `invoices.list`, `paymentMethods.attach/detach`. Write a test for each method.
- **Do NOT add methods ad-hoc** as you encounter needs -- plan the full API surface upfront.

**Detection:** If subscription code uses `fetch('https://api.stripe.com/v1/subscriptions', ...)` directly instead of going through a Stripe client method, the adapter was not extended and raw API calls are being made (fragile, no error handling standardization).

**Phase:** Infrastructure/foundation phase -- resolve before building subscription features.

**Confidence:** HIGH (verified by reading `lib/stripe.ts` -- only 3 methods exist on CloudflareStripe). Note: whether Stripe Node SDK works with `nodejs_compat` is MEDIUM confidence -- needs testing.

---

### Pitfall 7: Customer Identity Mismatch Between Shopify, Clerk, and Stripe

**What goes wrong:** Shopify customers have a Shopify customer ID. Clerk users have a Clerk user ID. Stripe has its own customer ID. The D1 `customers` table has its own `id` field. During migration, if these IDs are not cross-referenced, you lose the ability to connect a returning customer's Shopify order history, their new Clerk identity, their Stripe payment methods, and their D1 customer record.

**Why it happens:** Each system generates its own IDs. Shopify exports give you `shopify_customer_12345`. Clerk creates `user_2abc...`. Stripe has `cus_xyz...`. Without an explicit mapping table or `external_references` field, there is no way to say "these are all the same person."

**Consequences:**
- Migrated customers cannot see their old order history after logging in with Clerk.
- If a customer had a Stripe customer record via Shopify Payments, creating a new Stripe customer loses their saved payment methods.
- Subscription records cannot be tied back to order history.
- Customer support cannot look up a customer across all systems.

**Prevention:**
- Use the D1 `customers.external_references` JSON field (already in schema) to store a mapping: `{"shopify_id": "12345", "clerk_id": "user_2abc", "stripe_customer_id": "cus_xyz"}`.
- During Shopify data import, populate `external_references` with the Shopify customer ID.
- When a customer creates a Clerk account (via password reset flow), link the Clerk user ID to the existing D1 customer record by matching on email.
- When creating Stripe subscriptions, check if a Stripe customer already exists for this email (from Shopify Payments) before creating a new one. Use `stripe.customers.list({ email: ... })`.
- Store the Stripe customer ID in `external_references` upon first Stripe interaction.

**Detection:** After migration, query `SELECT COUNT(*) FROM customers WHERE external_references IS NULL` -- any rows without cross-references are unmapped customers.

**Phase:** Data migration phase AND subscription system phase (both must use the same ID mapping strategy).

**Confidence:** HIGH (verified that `customers.external_references` exists in schema but is currently unused in the codebase).

---

### Pitfall 8: Losing Google Search Console Verification and Historical Data

**What goes wrong:** When you move from `beauteas.com` (Shopify) to `beauteas.com` (Cloudflare Workers), the domain stays the same but the hosting infrastructure changes. If Google Search Console verification was done via Shopify's DNS/meta tag, it may break after migration. More critically, if you create a new Search Console property instead of keeping the existing one, you lose all historical search performance data.

**Why it happens:** Shopify typically handles Search Console verification via a meta tag in the theme or a DNS TXT record. When the platform changes, the meta tag disappears. Teams then re-verify as a "new" property.

**Consequences:** Loss of 6-12 months of search performance data (impressions, clicks, average position by query). Inability to compare pre/post migration performance. Loss of submitted sitemaps and URL inspection data.

**Prevention:**
- **Before DNS cutover:** Document the current Search Console verification method (DNS TXT, meta tag, or HTML file).
- If using DNS TXT verification, ensure the TXT record persists through the Cloudflare DNS migration.
- If using meta tag verification, add the exact same verification meta tag to the Mercora `app/layout.tsx` `<head>`.
- If using HTML file verification, create a static route that serves the verification file.
- **Do NOT delete or re-create the Search Console property.** Keep the existing one.
- Submit the new sitemap URL to the existing Search Console property immediately after cutover.

**Detection:** Check Search Console 24-48 hours after DNS cutover. If verification is lost, you will see a warning banner.

**Phase:** SEO phase -- verification preservation must happen BEFORE DNS cutover.

**Confidence:** MEDIUM (standard SEO migration knowledge, not verified against specific Shopify/Cloudflare interaction).

---

## Moderate Pitfalls

Mistakes that cause significant rework, degraded UX, or days of debugging.

---

### Pitfall 9: Subscription Webhooks Self-Calling via HTTP

**What goes wrong:** The existing `handlePaymentSucceeded` function (webhook handler at lines 117-131) updates the order status by making an HTTP `fetch()` call BACK to its own `/api/orders` endpoint. If subscription webhook handlers follow this pattern, each renewal generates an internal HTTP round-trip that can fail due to Cloudflare Workers self-referencing limits, timeouts, or auth issues.

**Prevention:** Import and call database model functions directly (`updateOrderStatus()` from `lib/models/mach/orders.ts`) instead of making HTTP calls to your own API. This is faster, avoids auth complexity, and eliminates the self-call failure mode.

**Phase:** Subscription system phase -- establish the correct pattern from the start.

**Confidence:** HIGH (verified anti-pattern exists at `app/api/webhooks/stripe/route.ts` lines 117-131).

---

### Pitfall 10: Shopify Product Handle to Mercora Slug Mismatch

**What goes wrong:** Shopify auto-generates product handles from titles (e.g., "Calming Chamomile Blend" becomes `calming-chamomile-blend`). If Mercora products were created with different slugs (e.g., `chamomile-blend`), the 301 redirect from `/products/calming-chamomile-blend` to `/product/chamomile-blend` requires a manual mapping, not just a path prefix swap.

**Prevention:**
- Export ALL Shopify product handles and collection handles before migration.
- Compare against Mercora slugs. Build an explicit mapping table (can be a JSON file or DB table).
- For new products being migrated, use the Shopify handle as the Mercora slug whenever possible to make redirects trivial.
- For existing Mercora products that already have different slugs, maintain the explicit redirect map.

**Phase:** Data migration phase (slug mapping) and SEO phase (redirect implementation).

**Confidence:** HIGH (standard migration concern; Mercora `buildProductSlug()` in schema may produce different results than Shopify's handle generation).

---

### Pitfall 11: Subscription Discount Conflicts with Existing Promotion System

**What goes wrong:** BeauTeas subscriptions offer "10% off" for subscribers. The Mercora codebase already has a promotions system (`lib/db/schema/promotions.ts`, `lib/models/mach/promotions.ts`) and discount codes. If subscription discounts are implemented as Stripe Coupons but also interact with the existing promotion/coupon system, customers could stack discounts (10% subscription + 15% coupon = 25% off), or the system could reject valid subscription orders because the promotion logic does not understand Stripe subscription pricing.

**Prevention:**
- Use Stripe Coupons (applied to the subscription in Stripe, not in Mercora) for the subscription discount. Let Stripe handle the discounted price calculation.
- Decide explicitly whether coupon codes can be combined with subscription discounts. If not, add validation in the subscription checkout flow.
- Do NOT implement subscription discounts in Mercora's promotion system -- let Stripe be the authority for subscription pricing.

**Phase:** Subscription checkout flow phase.

**Confidence:** MEDIUM (verified promotions system exists; discount stacking policy is a business decision).

---

### Pitfall 12: Shopify Password Migration is Impossible -- Poor Communication Causes Customer Churn

**What goes wrong:** Shopify uses bcrypt with a custom salt format that Clerk cannot import. PROJECT.md correctly notes this and plans a password reset flow. The pitfall is NOT the technical limitation -- it is the customer communication around it. If migrated customers arrive at the new site, try to log in with their old password, get rejected, and see a generic "invalid credentials" error, they will assume the site is broken (or a phishing attempt) and leave.

**Prevention:**
- Design a dedicated "Welcome back" login flow for migrated customers that explains the platform change.
- When a customer enters an email that matches a migrated customer record (but has no Clerk account), show a clear message: "We have upgraded our platform! Please set a new password to continue." with a one-click password reset email.
- Send a proactive email to all customers BEFORE DNS cutover explaining the change and inviting them to set up their new account.
- Track how many migrated customers complete the password reset (metric for migration success).

**Detection:** If customer support tickets spike with "I can not log in" complaints in the first week after cutover, the communication was insufficient.

**Phase:** Customer import phase (data migration) and pre-launch communication planning.

**Confidence:** HIGH (PROJECT.md constraint: "Cannot migrate Shopify passwords -- must use Clerk password reset flow").

---

### Pitfall 13: Missing Canonical URLs Cause Duplicate Content Penalties

**What goes wrong:** During the transition period (and potentially after), Google may index both the old Shopify URLs (via cached links) and the new Mercora URLs for the same content. If canonical tags are missing or incorrect, Google treats these as duplicate pages and may demote both versions.

**Prevention:**
- Every product, category, and CMS page MUST have a `<link rel="canonical" href="https://beauteas.com/product/[slug]" />` tag pointing to the definitive Mercora URL.
- The canonical URL must use the full absolute URL (including https and domain).
- The current codebase has no canonical tag implementation (verified: no `canonical` pattern found in storefront pages).
- Implement canonical tags in `app/product/[slug]/page.tsx`, `app/category/[slug]/page.tsx`, and `app/[slug]/page.tsx`.
- Ensure the 301 redirects from Shopify URLs point to the canonical Mercora URLs.

**Detection:** After launch, check any product page's HTML source. If `<link rel="canonical">` is missing, this is unaddressed.

**Phase:** SEO phase -- metadata implementation.

**Confidence:** HIGH (verified no canonical tags exist in current codebase).

---

### Pitfall 14: Webhook Handler Returns 500 on Processing Error, Causing Infinite Retries

**What goes wrong:** The current webhook handler returns `{ status: 500 }` when processing fails (line 95-98). Stripe interprets 5xx responses as "try again later" and will retry the webhook up to ~15 times over 72 hours with exponential backoff. If the error is a bug in your code (not a transient failure), you get 15 identical failing requests clogging your logs and potentially causing side effects if the handler is partially successful before failing.

**Prevention:**
- Return 200 for events that were received and parsed, even if business logic processing fails. Log the error and handle it asynchronously or via a dead letter queue.
- Return 400 only for signature verification failures or malformed payloads.
- Return 500 only for genuinely transient failures (database temporarily unavailable).
- Implement idempotency: store processed event IDs and skip duplicates. Stripe event IDs (`evt_xxx`) are unique and can be used as deduplication keys.

**Detection:** Check Stripe Dashboard webhook logs. If you see the same event being retried repeatedly with 500 responses, this pitfall is active.

**Phase:** Subscription system phase (webhook handler redesign).

**Confidence:** HIGH (verified in `app/api/webhooks/stripe/route.ts` lines 93-98).

---

### Pitfall 15: Shopify Image URLs Break After Migration

**What goes wrong:** Shopify hosts product images on `cdn.shopify.com`. If product data is migrated with Shopify CDN URLs still in the image fields, images work initially (Shopify serves them). But Shopify eventually purges CDN assets for deactivated stores, and all product images break.

**Prevention:**
- During data migration, download ALL product images from Shopify CDN.
- Upload them to Cloudflare R2 (using the existing `uploadImageToR2()` utility in `lib/utils/r2.ts`).
- Update all product records in D1 to reference R2 paths, not Shopify CDN URLs.
- Verify image loading on every migrated product page before DNS cutover.
- The existing R2 folder structure (`products/`, `categories/`) and image resizing pipeline (`image-loader.ts`) should be used.

**Detection:** After migration, search the products table for any `media` or `primary_image` values containing `cdn.shopify.com`. Any matches are unmigrated images.

**Phase:** Data migration phase.

**Confidence:** HIGH (Shopify CDN behavior is well-known; R2 infrastructure already exists in the codebase).

---

### Pitfall 16: `force-dynamic` Root Layout Prevents Static Generation of SEO Pages

**What goes wrong:** The root layout (`app/layout.tsx` line 43) has `export const dynamic = "force-dynamic"`, which forces EVERY page to be server-rendered on every request. This means product pages, category pages, and CMS pages cannot be statically generated or cached at the edge. This hurts Time to First Byte (TTFB), which is a Core Web Vital that affects SEO rankings.

**Prevention:**
- Evaluate whether `force-dynamic` is truly necessary at the root layout level. It was likely added for Clerk authentication context.
- If dynamic rendering is only needed for authenticated features, move `force-dynamic` to specific layouts that need it (e.g., `/checkout/layout.tsx`, `/admin/layout.tsx`, `/orders/layout.tsx`) and let public pages (products, categories, CMS) use static or ISR rendering.
- If root-level dynamic is required for Clerk, consider using `revalidate` with short TTLs for product/category pages to benefit from edge caching.
- The R2 incremental cache (configured in `open-next.config.ts`) can help, but only if pages are not forced-dynamic.

**Detection:** Measure TTFB for product pages. If consistently above 200ms, dynamic rendering is a contributing factor.

**Phase:** SEO phase (metadata and performance).

**Confidence:** MEDIUM (verified `force-dynamic` exists at root; impact on Next.js/OpenNext/Cloudflare caching needs testing).

---

## Minor Pitfalls

Mistakes that cause confusion, minor rework, or suboptimal outcomes.

---

### Pitfall 17: Shopify Order ID Format Collision

**What goes wrong:** Shopify order IDs are numeric (e.g., `1234`). Mercora order IDs appear to be string-based (text primary key in schema). If migrated Shopify orders use their original numeric IDs and new Mercora orders use a different format (e.g., `ord_abc123`), lookups and sorting behave inconsistently.

**Prevention:** During migration, prefix Shopify order IDs: `shopify_1234`. Store the original Shopify order ID/number in the `external_references` JSON field for customer-facing display (customers know their Shopify order numbers).

**Phase:** Data migration phase.

**Confidence:** MEDIUM (order ID format not fully specified in codebase; `nanoid` is used for some IDs).

---

### Pitfall 18: Shopify Review Star Ratings Scale Mismatch

**What goes wrong:** Judge.me (the Shopify reviews app) uses a 1-5 star scale. If the Mercora reviews schema uses a different scale, or if the import script does not properly map the rating field, aggregate ratings will be wrong on product pages.

**Prevention:** Verify the Mercora `product_reviews` table rating field accepts the same 1-5 integer scale. Map Judge.me export fields (`rating`, `title`, `body`, `reviewer_name`, `reviewer_email`, `created_at`, `product_handle`) to Mercora fields. Preserve the original review date (do not set `created_at` to import date).

**Phase:** Data migration phase.

**Confidence:** MEDIUM (Judge.me export format is based on training data; review schema verified in `lib/db/schema/reviews.ts`).

---

### Pitfall 19: Subscription Pause/Resume Not Available in All Stripe Configurations

**What goes wrong:** Stripe's subscription pause feature (`pause_collection`) has specific behavior: it stops invoices from being generated but does not change the billing cycle. When resumed, the customer may be charged immediately or at the next cycle depending on configuration. If the UI says "pause" but the implementation uses `cancel_at_period_end` instead, the subscription is actually cancelled, not paused.

**Prevention:**
- Use `subscription.pause_collection` for true pause functionality, NOT `cancel_at_period_end`.
- `cancel_at_period_end` means "cancel at the end of the current billing period" -- different from pause.
- When paused, clearly communicate to the customer when billing will resume.
- Test the resume flow: after unpausing, verify the next invoice date is correct.

**Phase:** Subscription lifecycle management phase.

**Confidence:** MEDIUM (Stripe pause_collection behavior based on training data; verify against current Stripe docs during implementation).

---

### Pitfall 20: JSON Column Data in D1 Makes Subscription Queries Expensive

**What goes wrong:** The existing codebase stores complex objects (addresses, items, media) as JSON text columns in D1. If subscription data follows this pattern (e.g., storing the full subscription plan as a JSON blob), querying "all active subscriptions" or "subscriptions expiring this week" requires fetching all rows and filtering in JavaScript -- the same pattern already causing performance issues with orders (documented in CONCERNS.md).

**Prevention:**
- Design the subscriptions table with explicit, queryable columns for commonly-filtered fields: `status`, `stripe_subscription_id`, `customer_id`, `product_id`, `variant_id`, `current_period_end`, `cancel_at_period_end`.
- Use JSON columns only for truly unstructured metadata (e.g., Stripe event history).
- Add indexes on `status`, `customer_id`, and `current_period_end`.
- Use Drizzle `.where()` clauses, not JavaScript filtering.

**Detection:** If the subscription model file has `JSON.parse()` calls in its query functions, the data model needs restructuring.

**Phase:** Subscription schema design phase.

**Confidence:** HIGH (verified existing anti-pattern in `app/api/orders/route.ts` lines 72-88; this is about preventing the same mistake in new code).

---

### Pitfall 21: Not Testing CloudflareStripe Adapter Methods in Workers Runtime

**What goes wrong:** The `CloudflareStripe` fetch-based adapter manually URL-encodes nested params (lines 115-142). Stripe's API expects very specific encoding for nested objects (e.g., `items[0][price]=price_xxx`). A bug in the encoding logic means API calls silently create malformed resources (e.g., a subscription with no price, which Stripe rejects).

**Prevention:**
- Test every new `CloudflareStripe` method against the real Stripe API (test mode) in a Cloudflare Workers environment, not just in Node.js local dev.
- Use `npm run preview` (Cloudflare local preview) for integration testing.
- Compare the URL-encoded output of `CloudflareStripe` against what the official SDK would send for the same parameters.

**Phase:** Infrastructure/foundation phase.

**Confidence:** HIGH (verified the encoding logic at `lib/stripe.ts` lines 115-142 is hand-rolled).

---

### Pitfall 22: Shopify Data Export Format Assumptions

**What goes wrong:** Shopify offers multiple export formats (CSV from admin, JSON from Admin API, third-party export tools). Each has different field names, data structures, and completeness. Code written to parse one format will fail silently on another.

**Prevention:**
- Use Shopify's Admin API (GraphQL or REST) for programmatic export, not CSV exports from the admin UI.
- Document the exact Shopify API version and endpoints used for export.
- For each entity (products, customers, orders, reviews), write a parser that validates required fields before attempting insertion.
- Judge.me reviews require a separate export from Judge.me, not from Shopify's admin.

**Phase:** Data migration phase.

**Confidence:** MEDIUM (Shopify API specifics based on training data).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Severity |
|-------------|---------------|------------|----------|
| **Subscription Schema** | Storing subscription state in D1 as authority (Pitfall 5) | Stripe is authority; D1 is sync cache via webhooks | Critical |
| **Subscription Schema** | JSON blob for subscription data (Pitfall 20) | Use explicit queryable columns with indexes | Moderate |
| **Subscription System** | Webhook verification bypass (Pitfall 1) | Fix CloudflareStripe.webhooks.constructEvent before going live | Critical |
| **Subscription System** | Missing webhook events (Pitfall 3) | Handle all 8+ subscription lifecycle events | Critical |
| **Subscription System** | Webhook 500 causing retries (Pitfall 14) | Return 200 on parse success; implement idempotency | Moderate |
| **Subscription Checkout** | Using PaymentIntent instead of Subscription flow (Pitfall 2) | Use Stripe Subscription API with incomplete payment behavior | Critical |
| **Subscription Checkout** | Discount stacking (Pitfall 11) | Use Stripe Coupons; define stacking policy | Moderate |
| **Subscription Lifecycle** | Pause vs cancel confusion (Pitfall 19) | Use pause_collection, not cancel_at_period_end | Minor |
| **CloudflareStripe Adapter** | Missing subscription API methods (Pitfall 6) | Test Node SDK with nodejs_compat OR extend adapter fully | Critical |
| **CloudflareStripe Adapter** | Encoding bugs in Workers (Pitfall 21) | Test in Workers runtime, not just Node.js dev | Moderate |
| **SEO - Redirects** | Missing Shopify 301 redirects (Pitfall 4) | Crawl all Shopify URLs; implement in middleware.ts | Critical |
| **SEO - Metadata** | Missing canonical URLs (Pitfall 13) | Add canonical tags to all public pages | Moderate |
| **SEO - Performance** | force-dynamic prevents caching (Pitfall 16) | Move to page-level dynamic exports | Moderate |
| **SEO - Verification** | Losing Search Console (Pitfall 8) | Preserve verification method through DNS cutover | Moderate |
| **Data Migration** | Customer identity mismatch (Pitfall 7) | Use external_references for ID cross-referencing | Critical |
| **Data Migration** | Shopify images breaking (Pitfall 15) | Download and re-upload all images to R2 | Moderate |
| **Data Migration** | Slug mismatch (Pitfall 10) | Export Shopify handles; build explicit mapping | Moderate |
| **Data Migration** | Order ID collisions (Pitfall 17) | Prefix migrated IDs; preserve originals in external_references | Minor |
| **Data Migration** | Review format mismatch (Pitfall 18) | Verify rating scale; preserve original dates | Minor |
| **Data Migration** | Export format assumptions (Pitfall 22) | Use Shopify Admin API; validate before insert | Minor |
| **Customer Import** | Password migration communication (Pitfall 12) | Dedicated welcome-back flow; proactive email | Moderate |
| **Webhook Infrastructure** | Self-calling HTTP pattern (Pitfall 9) | Call model functions directly, not own API | Moderate |

---

## Sources

- Codebase analysis: `.planning/codebase/CONCERNS.md`, `INTEGRATIONS.md`, `STACK.md`, `ARCHITECTURE.md` (HIGH confidence)
- Direct code inspection: `lib/stripe.ts`, `app/api/webhooks/stripe/route.ts`, `middleware.ts`, `app/layout.tsx`, `lib/db/schema/*.ts` (HIGH confidence)
- Stripe subscription patterns, Shopify migration patterns, SEO migration best practices: Training data (MEDIUM confidence -- verify against current Stripe docs during implementation)
- `PROJECT.md` constraints and decisions (HIGH confidence)

**Note:** WebSearch and WebFetch were unavailable during this research. All Stripe API behavior claims should be verified against current Stripe documentation (https://docs.stripe.com/billing/subscriptions) before implementation. Stripe's API evolves frequently; specific method names and parameters may have changed since training data cutoff.

---

*Pitfalls audit: 2026-03-04*

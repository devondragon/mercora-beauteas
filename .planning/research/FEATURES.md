# Feature Landscape

**Domain:** Subscription e-commerce platform (organic skincare teas), Shopify-to-Mercora migration
**Researched:** 2026-03-04

## Table Stakes

Features users expect. Missing = product feels incomplete or migration fails.

### Subscription System

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Subscribe & Save toggle on product pages | Every subscription DTC brand (Dollar Shave Club, Bluebottle, Native) has this. Customers expect a one-click option next to the buy button. | Med | Toggle between one-time purchase and subscription with visible discount (e.g., "Save 10%"). Must show per-unit price difference. |
| Frequency selector | Customers need to choose delivery cadence. Standard for consumable products. | Low | PROJECT.md specifies 3 frequencies: every 2 weeks, monthly, every 2 months. Dropdown or pill selector adjacent to Subscribe & Save toggle. |
| Subscription discount display | Customers won't subscribe without seeing the value. Every subscribe-and-save program shows the savings prominently. | Low | Show both original price and subscription price. "Save 10%" or "$X.XX/delivery" format. Discount percentage defined per-product or globally in admin. |
| Stripe recurring billing integration | Stripe Subscriptions is the billing engine. Without it, nothing recurs. | High | Create Stripe Product + Price objects (recurring type). Use `SetupIntent` to collect payment method without immediate charge, then create `Subscription` via Stripe API. Must use `CloudflareStripe` fetch-based adapter per project constraints. |
| Subscription webhook handling | Stripe sends lifecycle events. Without handling them, the local DB drifts from Stripe's state. | High | Handle: `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `invoice.upcoming` (for advance notice emails). Stripe is the billing authority; D1 is the sync layer. |
| Subscription lifecycle management (pause/resume/skip/cancel) | Customers who can't manage their subscription will churn or file chargebacks. Industry standard self-service. | Med | Pause: sets `pause_collection` on Stripe Subscription. Resume: removes `pause_collection`. Skip: advances billing anchor date for one cycle. Cancel: `cancel_at_period_end` (graceful) or immediate cancel. All actions via Stripe API, synced to D1 via webhooks. |
| Customer subscription dashboard | Customers must see what they're subscribed to and manage it. Without this, support tickets replace UI. | Med | Show active/paused/cancelled subscriptions. Next delivery date. Payment method on file. Action buttons for pause/resume/skip/cancel. Order history for subscription orders. |
| Subscription email notifications | Transactional emails for subscription lifecycle are legally required in many jurisdictions and expected everywhere. | Med | Minimum set: subscription created confirmation, upcoming renewal reminder (3 days before), payment succeeded/receipt, payment failed (with retry info), subscription paused, subscription resumed, subscription cancelled. Use existing Resend integration with React Email templates. |
| Payment method management | Subscribers need to update expired/lost cards without cancelling. Critical for reducing involuntary churn. | Med | Stripe Customer Portal or custom UI to update default payment method. Show last 4 digits + expiration. Allow adding new card via SetupIntent. |
| Dunning/retry for failed payments | Failed payments are the #1 cause of involuntary subscription churn. Stripe handles retries automatically but the customer experience requires emails and grace periods. | Low-Med | Stripe Smart Retries handles the retry logic. Build: failed payment email with "update payment method" link, grace period before cancellation (configurable, typically 7-14 days), visual indicator in customer dashboard showing payment issue. |

### SEO Preservation (Migration)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 301 redirects from Shopify URL patterns | Without redirects, all existing Google rankings are lost. Shopify uses `/products/slug` and `/collections/slug`; Mercora uses `/product/slug` and `/category/slug`. | Low | Map: `/products/*` to `/product/*`, `/collections/*` to `/category/*`, `/pages/*` to `/*`. Implement in Next.js middleware or `next.config.ts` redirects. Also handle `/collections/all`, Shopify's default "all products" page. |
| Dynamic sitemap.xml | Google needs a sitemap to discover all product, category, and CMS pages. Shopify auto-generates one; the new platform must too. | Low | Generate XML sitemap at `/sitemap.xml` listing all active products, categories, and CMS pages with `lastmod` dates. Use Next.js `sitemap.ts` convention (App Router supports this natively). |
| Product page meta tags | Google uses title, description, OG tags, and Twitter cards for search results and social sharing. Shopify sets these automatically. | Low | `<title>`, `<meta name="description">`, `og:title`, `og:description`, `og:image`, `og:type` (product), `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`. Use Next.js `generateMetadata` in product page. |
| JSON-LD structured data | Google uses structured data for rich results (product cards with price, availability, reviews in search). Significant SEO advantage. | Med | Product schema: name, description, image, sku, brand, offers (price, availability, priceCurrency), aggregateRating. Organization schema on homepage. BreadcrumbList schema on all pages. Use `<script type="application/ld+json">` in page head. |
| Canonical URLs | Prevents duplicate content penalties. Shopify sets canonical URLs automatically. | Low | Set `<link rel="canonical">` on every page. Especially important for products accessible via multiple category paths. |
| Dynamic robots.txt | Controls search engine crawling. Must exist for proper SEO. | Low | Serve at `/robots.txt`. Allow all product/category pages, disallow admin, API, and checkout routes. Include sitemap URL. Use Next.js `robots.ts` convention. |

### Shopify Data Migration

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Product + variant import | Without products, there is no store. ~30 products with variants need exact mapping. | Med | Export from Shopify Admin API (REST or GraphQL) or CSV export. Map Shopify product fields to Mercora MACH Product schema. Preserve: title, description (HTML), variants (price, SKU, weight, inventory), images, tags, product type, status. Shopify product IDs stored in `external_references` for traceability. |
| Product image migration | Products without images are unsellable. | Med | Download all Shopify CDN images, re-upload to Cloudflare R2 under `products/` prefix. Update image references in product records. Verify all images load through Cloudflare Image Resizing CDN. |
| Category/collection mapping | Shopify "collections" = Mercora "categories". Must maintain product-category assignments. | Low | Map Shopify manual and smart collections to Mercora categories. Preserve: title, description, image, sort order. Map product-collection relationships. |
| Customer import | Existing customers must be able to log in and see their history. ~1K customers. | Med | Export customers from Shopify. Create Clerk user accounts (email-based). Cannot migrate Shopify passwords -- trigger password reset flow for all migrated customers. Store Shopify customer ID in Clerk metadata and/or `external_references` for order history linking. |
| Order history import | Customers expect to see their past orders. Losing order history feels like data loss. | Med | Export orders from Shopify. Map to Mercora order schema (id, customer_id, items, totals, status, dates, addresses). Preserve: order number, line items, financial status, fulfillment status, shipping/billing addresses, timestamps. Mark as `imported: true` in extensions to distinguish from native orders. |
| Review migration (Judge.me) | Reviews are social proof and SEO content. Losing them hurts conversion and rankings. | Med | Export from Judge.me API or Shopify admin. Map to existing `product_reviews` table (reviewer name, email, rating, title, body, verified purchase flag, date). Link to migrated product IDs. |
| CMS page migration | Existing pages (About, FAQ, etc.) must persist or customers/Google get 404s. | Low | Export Shopify pages. Map HTML content to Mercora CMS `pages` table. Preserve: title, slug, body HTML, published status. |
| Migration validation | Without verification, migrated data could have missing images, broken references, or incorrect counts. | Low | Script that compares: record counts (Shopify vs D1), spot-checks random records for field integrity, verifies all product images load from R2, confirms customer counts match between Shopify export and Clerk. |

### Subscription Admin

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Subscription dashboard with MRR | Store owners need to see subscription revenue health. MRR (Monthly Recurring Revenue) is the key metric. | Med | Display: active subscription count, MRR, churn rate (cancellations/active), new subscriptions this month. Pull from D1 subscription records (Stripe is source of truth, synced via webhooks). |
| Subscription plan management | Admin needs to configure which products are subscribable, at what frequencies, and at what discount. | Med | Per-product subscription toggle. Frequency options (with ability to add/remove). Discount percentage. Maps to Stripe Price objects (recurring interval). |
| Subscription event timeline | Admin needs to see what happened to a subscription (created, renewed, paused, failed payment, cancelled) for customer support. | Low-Med | Chronological log of all webhook events for a subscription. Stored in D1, sourced from Stripe webhook payloads. Displayed as timeline in admin subscription detail view. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI-powered product recommendations for subscribers | Use existing Cloudflare Workers AI + Vectorize to suggest complementary teas based on subscription history. "Customers who subscribe to X also love Y." | Med | Leverage existing AI/Vectorize infrastructure. Run recommendation on subscription renewal to include in renewal email or dashboard. Differentiates from cookie-cutter Shopify subscription apps. |
| Subscription gifting | Allow customers to purchase a subscription as a gift. Organic tea is a natural gift category. | High | Requires: gift recipient email, gift message, separate shipping address, configurable start date, notification to recipient. Creates a subscription under recipient's account (or pending account). Defer to post-launch -- high complexity, unclear demand without data. |
| Smart skip suggestions | Instead of just "skip next delivery," suggest rescheduling to a later date based on estimated consumption rate. | Med | Track order frequency, estimate when customer will run out, suggest optimal next delivery date rather than binary skip/don't-skip. |
| Subscription bundles/build-a-box | Let subscribers mix different tea products in a single subscription delivery. | High | Requires: multi-product subscription model, product picker UI, flexible billing (sum of component prices or flat bundle price). PROJECT.md explicitly defers curated boxes -- but build-a-box is customer-driven, not curated. Still defer this: it is architecturally different from per-product subscriptions. |
| Klaviyo-powered subscription lifecycle emails | Richer, branded lifecycle emails with dynamic content blocks, product images, and personalized recommendations. | Med | Replace basic Resend transactional emails with Klaviyo flows for subscription events. Better analytics on email engagement. Already planned post-launch per PROJECT.md; Klaviyo is already in use with existing flows. |
| Blog with SEO content | Tea education content (brewing guides, ingredient spotlights, health benefits) drives organic traffic. | Med | Already in PROJECT.md as post-launch. CMS already exists. Add: blog index page, post pages, category filtering, RSS feed, author attribution. |
| Customer account hub | Unified dashboard for orders, subscriptions, addresses, and account settings. | Med | Already in PROJECT.md as post-launch. Combines: order history, subscription management, saved addresses, payment methods, account settings. Currently these would be separate pages. |
| Wishlist / favorites | Let customers save products they want to try later or subscribe to later. | Low | Already in PROJECT.md as post-launch. DB-backed wishlist with heart icon on product cards. For a subscription tea brand, this signals intent and can drive targeted marketing. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Curated subscription boxes | PROJECT.md explicitly scopes to individual product subscriptions. Curated boxes require: curation workflow, box assembly, different pricing model, SKU management for boxes. Fundamentally different product model. | Per-product "Subscribe & Save" only. If demand emerges, evaluate as a separate product line post-launch. |
| Custom subscription billing engine | Building billing logic (retry schedules, proration, billing cycle management) is extremely error-prone and unnecessary when Stripe handles all of it. | Stripe is the billing authority. D1 is the sync layer. Never store billing state locally that contradicts Stripe. |
| Shopify-style "password protected storefront" during migration | Some migrations use a password wall during transition. For a small catalog migration, this is unnecessary complexity and kills SEO. | Do a "DNS cutover" approach: build everything, validate, then switch DNS. No interim password-protected state. |
| Real-time inventory sync with Shopify | Maintaining a bridge between Shopify and the new platform during migration adds complexity for a one-time move. | Export-import approach. Freeze Shopify orders during the brief cutover window (hours, not days). |
| OAuth social login | PROJECT.md explicitly defers. Clerk email/password is sufficient. Adding OAuth introduces: privacy policy concerns, additional Clerk configuration, UI complexity, minimal benefit for a niche tea brand. | Clerk email/password authentication. |
| Mobile app | Responsive web covers the use case. A native app for a ~30 product tea store has no ROI. | Responsive web design. PWA manifest if push notifications are desired later. |
| Gift cards (at launch) | Deferred to post-launch fast follow per PROJECT.md. Not needed for migration parity -- subscriptions are the priority. | Build within first month after launch. |
| Multi-currency support | BeauTeas is USD-only. Adding multi-currency touches: pricing, Stripe configuration, tax calculation, display formatting. Massive scope for no current need. | USD only. Stripe handles currency at the payment layer if needed later. |
| Discount stacking on subscriptions | Allowing coupon codes on top of subscription discounts creates revenue leakage and billing complexity. | Subscription discount is the discount. Do not allow additional coupon codes on subscription orders. Consider introductory pricing (first delivery discounted more) as a controlled alternative. |

## Feature Dependencies

```
Product Import  -->  Category Mapping (categories must exist before products reference them)
Product Import  -->  Image Migration (images must be in R2 before product records reference them)
Customer Import -->  Clerk Account Creation (Clerk users must exist before linking)
Order Import    -->  Customer Import (orders reference customer IDs)
Order Import    -->  Product Import (orders reference product IDs for display)
Review Import   -->  Product Import (reviews reference product IDs)

Stripe Subscription Setup  -->  Product Import (need Stripe Products/Prices for subscription products)
Subscribe & Save UI        -->  Stripe Subscription Setup (UI needs Price IDs and frequencies to display)
Subscription Checkout      -->  Stripe Subscription Setup + Subscribe & Save UI
Subscription Webhooks      -->  Subscription Schema (D1 tables must exist to store webhook data)
Subscription Lifecycle UI  -->  Subscription Webhooks (need synced data to display)
Subscription Admin         -->  Subscription Schema + Subscription Webhooks
Subscription Emails        -->  Subscription Webhooks (triggered by webhook events)
Dunning/Retry Emails       -->  Subscription Emails (subset of subscription email system)
Payment Method Management  -->  Stripe Customer Setup (customers need Stripe Customer IDs)

301 Redirects              -->  Product Import + Category Mapping (need slug mapping to build redirect rules)
JSON-LD Structured Data    -->  Product Import (needs product data to render)
Sitemap                    -->  Product Import + Category Mapping + CMS Page Import

Migration Validation       -->  All Import Steps (validates after everything is imported)
```

## MVP Recommendation

Prioritize (Launch Blockers -- all required for DNS cutover):

1. **SEO infrastructure** (sitemap, meta tags, JSON-LD, robots.txt, canonical URLs) -- Low complexity items that protect existing rankings. Do first so they can be tested early.
2. **301 redirects from Shopify URL patterns** -- Must be in place before DNS cutover or traffic from Google goes to 404 pages.
3. **Shopify data migration pipeline** (products, images, categories, customers, orders, reviews, pages) -- Everything downstream depends on having real data in the system.
4. **Migration validation** -- Verify the import before building features on top of it.
5. **Subscription schema + Stripe billing integration** -- Core revenue feature. Create D1 tables, Stripe Products/Prices, subscription creation flow.
6. **Subscribe & Save UI on product pages** -- Customer-facing subscription purchase flow.
7. **Subscription checkout flow** -- SetupIntent-based payment method collection for recurring billing.
8. **Subscription webhook handling** -- Keep D1 in sync with Stripe as the billing authority.
9. **Subscription lifecycle management** (pause/resume/skip/cancel) -- Customer self-service.
10. **Subscription email notifications** -- Transactional emails for the subscription lifecycle.
11. **Subscription admin dashboard** -- Admin visibility into MRR, active subscriptions, event timeline.
12. **Customer subscription dashboard** -- Customer-facing subscription management.
13. **Payment method management** -- Allow subscribers to update cards.
14. **Dunning/retry email flow** -- Reduce involuntary churn from failed payments.

Defer:
- **Blog system**: Post-launch. Not needed for migration parity.
- **Klaviyo integration**: Post-launch. Resend handles transactional emails at launch.
- **Customer account hub**: Post-launch. Subscription dashboard can be a standalone page initially.
- **Wishlist / Recently viewed**: Post-launch. Nice-to-have, not migration-blocking.
- **AI recommendations for subscribers**: Post-launch. Leverage existing AI infrastructure later.
- **Gift cards**: Post-launch fast follow (within first month per PROJECT.md).
- **Apple Pay domain verification**: Post-launch.

## Subscription System Design Notes

**Stripe as billing authority pattern:**
- Stripe `Subscription` object is the source of truth for billing state (active, paused, cancelled, past_due).
- D1 `subscriptions` table is a read-optimized cache synced via webhooks.
- Never make billing decisions based on D1 state alone -- always verify against Stripe when executing billing changes.
- Use Stripe's `metadata` field to store the Mercora subscription ID for webhook correlation.

**Key Stripe objects involved:**
- `Customer` -- one per Clerk user. Created when user first subscribes. Store Stripe Customer ID on the D1 customer record.
- `Product` -- one per subscribable Mercora product. Can reuse the existing Stripe Product if already created for one-time purchases.
- `Price` -- one per frequency per product (e.g., "Monthly - Lavender Tea", "Every 2 Weeks - Lavender Tea"). Type: `recurring`, interval: `week` or `month`.
- `Subscription` -- one per customer-product-frequency combination. Contains the billing schedule, payment method, and current status.
- `SetupIntent` -- used during subscription checkout to collect and save payment method without immediate charge. First invoice charges immediately after subscription creation.
- `Invoice` -- Stripe creates invoices automatically per billing cycle. Webhook events on invoices drive renewal notifications and order creation.

**Frequency mapping to Stripe intervals:**
- Every 2 weeks = `interval: "week", interval_count: 2`
- Monthly = `interval: "month", interval_count: 1`
- Every 2 months = `interval: "month", interval_count: 2`

**Subscription checkout flow (differs from one-time checkout):**
1. Customer selects "Subscribe & Save" + frequency on product page
2. Add to cart with subscription metadata (frequency, discount)
3. Checkout creates `SetupIntent` (not `PaymentIntent`) to save card
4. After card saved, create Stripe `Subscription` with saved payment method
5. Stripe immediately creates first invoice and charges
6. Webhook `customer.subscription.created` fires -- create D1 subscription record
7. Webhook `invoice.payment_succeeded` fires -- create D1 order record for first delivery
8. Subsequent invoices auto-created by Stripe per billing schedule

## SEO Migration Notes

**Critical timing:** All SEO features (redirects, sitemap, meta tags, structured data, robots.txt) must be deployed and verified BEFORE DNS cutover. If DNS points to the new site without redirects, Google indexes 404 pages within hours and rankings drop immediately.

**Shopify URL patterns to redirect:**
- `/products/{handle}` --> `/product/{handle}` (product pages)
- `/collections/{handle}` --> `/category/{handle}` (collection/category pages)
- `/collections/all` --> `/` or `/shop` (all products page)
- `/pages/{handle}` --> `/{handle}` (CMS pages)
- `/blogs/{blog}/{article}` --> TBD (if blog exists on Shopify)
- `/cart` --> `/checkout` or `/cart` (cart page)
- `/account` --> `/account` (customer account)
- `/account/login` --> Clerk sign-in page
- `/account/register` --> Clerk sign-up page

**Structured data priority:**
1. Product schema (drives rich results in Google -- price, availability, reviews)
2. Organization schema (brand identity in knowledge panel)
3. BreadcrumbList schema (breadcrumb display in search results)
4. Review/AggregateRating schema (star ratings in search results)

## Data Migration Notes

**Shopify data export methods (in order of preference):**
1. **Shopify Admin API (GraphQL)** -- Most complete, programmatic, handles pagination. Best for customers and orders.
2. **Shopify Admin API (REST)** -- Simpler for products and collections. Well-documented.
3. **Shopify CSV export** -- Quick for products but loses variant detail and rich formatting.
4. **Judge.me API** -- Separate export for reviews. Has its own REST API.

**Migration script approach (given small data scale ~1K customers, few hundred orders):**
- Sequential scripts, not parallel. No performance concerns at this scale.
- Idempotent: re-running a script should skip already-imported records (check by external_reference/Shopify ID).
- Ordered: categories first, then products + images, then customers, then orders, then reviews, then pages.
- Logged: each record logged as imported or skipped with source ID for audit trail.

**Password migration:**
- Shopify passwords are bcrypt-hashed and NOT exportable.
- All migrated customers must go through Clerk password reset.
- Options: (a) bulk invite via Clerk with password reset link, (b) detect first login attempt by migrated customer and prompt reset.
- Communicate to customers before cutover: "You'll need to reset your password on our new site."

## Sources

- Project context: `.planning/PROJECT.md` (project requirements, constraints, decisions)
- Codebase analysis: `.planning/codebase/` (STACK.md, ARCHITECTURE.md, INTEGRATIONS.md, CONCERNS.md)
- Stripe Subscription Billing: training data knowledge of Stripe Billing API (Subscriptions, Prices, Invoices, SetupIntents, webhook events). Confidence: HIGH -- Stripe's subscription API has been stable since 2020 and these patterns are well-established.
- Shopify Admin API: training data knowledge of Shopify REST/GraphQL Admin API for data export. Confidence: HIGH -- export patterns have been stable for years.
- E-commerce subscription UX patterns: training data knowledge of DTC subscription brands (Dollar Shave Club, Bluebottle Coffee, Native, Ritual, Athletic Greens). Confidence: HIGH -- these patterns are industry-standard.
- SEO migration best practices: training data knowledge of Google Search Central documentation on site migrations. Confidence: HIGH -- 301 redirect and structured data guidance has been stable.

**Confidence notes:**
- All findings in this document are based on training data (cutoff: May 2025). WebSearch and WebFetch were unavailable during research.
- Stripe API patterns and subscription billing concepts: HIGH confidence. Core Stripe Billing API has been stable since 2020. The `CloudflareStripe` fetch-based adapter is project-specific and will need implementation verification.
- Shopify export capabilities: HIGH confidence. Admin API and CSV export have been stable features for years.
- SEO best practices: HIGH confidence. Google's guidance on site migrations and structured data has been consistent for years.
- Subscription UX patterns (Subscribe & Save, lifecycle management): HIGH confidence. These are industry-standard patterns used by every major DTC subscription brand.

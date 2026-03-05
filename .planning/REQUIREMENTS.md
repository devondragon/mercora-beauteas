# Requirements: BeauTeas Shopify-to-Mercora Migration

**Defined:** 2026-03-04
**Core Value:** Existing BeauTeas customers can continue buying and subscribing to teas without disruption after the Shopify migration, with no loss of search rankings or order history.

## v1 Requirements

Requirements for migration launch (DNS cutover). Each maps to roadmap phases.

### SEO

- [x] **SEO-01**: Dynamic sitemap at `/sitemap.xml` includes all products, categories, and CMS pages
- [x] **SEO-02**: Product pages have `generateMetadata()` with title, description, canonical URL, OG tags (og:title, og:description, og:image), and Twitter cards
- [x] **SEO-03**: Category pages have `generateMetadata()` with title, description, canonical URL, and OG tags
- [x] **SEO-04**: Product pages include JSON-LD `Product` schema with pricing, availability, and aggregate ratings
- [x] **SEO-05**: Root layout includes JSON-LD `Organization` schema for BeauTeas
- [x] **SEO-06**: Product and category pages include JSON-LD `Breadcrumb` schema
- [x] **SEO-07**: Shopify URLs redirect via 301 to Mercora equivalents (`/products/` → `/product/`, `/collections/` → `/category/`, `/pages/` → `/`)

### Subscription Infrastructure

- [ ] **SUBI-01**: D1 schema with `subscription_plans`, `customer_subscriptions`, and `subscription_events` tables via Drizzle ORM
- [ ] **SUBI-02**: TypeScript types for SubscriptionPlan, CustomerSubscription, and SubscriptionEvent
- [ ] **SUBI-03**: Model layer with CRUD operations for subscription plans, customer subscriptions, and stats queries
- [ ] **SUBI-04**: CloudflareStripe adapter extended with `subscriptions.create/update/cancel`, `customers.create/retrieve`, `setupIntents.create`, and `prices.create/list` methods
- [ ] **SUBI-05**: CloudflareStripe webhook signature verification fixed with proper HMAC validation (security critical)
- [ ] **SUBI-06**: Stripe webhook handler processes `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, and `customer.subscription.resumed` events
- [ ] **SUBI-07**: Stripe webhook handler processes `invoice.payment_succeeded` (creates renewal order), `invoice.payment_failed`, and `invoice.upcoming` (skip-next logic) events
- [ ] **SUBI-08**: Each webhook event updates D1 subscription state, creates audit event in `subscription_events`, and triggers appropriate email

### Subscription Customer Experience

- [ ] **SUBX-01**: Product pages show "One-time purchase" vs "Subscribe & Save" toggle with frequency dropdown (every 2 weeks, monthly, every 2 months) and discount display
- [ ] **SUBX-02**: Dedicated subscription checkout flow using Stripe SetupIntent for payment method collection (not PaymentIntent)
- [ ] **SUBX-03**: After SetupIntent confirmation, Stripe Subscription is created with selected product, frequency, and discount applied
- [ ] **SUBX-04**: Customer can pause an active subscription
- [ ] **SUBX-05**: Customer can resume a paused subscription
- [ ] **SUBX-06**: Customer can skip the next renewal
- [ ] **SUBX-07**: Customer can cancel a subscription
- [ ] **SUBX-08**: API routes for subscription actions: list own subscriptions (GET), create subscription (POST), and per-subscription actions (pause/resume/skip/cancel)
- [ ] **SUBX-09**: Email sent on subscription created, renewed, payment failed, paused, resumed, and canceled events

### Subscription Admin

- [ ] **SUBA-01**: Admin subscription dashboard showing active subscription count, MRR, and churn rate
- [ ] **SUBA-02**: Admin filterable table of all subscriptions with status, customer, product, and frequency columns
- [ ] **SUBA-03**: Admin subscription detail view with full event timeline
- [ ] **SUBA-04**: Admin UI to manage subscription plans (which products have subscription options, frequencies, discount percentage)
- [ ] **SUBA-05**: "Subscriptions" added to admin sidebar navigation

### Data Migration

- [ ] **MIGR-01**: Migration scripts in `scripts/shopify-migration/` with ETL architecture (extractors, transformers, loaders)
- [ ] **MIGR-02**: Products, variants, and product images migrated from Shopify to D1 and R2
- [ ] **MIGR-03**: Shopify collections mapped to Mercora categories
- [ ] **MIGR-04**: Customer emails imported to Clerk with `skip_password_requirement`, password reset flow prepared
- [ ] **MIGR-05**: Historical orders imported as read-only records with preserved dates and status
- [ ] **MIGR-06**: Judge.me reviews imported to `product_reviews` with product rating recalculation
- [ ] **MIGR-07**: CMS pages imported from Shopify
- [ ] **MIGR-08**: Redirect map generated from migrated data to complete SEO-07 redirects
- [ ] **MIGR-09**: Post-migration validation with record count comparison per table and spot checks

## v2 Requirements

Deferred to post-launch. Tracked but not in current roadmap.

### Blog

- **BLOG-01**: Blog post CRUD with title, slug, content, excerpt, featured image, tags, categories, and SEO fields
- **BLOG-02**: Blog listing page with pagination and category filtering
- **BLOG-03**: Blog detail page with generateMetadata(), JSON-LD ArticleJsonLd, and related posts
- **BLOG-04**: RSS feed at `/blog/feed.xml`
- **BLOG-05**: Admin blog management UI following existing pages pattern

### Klaviyo Integration

- **KLAV-01**: Fetch-based Klaviyo API client (same pattern as CloudflareStripe)
- **KLAV-02**: Event tracking: viewed product, added to cart, started checkout, placed order, subscription events
- **KLAV-03**: Newsletter signup component in footer
- **KLAV-04**: Bulk customer and catalog sync endpoint

### Customer Account

- **ACCT-01**: Account layout with sidebar navigation (Orders, Addresses, Subscriptions, Settings)
- **ACCT-02**: Enhanced order history with detailed order view and timeline
- **ACCT-03**: Saved addresses CRUD
- **ACCT-04**: Subscription management page (pause/skip/cancel from account)
- **ACCT-05**: Account settings (name, email, communication preferences)

### UX Parity

- **UXPR-01**: Search autocomplete with debounced product suggestions
- **UXPR-02**: Full search results page with category/price facets
- **UXPR-03**: Breadcrumbs on all pages (product, checkout, orders, CMS, blog)
- **UXPR-04**: Social sharing buttons on product pages
- **UXPR-05**: Recently viewed products (localStorage, horizontal scroll)
- **UXPR-06**: Wishlist with DB backing and heart icon on product cards
- **UXPR-07**: Apple Pay domain verification

## Out of Scope

| Feature | Reason |
|---------|--------|
| Gift cards | Post-launch fast follow (within first month), not migration blocker |
| Mobile app | Web-first, responsive design sufficient |
| Real-time chat | Not part of BeauTeas experience |
| Curated subscription boxes | Individual product subscriptions only per business model |
| OAuth social login | Clerk email/password sufficient for launch |
| Dynamic robots.txt | Static file adequate for launch, low priority |
| Switching from Resend | Keep for transactional, Klaviyo for marketing only |
| Subscription proration | Use Stripe defaults, customize post-launch if needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEO-01 | Phase 1 | Complete |
| SEO-02 | Phase 1 | Complete |
| SEO-03 | Phase 1 | Complete |
| SEO-04 | Phase 1 | Complete |
| SEO-05 | Phase 1 | Complete |
| SEO-06 | Phase 1 | Complete |
| SEO-07 | Phase 1 | Complete |
| SUBI-01 | Phase 2 | Pending |
| SUBI-02 | Phase 2 | Pending |
| SUBI-03 | Phase 2 | Pending |
| SUBI-04 | Phase 2 | Pending |
| SUBI-05 | Phase 2 | Pending |
| SUBI-06 | Phase 2 | Pending |
| SUBI-07 | Phase 2 | Pending |
| SUBI-08 | Phase 2 | Pending |
| SUBX-01 | Phase 3 | Pending |
| SUBX-02 | Phase 3 | Pending |
| SUBX-03 | Phase 3 | Pending |
| SUBX-04 | Phase 3 | Pending |
| SUBX-05 | Phase 3 | Pending |
| SUBX-06 | Phase 3 | Pending |
| SUBX-07 | Phase 3 | Pending |
| SUBX-08 | Phase 3 | Pending |
| SUBX-09 | Phase 3 | Pending |
| SUBA-01 | Phase 5 | Pending |
| SUBA-02 | Phase 5 | Pending |
| SUBA-03 | Phase 5 | Pending |
| SUBA-04 | Phase 5 | Pending |
| SUBA-05 | Phase 5 | Pending |
| MIGR-01 | Phase 4 | Pending |
| MIGR-02 | Phase 4 | Pending |
| MIGR-03 | Phase 4 | Pending |
| MIGR-04 | Phase 4 | Pending |
| MIGR-05 | Phase 4 | Pending |
| MIGR-06 | Phase 4 | Pending |
| MIGR-07 | Phase 4 | Pending |
| MIGR-08 | Phase 4 | Pending |
| MIGR-09 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-05 after roadmap creation*

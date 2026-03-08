# Roadmap: BeauTeas Shopify-to-Mercora Migration

## Overview

This roadmap delivers the three launch-blocking capabilities for DNS cutover: SEO foundations to preserve search rankings, a full Stripe subscription billing system (BeauTeas core revenue), and a one-time Shopify data migration pipeline. SEO ships first (zero dependencies, protects rankings from day one). Subscription infrastructure provides the schema and webhook plumbing that customer-facing subscription features and data migration both depend on. Data migration runs after schema exists and generates the redirect map that completes SEO redirects. Subscription admin ships last as internal tooling with no customer-facing impact.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: SEO Foundations** - Dynamic sitemap, metadata, JSON-LD structured data, and Shopify 301 redirect stubs to preserve search rankings
- [ ] **Phase 2: Subscription Infrastructure** - D1 schema, Stripe SDK for Workers, webhook signature fix, and webhook event handlers
- [ ] **Phase 3: Subscription Customer Experience** - Subscribe & Save UI, SetupIntent checkout, lifecycle management, and email notifications
- [x] **Phase 4: Data Migration** - Shopify ETL pipeline for products, customers, orders, reviews, images, and redirect map generation (completed 2026-03-07)
- [x] **Phase 5: Subscription Admin** - Admin dashboard with MRR metrics, subscription table, plan management, and event timeline (completed 2026-03-07)
- [ ] **Phase 6: Pre-Launch Polish** - Fix email manage URL, product name resolution, and 308->301 redirect status codes

## Phase Details

### Phase 1: SEO Foundations
**Goal**: Search engines index the Mercora storefront correctly, preserving all Shopify ranking equity through proper metadata, structured data, and redirect stubs
**Depends on**: Nothing (first phase)
**Requirements**: SEO-01, SEO-02, SEO-03, SEO-04, SEO-05, SEO-06, SEO-07
**Success Criteria** (what must be TRUE):
  1. Visiting `/sitemap.xml` returns a valid XML sitemap listing all products, categories, and CMS pages with correct URLs
  2. Product and category pages render complete OG tags, Twitter cards, and canonical URLs visible in page source
  3. Product pages include JSON-LD Product schema with pricing and availability; all pages include Organization schema; product and category pages include Breadcrumb schema
  4. Requesting any known Shopify URL pattern (`/products/slug`, `/collections/slug`, `/pages/slug`) returns a 301 redirect to the corresponding Mercora URL
  5. Google Rich Results Test validates structured data on product pages without errors
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md -- Dynamic sitemap generation and Shopify URL redirect stubs
- [ ] 01-02-PLAN.md -- Product and category page metadata (OG tags, Twitter cards, canonical URLs)
- [ ] 01-03-PLAN.md -- JSON-LD structured data (Product, Organization, BreadcrumbList)

### Phase 2: Subscription Infrastructure
**Goal**: The database schema, Stripe API integration, and webhook pipeline exist so that subscriptions can be created, billed, and synchronized between Stripe and D1
**Depends on**: Nothing (can run parallel to Phase 1, but sequenced for focus)
**Requirements**: SUBI-01, SUBI-02, SUBI-03, SUBI-04, SUBI-05, SUBI-06, SUBI-07, SUBI-08
**Success Criteria** (what must be TRUE):
  1. D1 database has `subscription_plans`, `customer_subscriptions`, and `subscription_events` tables with a Drizzle migration applied successfully
  2. Stripe Node SDK initialized with `createFetchHttpClient()` can create/update/cancel subscriptions, create/retrieve customers, create SetupIntents, and create/list prices against Stripe test mode
  3. Webhook endpoint rejects requests with invalid or missing Stripe signatures (HMAC verification via constructEventAsync)
  4. Stripe test-mode subscription lifecycle events (created, updated, deleted, paused, resumed, invoice paid, invoice failed) are processed and reflected in D1 state with audit entries in `subscription_events`
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md -- D1 subscription schema, TypeScript types, and model CRUD layer
- [ ] 02-02-PLAN.md -- Workers-compatible Stripe SDK initialization and webhook signature fix
- [ ] 02-03-PLAN.md -- Webhook event handlers for subscription lifecycle and invoice events, plus subscription emails

### Phase 3: Subscription Customer Experience
**Goal**: Customers can subscribe to tea products at a discount, manage their subscriptions, and receive email notifications for all subscription lifecycle events
**Depends on**: Phase 2
**Requirements**: SUBX-01, SUBX-02, SUBX-03, SUBX-04, SUBX-05, SUBX-06, SUBX-07, SUBX-08, SUBX-09
**Success Criteria** (what must be TRUE):
  1. Product pages show a toggle between "One-time purchase" and "Subscribe & Save" with frequency options (every 2 weeks, monthly, every 2 months) and visible discount
  2. Completing subscription checkout collects a payment method via Stripe SetupIntent (not PaymentIntent) and creates an active Stripe Subscription with the selected product, frequency, and discount
  3. A customer with an active subscription can pause, resume, skip next renewal, and cancel -- each action reflected in both Stripe and the customer-facing UI
  4. API routes exist for listing own subscriptions (GET), creating a subscription (POST), and per-subscription lifecycle actions (pause, resume, skip, cancel)
  5. Emails are sent for subscription created, renewed, payment failed, paused, resumed, and canceled events
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md -- Subscription API routes (7 endpoints) and product page Subscribe & Save toggle UI
- [ ] 03-02-PLAN.md -- Subscription checkout flow with SetupIntent and confirmation page
- [ ] 03-03-PLAN.md -- Subscription management page with pause/resume/skip/cancel actions

### Phase 4: Data Migration
**Goal**: All Shopify data (products, customers, orders, reviews, images, pages) is migrated to Mercora with a validated redirect map, ready for DNS cutover
**Depends on**: Phase 2 (subscription schema must exist for future subscription setup), Phase 1 (redirect map completes SEO-07)
**Requirements**: MIGR-01, MIGR-02, MIGR-03, MIGR-04, MIGR-05, MIGR-06, MIGR-07, MIGR-08, MIGR-09
**Success Criteria** (what must be TRUE):
  1. All ~30 Shopify products with variants and images appear in the Mercora catalog with correct pricing, inventory, and images served from R2
  2. Shopify collections are mapped to Mercora categories and products are correctly assigned
  3. Customer emails are imported into Clerk; migrated customers can trigger a password reset and log in to the new platform
  4. Historical orders are visible as read-only records with preserved dates and status
  5. Judge.me reviews appear on their corresponding product pages with recalculated aggregate ratings
  6. A redirect map generated from migrated data powers the SEO-07 301 redirects, and post-migration validation confirms record counts match across all tables
**Plans**: 3 plans

Plans:
- [ ] 04-01-PLAN.md -- ETL foundation, shared library, redirect_map schema, categories and products/variants/images migration
- [ ] 04-02-PLAN.md -- Customers (Clerk import), orders, reviews (with rating recalculation), and CMS pages migration
- [ ] 04-03-PLAN.md -- Redirect map generation, post-migration validation, orchestrator, and middleware D1 redirect lookup

### Phase 5: Subscription Admin
**Goal**: Store operators can monitor subscription health, manage plans, and investigate individual subscription histories from the admin dashboard
**Depends on**: Phase 2 (uses subscription schema and data), Phase 3 (subscriptions exist to manage)
**Requirements**: SUBA-01, SUBA-02, SUBA-03, SUBA-04, SUBA-05
**Success Criteria** (what must be TRUE):
  1. Admin dashboard displays active subscription count, MRR, and churn rate
  2. Admin can view a filterable table of all subscriptions with status, customer, product, and frequency columns
  3. Admin can click into a subscription to see its full event timeline (created, renewals, pauses, cancellations)
  4. Admin can manage subscription plans -- configuring which products offer subscriptions, available frequencies, and discount percentages
  5. "Subscriptions" link appears in the admin sidebar navigation
**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md -- Model layer extensions, admin API routes (list/detail/plans), and sidebar navigation
- [x] 05-02-PLAN.md -- Subscription dashboard page (stat cards + filterable table) and detail page (summary card + event timeline)
- [x] 05-03-PLAN.md -- Product editor subscription plan configuration section
- [ ] 05-04-PLAN.md -- Fix API-to-UI data contract mismatch (camelCase to snake_case response transformation)

### Phase 6: Pre-Launch Polish
**Goal**: Fix email content quality issues and redirect status codes identified by milestone audit before DNS cutover
**Depends on**: Phase 2 (webhook handlers), Phase 1 (redirect config)
**Requirements**: SUBI-08, SUBX-09, SEO-07 (integration quality fixes)
**Gap Closure:** Closes INT-01, INT-02, FLOW-01 from v1.0 audit + 308->301 redirect fix
**Success Criteria** (what must be TRUE):
  1. Subscription lifecycle emails contain a working "Manage Subscription" link pointing to `/subscriptions`
  2. Subscription lifecycle emails display human-readable product names (e.g., "Jasmine Green Tea") instead of internal IDs
  3. Shopify URL redirects return 301 status codes (not 308)
**Plans**: 1 plan

Plans:
- [ ] 06-01-PLAN.md -- Fix email manageUrl/productName/frequency and redirect 308->301 status codes

## Cross-Phase Dependencies

- **MIGR-08 feeds SEO-07**: The redirect map generated in Phase 4 (MIGR-08) completes the Shopify URL redirects stubbed in Phase 1 (SEO-07). Phase 1 builds the redirect middleware; Phase 4 populates it with real data.
- **SUBI-05 is security-critical**: The CloudflareStripe webhook signature fix (Phase 2) must be deployed before any subscription webhooks go live. Phase 3 must not launch without Phase 2 complete.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. SEO Foundations | 0/3 | Planning complete | - |
| 2. Subscription Infrastructure | 0/3 | Planning complete | - |
| 3. Subscription Customer Experience | 0/3 | Planning complete | - |
| 4. Data Migration | 3/3 | Complete   | 2026-03-07 |
| 5. Subscription Admin | 4/4 | Complete   | 2026-03-07 |
| 6. Pre-Launch Polish | 0/1 | Planning complete | - |

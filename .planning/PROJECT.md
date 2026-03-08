# BeauTeas: Shopify to Mercora Migration

## What This Is

BeauTeas.com sells organic skincare teas (~30 products) and is migrating from Shopify to the Mercora e-commerce platform (Next.js 15 / Cloudflare Workers / D1 / Stripe). The Mercora codebase already handles product catalog, cart, checkout, orders, reviews, admin dashboard, AI search, and payments. The migration adds subscription support (core revenue), preserves SEO rankings, and moves all Shopify data to the new platform.

## Core Value

Existing BeauTeas customers can continue buying and subscribing to teas without disruption after the Shopify migration, with no loss of search rankings or order history.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — existing Mercora codebase capabilities. -->

- ✓ Product catalog with MACH data model (~30 products, variants, pricing, inventory) — existing
- ✓ Category browsing and product detail pages — existing
- ✓ Shopping cart with localStorage persistence (Zustand) — existing
- ✓ Checkout flow with Stripe payments (PaymentIntent) — existing
- ✓ Order creation, confirmation emails (Resend), order history — existing
- ✓ Product reviews with ratings — existing
- ✓ Admin dashboard (products, orders, categories, reviews, settings, CMS pages) — existing
- ✓ AI-powered product search (Cloudflare Vectorize + Workers AI) — existing
- ✓ MCP server for AI agent commerce — existing
- ✓ User authentication (Clerk) — existing
- ✓ CMS pages system — existing
- ✓ Image storage and CDN delivery (Cloudflare R2 + Image Resizing) — existing
- ✓ Brand configuration system (fonts, colors, identity) — existing
- ✓ Promotional banner and discount codes — existing
- ✓ Shipping rate calculation — existing
- ✓ Tax calculation via Stripe Tax — existing

### Active

<!-- Current scope. Building toward these. -->

**Launch Blockers (DNS cutover requires all three):**

- [ ] Dynamic sitemap generation (products, categories, CMS pages)
- [ ] Product/category page metadata (OG tags, canonical URLs, Twitter cards)
- [ ] JSON-LD structured data (Product, Organization, Breadcrumb schemas)
- [ ] Shopify URL 301 redirects (/products/ -> /product/, /collections/ -> /category/, etc.)
- [ ] Dynamic robots.txt
- [ ] Subscription system — schema, Stripe recurring billing, webhook handling
- [ ] Subscription customer UI — "Subscribe & Save" selector on product pages, frequency picker
- [ ] Subscription checkout flow — dedicated flow with SetupIntent for payment method collection
- [ ] Subscription lifecycle management — pause, resume, skip, cancel
- [ ] Subscription email notifications — created, renewed, payment failed, paused, resumed, canceled
- [ ] Subscription admin UI — dashboard with MRR, plan management, event timeline
- [ ] Shopify data migration — products, variants, images, categories, customers, orders, reviews, pages
- [ ] Customer import to Clerk with password reset flow
- [ ] Migration validation — record count verification, spot checks, image loading

**Post-Launch:**

- [ ] Blog system (posts, categories, RSS feed, admin CRUD)
- [ ] Klaviyo integration (event tracking, newsletter signup, catalog sync)
- [ ] Customer account pages (dashboard, orders, addresses, subscriptions, settings)
- [ ] Search improvements (autocomplete, faceted search results page)
- [ ] Breadcrumbs on all pages
- [ ] Social sharing buttons on product pages
- [ ] Recently viewed products
- [ ] Wishlist (DB-backed, heart icon on product cards)
- [ ] Apple Pay domain verification

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Gift cards — deferred to post-launch fast follow (within first month)
- Mobile app — web-first, responsive design sufficient
- Real-time chat — not part of BeauTeas experience
- Curated subscription boxes — individual product subscriptions only
- OAuth social login — Clerk email/password sufficient
- Switching away from Resend — keep for transactional, Klaviyo for marketing only

## Context

- **Existing platform:** Mercora is a fully functional e-commerce platform with 6 DB migrations already applied. The codebase follows MACH Alliance patterns with Drizzle ORM on Cloudflare D1.
- **Shopify data scale:** Small — under 1K customers, a few hundred orders. Migration scripts can run sequentially without performance concerns.
- **Subscriptions:** Core revenue for BeauTeas. Individual product subscriptions at 3 frequencies (every 2 weeks, monthly, every 2 months) with a discount (e.g., 10% off). Stripe manages billing cycles.
- **Klaviyo:** Already in use with existing flows. Integration is about wiring events from the new platform, not building flows from scratch.
- **Stripe pattern:** Must use fetch-based `CloudflareStripe` adapter (`lib/stripe.ts`), not the Node.js SDK, due to Cloudflare Workers runtime constraints.
- **Reviews source:** Currently on Judge.me (Shopify app). Reviews will be migrated to the existing `product_reviews` table.
- **Codebase map:** Full analysis available at `.planning/codebase/` (STACK.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md, CONCERNS.md).

## Constraints

- **Runtime:** Cloudflare Workers edge runtime — no Node.js-specific APIs, no long-running processes
- **Stripe SDK:** Must use fetch-based `CloudflareStripe` pattern for all new Stripe integrations (subscriptions)
- **Dependencies:** No new npm packages — use existing packages (Stripe, Clerk, Drizzle, Zustand, Resend) or fetch-based API clients
- **SEO:** Must preserve all Shopify search rankings — 301 redirects, proper metadata, structured data required before DNS cutover
- **Passwords:** Cannot migrate Shopify passwords — must use Clerk password reset flow for all migrated customers

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Launch gate = SEO + Subscriptions + Data Migration | These three are the minimum for DNS cutover without losing customers or rankings | — Pending |
| Individual product subscriptions only | BeauTeas model is per-product subscribe & save, not curated boxes | — Pending |
| Stripe as subscription billing authority | D1 is sync layer via webhooks, Stripe manages billing cycles and payment retries | — Pending |
| Keep Resend for transactional, Klaviyo for marketing | Already using both — don't consolidate, just wire up events from new platform | — Pending |
| Gift cards as post-launch fast follow | Not needed for migration, but customers use them — add within first month | — Pending |
| Blog/accounts/UX features are post-launch | Can operate without these initially — Shopify parity not required for cutover | — Pending |
| No new npm dependencies | Keeps bundle small, avoids Cloudflare Workers compatibility issues | — Pending |

---
*Last updated: 2026-03-04 after initialization*

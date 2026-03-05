# Research Summary: BeauTeas Subscriptions, SEO, and Data Migration

**Domain:** E-commerce platform extension -- adding subscriptions, SEO foundations, and Shopify data migration
**Researched:** 2026-03-04
**Overall confidence:** MEDIUM (all web research tools unavailable; findings based on thorough codebase analysis + training data through May 2025)

## Executive Summary

This milestone adds three capabilities to an existing, fully functional Next.js 15 / Cloudflare Workers / D1 / Stripe e-commerce platform: (1) Stripe subscription billing for "Subscribe & Save" tea purchases, (2) SEO foundations required to preserve search rankings during the Shopify-to-Mercora DNS cutover, and (3) a one-time data migration pipeline to move products, customers, orders, reviews, and images from Shopify to the new platform.

The critical finding is that **no new npm dependencies are needed**. The existing Stripe SDK (v18.4.0) includes full subscription support. Next.js 15's built-in Metadata API, `sitemap.ts`, and `robots.ts` conventions handle all SEO requirements natively. The `tsx` script runner (already in devDependencies) provides the migration script infrastructure. All three work streams plug into established codebase patterns without architectural changes.

The most significant technical risk is the `CloudflareStripe` fetch adapter in `lib/stripe.ts`, which currently implements only 3 of the ~15 Stripe API methods needed for subscriptions, and has a **broken webhook verification** method that silently accepts forged events. This must be addressed before any subscription webhooks go live. A secondary risk is the `force-dynamic` export on the root layout, which prevents edge caching of public pages and hurts SEO-relevant performance metrics.

The subscription system follows a well-established pattern: Stripe is the billing authority, D1 is a synchronized read cache updated via webhooks. This is explicitly stated as a project decision in PROJECT.md and is the correct approach. The data migration is small-scale (~30 products, ~1K customers, a few hundred orders) and can be handled by sequential local scripts without performance concerns.

## Key Findings

**Stack:** No new dependencies needed. Stripe SDK 18.4.0 (subscriptions), Next.js 15 Metadata API (SEO), tsx 4.20.3 (migration scripts) -- all already installed.

**Architecture:** Three independent work streams that integrate into existing layers. Subscriptions add a new D1 schema + models + API routes + webhook handlers. SEO adds `generateMetadata` exports and file conventions. Migration adds local scripts that run outside the application.

**Critical pitfall:** The `CloudflareStripe` adapter's `webhooks.constructEvent()` does NOT verify signatures -- it just JSON.parse()s the payload. In production, subscription webhook handlers using this path would accept forged Stripe events. Must be fixed before subscriptions go live.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **SEO Foundations** -- Lowest complexity, highest risk if missing
   - Addresses: sitemap.xml, robots.txt, generateMetadata on product/category pages, JSON-LD Product schema, canonical URLs, Shopify 301 redirects stub
   - Avoids: SEO ranking loss from missing metadata at DNS cutover (Pitfall 4, 13)
   - Rationale: Can be developed and verified independently with no external API dependencies. Must be in place before DNS cutover. Static analysis tools (Google Rich Results Test) provide immediate verification.

2. **Subscription System Infrastructure** -- Most architecturally complex
   - Addresses: D1 schema (subscription_plans, customer_subscriptions, subscription_events), CloudflareStripe adapter extensions, Stripe webhook handler expansion
   - Avoids: Billing state authority confusion (Pitfall 5), broken webhook verification (Pitfall 1), missing webhook events (Pitfall 3)
   - Rationale: Foundation that all subscription features depend on. Needs early start for Stripe test mode integration testing.

3. **Subscription Customer Experience** -- Visible features
   - Addresses: Subscribe & Save UI on product pages, subscription checkout (SetupIntent flow), lifecycle management (pause/resume/cancel), email notifications
   - Avoids: PaymentIntent misuse for subscriptions (Pitfall 2), discount stacking issues (Pitfall 11)
   - Rationale: Depends on infrastructure from phase 2. Can be tested against Stripe test mode.

4. **Shopify Data Migration** -- One-time pipeline
   - Addresses: Product/variant/image import, customer-to-Clerk migration, order history, Judge.me review import, URL redirect map generation
   - Avoids: Customer identity mismatch (Pitfall 7), Shopify image breakage (Pitfall 15), slug mismatch in redirects (Pitfall 10)
   - Rationale: Should run close to DNS cutover to minimize data staleness. Populates the redirect map that completes SEO phase work. Requires Shopify API access tokens.

5. **Subscription Admin & Polish** -- Post-infrastructure
   - Addresses: Admin subscription dashboard (MRR, churn), subscription plan management, event timeline
   - Avoids: Over-scoping the launch-blocking work
   - Rationale: Nice-to-have for business visibility but not required for customer-facing launch.

**Phase ordering rationale:**
- SEO first because it has zero dependencies on other phases and protects rankings
- Subscription infrastructure before customer experience because UI depends on schema + API
- Migration after subscription infrastructure so the schema exists for post-migration subscription setup
- Admin polish last because it has no external-facing impact

**Research flags for phases:**
- Phase 2 (Subscription Infrastructure): Needs deeper research -- verify if Stripe Node.js SDK v18 works in Cloudflare Workers with `nodejs_compat` flag. If it does, the entire CloudflareStripe adapter can be deprecated, massively simplifying the work.
- Phase 4 (Data Migration): Needs deeper research -- verify current Shopify Admin API version string, Clerk Backend API for user creation parameters, and Judge.me API export format. All came from training data.
- Phase 1 (SEO): Standard patterns, unlikely to need further research. Next.js Metadata API is well-documented and stable.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | All packages verified from package.json. External API versions (Shopify, Clerk Backend) need verification. |
| Features | HIGH | Feature landscape derived from PROJECT.md requirements and industry-standard DTC subscription patterns. |
| Architecture | MEDIUM-HIGH | Patterns follow existing codebase conventions. Stripe subscription flow is standard. CloudflareStripe Worker compatibility needs testing. |
| Pitfalls | HIGH | Most critical pitfalls verified directly in codebase (broken webhook verification, self-referential HTTP calls, missing metadata). |

## Gaps to Address

- **Stripe Node.js SDK in Workers:** Can `stripe` v18.4.0 run in Cloudflare Workers with `nodejs_compat`? If yes, deprecate CloudflareStripe entirely. This is the single highest-leverage unknown.
- **Shopify Admin API version:** The `2024-10` version string is from training data. Verify current stable version before writing migration scripts.
- **Clerk Backend API user creation:** Exact parameters for `POST /users` with `skip_password_requirement` need verification against current Clerk docs.
- **Judge.me API:** Export endpoints and response format need verification.
- **OpenNext + force-dynamic caching behavior:** How does `force-dynamic` at root layout interact with Cloudflare edge caching via OpenNext? Does R2 incremental cache still function?
- **Stripe API version in CloudflareStripe:** Uses `2020-08-27` (5+ years old) while the Node SDK uses `2025-08-27.basil`. If CloudflareStripe is extended for subscriptions, it needs the newer API version.

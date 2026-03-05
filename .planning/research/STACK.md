# Technology Stack: Subscriptions, SEO, and Data Migration

**Project:** BeauTeas Shopify-to-Mercora Migration (Milestone 2)
**Researched:** 2026-03-04
**Scope:** What to add to the existing Next.js 15 / Cloudflare Workers / D1 / Stripe platform
**Overall Confidence:** MEDIUM (unable to verify versions against live docs; all recommendations based on training data through early 2025 and codebase analysis)

## Constraint Recap

The PROJECT.md enforces **no new npm dependencies**. Every recommendation below must work with the existing `package.json` or use fetch-based API clients. The existing stack is:

- Next.js 15.3.5 (App Router, `force-dynamic` root)
- Cloudflare Workers (edge runtime, no Node.js-specific APIs)
- Cloudflare D1 (SQLite via Drizzle ORM 0.35.2)
- Stripe 18.4.0 (SDK + CloudflareStripe fetch adapter)
- Clerk 6.25.5 (auth)
- Resend 4.8.0 (transactional email)
- React Email 0.4.0 (email templates)

---

## 1. Stripe Subscriptions

**Confidence:** MEDIUM -- Stripe Billing API is stable and well-known; the `stripe` v18 SDK in `package.json` includes full subscription support. Exact API version strings should be verified against Stripe's changelog before implementation.

### What to Use

| Component | Technology | Version | Purpose | Rationale |
|-----------|-----------|---------|---------|-----------|
| Subscription creation | Stripe Subscriptions API | Included in `stripe` 18.4.0 | Create recurring billing | Already installed; native subscription support via `stripe.subscriptions.create()` |
| Payment method collection | Stripe SetupIntent | Included in `stripe` 18.4.0 | Collect card for future billing | SetupIntent (not PaymentIntent) is correct for subscriptions -- collects payment method without an immediate charge |
| Client-side payment form | `@stripe/react-stripe-js` | 3.9.0 (installed) | Payment Element for card collection | Already installed; `<PaymentElement>` handles SCA/3DS automatically |
| Webhook processing | Stripe Webhooks | Existing endpoint | Subscription lifecycle events | Extend existing `app/api/webhooks/stripe/route.ts` |
| Subscription state sync | D1 `subscriptions` table | Drizzle ORM 0.35.2 | Local subscription records | D1 as read model, Stripe as source of truth for billing |
| CloudflareStripe adapter | `lib/stripe.ts` | Existing | Workers-compatible subscription calls | Extend existing `CloudflareStripe` class with subscription methods |

### Architecture Decision: Stripe as Billing Authority

Stripe manages all billing logic (cycles, retries, proration). D1 stores a **sync copy** of subscription state updated via webhooks. This is the standard pattern and avoids reimplementing billing logic.

**Flow:**
1. Customer selects "Subscribe & Save" on product page
2. Frontend creates a SetupIntent via `POST /api/subscriptions/setup-intent`
3. Customer enters card in `<PaymentElement>`
4. On success, backend creates Stripe Subscription with the confirmed PaymentMethod
5. Webhook `customer.subscription.created` fires -> D1 record created
6. Recurring: `invoice.payment_succeeded` -> D1 updated, confirmation email sent
7. Failed: `invoice.payment_failed` -> D1 updated, failure email sent

### Stripe API Endpoints Needed

| Stripe API | When Used | Notes |
|------------|-----------|-------|
| `stripe.customers.create/retrieve` | Subscription creation | Link Clerk userId to Stripe Customer via metadata |
| `stripe.setupIntents.create` | Checkout flow | `usage: 'off_session'` for recurring billing |
| `stripe.subscriptions.create` | After SetupIntent confirmed | Set `default_payment_method`, `items`, `metadata` |
| `stripe.subscriptions.update` | Pause/resume/change frequency | Update `pause_collection` or swap Price |
| `stripe.subscriptions.cancel` | Cancel flow | Use `cancel_at_period_end: true` for graceful cancel |
| `stripe.prices.create` | One-time setup | Create recurring Prices for each product/frequency combo |

### Stripe Webhook Events to Handle

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Insert D1 subscription record |
| `customer.subscription.updated` | Update D1 status (active/paused/past_due) |
| `customer.subscription.deleted` | Mark D1 subscription as canceled |
| `invoice.payment_succeeded` | Update D1 `last_payment_at`, send renewal email |
| `invoice.payment_failed` | Update D1 status to `past_due`, send failure email |
| `invoice.upcoming` | (Optional) Send upcoming renewal reminder |

### CloudflareStripe Extension

The existing `CloudflareStripe` class in `lib/stripe.ts` only supports `createPaymentIntent` and `calculateTax`. For subscriptions in the Workers runtime, extend it with:

```typescript
// Methods to add to CloudflareStripe class
async createCustomer(params: { email: string; metadata: Record<string, string> }) { ... }
async createSetupIntent(params: { customer: string; usage: string; metadata?: Record<string, string> }) { ... }
async createSubscription(params: { customer: string; items: Array<{ price: string }>; default_payment_method: string; metadata?: Record<string, string> }) { ... }
async updateSubscription(subscriptionId: string, params: Record<string, any>) { ... }
async cancelSubscription(subscriptionId: string, params: { cancel_at_period_end?: boolean }) { ... }
async listSubscriptions(params: { customer: string; status?: string }) { ... }
```

All use the same `this.request()` pattern with URL-encoded form data to `https://api.stripe.com/v1/`.

### D1 Schema Addition

New `subscriptions` table (migration `0007_add_subscriptions.sql`):

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | `SUB-XXXXXXXX` format |
| `customer_id` | TEXT | FK to `customers.id` |
| `clerk_user_id` | TEXT | Clerk user ID for fast lookups |
| `stripe_subscription_id` | TEXT UNIQUE | Stripe sub ID (`sub_xxx`) |
| `stripe_customer_id` | TEXT | Stripe customer ID (`cus_xxx`) |
| `product_id` | TEXT | Which product is subscribed |
| `variant_id` | TEXT | Which variant |
| `stripe_price_id` | TEXT | Which Stripe Price |
| `frequency` | TEXT | `biweekly`, `monthly`, `bimonthly` |
| `status` | TEXT | `active`, `paused`, `past_due`, `canceled`, `trialing` |
| `quantity` | INTEGER | Default 1 |
| `discount_percent` | INTEGER | e.g., 10 for 10% off |
| `current_period_start` | TEXT | ISO 8601 |
| `current_period_end` | TEXT | ISO 8601 |
| `cancel_at_period_end` | INTEGER | 0/1 boolean |
| `canceled_at` | TEXT | ISO 8601 |
| `last_payment_at` | TEXT | ISO 8601 |
| `next_payment_at` | TEXT | ISO 8601 |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

### What NOT to Use

| Rejected Approach | Why |
|-------------------|-----|
| Stripe Checkout Sessions for subscriptions | The app already has a custom checkout flow; Checkout Sessions redirect to Stripe-hosted pages, breaking the UX |
| Stripe Billing Portal | Redirects to Stripe-hosted portal; build custom subscription management UI instead for brand consistency |
| PaymentIntent for initial subscription | SetupIntent is correct when the first invoice might be $0 (trial) or when you want to decouple card collection from first charge |
| New billing library (e.g., `@stripe/billing`) | No new dependencies constraint; Stripe SDK already has everything needed |
| Storing billing cycle logic in D1 | Stripe handles retry schedules, grace periods, proration -- don't reimplement |

---

## 2. SEO Foundations

**Confidence:** MEDIUM-HIGH -- Next.js App Router SEO features (Metadata API, sitemap.ts, robots.ts) are well-established and stable in Next.js 14+. The patterns described are core Next.js features, not third-party. JSON-LD via script tag injection is the standard approach.

### What to Use

| Component | Technology | Version | Purpose | Rationale |
|-----------|-----------|---------|---------|-----------|
| Dynamic metadata | Next.js `generateMetadata` | Next.js 15.3.5 (installed) | OG tags, title, description, canonical URLs | Built-in App Router feature; no dependencies needed |
| Sitemap | `app/sitemap.ts` file convention | Next.js 15.3.5 | Dynamic XML sitemap | Built-in; exports `MetadataRoute.Sitemap` array |
| Robots.txt | `app/robots.ts` file convention | Next.js 15.3.5 | Dynamic robots.txt | Built-in; exports `MetadataRoute.Robots` object |
| JSON-LD structured data | `<script type="application/ld+json">` | HTML standard | Product, Organization, Breadcrumb schemas | No library needed; render JSON in script tag from server components |
| 301 redirects | Next.js `redirects` in `next.config.ts` | Next.js 15.3.5 | Shopify URL preservation | Built-in config; handles `/products/X` -> `/product/X` etc. |
| Canonical URLs | `generateMetadata` `alternates.canonical` | Next.js 15.3.5 | Prevent duplicate content | Part of Metadata API |
| Twitter Cards | `generateMetadata` `twitter` field | Next.js 15.3.5 | Social sharing cards | Part of Metadata API |

### Implementation Patterns

**`generateMetadata` on product pages** -- export an async `generateMetadata` function from `app/product/[slug]/page.tsx` that fetches the product and returns title, description, openGraph (with image from R2), twitter card, and canonical URL metadata.

**`app/sitemap.ts` (dynamic)** -- export a default async function returning a `MetadataRoute.Sitemap` array. Query D1 for all products, categories, and CMS pages. Map each to `{ url, lastModified, changeFrequency, priority }`. Next.js serves this automatically at `/sitemap.xml`.

**`app/robots.ts`** -- export a default function returning a `MetadataRoute.Robots` object with rules allowing `/` and disallowing `/admin/`, `/api/`, `/checkout/`. Include `sitemap` URL pointing to `https://beauteas.com/sitemap.xml`.

**JSON-LD structured data** -- render a `<script type="application/ld+json">` tag in product page server components with Product schema (name, description, image, offers with price/currency/availability). Also add Organization schema to the root layout and Breadcrumb schema to category/product pages. Content is server-generated from trusted database data, not user input.

**301 Redirects for Shopify URLs** -- add `async redirects()` to `next.config.ts` with permanent redirects:
- `/products/:slug` -> `/product/:slug`
- `/collections/:slug` -> `/category/:slug`
- `/pages/:slug` -> `/:slug`

### What NOT to Use

| Rejected Approach | Why |
|-------------------|-----|
| `next-seo` package | Next.js 15 Metadata API makes it redundant; also violates no-new-deps constraint |
| `next-sitemap` package | Built-in `sitemap.ts` convention handles this natively |
| `schema-dts` for JSON-LD types | Nice-to-have but adds a dependency; hand-typed JSON-LD objects are fine for Product/Organization/Breadcrumb |
| Static `public/robots.txt` | Dynamic `app/robots.ts` is better -- can conditionally block crawling in dev/staging |
| `@vercel/og` for OG images | Runs on Node.js runtime; not compatible with Cloudflare Workers. Use static OG images from R2 instead |

---

## 3. Shopify Data Migration

**Confidence:** MEDIUM -- Shopify Admin API patterns are well-known. The specific approach (local TypeScript scripts using `tsx` runner) aligns perfectly with the existing codebase patterns. Shopify API version strings should be verified.

### What to Use

| Component | Technology | Version | Purpose | Rationale |
|-----------|-----------|---------|---------|-----------|
| Shopify data export | Shopify Admin REST API | 2024-10 or later | Export products, customers, orders | REST API is simpler than GraphQL for one-time bulk export; use `fetch` directly |
| Migration scripts | TypeScript via `tsx` | 4.20.3 (installed) | Transform and load data | `tsx` already in devDependencies; used for token management scripts |
| Customer import | Clerk Backend API | Via `fetch` | Create Clerk users from Shopify customers | Clerk Backend API for user creation; no additional SDK needed |
| Image migration | Cloudflare R2 API | Via `wrangler` or `fetch` | Move product images from Shopify CDN to R2 | Download from Shopify CDN, upload to R2 bucket |
| Data validation | Custom TypeScript | N/A | Verify record counts and data integrity | Simple count comparisons and spot checks |
| Review export | Judge.me API | Via `fetch` | Export product reviews | Judge.me has a simple REST API for review export |
| Drizzle ORM | `drizzle-orm` 0.35.2 (installed) | D1 writes | Insert migrated data | Existing ORM for type-safe inserts |

### Migration Script Architecture

Scripts run **locally** via `tsx` (already in devDependencies), not in Cloudflare Workers. This avoids Workers runtime constraints (CPU time limits, no long-running processes). Scripts connect to D1 via Wrangler's local proxy or the Cloudflare D1 REST API.

```
scripts/
  migrate/
    01-export-shopify-products.ts    # Fetch from Shopify Admin API -> JSON files
    02-export-shopify-customers.ts   # Fetch customers -> JSON files
    03-export-shopify-orders.ts      # Fetch orders -> JSON files
    04-export-judgeme-reviews.ts     # Fetch reviews from Judge.me -> JSON files
    05-download-images.ts            # Download product/category images from Shopify CDN
    06-transform-products.ts         # Shopify format -> Mercora MACH format
    07-transform-customers.ts        # Shopify customers -> Mercora customers
    08-transform-orders.ts           # Shopify orders -> Mercora orders
    09-load-products.ts              # Insert into D1 via Drizzle
    10-load-customers.ts             # Insert into D1 + create Clerk users
    11-load-orders.ts                # Insert into D1
    12-load-reviews.ts               # Insert into D1 product_reviews table
    13-upload-images.ts              # Upload to R2 bucket
    14-validate.ts                   # Count verification + spot checks
    15-generate-redirects.ts         # Generate Shopify URL -> Mercora URL redirect map
```

**Package.json script additions:**
```json
{
  "migrate:export": "tsx scripts/migrate/01-export-shopify-products.ts && ...",
  "migrate:transform": "tsx scripts/migrate/06-transform-products.ts && ...",
  "migrate:load": "tsx scripts/migrate/09-load-products.ts && ...",
  "migrate:validate": "tsx scripts/migrate/14-validate.ts",
  "migrate:all": "npm run migrate:export && npm run migrate:transform && npm run migrate:load && npm run migrate:validate"
}
```

### Shopify Admin API Endpoints

| Endpoint | Data | Notes |
|----------|------|-------|
| `GET /admin/api/2024-10/products.json` | Products + variants + images | Paginate with `limit=250` + `page_info` cursor |
| `GET /admin/api/2024-10/customers.json` | Customers + addresses | Under 1K customers, simple pagination |
| `GET /admin/api/2024-10/orders.json` | Orders + line items | `status=any` to get all orders |
| `GET /admin/api/2024-10/custom_collections.json` | Collections/categories | Map to Mercora categories |
| `GET /admin/api/2024-10/pages.json` | CMS pages | Map to Mercora pages table |

### Data Transformation Map

| Shopify Entity | Mercora Table | Key Mappings |
|----------------|--------------|--------------|
| Product | `products` | `title` -> `name`, `handle` -> `slug`, `body_html` -> `description`, `product_type` -> `type` |
| Variant | `product_variants` | `price` -> price object, `sku` -> `sku`, `inventory_quantity` -> inventory record |
| Customer | `customers` + Clerk | `email` -> Clerk user + `customers.person.email`, `addresses` -> `customers.addresses` |
| Order | `orders` | `financial_status` -> `payment_status`, `fulfillment_status` -> `status`, `line_items` -> `items` JSON |
| Collection | `categories` | `title` -> `name`, `handle` -> `slug`, `body_html` -> `description` |
| Page | `pages` | `title` -> `title`, `handle` -> `slug`, `body_html` -> `content` |
| Judge.me Review | `product_reviews` | `rating` -> `rating`, `body` -> `content`, `reviewer.name` -> `reviewer_name` |

### Customer Migration to Clerk

Shopify password hashes cannot be migrated to Clerk. The approach:

1. Export Shopify customers (email, name, addresses)
2. Create Clerk users via Backend API (`POST /users`) with `skip_password_requirement: true`
3. Store Clerk `userId` in `customers.authentication` JSON field
4. On first login, Clerk triggers password reset flow automatically
5. Map Shopify customer IDs to new Mercora customer IDs in `customers.external_references`

### D1 Access for Migration Scripts

Two options for local scripts writing to D1:

1. **Wrangler D1 execute** (simpler): `wrangler d1 execute beauteas-db-dev --command "INSERT INTO..."`
2. **D1 HTTP API** (programmatic): Use Cloudflare API `POST /accounts/{account_id}/d1/database/{db_id}/query` with fetch

Recommend option 2 for bulk operations -- allows batching and better error handling within TypeScript scripts.

### What NOT to Use

| Rejected Approach | Why |
|-------------------|-----|
| Shopify GraphQL Admin API | REST is simpler for a one-time migration; GraphQL adds complexity for no benefit here |
| `@shopify/shopify-api` npm package | Violates no-new-deps; use raw `fetch` with API token |
| Cloudflare Workers for migration scripts | Workers have CPU time limits (30s-50ms depending on plan); migration needs sequential bulk operations |
| CSV export from Shopify admin UI | Loses data relationships (variant-to-product, order-to-customer); API preserves references |
| `@clerk/backend` npm package | Violates no-new-deps; use Clerk Backend API directly via `fetch` |
| Wrangler D1 local SQLite for testing | Use the actual dev D1 database to validate migration against real constraints |

---

## 4. Subscription Email Notifications

**Confidence:** HIGH -- Resend and React Email are already integrated. This is just adding new email templates following existing patterns.

### What to Use

| Component | Technology | Version | Purpose | Rationale |
|-----------|-----------|---------|---------|-----------|
| Email sending | Resend | 4.8.0 (installed) | Send subscription lifecycle emails | Already integrated in `lib/utils/email.ts` |
| Email templates | React Email | 0.4.0 (installed) | Build subscription email HTML | Already used for `OrderConfirmation.tsx` |
| Template location | `emails/` directory | N/A | Store subscription email templates | Follows existing pattern |

### Templates Needed

| Template | Trigger | Content |
|----------|---------|---------|
| `SubscriptionCreated.tsx` | `customer.subscription.created` webhook | Welcome, product, frequency, next billing date |
| `SubscriptionRenewed.tsx` | `invoice.payment_succeeded` webhook | Renewal confirmation, amount charged, next date |
| `SubscriptionPaymentFailed.tsx` | `invoice.payment_failed` webhook | Payment failed, update card link, retry schedule |
| `SubscriptionPaused.tsx` | User pauses via UI | Confirmation, how to resume |
| `SubscriptionResumed.tsx` | User resumes via UI | Confirmation, next billing date |
| `SubscriptionCanceled.tsx` | User cancels or period ends | Confirmation, win-back messaging |

---

## 5. Admin Subscription Dashboard

**Confidence:** HIGH -- Uses only existing UI technologies (shadcn/ui, Radix, Tailwind). No new dependencies.

### What to Use

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Dashboard UI | shadcn/ui + Radix primitives | Subscription management tables, stats cards |
| Charts | Custom Tailwind components | MRR visualization (no chart library to avoid new deps) |
| State | React state + fetch | Admin pages are client components with local state |
| Data | `/api/admin/subscriptions` | New API routes following existing admin patterns |

### MRR Calculation

Calculate server-side from D1 `subscriptions` table:
- Active subscriptions grouped by price
- Sum recurring amounts for Monthly Recurring Revenue
- Churn rate from canceled subscriptions in time window

---

## Summary: No New Dependencies Required

Every feature maps to existing installed packages or built-in Next.js capabilities:

| Feature Area | Existing Tech Used | New Code Needed |
|-------------|-------------------|-----------------|
| Subscriptions | Stripe SDK 18.4.0, CloudflareStripe, D1/Drizzle | Schema migration, API routes, webhook handlers, UI components |
| SEO | Next.js 15 Metadata API, App Router conventions | `generateMetadata` exports, `sitemap.ts`, `robots.ts`, JSON-LD, redirect config |
| Data Migration | `tsx` 4.20.3, `fetch`, Drizzle ORM | Migration scripts in `scripts/migrate/` |
| Subscription Emails | Resend 4.8.0, React Email 0.4.0 | New email templates in `emails/` |
| Admin UI | shadcn/ui, Radix, Tailwind, Zustand | New admin pages and API routes |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Subscription billing | Stripe Subscriptions (native) | Recurly, Chargebee | Already using Stripe; adding another billing provider creates unnecessary complexity |
| SEO metadata | Next.js Metadata API | `next-seo` package | Built-in is better maintained, no dependency, same features |
| Sitemap | `app/sitemap.ts` | `next-sitemap` | Built-in convention; `next-sitemap` is for Pages Router legacy |
| JSON-LD | Inline script tags | `schema-dts`, `next-seo` | No dependency needed for 3 schema types |
| OG images | Static images from R2 | `@vercel/og` | Vercel OG uses Node.js APIs incompatible with Cloudflare Workers |
| Migration scripts | Local `tsx` scripts | Cloudflare Worker scripts | Workers have CPU time limits; migration is a one-time local operation |
| Shopify API client | Raw `fetch` | `@shopify/shopify-api` | No new deps constraint; REST API with fetch is straightforward |
| Customer import | Clerk Backend API via `fetch` | `@clerk/backend` SDK | No new deps constraint; HTTP API is simple |

---

## Version Verification Status

| Package | Listed Version | Verified? | Notes |
|---------|---------------|-----------|-------|
| `stripe` | 18.4.0 | Yes (from `package.json`) | Includes Subscriptions, SetupIntent, Prices APIs |
| `@stripe/react-stripe-js` | 3.9.0 | Yes (from `package.json`) | Includes PaymentElement for SetupIntent flows |
| `next` | 15.3.5 | Yes (from `package.json`) | Includes Metadata API, sitemap.ts, robots.ts conventions |
| `drizzle-orm` | 0.35.2 | Yes (from `package.json`) | Schema migration for subscriptions table |
| `resend` | 4.8.0 | Yes (from `package.json`) | Email sending for subscription notifications |
| `@react-email/components` | 0.4.0 | Yes (from `package.json`) | Template building for subscription emails |
| `tsx` | 4.20.3 | Yes (from `package.json` devDeps) | Script runner for migration scripts |
| Shopify Admin API | 2024-10 | LOW confidence | Version string from training data; verify against Shopify docs before use |
| Clerk Backend API | N/A | LOW confidence | REST endpoints from training data; verify against Clerk docs before use |
| Judge.me API | N/A | LOW confidence | REST endpoints from training data; verify against Judge.me docs before use |

---

## Sources

- Codebase analysis: `package.json`, `lib/stripe.ts`, `lib/db/schema/`, `app/api/webhooks/stripe/route.ts`
- Project context: `.planning/PROJECT.md`
- Architecture context: `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/CONVENTIONS.md`
- Stripe Subscriptions API patterns: Training data (May 2025 cutoff) -- MEDIUM confidence
- Next.js App Router Metadata API: Training data (May 2025 cutoff) -- MEDIUM-HIGH confidence (core framework feature, stable since Next.js 13.2)
- Shopify Admin REST API: Training data (May 2025 cutoff) -- MEDIUM confidence
- Clerk Backend API: Training data (May 2025 cutoff) -- LOW-MEDIUM confidence

**Note:** Web search and documentation fetch were unavailable during this research session. All Stripe API patterns, Next.js features, and Shopify API details come from training data. Version strings for external APIs (Shopify `2024-10`, Stripe API version) should be verified against official documentation before implementation begins.

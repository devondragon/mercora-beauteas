# Architecture Patterns

**Domain:** Stripe subscriptions, SEO foundations, and Shopify data migration within existing Next.js 15 + Cloudflare Workers + D1 + Stripe e-commerce platform
**Researched:** 2026-03-04

## Recommended Architecture

The three new subsystems (Subscriptions, SEO, Data Migration) integrate into the existing Mercora layered architecture without introducing new infrastructure. Each subsystem plugs into established extension points: the Drizzle schema layer, the models layer, the API route layer, the `CloudflareStripe` adapter, and the Resend email utility. The migration tooling is the exception -- it runs locally via `tsx` and is not deployed.

### System Diagram

```
                              EXISTING MERCORA PLATFORM
  +---------------------------------------------------------------------------+
  |                                                                           |
  |  [Browser]                                                                |
  |     |                                                                     |
  |     +-- Product Pages --> SubscriptionSelector (new) --> Cart/Checkout    |
  |     |                                                                     |
  |     +-- Subscription Checkout (new) --> SetupIntent --> Stripe            |
  |     |                                                                     |
  |     +-- Admin Subscription Dashboard (new) --> Admin API                  |
  |                                                                           |
  |  [Next.js App Router - Cloudflare Workers]                                |
  |     |                                                                     |
  |     +-- app/api/subscriptions/         (new) -- Customer subscription ops |
  |     +-- app/api/admin/subscriptions/   (new) -- Admin subscription mgmt   |
  |     +-- app/api/webhooks/stripe/       (EXTEND) -- Subscription webhooks  |
  |     +-- app/sitemap.ts                 (new) -- Dynamic sitemap           |
  |     +-- app/robots.ts                  (new) -- Dynamic robots.txt        |
  |     |                                                                     |
  |  [Models Layer]                                                           |
  |     +-- lib/models/mach/subscriptions.ts  (new)                           |
  |     |                                                                     |
  |  [Schema Layer]                                                           |
  |     +-- lib/db/schema/subscription.ts     (new)                           |
  |     |                                                                     |
  |  [Stripe Integration]                                                     |
  |     +-- lib/stripe.ts   (EXTEND CloudflareStripe with subscription ops)   |
  |     |                                                                     |
  |  [Email]                                                                  |
  |     +-- lib/utils/email.ts  (EXTEND with subscription email templates)    |
  |                                                                           |
  +---------------------------------------------------------------------------+
                                     |
                              [Stripe API]
                    Subscription billing authority
                    Customer, Product, Price, Subscription,
                    SetupIntent, Invoice objects
                                     |
  +---------------------------------------------------------------------------+
  |  [Migration Tooling - LOCAL ONLY, not deployed]                           |
  |     scripts/shopify-migration/                                            |
  |       +-- Shopify GraphQL Admin API client                                |
  |       +-- Judge.me REST API client                                        |
  |       +-- Extractors --> Transformers --> Loaders (ETL)                   |
  |       +-- D1 loader (via wrangler d1 execute)                             |
  |       +-- R2 loader (via wrangler r2 object put)                          |
  |       +-- Clerk Backend API (customer import)                             |
  +---------------------------------------------------------------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | New/Extend |
|-----------|---------------|-------------------|------------|
| `lib/db/schema/subscription.ts` | Define `subscription_plans`, `customer_subscriptions`, `subscription_events` tables | Schema index, Models layer | **New** |
| `lib/types/subscription.ts` | TypeScript interfaces for all subscription entities | All subscription code | **New** |
| `lib/models/mach/subscriptions.ts` | CRUD operations for subscription data in D1, stats queries (MRR, churn) | Schema layer, DB connection | **New** |
| `lib/stripe.ts` (CloudflareStripe) | Add `createSubscription()`, `cancelSubscription()`, `pauseSubscription()`, `resumeSubscription()`, `createSetupIntent()`, `getOrCreateCustomer()`, `listSubscriptions()` | Stripe REST API via fetch | **Extend** |
| `app/api/subscriptions/route.ts` | Customer-facing: list own subscriptions (GET), create new subscription (POST) | Models layer, Stripe adapter, Auth | **New** |
| `app/api/subscriptions/[id]/route.ts` | Customer-facing: pause, resume, skip, cancel actions (POST) | Models layer, Stripe adapter | **New** |
| `app/api/admin/subscriptions/route.ts` | Admin: list all subscriptions, filter, stats | Models layer, Admin auth | **New** |
| `app/api/admin/subscription-plans/route.ts` | Admin: manage which products have subscription plans | Models layer, Admin auth | **New** |
| `app/api/webhooks/stripe/route.ts` | Handle subscription lifecycle webhooks from Stripe, sync to D1 | Models layer, Email utility | **Extend** |
| `lib/utils/email.ts` | Subscription email templates: created, renewed, failed, paused, resumed, canceled | Resend API | **Extend** |
| `components/product/SubscriptionSelector.tsx` | "One-time" vs "Subscribe & Save" toggle with frequency picker | Cart store, Subscription plans API | **New** |
| `app/checkout/subscription/page.tsx` | Dedicated subscription checkout with SetupIntent | Stripe Elements, Subscription API | **New** |
| `app/admin/subscriptions/page.tsx` | Admin subscription dashboard with MRR, churn, event timeline | Admin subscription API | **New** |
| `components/seo/JsonLd.tsx` | Reusable JSON-LD structured data components (Product, Organization, Breadcrumb) | Product data, Brand config | **New** |
| `app/sitemap.ts` | Dynamic sitemap from D1 (products, categories, CMS pages) | Models layer (products, categories, pages) | **New** |
| `app/robots.ts` | Dynamic robots.txt referencing sitemap | Brand config for domain | **New** |
| `app/product/[slug]/page.tsx` | Add `generateMetadata()` for OG tags, canonical, Twitter cards | Product model | **Extend** |
| `app/category/[slug]/page.tsx` | Add `generateMetadata()` for category SEO | Category model | **Extend** |
| `next.config.ts` | Add `redirects()` for Shopify URL 301 redirects | Static config | **Extend** |
| `scripts/shopify-migration/` | ETL pipeline: extract from Shopify, transform to Mercora schema, load to D1/R2/Clerk | Shopify API, Judge.me API, Wrangler CLI, Clerk Backend API | **New** |

### Data Flow

#### Subscription Creation Flow

```
1. Customer browses product page
   --> ProductDisplay renders SubscriptionSelector if product has plans
   --> SubscriptionSelector fetches plans from GET /api/products/[id]/subscription-plans

2. Customer selects "Subscribe & Save" + frequency
   --> Cart store updated with subscription metadata (plan_id, frequency)
   --> Cart routes to subscription checkout: /checkout/subscription

3. Subscription checkout page
   --> Shipping form collected (same as existing ShippingForm)
   --> POST /api/subscriptions with { product_id, variant_id, plan_id, shipping_address }
       --> API creates/retrieves Stripe Customer (linked to Clerk userId)
       --> API creates Stripe Subscription with payment_behavior: 'default_incomplete'
       --> API creates local subscription record in D1 (status: 'pending')
       --> API returns subscription.latest_invoice.payment_intent.client_secret
           OR SetupIntent client_secret for future billing

4. Client confirms payment via Stripe Elements (PaymentElement)
   --> Stripe processes first payment or stores payment method

5. Stripe sends webhook: invoice.payment_succeeded
   --> Webhook handler updates D1 subscription to 'active'
   --> Creates subscription_event record
   --> Sends "Subscription Created" email via Resend
```

#### Subscription Lifecycle (Webhook-Driven)

```
Stripe is billing authority. D1 is the sync layer.

invoice.payment_succeeded (renewal)
  --> Create renewal order in D1 orders table
  --> Update subscription.current_period_end
  --> Log subscription_event
  --> Send renewal confirmation email

invoice.payment_failed
  --> Update subscription status to 'past_due' in D1
  --> Log subscription_event
  --> Send payment failed email with update-payment-method link

customer.subscription.updated
  --> Sync status changes (pause/resume) from Stripe to D1
  --> Log subscription_event

customer.subscription.deleted
  --> Update subscription status to 'canceled' in D1
  --> Log subscription_event
  --> Send cancellation confirmation email

invoice.upcoming
  --> Check if customer has a "skip next" flag in D1
  --> If skipping: void the upcoming invoice via Stripe API
```

#### Customer Subscription Management

```
Customer action (pause/resume/skip/cancel)
  --> POST /api/subscriptions/[id] with { action: 'pause' | 'resume' | 'skip' | 'cancel' }
  --> API calls Stripe to update subscription (via CloudflareStripe)
  --> Stripe sends webhook with updated state
  --> Webhook handler syncs D1 and sends email
  --> Client polls or re-fetches subscription state
```

#### SEO Data Flow

```
Dynamic Sitemap:
  GET /sitemap.xml --> app/sitemap.ts
    --> Queries products (slug, updated_at), categories (slug), CMS pages (slug)
    --> Returns MetadataRoute.Sitemap array
    --> Next.js serializes to XML

Product Page Metadata:
  Request for /product/[slug]
    --> generateMetadata() in page.tsx fetches product by slug
    --> Returns: title, description, canonical URL, OG tags, Twitter card
    --> JSON-LD component renders Product structured data in page body

Shopify Redirects:
  Request for /products/green-tea-cleanser
    --> next.config.ts redirects() returns 301 to /product/green-tea-cleanser
    --> Preserves Shopify URL equity with no code at runtime
```

#### Data Migration Flow (One-Time ETL)

```
scripts/shopify-migration/ (run locally via tsx)

Phase 1: Extract
  --> Shopify GraphQL Admin API: products, variants, collections, customers, orders, pages, blog posts
  --> Judge.me REST API: reviews for each product
  --> Download product/category images from Shopify CDN to local temp directory

Phase 2: Transform
  --> Map Shopify product structure to MACH Product schema
  --> Map Shopify collections to categories
  --> Map Shopify customer to MACH Customer + Clerk import format
  --> Map Shopify orders to D1 orders schema (read-only historical records)
  --> Map Judge.me reviews to product_reviews table format
  --> Generate Shopify-to-Mercora URL redirect map
  --> Generate ID mapping table (Shopify ID --> Mercora ID) for cross-referencing

Phase 3: Load
  --> wrangler d1 execute: insert categories, products, variants, customers, orders, reviews
  --> wrangler r2 object put: upload images to products/, categories/ folders
  --> Clerk Backend API: create users with skip_password_requirement
  --> Recalculate product ratings from imported reviews
  --> Output redirect map as next.config.ts redirects() array

Phase 4: Validate
  --> Count comparison: Shopify record counts vs D1 record counts per table
  --> Spot checks: random sample of 5 orders, 5 products, 5 reviews for data integrity
  --> Image verification: confirm all product images load from R2
  --> Customer verification: confirm Clerk accounts exist for imported customers
```

## Patterns to Follow

### Pattern 1: Stripe as Authority, D1 as Sync Layer

**What:** Stripe owns the subscription billing lifecycle. D1 stores a synchronized copy for fast querying and display. All mutations go through Stripe first, then webhooks sync state to D1.

**When:** All subscription state changes.

**Why:** Stripe handles billing cycles, retry logic, proration, and payment method management reliably. Reimplementing this in D1 would be error-prone. The local D1 copy enables fast reads for admin dashboards and customer subscription pages without Stripe API calls on every page load.

**Example:**
```typescript
// lib/models/mach/subscriptions.ts
export async function syncSubscriptionFromStripe(
  stripeSubscription: StripeSubscriptionObject
): Promise<void> {
  const db = await getDbAsync();
  await db.update(customer_subscriptions)
    .set({
      status: stripeSubscription.status,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: stripeSubscription.cancel_at_period_end ? 1 : 0,
      updated_at: new Date().toISOString(),
    })
    .where(eq(customer_subscriptions.stripe_subscription_id, stripeSubscription.id));
}
```

### Pattern 2: Extend CloudflareStripe, Do Not Add Node.js SDK Calls

**What:** All new Stripe operations (subscriptions, customers, setup intents) must be added as methods on the `CloudflareStripe` class in `lib/stripe.ts`, following the existing fetch-based pattern.

**When:** Any new Stripe API integration.

**Why:** The Cloudflare Workers runtime does not support Node.js-specific APIs. The existing `CloudflareStripe` class already handles URL-encoded form data for Stripe's API format. Adding methods here maintains the single abstraction.

**Example:**
```typescript
// In CloudflareStripe class (lib/stripe.ts)
async createSubscription(params: {
  customer: string;
  items: Array<{ price: string }>;
  payment_behavior: string;
  payment_settings?: { save_default_payment_method: string };
  expand?: string[];
  metadata?: Record<string, string>;
}) {
  return await this.request('POST', '/subscriptions', params);
}

async createSetupIntent(params: {
  customer: string;
  payment_method_types?: string[];
  metadata?: Record<string, string>;
}) {
  return await this.request('POST', '/setup_intents', params);
}
```

### Pattern 3: Webhook Handler with Direct Model Calls

**What:** The existing webhook handler makes a self-referential HTTP `fetch()` to update orders. New subscription webhook handlers should call model functions directly instead.

**When:** All webhook event processing.

**Why:** Self-referential HTTP calls in Cloudflare Workers add unnecessary latency, risk circular routing, and use the disabled auth system as a credential (which is fragile). Direct model function calls are faster and type-safe.

**Example:**
```typescript
// In app/api/webhooks/stripe/route.ts
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  // GOOD: Direct model call
  await syncSubscriptionFromStripe(subscription);
  await createSubscriptionEvent({
    subscription_id: subscription.id,
    type: 'updated',
    data: JSON.stringify(subscription),
    created_at: new Date().toISOString(),
  });

  // DO NOT: fetch('/api/subscriptions/...')  <-- avoid self-referential HTTP
}
```

### Pattern 4: Next.js Metadata API for SEO

**What:** Use `generateMetadata()` export in page components and `app/sitemap.ts` / `app/robots.ts` file conventions for SEO primitives.

**When:** All SEO work (metadata, sitemap, robots.txt, JSON-LD).

**Why:** Next.js 15 has built-in support for these patterns. They are server-rendered, properly cached, and follow the framework's conventions for the App Router. No third-party SEO libraries needed.

**Example:**
```typescript
// app/product/[slug]/page.tsx
import type { Metadata } from 'next';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProductBySlug(params.slug);
  if (!product) return {};

  const name = typeof product.name === 'string' ? product.name : Object.values(product.name)[0];
  const description = typeof product.description === 'string'
    ? product.description
    : Object.values(product.description || {})[0] || '';
  const imageUrl = product.primary_image?.file?.url || '';

  return {
    title: `${name} | BeauTeas`,
    description: description.substring(0, 160),
    alternates: { canonical: `https://beauteas.com/product/${product.slug}` },
    openGraph: {
      title: name,
      description,
      images: imageUrl ? [{ url: imageUrl }] : [],
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title: name, description },
  };
}
```

### Pattern 5: ETL Scripts Outside the Application

**What:** Migration scripts live in `scripts/shopify-migration/` and run locally via `tsx`. They use Shopify's GraphQL Admin API for extraction, transform data to match Drizzle schema types, and load via Wrangler CLI commands or direct API calls.

**When:** Data migration from Shopify (one-time operation).

**Why:** D1 is not accessible via network from external scripts -- data must be loaded via `wrangler d1 execute` or the D1 HTTP API. The migration scripts do not need to run in the Workers runtime and should not be bundled into the application. Running locally via `tsx` allows Node.js-specific dependencies (like file system access for image downloads) without violating the "no new npm dependencies" constraint for the deployed app.

**Example:**
```typescript
// scripts/shopify-migration/transformers/product.ts
import type { Product } from '../../lib/types/mach/Product';

export function transformShopifyProduct(shopifyProduct: ShopifyProduct): Product {
  return {
    id: `prod_${nanoid()}`,
    name: shopifyProduct.title,
    description: shopifyProduct.bodyHtml,
    slug: shopifyProduct.handle,
    status: shopifyProduct.status === 'ACTIVE' ? 'active' : 'draft',
    external_references: JSON.stringify({
      shopify_id: shopifyProduct.id,
      shopify_handle: shopifyProduct.handle,
    }),
    // ... map remaining fields
  };
}
```

### Pattern 6: Subscription Plans Linked to Stripe Prices

**What:** Each subscribable product-variant combination gets Stripe Price objects for each frequency (biweekly, monthly, bimonthly). The `subscription_plans` D1 table maps product variants to Stripe Price IDs.

**When:** Setting up subscription offerings.

**Why:** Stripe Prices are the billing primitives. One Stripe Product can have multiple Prices (different frequencies/amounts). The local `subscription_plans` table acts as the lookup layer so product pages can display subscription options without hitting Stripe on every page load.

**Example schema:**
```sql
-- subscription_plans: maps product variants to Stripe recurring Prices
CREATE TABLE subscription_plans (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL UNIQUE,
  frequency TEXT NOT NULL CHECK(frequency IN ('biweekly', 'monthly', 'bimonthly')),
  interval_count INTEGER NOT NULL,
  discount_percent INTEGER DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- customer_subscriptions: synced from Stripe webhooks
CREATE TABLE customer_subscriptions (
  id TEXT PRIMARY KEY,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  clerk_user_id TEXT,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'pending',
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  skip_next_renewal INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- subscription_events: audit log
CREATE TABLE subscription_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES customer_subscriptions(id),
  event_type TEXT NOT NULL,
  stripe_event_id TEXT,
  data TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Storing Subscription Billing State in D1 as Source of Truth

**What:** Making D1 the authority for billing cycles, payment retries, or renewal dates instead of Stripe.

**Why bad:** D1 has no built-in scheduler. You would need to build cron-like logic in Workers to check for renewals, handle retry logic, manage proration, and deal with payment method failures. Stripe already does all of this reliably at scale. Duplicating it is a rewrite of billing infrastructure.

**Instead:** Let Stripe manage billing. D1 only stores a read-optimized copy synced via webhooks. Every subscription mutation goes to Stripe first.

### Anti-Pattern 2: Generating Sitemap at Build Time

**What:** Using `getStaticParams()` or build-time generation for sitemap.xml.

**Why bad:** Product catalog changes (new products, deactivated products) would require a rebuild and redeploy to update the sitemap. With ~30 products this is manageable, but it creates an operational burden and delays search engine discovery of new products.

**Instead:** Use `app/sitemap.ts` with dynamic generation. Next.js on Cloudflare Workers generates it on each request, and Cloudflare's edge caching handles performance. For a 30-product catalog, the D1 query is trivially fast.

### Anti-Pattern 3: Self-Referential HTTP Calls in Webhooks

**What:** The existing `handlePaymentSucceeded()` makes a `fetch()` call to its own `/api/orders` endpoint. This pattern should not be extended to subscription webhooks.

**Why bad:** Adds latency (round-trip through the Workers network layer), relies on `NEXT_PUBLIC_URL` being correctly set, uses the webhook secret as a makeshift API key, and could fail if the Workers instance has request limits or cold start issues.

**Instead:** Import model functions directly and call them. The webhook handler already has access to the D1 database through `getDbAsync()`.

### Anti-Pattern 4: Putting Migration Scripts in the App Bundle

**What:** Adding Shopify API clients, Judge.me clients, or migration logic to `lib/` or `app/api/` where they would be bundled into the Workers deployment.

**Why bad:** Migration scripts need Node.js-specific APIs (file system for temp image storage, `child_process` for wrangler CLI calls). They also need Shopify API credentials that should never be in the production Workers environment. Bundling them increases the deployed artifact size.

**Instead:** Keep all migration code in `scripts/shopify-migration/` and run via `tsx` locally. Migration dependencies (if any) go in `devDependencies` only.

### Anti-Pattern 5: Redirect Map in Middleware

**What:** Handling Shopify URL redirects in `middleware.ts` with runtime lookup logic.

**Why bad:** Middleware runs on every request. Adding a redirect lookup (even from a hardcoded map) adds latency to every page load, not just the redirected URLs. The redirect map is static (Shopify URLs do not change after migration).

**Instead:** Use `next.config.ts` `redirects()` function. Next.js compiles these into the routing layer and handles them before the page handler runs, with no runtime overhead for non-matching URLs.

## Scalability Considerations

| Concern | At 30 products (current) | At 500 products | At 5,000 products |
|---------|--------------------------|-----------------|-------------------|
| Sitemap generation | Single D1 query, <10ms | Still single query, fine | Consider `generateSitemaps()` for multiple sitemap files (50K URL limit per file) |
| Subscription webhook volume | Low (~10/day) | Moderate (~200/day) | D1 write throughput may need monitoring; consider batching subscription_events writes |
| Redirect map | ~50 entries in next.config.ts | ~500 entries, still static config | Consider moving to middleware with cached Map lookup |
| Migration script runtime | <5 minutes | ~30 minutes | May need parallel extraction and batch D1 inserts |
| Admin subscription dashboard | Full-table scan OK | Need SQL WHERE + pagination | Must use SQL aggregation for MRR/churn stats, not in-memory |

## Suggested Build Order (Dependencies)

The three subsystems have minimal cross-dependencies but should be ordered based on launch-blocker priority and testing needs.

```
Phase 1: SEO Foundation
  No dependencies on other new work.
  Must complete BEFORE DNS cutover.
  Can be developed and verified independently.
  Deliverables:
    - app/sitemap.ts
    - app/robots.ts
    - components/seo/JsonLd.tsx
    - generateMetadata() on product + category pages
    - redirects() stub in next.config.ts (populated after migration)

Phase 2: Subscription System (Schema + Stripe + Webhooks)
  No dependency on SEO or migration.
  Must complete BEFORE DNS cutover.
  Requires Stripe test mode for development.
  Build order within phase:
    1. Schema + types + migration SQL (foundation)
    2. CloudflareStripe extensions (Stripe API access)
    3. Models layer (CRUD for local D1 data)
    4. Webhook handler extensions (Stripe --> D1 sync)
    5. API routes (customer + admin endpoints)
    6. Email templates (subscription lifecycle)
    7. Customer UI (SubscriptionSelector, subscription checkout)
    8. Admin UI (subscription dashboard, plan management)

Phase 3: Shopify Data Migration
  Depends on: Phase 1 (redirect map feeds into next.config.ts redirects())
  Partially depends on: Phase 2 schema being in place (subscription plans
    may reference migrated products, though subscription setup is post-migration)
  Must complete BEFORE DNS cutover.
  Build order within phase:
    1. Shopify GraphQL client + Judge.me client
    2. Extractors (one per entity type)
    3. ID mapping utility
    4. Transformers (Shopify schema --> Mercora schema)
    5. D1 loader + R2 loader
    6. Clerk customer importer
    7. URL redirect map generator (feeds back into Phase 1)
    8. Validation suite (count checks, spot checks, image verification)
```

**Ordering rationale:**

1. **SEO first** because it is the simplest subsystem (no external API integrations beyond the database), can be verified with static analysis tools (Google Rich Results Test, sitemap validators), and the redirect map stub can be populated later when migration data is ready.

2. **Subscriptions second** because it is the most architecturally complex new subsystem (new schema, Stripe API extensions, webhook handlers, two checkout flows, admin dashboard). Starting it early gives maximum time for Stripe integration testing with `stripe listen --forward-to`.

3. **Migration third** because it depends on the subscription schema being in place (so migrated products can have subscription plans attached post-migration) and produces the redirect map that populates Phase 1's `redirects()` config. The migration itself is a one-time operation that should happen close to DNS cutover.

**Critical integration point:** The redirect map from Phase 3 must be merged into `next.config.ts` before DNS cutover. This is the one hard dependency between phases.

## Sources

- Existing codebase analysis: `.planning/codebase/ARCHITECTURE.md`, `INTEGRATIONS.md`, `STRUCTURE.md`, `CONCERNS.md`, `STACK.md`
- Existing migration plan: `MIGRATION-PLAN.md`
- `lib/stripe.ts` -- current CloudflareStripe implementation (fetch-based Stripe client pattern)
- `app/api/webhooks/stripe/route.ts` -- current webhook handler structure and known issues
- `app/api/payment-intent/route.ts` -- current PaymentIntent creation pattern
- `lib/db/schema/order.ts`, `customer.ts`, `products.ts` -- existing schema patterns for new subscription schema
- `lib/utils/email.ts` -- email template pattern for subscription emails
- Stripe Subscriptions documentation (training data, MEDIUM confidence -- verify `payment_behavior` and `expand` parameters against current Stripe API version)
- Next.js 15 Metadata API documentation (training data, HIGH confidence -- `generateMetadata()`, `app/sitemap.ts`, `app/robots.ts` are stable App Router conventions)
- Shopify GraphQL Admin API documentation (training data, MEDIUM confidence -- verify cursor pagination syntax and available fields against current API version)

---

*Architecture analysis: 2026-03-04*

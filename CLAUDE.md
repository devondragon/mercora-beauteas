# BeauTeas — Claude AI Assistant Reference

Essential context for Claude when working on **BeauTeas**, an AI-enhanced eCommerce storefront built on the **Mercora** platform.

> **Status:** Mid–Shopify→Mercora cutover. All launch-blocking code is built and audited; the remaining work is operational (provision prod, flip live keys, run the Shopify ETL, DNS switch). See **[Cutover Status](#cutover-status)**.

---

## Project Overview

**BeauTeas** (beauteas.com) is a USDA-certified **organic skincare tea shop** — "Build Your Beauty from Within." The current catalog is the **Clearly Calendula** collection (Morning / Afternoon / Evening blends formulated for skin health). It is migrating off **Shopify** onto the in-house **Mercora** platform.

**Key features:**
- **Chai** — AI shopping assistant with semantic (vector) search, personalization, and anti-hallucination safeguards
- Full eCommerce: catalog, cart, checkout, Stripe payments + **Stripe-backed subscriptions**
- Comprehensive admin dashboard (products, orders, categories, CMS pages, reviews, subscriptions, AI analytics)
- Clerk authentication with admin roles
- **MCP (Model Context Protocol) server** for multi-agent commerce
- SEO foundations + Shopify 301 redirect map for cutover

> **Note on naming:** `package.json` is `"name": "mercora"` (the platform), `"version": "0.1.0"`. "BeauTeas" is the store/brand instance configured on top of it.

---

## Tech Stack

### Frontend
- **Framework:** Next.js `^15.5.19` (App Router, `next dev --turbopack`)
- **Language:** TypeScript `^5` (strict)
- **Styling:** Tailwind CSS `^3.4.1` + `@tailwindcss/typography`, `tw-animate-css`
- **UI:** shadcn/ui + Radix UI primitives; `lucide-react` + `react-icons`
- **State:** Zustand `^5`
- **Email:** React Email (`@react-email/components`, `@react-email/render`) + Resend `^4`

### Backend & Infrastructure
- **Runtime:** Cloudflare Workers via **OpenNext** (`@opennextjs/cloudflare` `^1.20.1`)
- **Database:** Cloudflare **D1** (SQLite) — **Drizzle ORM `^0.45.2` for runtime queries only** (see [Migrations](#database--migrations))
- **Storage:** Cloudflare **R2** (product/knowledge media + ISR incremental cache)
- **AI:** Cloudflare **Workers AI** (text gen + embeddings) + **Vectorize**
- **Auth:** Clerk `^6.39.5` (`@clerk/nextjs`, `@clerk/backend`)
- **Payments:** Stripe `^22` (API `2026-06-24.dahlia`) (`stripe`, `@stripe/react-stripe-js`, `@stripe/stripe-js`)

### Key dependencies (exact)
```
next ^15.5.19 · react ^19 · drizzle-orm ^0.45.2 · drizzle-kit ^0.31.4
@opennextjs/cloudflare ^1.20.1 · wrangler ^4.105.0 · @cloudflare/workers-types ^4.20250726.0
@clerk/nextjs ^6.39.5 · stripe ^22.3.2 · zustand ^5.0.6 · resend ^4.8.0
tailwindcss ^3.4.1 · tsx ^4.20.3 (script runner) · @aws-sdk/client-s3 ^3 (R2/migration tooling)
```

---

## Commands

```bash
# Development
npm run dev               # next dev --turbopack
npm run build             # next build (standard Next.js build)
npm run lint              # next lint (ESLint: next/core-web-vitals)

# Local preview on the Workers runtime
npm run preview           # opennextjs-cloudflare build && preview
npm run preview:dev       # opennextjs-cloudflare build && wrangler dev --env dev

# Deploy (OpenNext build + deploy, per environment)
npm run deploy:dev        # clean → opennextjs-cloudflare build → deploy --env dev
npm run deploy:production # clean → opennextjs-cloudflare build → deploy --env production
npm run clean             # rm -rf .open-next .next .wrangler/state .wrangler/public

# Cloudflare types (regenerate after wrangler.jsonc binding changes)
npm run cf-typegen        # wrangler types --env-interface CloudflareEnv ./cloudflare-env.d.ts

# API token management (scripts/manage-tokens.ts)
npm run token:generate    # mint a scoped api_tokens row
npm run token:list
npm run token:revoke

# CMS page images → R2 (uploads from the committed data/r2/pages/ bytes;
# skips keys that already exist, so it is safe to re-run). Needs CLOUDFLARE_API_TOKEN.
npm run images:pages -- --env dev|production
```

- **Deploys go through OpenNext**, not bare `wrangler deploy`. Worker entry is `.open-next/worker.js`.
- **Always `npm run lint`** after changes.
- `open-next.config.ts` enables R2-backed ISR incremental cache (`NEXT_INC_CACHE_R2_BUCKET`).
- Lint = `.eslintrc.json` extends `next/core-web-vitals`. **No Prettier configured.**

---

## Cloudflare Configuration (`wrangler.jsonc`)

Two named environments. **Resources for both dev and prod are provisioned** (D1, R2, Vectorize created; all 12 migrations (`0001`–`0012`) applied → ~39 tables in each DB).

| | **dev** (`--env dev`) | **production** (`--env production`) |
|---|---|---|
| Worker name | `beauteas-dev` | `beauteas` |
| D1 database | `beauteas-db-dev` (`f88149dc-…`) + preview (`0a037b06-…`) | `beauteas-db` (`5dbae836-ff0f-420c-9ac0-16088ceb60ee`) |
| R2 (`MEDIA` + `NEXT_INC_CACHE_R2_BUCKET`) | `beauteas-images-dev` (+ `-dev-preview`) | `beauteas-images` |
| Vectorize | `beauteas-index-dev` | `beauteas-index` (both 768-dim, cosine) |
| Clerk publishable key | `pk_test_…` (set) | ✅ `pk_live_…` (set) |
| Stripe publishable key | `pk_test_…` (set) | ✅ `pk_live_…` (set) |

- **Shared bindings** (inherited): `ASSETS` (`.open-next/assets`), `AI`, observability enabled, empty `durable_objects`.
- **Rate-limit bindings** (per-env `ratelimits`, BMC-180): `AI_RATE_LIMITER` (20/60s — guards the paid `/api/agent-chat` AI path) and `PUBLIC_RATE_LIMITER` (60/60s — guards `tax`, `validate-discount`, `gift-cards/validate`, `payment-intent`, `shipping-options`). Native Cloudflare rate limiting (best-effort, per-colo); enforced via `lib/rate-limit.ts` (`enforceRateLimit`), which **fails open** if the binding is absent (e.g. plain `next dev`). Distinct `namespace_id`s per env so dev/prod counters don't share.
- **Compatibility:** date `2026-06-25`, flags `["nodejs_compat", "global_fetch_strictly_public"]`.
- **Secrets** are per-env via `wrangler secret put … --env <dev|production>` (NOT in config):
  `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_VECTORIZE_TOKEN`, `EMAIL_UNSUBSCRIBE_SECRET` (signs CAN-SPAM unsubscribe links, BMC-184), `ORDER_STATUS_SECRET` (signs guest order-status HMAC tokens, `lib/order-status/token.ts`, BMC-216A). ⚠️ Only set in the gitignored local `.dev.vars` so far — remote dev/prod provisioning is BMC-231; until it's set on a deployed env, guest order-status links fail closed there (no token minted/verified) rather than erroring loudly.
- Binding types are generated to `cloudflare-env.d.ts` (committed) via `npm run cf-typegen`. ⚠️ A newer wrangler CLI rewrites this file's other bindings as **optional** (`DB?`), which breaks existing `env.DB` call sites — the `AI_RATE_LIMITER`/`PUBLIC_RATE_LIMITER` `RateLimit` entries were therefore **hand-added** in the existing required-binding shape; keep them in sync with `wrangler.jsonc` manually rather than regenerating.

---

## Database & Migrations

> **Migrations are Wrangler-managed raw SQL — NOT Drizzle-generated.** There is no `drizzle.config.*` and no `drizzle-kit generate` step. Drizzle is the **runtime query/ORM layer only**.

- **Migration files:** `migrations/NNNN_name.sql` (hand-written SQL). Wrangler tracks applied state in the `d1_migrations` table per database.
- **Drizzle schema** (TypeScript, for queries): `lib/db/schema/` (~22 files; `index.ts` re-exports). `lib/db.ts` exposes cached `getDb()` / `getDbAsync()` via `drizzle(env.DB, { schema })`.
- **Data access layer:** `lib/models/` (incl. `lib/models/mach/` for MACH Alliance entities).

### Current migrations (24 files → ~41 tables)
| File | Adds |
|---|---|
| `0001_initial_schema.sql` | MACH core: addresses, languages, media, customers, categories, product_types, products, product_variants, promotions, coupon_instances, inventory, pricing, orders, api_tokens, chat_sessions/messages, order_webhooks, admin_settings |
| `0002_add_admin_users.sql` | `admin_users` (Clerk IDs + roles) |
| `0003_add_cms_pages.sql` | `pages`, `page_versions`, `page_templates` |
| `0004_add_mcp_tables.sql` | `mcp_sessions`, `mcp_agents`, `mcp_usage`, `mcp_rate_limits` |
| `0005_add_reviews_tables.sql` | `product_reviews`, `review_media`, `review_flags` |
| `0006_add_review_reminders.sql` | `review_reminders` |
| `0007_add_subscription_tables.sql` | `subscription_plans`, `customer_subscriptions`, `subscription_events`, `processed_webhook_events` |
| `0008_add_redirect_map.sql` | `redirect_map` (Shopify URL → new 301s) |
| `0009_rebrand_cms_pages.sql` | Updates seeded CMS page rows to tea/skincare copy (data-only) |
| `0010_add_blog_tables.sql` | `blog_categories`, `blog_posts` |
| `0010_add_gift_cards.sql` | `gift_cards`, `gift_card_transactions` + seeded gift-card product type/product/denomination variants |
| `0011_hash_mcp_api_keys.sql` | Renames `mcp_agents.api_key` → `api_key_hash` (store SHA-256, not plaintext) + re-seeds the dev `test-agent` hash (BMC-141/BMC-155; no new tables) |
| `0012_remove_seeded_test_agent.sql` | Deletes the seeded `test-agent` MCP row from every DB — its key (`test-key-123`) is public in the repo, so the row was a live prod credential (BMC-136/C9; no new tables). Local dev restores it from the dev-only `data/d1/seed-dev.sql` |
| `0013_add_product_recommendations.sql` | `product_recommendations` (precomputed per-product recs for the `ai_batch` provider) + seeds `recommendations.*` admin settings (`strategy`, `personalize`, `limit`, `exclude_owned`). Applied to local, remote dev, dev preview, **and production (2026-07-27)** |
| `0014_add_policy_pages.sql` | Seeds published Refund/Return, Shipping, and Contact CMS pages the footer + checkout link to (BMC-173; data-only, placeholder legal copy pending counsel) |
| `0015_add_subscription_shipping_address.sql` | Adds shipping-address columns to `customer_subscriptions` |
| `0016_rewrite_legal_pages.sql` | Rewrites the boilerplate Privacy Policy + Terms of Service seeded by 0003 with real processor/rights/retention/cookie disclosures + business address, and deletes the dead Shopify `ccpa-opt-out`/`ccpa-compliance`/`gdpr-compliance` pages (BMC-183; data-only, guarded/idempotent, snapshots into `page_versions`). Fresh DBs are seeded correctly by the updated 0003 + `data/d1/seed.sql` (CCPA rows removed) |
| `0017_backfill_legal_pages.sql` | Backfills Privacy/Terms rows on DBs where the 0016 `UPDATE` matched no row (BMC-183; data-only, idempotent) |
| `0018_add_email_unsubscribes.sql` | `email_unsubscribes` (CAN-SPAM opt-out suppression list: `(email, scope)` PK). The review-reminder sender checks it before sending; the public `/api/email/unsubscribe` route writes it (BMC-184). **Applied to production 2026-07-27** |
| `0019_restructure_footer_pages.sql` | Restructures the footer-linked CMS pages for the template system: sets `pages.template` (`guide`/`faq`/`contact`/`legal`/`story`), adds ledes, rewrites markup to the authoring conventions, repoints three Shopify-hosted images at `https://img.beauteas.com/pages/…`, and archives the duplicate `about` page (PR #98; data-only, guarded/idempotent, snapshots into `page_versions`). **Applied to remote dev, dev preview, and production 2026-07-30** (pre-flight `d1 export` backup taken; 8 `page_versions` snapshots written). ⚠️ If ever applied to a new environment: deploy the app **first** (the `/about` → `/about-us` redirect ships with the app), and run `npm run images:pages -- --env <env>` **before** applying, or three pages render broken images |
| `0020_seed_page_templates.sql` | Seeds `page_templates` with the five render kinds so the admin editor's Template dropdown matches `lib/cms/page-template.ts`; deactivates the redundant `about` row (PR #98; data-only, idempotent). Without it `guide`/`faq`/`contact`/`story` are unselectable and re-saving such a page through the admin silently downgrades it to `story`. **Applied to local, remote dev, dev preview, and production 2026-07-30** |

| `0021_add_external_refund_restock_setting.sql` | Seeds `refund.restock_on_external_refund` (default **true**) — decides whether the `charge.refunded` reconciler restocks inventory when a refund is issued outside the app (Stripe Dashboard). Only *full* external refunds ever restock; a partial one carries no line attribution (BMC-213; data-only, idempotent). **Applied to local, remote dev, dev preview, and production 2026-07-30** (pre-flight `d1 export` backups taken for dev + prod; row verified present in both). Behaviour is correct without it — `getRefundPolicy()` defaults to `true` when the row is absent — so the migration exists to make the toggle selectable in Admin → Settings → Refunds |
| `0022_add_shipping_carrier.sql` | Adds `orders.shipping_carrier` (typed `ups`/`fedex`/`other`/`NULL`) and backfills it from `extensions.carrier` then a narrow `shipping_method` fallback (BMC-216A; the fulfillment domain layer owns this column going forward). **Applied to local only** — remote dev/prod apply is BMC-231. ⚠️ **App code REQUIRES this migration once deployed** — `lib/db/schema/order.ts` declares `shipping_carrier` on the Drizzle `orders` table, and Drizzle names every column it selects/inserts/returns (never `SELECT *`), so **every order read and write** 500s with "no such column" on any deployed env missing this column. Merging this PR does not by itself break anything (`ci.yml` only lints/builds; deploy is a separate `workflow_dispatch`; `npm run deploy:production` does not run migrations) — but **apply `0022` before deploying any build built from a commit at or after this one.** If a rollback is ever needed pre-BMC-231: `ALTER TABLE orders DROP COLUMN shipping_carrier;` (SQLite ≥3.35, which D1 supports) reverses it cleanly since nothing reads the column yet |
| `0023_add_order_events.sql` | Adds `order_events` (append-only fulfillment audit log: `shipment_created`/`tracking_updated`/`shipping_email_*`), FK'd to `orders.id` with `ON DELETE CASCADE` — **restoring an `orders` row from a backup does not restore its deleted `order_events` rows** (BMC-216A). **Applied to local only** — remote dev/prod apply is BMC-231. No app code reads/writes this table yet (that's ticket B), so unlike `0022` it is not deploy-order-sensitive |

> ⚠️ **Two files share the `0010` prefix** (`0010_add_blog_tables` and `0010_add_gift_cards` landed independently). This is harmless — Wrangler tracks applied state by **filename**, and the two are independent — but **do not renumber either now that they're applied**: renaming to `0011_*` would make Wrangler treat it as a new, unapplied migration and re-run it ("table already exists"). The next new migration should be `0024_*` (`0011`–`0023` are taken).
>
> ⚠️ **D1 caps LIKE patterns at 50 characters** ("LIKE or GLOB pattern too complex: SQLITE_ERROR"). Data-only migrations that guard an `UPDATE`/`INSERT ... SELECT` with `content LIKE '%…%'` (the 0009/0016 idempotency pattern) must keep the substring short — a ~50-char guard silently rolls back the whole migration.

### Making a schema change
1. Update the Drizzle schema/types in `lib/db/schema/` (and `lib/models/`) so app code matches.
2. `npx wrangler d1 migrations create beauteas-db-dev <description>`, then hand-write the SQL in the new `migrations/NNNN_*.sql`.
3. Apply per environment:
```bash
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev           # dev
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev --preview  # dev preview DB
npx wrangler d1 migrations apply beauteas-db     --remote --env production     # production
npx wrangler d1 migrations apply beauteas-db-dev --local --env dev             # local sim
npx wrangler d1 migrations list  beauteas-db-dev --remote --env dev            # show pending
```

---

## Redirects & Environment Data

> **`migrations/data/*.sql` is environment data, NOT schema.** These files are deliberately **not** numbered `NNNN_*.sql` — Wrangler tracks migrations by filename, and re-running seed data on a fresh DB should be a deliberate act, not an automatic one. Apply them by hand with `d1 execute --file`. Every file uses `INSERT OR REPLACE` / `INSERT OR IGNORE` so it is re-runnable.

| File | Contents |
|---|---|
| `migrations/data/redirects.sql` | 51 Shopify→Mercora 301s in `redirect_map` |
| `migrations/data/blog-content.sql` | 21 blog posts + the `learn` blog category |

```bash
npx wrangler d1 execute beauteas-db     --env production --remote --file=migrations/data/redirects.sql
npx wrangler d1 execute beauteas-db-dev --env dev        --remote --file=migrations/data/redirects.sql
```

### How redirects resolve (`middleware.ts`)

1. For a path under `/products/`, `/collections/`, `/pages/`, `/blogs/`, or `/policies/`, look up an exact `source_path` in `redirect_map` → 301 to `target_path`.
2. No row → **structural fallback**, which exists only for the first three prefixes:
   `/products/:slug`→`/product/:slug` · `/collections/:slug`→`/category/:slug` · `/pages/:slug`→`/:slug`
3. `/blogs/` and `/policies/` are **exact-match only** — the fallback chain has no branch for them, so an unmatched path 404s honestly instead of being mangled (Shopify nests blogs as `/blogs/:blog/:slug`, and `/policies/*` slugs don't map positionally).

**Static redirects in `next.config.ts` run BEFORE middleware** (Next's order is headers → redirects → middleware → rewrites). `/about` → `/about-us` lives there because a bare `/about` matches none of the five `redirect_map` prefixes, so a row would never fire. A `/pages/about` request therefore chains: middleware structural fallback → `/about` → static redirect → `/about-us`.

**Only add rows where the slug or shape actually CHANGED.** A row whose target equals what the fallback already produces is dead weight. At cutover every `/products/*` and `/collections/*` handle survived the ETL intact, so the 51 rows cover only: 21 nested `/collections/:c/products/:p` (the fallback would mangle these), 22 blog URLs, 5 `/policies/*`, and 3 legal pages deleted by migration `0016`.

**Blog images** were rehosted from Shopify's CDN into R2 under `blog/` in **both** buckets and are referenced as absolute `https://img.beauteas.com/blog/<file>` URLs — the raw (non-`/cdn-cgi/image/`) path, so they survive Image Transformations being off. Because the URLs are absolute, the dev Worker also serves blog images from the **prod** bucket; the `beauteas-images-dev` copy is insurance, not what dev actually reads.

> ✅ **Soft-404s are fixed (PR #98).** `/nope`, `/product/nope`, `/category/nope` and `/blog/nope` now return a real **404**, so status codes are trustworthy for redirect verification.
>
> ⚠️ **Do not reintroduce a root `app/loading.tsx`.** That is what caused the soft-404s: a root `loading.tsx` wraps every route in a Suspense boundary, and with the root layout `force-dynamic` Next flushes the shell (committing a 200) before the page runs `notFound()`. Deleting it is what makes the status correct — you cannot have both a root Suspense boundary and a real 404, so the global navigation spinner is gone. Nested loading files are fine on segments that never `notFound()` or aren't indexed (`app/account/loading.tsx` is kept — auth-gated). The trap is recorded in code at `app/layout.tsx`.

---

## CMS Pages & Authoring Conventions

Footer-linked pages (`/brewing-directions`, `/faq`, `/contact`, the policy pages, `/about-us`, `/subscriptions`) store plain HTML in D1 and stay admin-editable — the design lives in the renderer, so new pages inherit it.

`app/[slug]/PageRenderer.tsx` sanitizes the stored HTML, parses it into a typed section model (`lib/cms/page-sections.ts`), and renders one of five templates chosen by the `pages.template` column (`lib/cms/page-template.ts`).

| Template | Layout | Renders conventions? |
|---|---|---|
| `guide` | Sectioned cards, contents rail | ✅ specs, callouts, blend column |
| `faq` | Accordion (a bold paragraph ending in `?` is promoted to a question) | — |
| `contact` | Icon grid | — |
| `legal` | Document with "Last Updated" pill + policy links | — |
| `story` | Long-form narrative + shop CTA. **Also the fallback** for any unrecognized value | — |

**Markup conventions (guide template only):**

| Markup | Becomes |
|---|---|
| `<h2>` | section boundary + rail anchor |
| `<ul class="specs">` | spec chips |
| `<blockquote>` | callout |
| `<figure class="blend"><a href="/product/:slug">` | shoppable column with live price |

- **`<h2>` must be at the top level.** A heading nested inside a wrapper element is left inline as ordinary markup — splitting at depth would emit unbalanced HTML into `dangerouslySetInnerHTML`.
- Extra classes and attributes are fine (`class="specs mt-4"`, an `id`) — matching is on the class token.
- Conventions are extracted **only for the template that renders them**. A `<blockquote>` on a legal page stays inline rather than being lifted and dropped.
- An unresolvable `figure.blend` (bad slug, non-product href, or a second figure in one section) is left inline rather than deleted.
- Content images go in as absolute `https://img.beauteas.com/pages/<file>` URLs, matching the blog convention — raw `<img>` inside `dangerouslySetInnerHTML` never passes through `image-loader.ts`, so a relative `/media/` path would bypass the image CDN entirely.

> ⚠️ **Two "template" registries.** `lib/cms/page-template.ts` is the render-time source of truth; the admin editor's Template dropdown is built from the `page_templates` **table**. Adding a kind to `TEMPLATE_KINDS` must be paired with a `page_templates` INSERT (see migration `0020`), or admins cannot select it and re-saving the page through the editor resets it to the `story` fallback.

---

## AI System (Chai)

```
User query → BGE embeddings → Vectorize search → context → text model → response + products
```

- **Config:** `lib/ai/config.ts`
  - **Text generation:** `@cf/openai/gpt-oss-20b` (temp 0.3, ~512 max tokens)
  - **Embeddings:** `@cf/baai/bge-base-en-v1.5` (**768 dimensions** — must match the Vectorize index dims)
- **System prompt / chat logic:** `app/api/agent-chat/route.ts` — **public** (the storefront chat widget serves anonymous visitors); Clerk `userId`, when present, is used only for personalization + as the rate-limit key. Abuse-contained via `AI_RATE_LIMITER`, input-length caps, prompt-injection sanitization, and an admin gate on the content-generation mode (BMC-180/BMC-139). Context-aware: user name, order history, geolocation, recent chat history.
- **Indexing:** `app/api/admin/vectorize` rebuilds the index from the `products` table + knowledge markdown in R2, embedding both with BGE. Content source files live under `data/r2/products_md/` and `data/r2/knowledge_md/`.
- **PDP recommendations** ("Recommended for you") are a separate seam from Chai: `lib/recommendations/` (`getRecommendationsForProduct`) picks a `deterministic` or `ai_batch` provider (`recommendations.strategy` admin setting), blends in live personalization from order history, and is called **server-side** on the product page — it is no longer routed through `/api/agent-chat`. `ai_batch` reads precomputed rows from the `product_recommendations` table (see [migrations](#database--migrations)), rebuilt via an admin endpoint or the `workers/recommendations-cron/` scheduled Worker.

> ⚠️ **Branding debt:** The assistant's prompt/comments here have been rebranded to **Chai** (skincare-tea voice), but outdoor-gear copy still lingers *outside* the assistant (MCP tools, emails, marketing copy). See [Known Branding Debt](#known-branding-debt).

---

## Authentication

Two layers; both **fail closed** (default deny). The prior P0 (unauthenticated order/refund APIs) is **fixed**.

### `lib/auth/unified-auth.ts` — order/refund + service auth
- **Protects:** `POST /api/orders/refund` (`ORDERS_UPDATE`) and the admin path of `GET /api/orders` (`?admin=true` → `ORDERS_READ`).
- **Credentials:**
  - **API token** via `Authorization: Bearer` or `X-API-Key` (header-only — no `?token=` query params). `ADMIN_VECTORIZE_TOKEN` (timing-safe) grants `admin:*`; `api_tokens` rows store SHA-256 hashes with per-token permissions + expiry.
  - **Clerk session** for the browser admin UI → `isUserAdmin()` (checks `admin_users` table or Clerk metadata `role=admin`).
- **Dev parity:** any signed-in Clerk user is admin when `NODE_ENV=development` (never true in the production Worker).

### `lib/auth/admin-middleware.ts` — `/api/admin/*`
- Clerk session (admin check) **or** `ADMIN_VECTORIZE_TOKEN` header. Dev-only bypass header `x-dev-admin: mercora-dev-bypass`.

### Token management
`scripts/manage-tokens.ts` (`npm run token:generate|list|revoke`) mints/revokes scoped `api_tokens` rows for webhooks/automation. SHA-256 hashing matches the `unified-auth.ts` verifier.

---

## API Routes (by area)

- **Public:** `/api/categories`, `/api/products`, `/api/products/[id]`, `/api/products/[id]/subscription-plans`, `/api/pages/[slug]`, `/api/validate-discount`, `/api/tax`, `/api/shipping-options`, `/api/email/unsubscribe` (CAN-SPAM opt-out — GET confirm page, POST opts out; BMC-184)
- **Orders/payments:** `GET/POST /api/orders`, `GET /api/orders/[id]`, `POST /api/orders/refund` (auth), `POST /api/payment-intent`
- **Subscriptions:** `GET/POST /api/subscriptions`, `POST /api/subscriptions/[id]` (pause/resume/cancel — Clerk user)
- **Webhooks:** `POST /api/webhooks/stripe` (payment_intent, subscription, invoice, `charge.refunded`; dedup via `processed_webhook_events`). `charge.refunded` reconciles refunds issued outside the app into the `orders.extensions.refunds[]` ledger so the over-refund guard can see them (BMC-213) — it must also be **subscribed on the Stripe endpoint**, or the handler never runs
- **Agent:** `POST /api/agent-chat` (Chai)
- **Admin (`/api/admin/*`):** `vectorize`, `analytics/*`, `categories`, `products`, `pages`, `reviews`, `subscriptions`, `knowledge`, `upload-image`, etc.
- **MCP server:** `GET /api/mcp` (capabilities), `POST /api/mcp` (tool exec), `GET /api/mcp/schema`, plus `/api/mcp/tools/*` REST endpoints. Per-agent API keys + rate limits; persistent sessions with cart state.

---

## Project Structure

```
app/                    # Next.js App Router (storefront, /admin, /api)
  api/                  # route handlers (see API Routes above)
  admin/                # admin dashboard (products, orders, categories, pages, reviews, subscriptions, settings)
components/             # React components (agent/, cart/, checkout/, admin/, ui/)
  pages/                # CMS page template components (hero, rail, section card, CTA)
lib/
  ai/config.ts          # AI model + embedding config
  auth/                 # unified-auth.ts, admin-middleware.ts
  cms/                  # CMS render pipeline: html normalization, section parsing,
                        #   template config, blend (product) resolution
  db.ts, db/schema/     # Drizzle connection + schema (runtime queries)
  models/ (+ mach/)     # data access layer
  seo/metadata.ts       # SITE_NAME / BASE_URL / metadata helpers
  brand.config.ts       # brand tagline, palette, fonts
  mcp/                  # MCP server implementation
  stores/               # Zustand stores (cart, chat)
data/r2/                # content synced to R2: products_md/, knowledge_md/
migrations/             # Wrangler D1 SQL migrations (0001–0023)
scripts/
  manage-tokens.ts      # API token CLI
  shopify-migration/    # Shopify→Mercora ETL (migrate-all.ts)
emails/                 # React Email templates
docs/                   # architecture & integration docs
```

---

## State Management

- **Zustand stores** (`lib/stores/`): `cart-store`, `chat-store`, server chat context.
- **Hooks** (`hooks/`): enhanced user context, cart persistence.

---

## Development Guidelines

- **TypeScript** strict; function components; `@/*` path alias → repo root.
- **Files** kebab-case; **components** PascalCase.
- **Data:** Drizzle for queries; MACH Alliance models for commerce entities; raw SQL + Wrangler for migrations.
- **Secrets:** `.dev.vars` / `.env.local` locally; `wrangler secret put … --env <env>` for deployed envs. Never commit secrets or pass them as CLI args.
- **Run `npm run lint`** before considering work done.
- **Tests:** Vitest unit (`tests/unit/**`), `@cloudflare/vitest-pool-workers` integration, and Playwright E2E. ⚠️ **CI gates on lint + `tsc --noEmit` + the unit suite + build only** — `test:workers` and E2E do **not** run in CI, so a regression test only actually blocks a merge if it is unit-style under `tests/unit/`. Unit tests must not touch Cloudflare bindings: mock the model layer (`vi.mock("@/lib/models/…")`) rather than reaching for the Workers pool.

### Money & Pricing
All monetary values flow through `lib/money` (`Money`). Internal unit is **integer minor units**; use `Money.fromMinor/fromMajor/fromStored`. Emit MACH `{amount, currency, precision}` via `.toMach()` ONLY at API/MCP/JSON-LD boundaries; use `.toMinorUnits()` at the Stripe boundary; persist via `.toJSON()` (minor units); display via `.format()`. Never write raw `*100`/`/100`. See [`docs/money.md`](docs/money.md).

---

## Cutover Status

Migration is tracked under `.planning/` (GSD); the runbook is `PRODUCTION-CUTOVER-RUNBOOK.md` (original scope: `MIGRATION-PLAN.md`).

**Built & audited (code-complete):** SEO foundations + Shopify redirects · Stripe subscriptions (schema, API, webhooks, UI, admin) · Shopify ETL pipeline · customer account pages · admin enhancements · pre-launch polish. P0 auth re-enabled and fail-closed.

**Migration status (2026-07-30): `beauteas-db` (prod) is caught up through `0021`** — `0001`–`0021` all applied, `wrangler d1 migrations list` reported none pending as of the `0021` apply. `0019`+`0020` were applied 2026-07-30 after deploying the app, with a pre-flight `d1 export` backup and post-apply verification of effects (templates set on all 9 footer pages, `about` archived, images repointed to `img.beauteas.com`, `page_templates` seeded with the five render kinds, 8 `page_versions` snapshots). **`0022`+`0023` (BMC-216A, this PR) are local-only** — remote dev/prod apply is BMC-231. See the ⚠️ deploy-ordering note on `0022` in the migration table above before deploying any build containing it.

> ⚠️ **Remote dev needed a manual image fix.** `0019` was applied to remote dev *during* PR development, before its image URLs were changed to the CDN host — so its `content LIKE '%85A6329%'` guards no longer matched and the pages kept relative `/media/pages/` URLs. Corrected in place with `UPDATE pages SET content = replace(content, '/media/pages/', 'https://img.beauteas.com/pages/')`. Production was unaffected (it received the final file). `0013`–`0018` were applied 2026-07-27 with a pre-flight `d1 export` backup and post-apply verification of each migration's *effects* (tables created, legal-page content actually rewritten 604→6951 / 542→4586 chars, `shipping_address` column present, 4 `page_versions` snapshots written).

**Infra provisioned (2026-06-27):** dev + prod D1, R2, and Vectorize created. **Migrations `0001`–`0011` applied** across `beauteas-db`, `beauteas-db-dev`, and the dev preview DB — `0009` + both `0010` (blog, gift cards) applied 2026-06-29; `0011_hash_mcp_api_keys` (BMC-141/BMC-155) applied to all three 2026-07-04 (prod `api_key_hash` column verified live); `0012_remove_seeded_test_agent` (BMC-136/C9) applied to all three 2026-07-06 — `test-agent` row verified gone from prod + remote dev. Local dev auto-restores the agent from `data/d1/seed-dev.sql`; to keep it on the **deployed dev** Worker for manual testing, re-run that dev-only seed against remote dev (`npx wrangler d1 execute beauteas-db-dev --remote --env dev --file data/d1/seed-dev.sql`) — never against prod.

**Redirects + blog content loaded (2026-07-27):** the `redirect_map` table was empty in both envs (the ETL never populated it). It now holds **51 rows** in prod *and* dev, and the Shopify `/blogs/learn` blog (**21 posts**, 44 images) has been migrated. See [Redirects & Environment Data](#redirects--environment-data).

**Operational work still remaining before go-live:**
- ✅ Prod **live keys** (`pk_live_…` Clerk + Stripe) are in `wrangler.jsonc`, and all six prod **secrets** are set (`CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_VECTORIZE_TOKEN`, `EMAIL_UNSUBSCRIBE_SECRET`) — verified via `wrangler secret list --env production` 2026-07-27. A 7th secret, `ORDER_STATUS_SECRET` (BMC-216A), still needs provisioning on dev + prod — tracked under BMC-231 along with the `0022`/`0023` remote/prod migration apply.
- Seed `admin_users` with production Clerk IDs.
- Configure Stripe live: subscription prices/coupons + webhook endpoint.
- **Run the Shopify ETL** (`scripts/shopify-migration/migrate-all.ts`, supports `--entity=<name>`) — rehearse against dev, then run against prod. See **[`SHOPIFY-ETL.md`](SHOPIFY-ETL.md)** for full steps/gotchas (notably: set `D1_REMOTE=true` or it writes to the local D1). ✅ Validated against dev 2026-06-29 (catalog + pages + images). **Prod run still pending.**
- Deploy prod build, smoke test, **DNS switch** + Clerk/Stripe domain config, then post-cutover verification (orders, subscriptions, redirects, auth).

**Shipped since original plan (no longer deferred):** gift cards (BMC-72/125 — schema live, redeem path tested against real D1), blog tables (BMC-121), and an automated test framework (BMC-69 — Vitest unit + `@cloudflare/vitest-pool-workers` integration + Playwright E2E).

**Still deferred (post-launch, not blockers):** Klaviyo, wishlist, search autocomplete, broader test coverage.

---

## Known Branding Debt

The repo was forked from a prior project (**Voltique** outdoor gear / **Mercora**). The AI assistant has been renamed **Volt → Chai** and given a warm, girlie beauty-bestie voice across the chat UI + `app/api/agent-chat/route.ts`. Remaining leftover branding to clean up over time:
- ✅ **Outdoor-gear copy outside the assistant — rebranded (BMC-90).** MCP tools (`lib/mcp/tools/*`) are now catalog-driven (recommendations/bundles derive from `listCategories`/product categories, not hardcoded tents/backpacks; capabilities endpoint built from the live catalog via `lib/mcp/catalog.ts`); transactional emails (`lib/utils/email.ts`), marketing copy (`app/page.tsx`, `components/HeaderClient.tsx`, `app/[slug]/PageRenderer.tsx`), admin AI prompts (`app/admin/pages/PageManagement.tsx`, `app/api/admin/generate-product-description/route.ts`) and admin placeholders (`components/admin/ProductEditor.tsx`, `app/admin/knowledge/KnowledgeManagement.tsx`) now use tea/skincare copy. Seeded CMS pages fixed in `migrations/0003` (fresh DBs) + `migrations/0009` (updates existing rows).
- ⚠️ **Sample vector-source content** in `data/r2/products_md/*.md` still has placeholder outdoor names (e.g. "Vivid Mission Pack", military/tactical tags). This is seed data for the Vectorize index that the Shopify ETL replaces at cutover (the real catalog lives in `data/d1/seed.sql` and is already tea-branded). Not user-facing; left for the ETL.
- ✅ **Chat mascot asset — done.** Chai is now a purpose-drawn teacup character in brand colours, shipped as two hand-authored SVGs: `public/chai.svg` (48px viewBox, full character — sprig, steam, saucer) for 32px+ renders, and `public/chai-mark.svg` (24px viewBox, simplified — one leaf, no steam, thicker strokes) for 16–24px renders. The legacy 2MB `data/r2/volt.svg` is deleted. **Pick the mark by rendered size, not by context** — the full character mushes below ~32px, which is why the mobile launcher, chat avatars and admin AI buttons all use `chai-mark.svg`.
- "voltique"/"mercora" strings linger in docs (`PRODUCTION-CUTOVER-RUNBOOK.md`, `docs/`, `.planning/`) and the `x-dev-admin: mercora-dev-bypass` header value.
- `package.json` name is still `mercora` (intentional — platform name).

---

## Troubleshooting

| Issue | Check |
|---|---|
| Binding `undefined` in Worker | Binding name matches `wrangler.jsonc`; rerun `npm run cf-typegen` |
| Build/deploy issues | Use the OpenNext path (`npm run deploy:dev`/`:production`), not bare `wrangler deploy` |
| Migration "table already exists" | DB schema applied outside Wrangler tracking — reconcile `d1_migrations`, don't re-run SQL |
| AI/vector errors | Vectorize index dims (768) match BGE model; index populated via `/api/admin/vectorize` |
| Vectorize CLI `list` auth error | The current API token can `create`/`get` indexes but not `list` (code 10000) — not a deploy blocker |

```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command "SELECT name FROM sqlite_master WHERE type='table'"
npx wrangler tail --env dev   # live logs
```

---

## Reference Docs
- `PRODUCTION-CUTOVER-RUNBOOK.md` — go-live runbook · `MIGRATION-PLAN.md` — original scope · `SHOPIFY-ETL.md` — Shopify→Mercora ETL steps & gotchas
- `docs/` — architecture, AI pipeline, Stripe, API structure, MCP spec
- `wrangler.jsonc` — Cloudflare config · `lib/brand.config.ts` / `lib/seo/metadata.ts` — brand/SEO

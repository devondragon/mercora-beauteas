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
- **Payments:** Stripe `^18` (`stripe`, `@stripe/react-stripe-js`, `@stripe/stripe-js`)

### Key dependencies (exact)
```
next ^15.5.19 · react ^19 · drizzle-orm ^0.45.2 · drizzle-kit ^0.31.4
@opennextjs/cloudflare ^1.20.1 · wrangler ^4.105.0 · @cloudflare/workers-types ^4.20250726.0
@clerk/nextjs ^6.39.5 · stripe ^18.4.0 · zustand ^5.0.6 · resend ^4.8.0
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
```

- **Deploys go through OpenNext**, not bare `wrangler deploy`. Worker entry is `.open-next/worker.js`.
- **Always `npm run lint`** after changes.
- `open-next.config.ts` enables R2-backed ISR incremental cache (`NEXT_INC_CACHE_R2_BUCKET`).
- Lint = `.eslintrc.json` extends `next/core-web-vitals`. **No Prettier configured.**

---

## Cloudflare Configuration (`wrangler.jsonc`)

Two named environments. **Resources for both dev and prod are provisioned** (D1, R2, Vectorize created; all 8 migrations applied → ~36 tables in each DB).

| | **dev** (`--env dev`) | **production** (`--env production`) |
|---|---|---|
| Worker name | `beauteas-dev` | `beauteas` |
| D1 database | `beauteas-db-dev` (`f88149dc-…`) + preview (`0a037b06-…`) | `beauteas-db` (`5dbae836-ff0f-420c-9ac0-16088ceb60ee`) |
| R2 (`MEDIA` + `NEXT_INC_CACHE_R2_BUCKET`) | `beauteas-images-dev` (+ `-dev-preview`) | `beauteas-images` |
| Vectorize | `beauteas-index-dev` | `beauteas-index` (both 768-dim, cosine) |
| Clerk publishable key | `pk_test_…` (set) | ⚠️ `REPLACE_WITH_LIVE_CLERK_KEY` |
| Stripe publishable key | `pk_test_…` (set) | ⚠️ `REPLACE_WITH_LIVE_STRIPE_KEY` |

- **Shared bindings** (inherited): `ASSETS` (`.open-next/assets`), `AI`, observability enabled, empty `durable_objects`.
- **Compatibility:** date `2024-12-01`, flags `["nodejs_compat", "global_fetch_strictly_public"]`.
- **Secrets** are per-env via `wrangler secret put … --env <dev|production>` (NOT in config):
  `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_VECTORIZE_TOKEN`.
- Binding types are generated to `cloudflare-env.d.ts` (committed) via `npm run cf-typegen`.

---

## Database & Migrations

> **Migrations are Wrangler-managed raw SQL — NOT Drizzle-generated.** There is no `drizzle.config.*` and no `drizzle-kit generate` step. Drizzle is the **runtime query/ORM layer only**.

- **Migration files:** `migrations/NNNN_name.sql` (hand-written SQL). Wrangler tracks applied state in the `d1_migrations` table per database.
- **Drizzle schema** (TypeScript, for queries): `lib/db/schema/` (~22 files; `index.ts` re-exports). `lib/db.ts` exposes cached `getDb()` / `getDbAsync()` via `drizzle(env.DB, { schema })`.
- **Data access layer:** `lib/models/` (incl. `lib/models/mach/` for MACH Alliance entities).

### Current migrations (8 → ~36 tables)
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

## AI System (Chai)

```
User query → BGE embeddings → Vectorize search → context → text model → response + products
```

- **Config:** `lib/ai/config.ts`
  - **Text generation:** `@cf/openai/gpt-oss-20b` (temp 0.3, ~512 max tokens)
  - **Embeddings:** `@cf/baai/bge-base-en-v1.5` (**768 dimensions** — must match the Vectorize index dims)
- **System prompt / chat logic:** `app/api/agent-chat/route.ts` (Clerk-authenticated). Context-aware: user name, order history, geolocation, recent chat history.
- **Indexing:** `app/api/admin/vectorize` rebuilds the index from the `products` table + knowledge markdown in R2, embedding both with BGE. Content source files live under `data/r2/products_md/` and `data/r2/knowledge_md/`.

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

- **Public:** `/api/categories`, `/api/products`, `/api/products/[id]`, `/api/products/[id]/subscription-plans`, `/api/pages/[slug]`, `/api/validate-discount`, `/api/tax`, `/api/shipping-options`
- **Orders/payments:** `GET/POST /api/orders`, `GET /api/orders/[id]`, `POST /api/orders/refund` (auth), `POST /api/payment-intent`
- **Subscriptions:** `GET/POST /api/subscriptions`, `POST /api/subscriptions/[id]` (pause/resume/cancel — Clerk user)
- **Webhooks:** `POST /api/webhooks/stripe` (payment_intent, subscription, invoice; dedup via `processed_webhook_events`)
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
lib/
  ai/config.ts          # AI model + embedding config
  auth/                 # unified-auth.ts, admin-middleware.ts
  db.ts, db/schema/     # Drizzle connection + schema (runtime queries)
  models/ (+ mach/)     # data access layer
  seo/metadata.ts       # SITE_NAME / BASE_URL / metadata helpers
  brand.config.ts       # brand tagline, palette, fonts
  mcp/                  # MCP server implementation
  stores/               # Zustand stores (cart, chat)
data/r2/                # content synced to R2: products_md/, knowledge_md/
migrations/             # Wrangler D1 SQL migrations (0001–0008)
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
- **Run `npm run lint`** before considering work done. There is **no automated test framework** yet (manual verification only).

---

## Cutover Status

Migration is tracked under `.planning/` (GSD); the runbook is `PRODUCTION-CUTOVER-RUNBOOK.md` (original scope: `MIGRATION-PLAN.md`).

**Built & audited (code-complete):** SEO foundations + Shopify redirects · Stripe subscriptions (schema, API, webhooks, UI, admin) · Shopify ETL pipeline · customer account pages · admin enhancements · pre-launch polish. P0 auth re-enabled and fail-closed.

**Infra provisioned (2026-06-27):** dev + prod D1, R2, and Vectorize created; all 8 migrations applied across `beauteas-db`, `beauteas-db-dev`, and the dev preview DB.

**Operational work still remaining before go-live:**
- Fill prod **live keys** in `wrangler.jsonc` (`REPLACE_WITH_LIVE_CLERK_KEY`, `REPLACE_WITH_LIVE_STRIPE_KEY`) and set prod **secrets** (`CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, strong `ADMIN_VECTORIZE_TOKEN`).
- Seed `admin_users` with production Clerk IDs.
- Configure Stripe live: subscription prices/coupons + webhook endpoint.
- **Run the Shopify ETL** (`scripts/shopify-migration/migrate-all.ts`, supports `--entity=<name>`) — rehearse against dev, then run against prod. Never executed against real data yet.
- Deploy prod build, smoke test, **DNS switch** + Clerk/Stripe domain config, then post-cutover verification (orders, subscriptions, redirects, auth).

**Deferred (post-launch, not blockers):** blog backend, Klaviyo, gift cards, wishlist, search autocomplete, automated tests.

---

## Known Branding Debt

The repo was forked from a prior project (**Voltique** outdoor gear / **Mercora**). The AI assistant has been renamed **Volt → Chai** and given a warm, girlie beauty-bestie voice across the chat UI + `app/api/agent-chat/route.ts`. Remaining leftover branding to clean up over time:
- ✅ **Outdoor-gear copy outside the assistant — rebranded (BMC-90).** MCP tools (`lib/mcp/tools/*`) are now catalog-driven (recommendations/bundles derive from `listCategories`/product categories, not hardcoded tents/backpacks; capabilities endpoint built from the live catalog via `lib/mcp/catalog.ts`); transactional emails (`lib/utils/email.ts`), marketing copy (`app/page.tsx`, `components/HeaderClient.tsx`, `app/[slug]/PageRenderer.tsx`), admin AI prompts (`app/admin/pages/PageManagement.tsx`, `app/api/admin/generate-product-description/route.ts`) and admin placeholders (`components/admin/ProductEditor.tsx`, `app/admin/knowledge/KnowledgeManagement.tsx`) now use tea/skincare copy. Seeded CMS pages fixed in `migrations/0003` (fresh DBs) + `migrations/0009` (updates existing rows).
- ⚠️ **Sample vector-source content** in `data/r2/products_md/*.md` still has placeholder outdoor names (e.g. "Vivid Mission Pack", military/tactical tags). This is seed data for the Vectorize index that the Shopify ETL replaces at cutover (the real catalog lives in `data/d1/seed.sql` and is already tea-branded). Not user-facing; left for the ETL.
- The chat **mascot asset** is still `data/r2/volt.svg` (referenced as `/volt.svg`); rename when the image itself is updated for Chai. *(Tracked separately.)*
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
- `PRODUCTION-CUTOVER-RUNBOOK.md` — go-live runbook · `MIGRATION-PLAN.md` — original scope
- `docs/` — architecture, AI pipeline, Stripe, API structure, MCP spec
- `wrangler.jsonc` — Cloudflare config · `lib/brand.config.ts` / `lib/seo/metadata.ts` — brand/SEO

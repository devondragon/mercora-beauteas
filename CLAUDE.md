# BeauTeas — Claude AI Assistant Reference

Essential context for Claude when working on **BeauTeas**, an AI-enhanced eCommerce storefront built on the **Mercora** platform.

> **Status:** BeauTeas is closing, and the going-out-of-business sale is **LIVE on production** as of 2026-08-15: migrations `0025`–`0031` applied, both bundle SKUs archived, all three blends repriced to $3.00 a box against a $20.00 compare-at. Shipping is a flat **$1.00 per box** (`shipping.per_box_cost`, migration `0032`) rather than the banded model the runbook was originally written around. **The sale ships from the `goob` branch, deployed manually — it is not being merged to `main`**, so the production-deploy-guard workflow is out of play and confirming the gate went green for the exact SHA is a manual step (runbook Phase 0.5). Still outstanding: the production Vectorize rebuild (needs the owner's prod `ADMIN_VECTORIZE_TOKEN`), the inventory recount, the promo banner, the Phase 7 checklist, and the DNS switch — see [`docs/goob-rollout-runbook.md`](docs/goob-rollout-runbook.md), [`docs/cutover-status.md`](docs/cutover-status.md), and `PRODUCTION-CUTOVER-RUNBOOK.md`.

---

## ☑ Migrations: prod and dev both applied through `0031`; `0032` (per-box shipping) lands with the next deploy (verified 2026-08-16)

Prod (`beauteas-db`), remote dev, and dev preview all report **up to date through `0024`** (`npm run db:migrate:status:{dev,production}`). The former "`main` is undeployable" blocker (BMC-231) is resolved — `0022`–`0024` were auto-applied by the BMC-239 deploy hook with pre-flight backups.

`0025`–`0031` (the going-out-of-business sale: settings seed, closing content, em-dash sweep, variant withdrawal, subscription deactivation, box-math content, pre-launch copy fixes) are applied on production and dev as of 2026-08-15, as are `0032_seed_per_box_shipping.sql` ($1.00-per-box shipping), `0033_repair_double_encoded_variant_json.sql` and `0034_restore_evening_product_type.sql` (repairs for admin-editor damage, 2026-08-16). `0035_normalize_legacy_setting_values.sql` JSON-encodes the eleven legacy `admin_settings` rows that held bare strings and applies on the next `npm run deploy:*`. **The next new migration after these is `0036_*`.**

`npm run deploy:*` backs up and applies pending migrations before every build, so a deploy can no longer land code on an unmigrated database. CI (`ci.yml`) still never applies migrations — only the deploy path does. Run `npm run db:migrate:status:production` before dispatching a prod deploy so you know what's about to land.

Full detail and the rollback order: [`docs/database-migrations.md`](docs/database-migrations.md).

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

> **Note on naming:** `package.json` is `"name": "mercora"` (the platform). "BeauTeas" is the store/brand instance configured on top of it.

Runtime is Next.js App Router on Cloudflare Workers via OpenNext, with D1 + R2 + Workers AI + Vectorize. Exact versions are in `package.json`.

---

## Commands

```bash
npm run dev               # next dev --turbopack
npm run build
npm run lint              # ESLint: next/core-web-vitals. No Prettier configured.
npm test                  # Vitest unit suite — the only suite CI gates on
npm run preview:dev       # seed local D1/R2 + build + wrangler dev --env dev
npm run deploy:dev        # OpenNext build + deploy
npm run deploy:production
```

- **Always `npm run lint`** after changes.
- **Deploys go through OpenNext** (`npm run deploy:*`), not bare `wrangler deploy`.
- **Plain `npm run dev` 500s on D1-backed routes** — it has no Workers bindings. Use `npm run preview:dev` for anything that touches the database.
- **The Workers runtime reads `.dev.vars`, not `.env.local`.** A secret set only in `.env.local` is invisible to `preview:dev` and to deployed Workers.
- Full command set and per-environment deploy notes: [`docs/cloudflare-environments.md`](docs/cloudflare-environments.md).

---

## Non-negotiables

These are the rules that bite hardest when broken. Everything else is in `docs/`.

### Migrations are Wrangler-managed raw SQL — NOT Drizzle-generated
There is no `drizzle.config.*` and no `drizzle-kit generate` step. Drizzle is the **runtime query/ORM layer only**. Hand-write `migrations/NNNN_name.sql`; Wrangler tracks applied state by **filename**.

**The next new migration is `0036_*`** (`0011`–`0035` are taken, and two files share the `0010` prefix — never renumber an applied migration).

### Deploys auto-apply migrations — so write them expand-first
`npm run deploy:dev` / `deploy:production` (and CI, which calls the latter) run `scripts/d1-migrate.mjs` from a `predeploy:*` hook: it backs up, then applies every pending migration, *before* the build. A failure aborts the deploy, so the Worker never ships against a half-migrated DB. Dev covers the preview DB too.

**It does not inspect your SQL.** A `DROP`/`RENAME`/`DELETE` auto-applies to production unattended, with only the pre-flight R2 backup behind it. Therefore: **never expand and contract in the same migration** — add + backfill in one deploy, drop in a later one, and confirm no deployed code names the thing you're dropping. Run `npm run db:migrate:status:production` before dispatching a prod deploy. Full policy: [`docs/database-migrations.md`](docs/database-migrations.md#-destructive-migration-policy).

### D1 has no `db.transaction()`
Use `db.batch()` for atomic writes.

### Never write raw `*100` / `/100`
All monetary values flow through `lib/money` (`Money`). Internal unit is **integer minor units**; use `Money.fromMinor/fromMajor/fromStored`. Emit MACH `{amount, currency, precision}` via `.toMach()` ONLY at API/MCP/JSON-LD boundaries; use `.toMinorUnits()` at the Stripe boundary; persist via `.toJSON()` (minor units); display via `.format()`. See [`docs/money.md`](docs/money.md).

**One accepted exception: plain-`node` scripts in `scripts/`.** `lib/money` is TypeScript with extensionless internal imports, which `node` alone cannot resolve (`ERR_MODULE_NOT_FOUND`) — and every script there is deliberately a plain-`node`-executable `.mjs` with no build step. `scripts/goob-reprice.mjs` therefore imports `big.js` directly (the same library `money.ts` uses internally) and replicates only `Money.fromMajor`'s USD algorithm, with its reasoning in the file header. This is **not** licence for bare `rate * 100` anywhere: naive float multiplication misrounds ordinary inputs (`Math.round(1.005 * 100) === 100`). Application code has no excuse — it runs under a bundler.

### Do not reintroduce a root `app/loading.tsx`
That is what caused the soft-404s. A root `loading.tsx` wraps every route in a Suspense boundary, and with the root layout `force-dynamic` Next flushes the shell (committing a 200) before the page runs `notFound()`. You cannot have both a root Suspense boundary and a real 404 — which is why the global navigation spinner is gone. Nested loading files are fine on segments that never `notFound()` or aren't indexed (`app/account/loading.tsx` is kept — auth-gated). The trap is recorded in code at `app/layout.tsx`.

### The full launch-readiness suite gates production
CI runs lint, TypeScript, the production dependency audit, unit tests, Workers integration tests, a production OpenNext build, and Playwright against a local Worker preview. Production deployment checks that the exact commit passed the `Launch readiness gate`. Unit tests must still mock the model layer rather than touch Cloudflare bindings directly. See [`docs/testing.md`](docs/testing.md).

### Never commit secrets or pass them as CLI args
`.dev.vars` locally; `wrangler secret put … --env <env>` for deployed environments.

### Don't regenerate `cloudflare-env.d.ts` wholesale
A newer wrangler CLI rewrites bindings as optional (`DB?`), breaking every `env.DB` call site. Hand-add new bindings in the existing required shape.

---

## Where the non-obvious logic lives

Everything else is discoverable by reading the tree; these five encode decisions the code alone won't explain.

| Path | What it owns |
|---|---|
| `lib/fulfillment/` | Shipment domain — pure `transitions.ts` (decision matrix), `service.ts` (guarded CAS + audit event in one `db.batch`), `tracking.ts` (carrier codes + URL builder), `shipping-email.ts` |
| `lib/cms/` | CMS render pipeline — HTML normalization, section parsing, template config, blend (product) resolution |
| `lib/money/` | The `Money` type and every conversion boundary (see above) |
| `lib/recommendations/` | PDP recommendations — a **separate seam** from Chai, called server-side |
| `lib/sale/year-supply.ts` | Box math for the closing sale: 10 cups a box, 36 boxes a year, the stock-aware year-supply offer, and `isSoldByTheBox` (which products may truthfully show a box count). Pure like `lib/sale/rules.ts`, since client bundles (PDP, catalog cards) import it directly |

Carrier codes are pinned in **four** places that must agree: `CARRIERS` in `lib/fulfillment/types.ts`, `buildTrackingUrl`, `normalizeLegacyCarrier`, and the `LIKE` patterns in migration `0022`.

**Going-out-of-business sale settings** (migration `0025`, `admin_settings` table, read via `lib/sale/settings.ts`'s `getSaleRules()`):
- `sale.minimum_boxes` — cart minimum in boxes; enforced server-side (checkout, MCP order tools) and reflected client-side in the drawer/checkout copy.
- `sale.final_sale` — gates all three final-sale surfaces: Chai's refund answer (`lib/ai/deterministic-answers.ts`), the checkout notice (`components/checkout/FinalSaleNotice.tsx`, via `useSaleRules()` → `/api/sale-rules`), and the order-confirmation email line (`lib/utils/email.ts`, via `OrderData.finalSale`, set server-side by `lib/services/order-confirmation.ts`). Every layer defaults to **true** when the value can't be read — an unreadable setting must never produce a checkout or a receipt that omits the no-returns statement. Only an explicit `false` removes the copy. There is no admin UI for this key; changing it means a direct settings write.
- `sale.subscriptions_enabled` — enforced server-side by `rejectIfSubscriptionsDisabled()` (`lib/sale/subscription-gate.ts`) on every surface that STARTS recurring billing: `POST /api/subscriptions`, `POST /api/setup-intent`, and the `resume` / `skip` subroutes (`skip` schedules its own restart). Returns 403; fails closed by not catching, so a settings read failure 500s without reaching Stripe. Deliberately NOT applied to `pause`/`cancel` (never block a customer from stopping a charge), the admin plans route (the tool used to reverse this), or the Stripe webhooks (they only record what already happened in Stripe). `/subscribe/checkout` redirects too, but that is UX — the 403s are the boundary. Migration `0029` also sets `subscription_plans.is_active = 0` as a second, data-level stop. Reversing takes **two** steps, neither of them a migration: flip the plans back on at `/admin/subscriptions`, and write `sale.subscriptions_enabled` directly — like `sale.final_sale`, that key has **no admin UI**. The subscription code itself is otherwise untouched (kept as Mercora upstreaming source material).
- `shipping.per_box_cost` — **the model the sale actually runs on**: a flat dollar cost for every box in the cart, seeded at `1` by migration `0032`. **Zero, absent, or unusable means "not configured"** (`normalizePerBoxCost`), which leaves the tiers or flat rates in force rather than shipping anything free. When above zero it prices the whole cart and **outranks both** `shipping.tiers` and the per-method rates; the multiplication happens once, in `resolveShippingOptions`, so the quote, the charge floor, and Chai cannot diverge. Chosen over bands because measured postage is ~$10 for 10 boxes and ~$9 for 20, and every band boundary was a price cliff that both shocked and capped orders (a 20th box costing $10 of shipping is a reason to buy 19). Editable at `/admin/settings` → Shipping.
- `shipping.tiers` — quantity-tiered shipping cost by box count, **superseded by `shipping.per_box_cost` but kept working**, so switching models back is one settings write. **Empty (`[]`) means "not configured"** and leaves the flat per-method rates (`$5.99`/`$9.99`/`$19.99`) in force — a deliberate safety property, not a bug: seeding this with placeholder bands would have shipped every order free until an admin entered real prices (see Task 4's fix in the SDD ledger). Configure via `/admin/settings` → Shipping. Once **non-empty** it prices the whole cart: a box count above every bounded band resolves to the **top band**, never back to the flat rate (`resolveShippingTier`) — falling back would have undercharged the largest orders, with the charge floor agreeing because it resolves through the same function. The editor warns when no row is open-ended.
- `promotions.banner_link` — URL the storefront promo banner links to.

---

## Development Guidelines

- **Data:** Drizzle for runtime queries; MACH Alliance models (`lib/models/mach/`) for commerce entities; raw SQL + Wrangler for migrations.
- **Secrets:** see Non-negotiables above.
- Run `npm run lint` before considering work done.

---

## Reference Docs

**Operational knowledge (start here):**
- [`docs/database-migrations.md`](docs/database-migrations.md) — migration table, deploy-order blocker, schema-change workflow, D1 gotchas
- [`docs/cloudflare-environments.md`](docs/cloudflare-environments.md) — `wrangler.jsonc` envs, bindings, rate limiters, secrets, deploy commands
- [`docs/testing.md`](docs/testing.md) — the three suites and what CI actually gates
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — symptom → cause table
- [`docs/cutover-status.md`](docs/cutover-status.md) — what's done, what's left before go-live, branding debt

**Subsystems:**
- [`docs/api-routes.md`](docs/api-routes.md) — current route map incl. fulfillment endpoints
- [`docs/auth-model.md`](docs/auth-model.md) — the two fail-closed auth layers
- [`docs/ai-chai.md`](docs/ai-chai.md) — Chai config, indexing, recommendations seam
- [`docs/cms-pages.md`](docs/cms-pages.md) — page templates + markup authoring conventions
- [`docs/redirects.md`](docs/redirects.md) — Shopify→Mercora 301s and how they resolve
- [`docs/money.md`](docs/money.md) · [`docs/observability.md`](docs/observability.md) · [`docs/mcp-server-specification.md`](docs/mcp-server-specification.md) · [`docs/THEMING.md`](docs/THEMING.md)

**Runbooks:**
- [`docs/goob-rollout-runbook.md`](docs/goob-rollout-runbook.md) — the owner's step-by-step for deploying the going-out-of-business sale
- `PRODUCTION-CUTOVER-RUNBOOK.md` — go-live runbook
- `SHOPIFY-ETL.md` — Shopify→Mercora ETL steps & gotchas
- `MIGRATION-PLAN.md` — original scope

**Config:** `wrangler.jsonc` · `lib/brand.config.ts` / `lib/seo/metadata.ts` — brand/SEO

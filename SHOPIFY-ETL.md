# Shopify → Mercora ETL

How to populate a BeauTeas/Mercora environment (D1 + R2) with catalog and content
data extracted from the live Shopify store. This is the **"Run the Shopify ETL"**
step of the [Production Cutover Runbook](PRODUCTION-CUTOVER-RUNBOOK.md).

> **First validated against dev:** 2026-06-29 — 9 Shopify products + 1 seeded gift
> card, 19 variants, 6 categories, 10 CMS pages, 42 images → R2. Zero errors.
> The prod run has **not** been executed yet.

---

## What it does

The ETL (`scripts/shopify-migration/`) extracts structured data from Shopify
(Admin REST API **or** exported files), transforms it to the Mercora/MACH schema,
and loads it into Cloudflare **D1** (via `wrangler d1 execute`) and **R2** (product
images). It is **not** a scraper — it reads Shopify's structured endpoints/exports.

```
Shopify (Admin API or file export)
   → extract  (extractors/shopify-api/ | extractors/file-based/)
   → transform (transformers/  → Mercora/MACH records)
   → load      (loaders/d1-loader.ts → D1,  loaders/r2-loader.ts → R2,
                loaders/clerk-loader.ts → Clerk for customers)
```

The orchestrator is `scripts/shopify-migration/migrate-all.ts`. A per-entity
ID map is persisted to disk between steps (used by `redirects`).

---

## Entities (dependency order)

Run via `migrate-all.ts` (full pipeline) or `--entity=<name>` (single step).

| Entity | Source → target | Notes / deps |
|---|---|---|
| `schema` | applies `migrations/0008_add_redirect_map.sql` | Skip if migrations already applied (will error "table exists"; harmless, caught per-entity). |
| `categories` | Shopify custom + smart collections → `categories` | Registers each collection in the ID map by numeric id **and** handle. |
| `products` | products / variants / images → `products`, `product_variants` (+ images → R2) | Prices stored **inline on variants** (`price` JSON col). Category membership is read from Shopify **collects** (`fetchCollects()`) and written to `products.categories` — requires the `categories` step to have run first (populates the ID map). Smart-collection membership is rule-based and **not** in collects. |
| `customers` | Shopify customers → Clerk + D1 | Needs `CLERK_SECRET_KEY` + `read_customers`. |
| `orders` | Shopify orders → D1 | Requires `customers`, `products` first; `read_orders`. |
| `reviews` | Judge.me reviews → D1 | Requires `products`. |
| `pages` | Shopify CMS pages → `pages` | `read_content`. |
| `redirects` | generate `redirect_map` from accumulated ID map | Run **after** products/pages so the ID map is populated. |
| `validate` | post-migration validation (row counts etc.) | — |

For a storefront-only fill (what dev needed to stop 404ing), only
`categories`, `products`, `pages` are required.

---

## Prerequisites

1. **Migrations applied** to the target DB (all 11 → ~39 tables). The ETL loads
   into existing tables; it does not create the full schema.
2. **Shopify Admin API access token** — Shopify admin → Settings → Apps →
   *Develop apps* → custom app → **Admin API access token** (`shpat_…`).
   The client sends it as `X-Shopify-Access-Token`.
   Required read scopes by entity: `read_products`, `read_content` (pages),
   `read_customers`, `read_orders`. (Storefront-only run needs just
   `read_products` + `read_content`.)
3. **R2 API credentials** (optional) — only needed to localize product images
   into R2. Omit and image upload is skipped gracefully (text/pricing still load).

---

## Configuration (`.env.local`)

> ⚠️ The ETL reads `process.env` directly and does **not** auto-load `.env.local`.
> Run `tsx` with `--env-file=.env.local` (tsx ≥ 4.20). Never pass secrets as CLI args.

```bash
EXTRACTION_MODE=api                              # 'api' (live store) or 'file' (exports)
SHOPIFY_STORE_URL=https://<store>.myshopify.com
SHOPIFY_API_KEY=shpat_xxxxxxxx                   # Admin API ACCESS TOKEN (not key/secret)
# SHOPIFY_API_VERSION=2025-01                     # optional, default 2025-01

# Customer migration only:
# CLERK_SECRET_KEY=sk_...

# Image upload to R2 (optional):
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=beauteas-images-dev               # default; use beauteas-images for prod

# Load target (see "D1 target" below):
# D1_DATABASE_NAME=beauteas-db-dev               # default beauteas-db-dev
# D1_ENV=dev                                      # default dev
# D1_REMOTE=true                                  # REQUIRED for remote DB (see gotcha)
# D1_PREVIEW=true                                 # adds --preview (preview_database_id)
```

`file` mode instead reads `DATA_DIR` (default `scripts/shopify-migration/data/`)
expecting `products.json`/`.csv`, `pages.json`, etc.

---

## ⚠️ Critical gotcha: D1 writes go to LOCAL by default

`wrangler d1 execute` targets the **local** `.wrangler/state` DB unless `--remote`
is passed. Migrations were applied `--remote`, so a default ETL run fails with
`no such table: <table>`.

`lib/wrangler-exec.ts` honors two env flags (added 2026-06-29):

- `D1_REMOTE=true` → adds `--remote` (the deployed environment's database).
- `D1_PREVIEW=true` → adds `--preview` (the env's `preview_database_id`).

**Always set `D1_REMOTE=true`** when populating a deployed environment.

### D1 target — which DB does the deployed Worker read?

The deployed Worker (`wrangler deploy --env <env>`) reads the env's main
`database_id`, **not** `preview_database_id` (preview is only for `wrangler dev`):

| Env | `database_name` | main `database_id` (deployed Worker reads this) |
|---|---|---|
| dev | `beauteas-db-dev` | `f88149dc-32c3-4a04-9c02-95e25db6d735` |
| prod | `beauteas-db` | `5dbae836-ff0f-420c-9ac0-16088ceb60ee` |

So load with `D1_REMOTE=true` and **without** `--preview` to populate what the
deployed site serves. (`wrangler.jsonc` dev preview id is `0a037b06-…`; only set
`D1_PREVIEW=true` if you specifically want to feed `wrangler dev`/preview.)

---

## Running it

### Dev (storefront fill, validated path)

```bash
D1_REMOTE=true npx tsx --env-file=.env.local scripts/shopify-migration/migrate-all.ts --entity=categories
D1_REMOTE=true npx tsx --env-file=.env.local scripts/shopify-migration/migrate-all.ts --entity=products
D1_REMOTE=true npx tsx --env-file=.env.local scripts/shopify-migration/migrate-all.ts --entity=pages
```

Running per-entity keeps required Shopify scopes minimal and skips
customers/orders/reviews. For the full pipeline (needs all scopes + Clerk):

```bash
D1_REMOTE=true npx tsx --env-file=.env.local scripts/shopify-migration/migrate-all.ts
```

### Prod (cutover)

Rehearse against dev first. Then, with **prod live keys/secrets** and prod R2
bucket in `.env.local`:

```bash
D1_REMOTE=true D1_DATABASE_NAME=beauteas-db D1_ENV=production R2_BUCKET_NAME=beauteas-images \
  npx tsx --env-file=.env.local scripts/shopify-migration/migrate-all.ts
```

> Loads run `DELETE … WHERE id LIKE '<prefix>%'` then `INSERT` per table
> (`prod_`/`variant_`/`cat_`). The orchestrator continues past a failed entity
> and reports per-entity status; a run report is written to
> `scripts/shopify-migration/output/migration-report.txt`.
>
> ⚠️ **Re-running `products` against an already-populated DB fails** with
> `FOREIGN KEY constraint failed`: the products step deletes `prod_%` rows while
> `variant_%` rows still reference them. A fresh (empty) target is fine — the
> deletes match nothing. To re-run against populated tables, clear children first
> in FK-safe order:
> ```bash
> npx wrangler d1 execute <db> --remote --env <env> --command \
>   "DELETE FROM product_variants WHERE id LIKE 'variant_%'; DELETE FROM products WHERE id LIKE 'prod_%';"
> ```
> (Seeded `gift-card*` product/variants don't match the ETL prefixes, so they're preserved.)

### Chai search index (Vectorize) + knowledge base

The ETL loads D1/R2 but does **not** build the Vectorize index. Rebuild it after
the catalog is loaded so Chai searches the real products + knowledge base:

1. **Knowledge articles** live in `data/r2/knowledge_md/*.md` and must be uploaded
   to the env's R2 bucket under the `knowledge_md/` prefix (the vectorize route
   reads `MEDIA.list({ prefix: "knowledge_md/" })`). Both dev (`beauteas-images-dev`)
   and prod (`beauteas-images`) buckets are already seeded (2026-06-30). To update:
   ```bash
   npx wrangler r2 object put "<bucket>/knowledge_md/<file>.md" --file="data/r2/knowledge_md/<file>.md" --content-type="text/markdown" --remote
   ```
2. **Rebuild the index** by calling the deployed Worker (it reads products from D1
   + knowledge from R2, clears the old vectors, and re-embeds with BGE):
   ```bash
   curl -H "Authorization: Bearer $ADMIN_VECTORIZE_TOKEN" https://<worker-host>/api/admin/vectorize
   ```
   Auth needs the `ADMIN_VECTORIZE_TOKEN` **secret** set on that Worker
   (`wrangler secret put ADMIN_VECTORIZE_TOKEN --env <env>`). The `x-dev-admin`
   bypass does **not** work on deployed Workers (they run `NODE_ENV=production`).
   Prod must have the catalog loaded + Worker live with live keys + the token set
   before this will produce a useful index.

---

## Verification

```bash
# Row counts (remote)
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command \
  "SELECT 'products' t, COUNT(*) n FROM products
   UNION ALL SELECT 'product_variants', COUNT(*) FROM product_variants
   UNION ALL SELECT 'categories', COUNT(*) FROM categories
   UNION ALL SELECT 'pages', COUNT(*) FROM pages"

# Deployed Worker serves it
curl -s https://beauteas-dev.justblackmagic.workers.dev/api/products    # 10 products
curl -s https://beauteas-dev.justblackmagic.workers.dev/api/categories  # 5 browsable

# Storefront pages
curl -s -o /dev/null -w '%{http_code}\n' https://beauteas-dev.justblackmagic.workers.dev/shop          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://beauteas-dev.justblackmagic.workers.dev/about-us      # 200
curl -sIL https://beauteas-dev.justblackmagic.workers.dev/products/<handle>                            # 301 → /product/<handle> → 200
```

### Expected / known-good observations (dev, 2026-06-29)

- **10 products** = 9 from Shopify + 1 gift-card product seeded by
  `migrations/0010_add_gift_cards.sql`. (Two gift-card entries appear: the Shopify
  "A Gift of Beauty" product and the seeded stored-value gift card — dedupe later if undesired.)
- **`pricing` table is empty by design** — prices live inline on each variant
  (`price` JSON: `{"amount":2999,"currency":"USD"}`). The storefront reads variant price.
- **Product URLs 301-redirect** `/products/<handle>` → `/product/<handle>` — that's the
  Shopify redirect map (cutover SEO), not an error. Final status 200.
- **Categories**: 6 loaded, ~5 browsable (`Home page`/frontpage collection isn't shown as a nav category).
  Product→category links come from collects: Clearly Calendula → 5 teas, Drinkware → 3, Gift Cards → 1.
- **Images**: uploaded to R2 under `products/<handle>.jpg`. Requires the R2_* vars.
  Served to the storefront via the image host: **prod** uses the Cloudflare Images
  CDN (`NEXT_PUBLIC_IMAGE_CDN=https://img.beauteas.com`, set in
  `wrangler.jsonc` production vars); **dev** leaves it unset and serves the same
  R2 objects same-origin through the `/media/[...key]` route (`app/media`). The
  custom `image-loader.ts` picks the host. If product images 404, check the CDN
  var / that the `/media` route resolves (`curl .../media/products/<handle>.jpg`).
- **Descriptions**: Shopify `body_html` is flattened to clean text by
  `scripts/shopify-migration/lib/html-to-text.ts` (used in the product **and**
  category transformers) — hidden `display:none` blocks and `data-sheets-*` paste
  junk are dropped. The storefront renders descriptions as text, so raw HTML would
  otherwise show as literal tags.

> **App-side gotcha (not ETL):** the homepage (`app/page.tsx`) and any code calling
> `getProductsByCategory("…")` reference category **IDs**. After import these are
> `cat_<collection-handle>` (e.g. `cat_clearly_calendula`), not the old seed `cat_1`.
> Empty category pages usually mean either `products.categories` is unpopulated
> (re-run `products` after `categories`) or app code points at a stale category ID.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `no such table: <table>` | Loader ran against **local** D1. Set `D1_REMOTE=true`. |
| Data loads but deployed site still 404s | Wrote to preview DB, or wrong `D1_ENV`/`D1_DATABASE_NAME`. Deployed Worker reads main `database_id` (no `--preview`). |
| `FOREIGN KEY constraint failed` re-running `products` | Re-run against a populated DB — clear `product_variants` then `products` first (see "Re-running" note above). Fresh runs are unaffected. |
| Category pages empty but products exist | `products.categories` null (run `categories` before `products`), or app code references a stale category ID. |
| `API extraction mode requires: SHOPIFY_API_KEY, SHOPIFY_STORE_URL` | Missing creds, or `.env.local` not loaded — use `--env-file=.env.local`. |
| `Shopify API error: 401/403` | Token wrong, or app missing the scope for that entity (`read_products`/`read_content`/`read_customers`/`read_orders`). |
| Images skipped ("R2 credentials not configured") | Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (+ `R2_BUCKET_NAME`). Non-fatal. |
| `command not found` running multi-line `for` loops in shell | Run curl/wrangler/node as separate statements (loop interacts badly with the rtk shell hook). |
| Shopify deprecation notice on `/products.json` | REST still served at `2025-01`; fine for cutover. |

---

## File map

```
scripts/shopify-migration/
  migrate-all.ts            # orchestrator (--entity=, --help)
  migrate-*.ts              # per-entity entrypoints (importable by migrate-all)
  lib/
    config.ts               # reads process.env → MigrationConfig; validates api-mode vars
    shopify-api.ts          # ShopifyClient (X-Shopify-Access-Token, cursor pagination)
    wrangler-exec.ts        # executeSql/executeQuery; D1_REMOTE / D1_PREVIEW flags
    id-map.ts, logger.ts, types.ts
  extractors/shopify-api/   # live API extractors (products, collections, customers, orders, pages)
  extractors/file-based/    # export-file extractors (json/csv)
  transformers/             # Shopify → Mercora/MACH record shaping (+ redirects.ts)
  loaders/                  # d1-loader.ts, r2-loader.ts, clerk-loader.ts
  validators/validate.ts    # post-migration validation
  output/                   # migration-report.txt
```

Related: [PRODUCTION-CUTOVER-RUNBOOK.md](PRODUCTION-CUTOVER-RUNBOOK.md) ·
[MIGRATION-PLAN.md](MIGRATION-PLAN.md) · [CLAUDE.md](CLAUDE.md) (Database & Migrations).

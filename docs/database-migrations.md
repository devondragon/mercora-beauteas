# Database & Migrations

> **Migrations are Wrangler-managed raw SQL — NOT Drizzle-generated.** There is no `drizzle.config.*` and no `drizzle-kit generate` step. Drizzle is the **runtime query/ORM layer only**.

- **Migration files:** `migrations/NNNN_name.sql` (hand-written SQL). Wrangler tracks applied state in the `d1_migrations` table per database, **by filename**.
- **Drizzle schema** (TypeScript, for queries): `lib/db/schema/` (~22 files; `index.ts` re-exports). `lib/db.ts` exposes cached `getDb()` / `getDbAsync()` via `drizzle(env.DB, { schema })`.
- **Data access layer:** `lib/models/` (incl. `lib/models/mach/` for MACH Alliance entities).
- D1 has no `db.transaction()` — use `db.batch()` for atomic writes.

---

## 🚨 Deploy ordering (current blocker)

**`main` cannot be deployed to dev or prod until `0022` + `0023` are applied there (BMC-231).**

Both the migrations (`bb14313`, BMC-225) and the fulfillment code that requires them (`e2474ff`, BMC-226) are on `main`. Deploying without the apply takes down **every order read and write** with "no such column", plus the ship/tracking/events endpoints.

CI never closes this gap: `ci.yml` lints, typechecks, runs the unit suite, and builds — it does not deploy or run migrations. Deploy is a separate `workflow_dispatch`, and `npm run deploy:production` does not run migrations either.

**If a bad deploy needs undoing pre-BMC-231:** roll the app back to a pre-`shipping_carrier` build **first** (redeploy the last-known-good commit), *then* — only once no deployed code names the column — `ALTER TABLE orders DROP COLUMN shipping_carrier;` (SQLite ≥3.35, which D1 supports) is safe. Dropping the column while the new build is still live reproduces the exact outage this warning exists to prevent.

---

## Standing gotchas

> ⚠️ **Two files share the `0010` prefix** (`0010_add_blog_tables` and `0010_add_gift_cards` landed independently). This is harmless — Wrangler tracks applied state by **filename**, and the two are independent — but **do not renumber either now that they're applied**: renaming to `0011_*` would make Wrangler treat it as a new, unapplied migration and re-run it ("table already exists"). The next new migration should be `0024_*` (`0011`–`0023` are taken).
>
> ⚠️ **D1 caps LIKE patterns at 50 characters** ("LIKE or GLOB pattern too complex: SQLITE_ERROR"). Data-only migrations that guard an `UPDATE` / `INSERT ... SELECT` with `content LIKE '%…%'` (the 0009/0016 idempotency pattern) must keep the substring short — a ~50-char guard silently rolls back the whole migration.
>
> ⚠️ **Remote dev's `pages` table diverges from the 0003 seed.** UPDATE-guarded data migrations can silently no-op there — pair them with `INSERT OR IGNORE`.

---

## Current migrations (24 files → ~41 tables)

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
| `0022_add_shipping_carrier.sql` | Adds `orders.shipping_carrier` (typed `ups`/`fedex`/`usps`/`other`/`NULL`) and backfills it from `extensions.carrier` then a narrow `shipping_method` fallback (BMC-216A; the fulfillment domain layer owns this column going forward). Carrier codes are pinned in **four** places that must agree — `CARRIERS` in `lib/fulfillment/types.ts`, `buildTrackingUrl`, `normalizeLegacyCarrier`, and this file's `LIKE` patterns; DHL is deliberately not a code and resolves to `other` (BMC-225 decision: BeauTeas ships UPS/FedEx/USPS). **Applied to local only** — remote dev/prod apply is BMC-231. 🚨 See [Deploy ordering](#-deploy-ordering-current-blocker): `lib/db/schema/order.ts` declares `shipping_carrier` on the Drizzle `orders` table, and Drizzle names every column it selects/inserts/returns (never `SELECT *`), so **every order read and write** 500s with "no such column" on any deployed env missing this column |
| `0023_add_order_events.sql` | Adds `order_events` (append-only fulfillment audit log: `shipment_created`/`tracking_updated`/`shipping_email_*`), FK'd to `orders.id` with `ON DELETE CASCADE` — **restoring an `orders` row from a backup does not restore its deleted `order_events` rows** (BMC-216A). **Applied to local only** — remote dev/prod apply is BMC-231. ⚠️ **Deploy-order-sensitive as of BMC-226 (`e2474ff`)** — it was not when written (ticket B hadn't landed). `lib/fulfillment/service.ts` writes `order_events` inside the same `db.batch()` as the guarded order UPDATE, so on an env missing this table the whole batch fails and `POST …/ship` + `PATCH …/tracking` break outright; `GET …/events` 500s on read |

---

## Making a schema change

1. Update the Drizzle schema/types in `lib/db/schema/` (and `lib/models/`) so app code matches.
2. `npx wrangler d1 migrations create beauteas-db-dev <description>`, then hand-write the SQL in the new `migrations/NNNN_*.sql`.
3. Apply per environment:

```bash
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev            # dev
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev --preview  # dev preview DB
npx wrangler d1 migrations apply beauteas-db     --remote --env production     # production
npx wrangler d1 migrations apply beauteas-db-dev --local  --env dev            # local sim
npx wrangler d1 migrations list  beauteas-db-dev --remote --env dev            # show pending
```

Take a pre-flight `d1 export` backup before applying to a remote environment, and verify the migration's *effects* afterwards (table present, rows actually rewritten) — not just that the command exited 0.

## Inspecting a database

```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev \
  --command "SELECT name FROM sqlite_master WHERE type='table'"
```

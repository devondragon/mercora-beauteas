# Shopify → Mercora Cutover Status

Migration is tracked under `.planning/` (GSD); the runbook is [`PRODUCTION-CUTOVER-RUNBOOK.md`](../PRODUCTION-CUTOVER-RUNBOOK.md) (original scope: [`MIGRATION-PLAN.md`](../MIGRATION-PLAN.md)).

**Status as of 2026-07-31:** all launch-blocking code is built and audited. The remaining work is operational.

---

## Built & audited (code-complete)

SEO foundations + Shopify redirects · Stripe subscriptions (schema, API, webhooks, UI, admin) · Shopify ETL pipeline · customer account pages · admin enhancements · pre-launch polish. P0 auth re-enabled and fail-closed.

**Shipped since the original plan (no longer deferred):** gift cards (BMC-72/125 — schema live, redeem path tested against real D1), blog tables (BMC-121), and an automated test framework (BMC-69 — Vitest unit + `@cloudflare/vitest-pool-workers` integration + Playwright E2E).

**Still deferred (post-launch, not blockers):** Klaviyo, wishlist, search autocomplete, broader test coverage.

---

## Migration status

**`beauteas-db` (prod) is caught up through `0021`** — `0001`–`0021` all applied; `wrangler d1 migrations list` reported none pending as of the `0021` apply (2026-07-30).

`0019`+`0020` were applied 2026-07-30 after deploying the app, with a pre-flight `d1 export` backup and post-apply verification of effects (templates set on all 9 footer pages, `about` archived, images repointed to `img.beauteas.com`, `page_templates` seeded with the five render kinds, 8 `page_versions` snapshots).

🚨 **`0022`+`0023` (BMC-216A) are merged to `main` but applied to LOCAL ONLY** — see the deploy-ordering blocker in [`database-migrations.md`](database-migrations.md).

> ⚠️ **Remote dev needed a manual image fix.** `0019` was applied to remote dev *during* PR development, before its image URLs were changed to the CDN host — so its `content LIKE '%85A6329%'` guards no longer matched and the pages kept relative `/media/pages/` URLs. Corrected in place with `UPDATE pages SET content = replace(content, '/media/pages/', 'https://img.beauteas.com/pages/')`. Production was unaffected (it received the final file).
>
> `0013`–`0018` were applied 2026-07-27 with a pre-flight `d1 export` backup and post-apply verification of each migration's *effects* (tables created, legal-page content actually rewritten 604→6951 / 542→4586 chars, `shipping_address` column present, 4 `page_versions` snapshots written).

## Infra provisioned (2026-06-27)

Dev + prod D1, R2, and Vectorize created. **Migrations `0001`–`0011` applied** across `beauteas-db`, `beauteas-db-dev`, and the dev preview DB — `0009` + both `0010` (blog, gift cards) applied 2026-06-29; `0011_hash_mcp_api_keys` (BMC-141/BMC-155) applied to all three 2026-07-04 (prod `api_key_hash` column verified live); `0012_remove_seeded_test_agent` (BMC-136/C9) applied to all three 2026-07-06 — `test-agent` row verified gone from prod + remote dev.

Local dev auto-restores the agent from `data/d1/seed-dev.sql`. To keep it on the **deployed dev** Worker for manual testing, re-run that dev-only seed against remote dev — **never** against prod:

```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev --file data/d1/seed-dev.sql
```

## Redirects + blog content loaded (2026-07-27)

51 `redirect_map` rows in prod *and* dev, and the Shopify `/blogs/learn` blog (21 posts, 44 images) migrated. See [`redirects.md`](redirects.md).

---

## Operational work still remaining before go-live

- 🚨 **BMC-231 gates every deploy, not just go-live** — apply `0022`+`0023` to remote dev, dev preview, and prod. `main` carries code that requires both; until they're applied, deploying `main` anywhere breaks all order traffic. BMC-231 also provisions `ORDER_STATUS_SECRET`.
- ✅ Prod **live keys** (`pk_live_…` Clerk + Stripe) are in `wrangler.jsonc`, and all six prod **secrets** are set (`CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_VECTORIZE_TOKEN`, `EMAIL_UNSUBSCRIBE_SECRET`) — verified via `wrangler secret list --env production` 2026-07-27. A 7th secret, `ORDER_STATUS_SECRET` (BMC-216A), still needs provisioning on dev + prod — tracked under BMC-231.
- Seed `admin_users` with production Clerk IDs.
- Configure Stripe live: subscription prices/coupons + webhook endpoint (including `charge.refunded`, or the external-refund reconciler never runs).
- **Run the Shopify ETL** (`scripts/shopify-migration/migrate-all.ts`, supports `--entity=<name>`) — rehearse against dev, then run against prod. See [`SHOPIFY-ETL.md`](../SHOPIFY-ETL.md) for full steps/gotchas (notably: set `D1_REMOTE=true` or it writes to the local D1). ✅ Validated against dev 2026-06-29 (catalog + pages + images). **Prod run still pending.**
- Deploy prod build, smoke test, **DNS switch** + Clerk/Stripe domain config, then post-cutover verification (orders, subscriptions, redirects, auth).

---

## Known branding debt

The repo was forked from a prior project (**Voltique** outdoor gear / **Mercora**). The AI assistant has been renamed **Volt → Chai** and given a warm, girlie beauty-bestie voice across the chat UI + `app/api/agent-chat/route.ts`. Remaining leftovers:

- ✅ **Outdoor-gear copy outside the assistant — rebranded (BMC-90).** MCP tools (`lib/mcp/tools/*`) are now catalog-driven (recommendations/bundles derive from `listCategories`/product categories, not hardcoded tents/backpacks; capabilities endpoint built from the live catalog via `lib/mcp/catalog.ts`); transactional emails (`lib/utils/email.ts`), marketing copy (`app/page.tsx`, `components/HeaderClient.tsx`, `app/[slug]/PageRenderer.tsx`), admin AI prompts (`app/admin/pages/PageManagement.tsx`, `app/api/admin/generate-product-description/route.ts`) and admin placeholders (`components/admin/ProductEditor.tsx`, `app/admin/knowledge/KnowledgeManagement.tsx`) now use tea/skincare copy. Seeded CMS pages fixed in `migrations/0003` (fresh DBs) + `migrations/0009` (updates existing rows).
- ⚠️ **Sample vector-source content** in `data/r2/products_md/*.md` still has placeholder outdoor names (e.g. "Vivid Mission Pack", military/tactical tags). This is seed data for the Vectorize index that the Shopify ETL replaces at cutover (the real catalog lives in `data/d1/seed.sql` and is already tea-branded). Not user-facing; left for the ETL.
- ✅ **Chat mascot asset — done.** Chai is a purpose-drawn teacup character in brand colours, shipped as two hand-authored SVGs: `public/chai.svg` (48px viewBox, full character — sprig, steam, saucer) for 32px+ renders, and `public/chai-mark.svg` (24px viewBox, simplified — one leaf, no steam, thicker strokes) for 16–24px renders. The legacy 2MB `data/r2/volt.svg` is deleted. **Pick the mark by rendered size, not by context** — the full character mushes below ~32px, which is why the mobile launcher, chat avatars and admin AI buttons all use `chai-mark.svg`.
- "voltique"/"mercora" strings linger in docs (`PRODUCTION-CUTOVER-RUNBOOK.md`, `docs/`, `.planning/`) and the `x-dev-admin: mercora-dev-bypass` header value.
- `package.json` name is still `mercora` (intentional — platform name).

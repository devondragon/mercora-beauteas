# Shopify → Mercora Cutover Status

Migration is tracked under `.planning/` (GSD); the runbook is [`PRODUCTION-CUTOVER-RUNBOOK.md`](../PRODUCTION-CUTOVER-RUNBOOK.md) (original scope: [`MIGRATION-PLAN.md`](../MIGRATION-PLAN.md)).

**Status as of 2026-08-18:** the Shopify→Mercora cutover itself is done; prod is deployed and taking live orders on `shop.beauteas.com`. The store is winding down — BeauTeas is closing and running a terminal going-out-of-business sale rather than continuing as an ongoing concern. **The sale has been live on production since 2026-08-15**, carried by migrations `0025`–`0035`: purchase minimum, subscriptions off, Chai's answers, closing content, an em-dash sweep, both bundle SKUs archived, and all three blends at $3.00 a box. Shipping is a flat $1.00 per box (`shipping.per_box_cost`), not the tier bands this doc was originally written around — those were abandoned before ever being priced.

Since then: the production Vectorize rebuild, the inventory recount, and the promo banner all landed on 2026-08-18. What remains is the runbook's Phase 7 checklist (a real order and refund on the live sale) and then the DNS switch (Phase 10, `www`). DNS deliberately follows the sale going live rather than preceding it: there is no reason to move the canonical domain before the store customers land on reflects the closing sale.

---

## Built & audited (code-complete)

SEO foundations + Shopify redirects · Stripe subscriptions (schema, API, webhooks, UI, admin) · Shopify ETL pipeline · customer account pages · admin enhancements · pre-launch polish. P0 auth re-enabled and fail-closed.

**Shipped since the original plan (no longer deferred):** gift-card redemption/admin (BMC-72/125 — new-card purchasing is launch-disabled), blog tables (BMC-121), and an automated test framework (BMC-69 — Vitest unit + `@cloudflare/vitest-pool-workers` integration + Playwright E2E).

**Still deferred (post-launch, not blockers):** Klaviyo, wishlist, search autocomplete, broader test coverage.

---

## Migration status

**All three remote databases are fully migrated through `0024`** — prod (`beauteas-db`), remote dev, and dev preview all report up to date (verified 2026-08-01 via `npm run db:migrate:status:{dev,production}`). `0022`–`0024` were applied 2026-08-01 by the BMC-239 deploy auto-apply, with pre-flight backups (`backup-prod-pre-0022-20260801.sql`, `backup-dev-pre-0024-20260801.sql`). The former deploy-ordering blocker (BMC-231) is resolved — see [`database-migrations.md`](database-migrations.md).

**`0025`–`0027` (the sale settings, closing content, and em-dash sweep) are pending everywhere** — confirmed 2026-08-06 via `npm run db:migrate:status:dev` (3 pending on both `beauteas-db-dev` and the dev preview DB). They apply automatically on the next `npm run deploy:*`, per the standing auto-apply policy. See [`goob-rollout-runbook.md`](goob-rollout-runbook.md) for what each one does and the order to deploy in.

`0019`+`0020` were applied 2026-07-30 after deploying the app, with a pre-flight `d1 export` backup and post-apply verification of effects (templates set on all 9 footer pages, `about` archived, images repointed to `img.beauteas.com`, `page_templates` seeded with the five render kinds, 8 `page_versions` snapshots).

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

- ✅ **BMC-231 resolved 2026-08-01** — `0022`–`0024` applied to remote dev, dev preview, and prod via the deploy auto-apply. `ORDER_STATUS_SECRET` verified present on both dev and prod Workers.
- ✅ Prod **live keys** (`pk_live_…` Clerk + Stripe) are in `wrangler.jsonc`, and all prod **secrets** are set (`CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_VECTORIZE_TOKEN`, `EMAIL_UNSUBSCRIBE_SECRET`, `ORDER_STATUS_SECRET`) — re-verified via `wrangler secret list --env production` 2026-08-01.
- ✅ `admin_users` seeded with the production Clerk ID (verified with a real `last_login`).
- ✅ Stripe live configured: webhook endpoint on `shop.beauteas.com` with 69 events incl. `charge.refunded` (CLI-verified 2026-07-30). Subscription prices/coupons deliberately deferred — subscriptions are not sold at launch.
- ✅ **`refund.updated` + `refund.failed` subscribed on the live endpoint** (2026-08-01, BMC-224) — the refund-lifecycle handlers deployed the same day, so a delayed refund (Klarna / Cash App Pay / Amazon Pay) now resumes cancellation/restock when it settles.
- ✅ **Prod catalog populated by promoting the curated dev catalog** (`scripts/promote-dev-to-prod.mjs`, 2026-07-27) — NOT by re-running the Shopify ETL against prod; dev is the golden source. 10 products / 6 categories / 13 pages / 47 images / 18 Vectorize vectors.
- ✅ Prod build deployed (latest 2026-08-01), smoke tested, live order placed end-to-end on `shop.beauteas.com` with real Stripe tax, webhook, inventory decrement, and confirmation email.
- ✅ **Apple Pay live** (BMC-81, 2026-08-01) — domain-association file deployed and serving, both domains registered in Stripe, and a real production Apple Pay order placed successfully.
- ✅ **Going-out-of-business sale deployed** (2026-08-15, from `goob`; migrations `0025`–`0035`). The owner-only follow-ups are done too: bundle SKUs archived with their redirect, blends repriced to $3.00, shipping settled at $1.00/box, and — on 2026-08-18 — Chai's Vectorize index rebuilt on prod, inventory recounted (1,129 boxes), and the promo banner enabled. Sequence and verification steps: [`goob-rollout-runbook.md`](goob-rollout-runbook.md).
- ☐ **Phase 7 checklist** — a real order and refund against the live sale.
- ☐ **DNS switch** (runbook Phase 10) + Clerk/Stripe domain config, then post-cutover verification (orders, redirects, auth) — Phase 11. Sequenced *after* the sale deploy above, not before it.

---

## Known branding debt

The repo was forked from a prior project (**Voltique** outdoor gear / **Mercora**). The AI assistant has been renamed **Volt → Chai** and given a warm, girlie beauty-bestie voice across the chat UI + `app/api/agent-chat/route.ts`. Remaining leftovers:

- ✅ **Outdoor-gear copy outside the assistant — rebranded (BMC-90).** MCP tools (`lib/mcp/tools/*`) are now catalog-driven (recommendations/bundles derive from `listCategories`/product categories, not hardcoded tents/backpacks; capabilities endpoint built from the live catalog via `lib/mcp/catalog.ts`); transactional emails (`lib/utils/email.ts`), marketing copy (`app/page.tsx`, `components/HeaderClient.tsx`, `app/[slug]/PageRenderer.tsx`), admin AI prompts (`app/admin/pages/PageManagement.tsx`, `app/api/admin/generate-product-description/route.ts`) and admin placeholders (`components/admin/ProductEditor.tsx`, `app/admin/knowledge/KnowledgeManagement.tsx`) now use tea/skincare copy. Seeded CMS pages fixed in `migrations/0003` (fresh DBs) + `migrations/0009` (updates existing rows).
- ⚠️ **Sample vector-source content** in `data/r2/products_md/*.md` still has placeholder outdoor names (e.g. "Vivid Mission Pack", military/tactical tags). This is seed data for the Vectorize index that the Shopify ETL replaces at cutover (the real catalog lives in `data/d1/seed.sql` and is already tea-branded). Not user-facing; left for the ETL.
- ✅ **Chat mascot asset — done.** Chai is a purpose-drawn teacup character in brand colours, shipped as two hand-authored SVGs: `public/chai.svg` (48px viewBox, full character — sprig, steam, saucer) for 32px+ renders, and `public/chai-mark.svg` (24px viewBox, simplified — one leaf, no steam, thicker strokes) for 16–24px renders. The legacy 2MB `data/r2/volt.svg` is deleted. **Pick the mark by rendered size, not by context** — the full character mushes below ~32px, which is why the mobile launcher, chat avatars and admin AI buttons all use `chai-mark.svg`.
- "voltique"/"mercora" strings linger in docs (`PRODUCTION-CUTOVER-RUNBOOK.md`, `docs/`, `.planning/`) and the `x-dev-admin: mercora-dev-bypass` header value.
- `package.json` name is still `mercora` (intentional — platform name).

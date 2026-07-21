# BeauTeas: Shopify → Mercora Production Cutover Runbook

**Goal:** Take the finished v1.0 build to **beauteas.com serving live traffic on Mercora**, taking real orders on real credit cards — with no loss of orders, customers, reviews, or search rankings.

**Audience:** Operator running the cutover (Devon).

---

## Read this first

**All development is done.** Every launch-blocking code ticket is merged and audited — auth (fail-closed), inventory decrement/oversell, refund idempotency, server-side tax with charge floors, coupon redemption tracking, order-status gating, and observability. There is **no code left to write** to launch. There is also now an automated test suite (Vitest + Playwright, gated in CI).

**Everything below is operational** — standing up live services, flipping to live keys, **promoting the curated catalog from dev to prod**, and switching DNS. None of it has been exercised end-to-end against live Stripe/Clerk yet, so the manual verification steps (Phases 9 and 11) are the safety net.

**What's already provisioned** (don't redo): prod D1 (`beauteas-db`, id `5dbae836-…`), R2 (`beauteas-images`), and Vectorize (`beauteas-index`) all exist. Migrations **0001–0012 are applied to prod**. `app/robots.ts` exists. Wallets are wired in `PaymentForm.tsx`.

**Data strategy (decided 2026-07-20):** prod is populated by **copying the curated catalog/content from dev**, NOT by re-running the Shopify ETL against prod. The ETL already ran into dev and the catalog was hand-fixed there; dev is the golden source. **Customers and orders start fresh** — none are migrated (customers re-register on the new site). See Phase 8.

**Do it in order.** Each phase depends on the ones before it. Check the box, move on.

**Status legend:** ☐ not started · ◐ in progress · ☑ done

---

## Phase 0 — Accounts & decisions (get these first; they have lead time)

You can't do anything else until these exist. None of it is code — it's account setup and business decisions.

- ☐ **Cloudflare** account on the Workers **paid** plan; note the Account ID.
- ☐ **Clerk production instance** (separate from the `pk_test…` dev instance). Get `pk_live_…` + `sk_live_…`.
- ☐ **Stripe** business verification complete, **Live mode** available.
- ☐ ⚠️ **Stripe Tax registrations / nexus configured in the LIVE account** (BMC-187). **This is a hard gate, not just "enable Stripe Tax."** `/api/tax` uses nexus-aware Stripe Tax but **falls back to a flat 7% rate** whenever Stripe Tax errors or `STRIPE_SECRET_KEY` is missing. If your live nexus isn't registered, **every order mischarges tax.** Verify in **Stripe Dashboard → Tax → Registrations** that each jurisdiction you have nexus in is registered. (Confirmed working later when a live checkout's `/api/tax` returns `"calculated_by": "stripe"`, not `"fallback"`.)
- ☐ **R2 API token** (Account ID + Access Key ID + Secret) — used to copy image objects from the **dev** bucket to the **prod** bucket (Phase 8).
- ☐ *(Shopify Admin API + Judge.me creds were used for the already-completed dev ETL and are **not** needed again — prod is populated by copying the curated dev catalog, not a fresh Shopify pull. Only revisit if you later decide to migrate order/customer history.)*
- ☐ Decide **subscription economics**: frequencies (e.g. every 2 weeks / monthly / every 2 months) + discount % (e.g. 10%).
- ☐ Decide the **maintenance/migration window** (low-traffic, e.g. overnight). Budget 2–4h.
- ☐ Confirm Shopify data scale (expected: <1K customers, few hundred orders, ~30 products).

---

## Phase 1 — Fill the config placeholders (code)

Two placeholders remain in `wrangler.jsonc` under the **production** env (the prod D1 id is already real):

- ☐ `"NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "REPLACE_WITH_LIVE_CLERK_KEY"` → your `pk_live_…`
- ☐ `"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY": "REPLACE_WITH_LIVE_STRIPE_KEY"` → your `pk_live_…`

Commit these. (Publishable keys are safe to commit; **secret** keys go in Phase 2, never in the file.)

---

## Phase 2 — Set production secrets

```bash
wrangler secret put CLERK_SECRET_KEY        --env production   # sk_live_…
wrangler secret put STRIPE_SECRET_KEY       --env production   # sk_live_…
wrangler secret put RESEND_API_KEY          --env production
wrangler secret put ADMIN_VECTORIZE_TOKEN   --env production   # strong random — do NOT reuse the dev/upstream default
wrangler secret put EMAIL_UNSUBSCRIBE_SECRET --env production  # strong random — REQUIRED or review-reminder emails skip entirely (BMC-184)
# STRIPE_WEBHOOK_SECRET is set later, in Phase 4, once the live webhook exists.
```

- ☐ All five secrets above set. (`STRIPE_WEBHOOK_SECRET` deferred to Phase 4.)

---

## Phase 3 — Apply the remaining prod migrations

Prod is at migration **0012**. Migrations **0013–0018** are new and pending (recommendations, policy/legal pages, subscription shipping address, email-unsubscribe suppression list). One command applies all pending:

```bash
wrangler d1 migrations apply beauteas-db --env production --remote
```

- ☐ Applied. Confirm tables and the last migration:
  ```bash
  wrangler d1 execute beauteas-db --env production --remote \
    --command="SELECT name FROM sqlite_master WHERE type='table';"
  ```
- ☐ **Do NOT run `data/d1/seed.sql` or `data/d1/seed-dev.sql` against prod** — prod data comes from the Shopify migration. `seed-dev.sql` re-adds the public MCP `test-agent` credential and must stay dev-only (BMC-136).

---

## Phase 4 — Configure Stripe live mode (BMC-76)

In **Stripe Live mode**:

- ☐ Create the **subscription discount coupon** (e.g. 10% off, forever) → note the coupon/promotion id.
- ☐ Recurring **Prices** for subscribable products — the app auto-creates these; confirm the path runs in live mode, or pre-create prices for the 3 frequencies.
- ☐ Create the **webhook endpoint** → `https://beauteas.com/api/webhooks/stripe`, subscribed to:
  - `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`
  - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
  - `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.upcoming`
- ☐ Copy the live signing secret and set it:
  ```bash
  wrangler secret put STRIPE_WEBHOOK_SECRET --env production   # whsec_…
  ```
- ☐ Test signature handling before cutover:
  `stripe listen --forward-to https://beauteas.com/api/webhooks/stripe` then `stripe trigger customer.subscription.created`.

---

## Phase 5 — Deploy the observability Tail Worker ⚠️ BEFORE the app (BMC-202)

**Critical ordering.** The production Worker config lists `tail_consumers: [{ service: "beauteas-observability-tail" }]`. That binding is **load-bearing**: if the Tail Worker doesn't exist yet, **`npm run deploy:production` in Phase 7 will FAIL**. Deploy it first, and set its two secrets.

```bash
cd workers/observability-tail
wrangler secret put RESEND_API_KEY  --env production   # Resend key (can be the same as the app's)
wrangler secret put ALERT_EMAIL_TO  --env production   # comma-separated recipient list for alerts
wrangler deploy --env production
cd ../..
```

- ☐ Tail Worker deployed and both secrets set. (`ALERT_EMAIL_FROM` / `ENVIRONMENT` are already vars in its config — must be a Resend-verified from-domain.)
- ☐ **(Optional) Recommendations rebuild cron** — only if you set `recommendations.strategy` to `ai_batch` (the default `deterministic` needs no cron). Confirm `REBUILD_URL` in `workers/recommendations-cron/wrangler.jsonc` points at `https://beauteas.com/api/admin/recommendations/rebuild`, then:
  ```bash
  cd workers/recommendations-cron
  wrangler secret put ADMIN_TOKEN    # same value as the app's ADMIN_VECTORIZE_TOKEN
  wrangler deploy
  cd ../..
  ```

---

## Phase 6 — DEV is the golden source (ETL already done)

> **Status: done (BMC-67).** The Shopify ETL has already run into dev and the catalog was hand-curated there. **Dev is now the golden source that Phase 8 promotes to prod** — so finish any catalog/content cleanup in dev *before* cutover. Prod is not fed by a fresh Shopify pull. The original rehearsal steps are kept below for reference.

**Always rehearse the full pipeline against dev before touching prod.** Validated for catalog/pages/images on 2026-06-29.

⚠️ **`D1_REMOTE=true` is required** or the ETL writes to your **local** D1 instead of remote.

⚠️ **Customer-import caution:** rehearsal imports customers into whatever Clerk instance `CLERK_SECRET_KEY` points at, which sends real password-reset emails. Use a throwaway Clerk instance for rehearsal, or scope the import to a handful — do **not** spam real customers.

```bash
export EXTRACTION_MODE=api            # or 'file' with DATA_DIR pointing at a Shopify export
export SHOPIFY_API_KEY=...
export SHOPIFY_API_SECRET=...
export SHOPIFY_STORE_URL=...
export CLERK_SECRET_KEY=sk_test_...   # rehearsal → throwaway/test Clerk instance
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ACCOUNT_ID=...

export D1_ENV=dev
export D1_DATABASE_NAME=beauteas-db-dev
export D1_REMOTE=true

npx tsx scripts/shopify-migration/migrate-all.ts --entity=categories   # one entity first
npx tsx scripts/shopify-migration/migrate-all.ts                       # then the full run
```

- ☐ Rehearsal completes; review `scripts/shopify-migration/output/migration-report.txt`.
- ☐ `--entity=validate` passes (per-table record counts match).
- ☐ Spot-check on the dev site: 5 products (price/inventory/images), 5 orders, 5 reviews, a few CMS pages.
- ☐ A migrated test customer can complete Clerk password reset → login.
- ☐ Redirect works: `curl -I https://beauteas-dev.<subdomain>.workers.dev/products/<slug>` → **301** to `/product/<slug>`.

---

## Phase 7 — Deploy the app to prod + seed admins + smoke test (DNS still on Shopify)

- ☐ **Seed `admin_users` with your production Clerk user ID** (BMC-77). Without it, **no one can reach `/admin`** (orders, refunds) in prod:
  ```bash
  wrangler d1 execute beauteas-db --env production --remote \
    --command="INSERT INTO admin_users (clerk_user_id, role) VALUES ('<your_prod_clerk_id>', 'admin');"
  ```
- ☐ Deploy (Tail Worker from Phase 5 must already be live):
  ```bash
  npm run deploy:production
  ```
- ☐ Add the custom domain in Cloudflare (Workers → beauteas → Settings → Domains) — but **keep DNS pointed at Shopify** for now; validate on the `*.workers.dev` URL.
- ☐ Smoke test on the workers.dev URL: homepage, product page, category, cart, admin login, AI chat.
  - **Note:** this deploy uses **live** Stripe keys, so test cards are rejected. Either do a real low-value checkout + immediate refund, or temporarily swap in Stripe **test** keys for this step only, then re-set live keys before Phase 10.

---

## Phase 8 — Promote the curated catalog + content from DEV → PROD

Cutover-day, start of window. Prod starts fresh (no customers/orders); we copy the **curated catalog/content** from dev. **Prereq: Phase 3 (migrations 0013–0018) applied**, so dev and prod schemas match exactly.

> **Use `scripts/promote-dev-to-prod.mjs`.** It exports the whitelisted tables from dev (`--no-schema`), rewrites `INSERT` → `INSERT OR REPLACE`, loads them into prod, then delegates to `sync-images.mjs` to copy the R2 images (dev → prod) and prints the Vectorize rebuild curl. It is **dry-run by default** (reads only) and **preflights migration parity** — it aborts unless prod already has the 0013–0018 tables. Run the dry run first, then `--execute`:
> ```bash
> node scripts/promote-dev-to-prod.mjs            # dry run: preview row counts + copy/exclude sets
> node scripts/promote-dev-to-prod.mjs --execute  # write catalog/content + images to prod
> ```
> The manual `wrangler d1 export --table … | d1 execute --file …` path below is the fallback if you need to copy tables individually.

- ☐ **Put Shopify in read-only** (freeze new orders) — fallback if cutover aborts.
- ☐ Back up the prod DB baseline:
  ```bash
  wrangler d1 export beauteas-db --env production --remote --output=backup-pre-promote.sql
  ```
- ☐ **Copy R2 image objects** dev → prod. Image refs in D1 are **relative keys** (`products/{slug}.{ext}`), so they map 1:1 — just copy the objects from `beauteas-images-dev` → `beauteas-images` (S3 API / rclone with your R2 token). Then confirm **`img.beauteas.com` is a custom domain on the prod `beauteas-images` bucket**.
- ☐ **Copy the curated D1 tables** dev → prod — **catalog/content only**, table-scoped, `INSERT OR REPLACE` (prod already holds migration-seeded CMS/legal/gift-card-product rows, so a blind dump collides). Copy set:
  ```
  categories · product_types · products · product_variants · inventory · pricing · media
  pages · page_versions · page_templates · redirect_map
  product_reviews · review_media · blog_categories · blog_posts
  subscription_plans · admin_settings
  ```
- ☐ **Do NOT copy** — credentials / admin / customer / transactional / dev-noise:
  ```
  admin_users · api_tokens · mcp_agents · mcp_sessions · mcp_usage · mcp_rate_limits
  customers · addresses · orders · order_webhooks
  customer_subscriptions · subscription_events · processed_webhook_events
  chat_sessions · chat_messages · gift_cards · gift_card_transactions
  review_reminders · email_unsubscribes
  ```
  …and **never** `d1_migrations` (prod tracks its own migration state).
- ☐ **Rebuild Vectorize** from prod (the index is not copyable):
  ```bash
  curl -X POST "https://beauteas.com/api/admin/vectorize" \
    -H "Authorization: Bearer <ADMIN_VECTORIZE_TOKEN>"
  # Expect the real catalog (+ knowledge articles) indexed
  ```
- ☐ Spot-check on prod (workers.dev URL): products with prices/inventory/images, categories, CMS + legal pages, reviews on PDPs, and redirects populated:
  ```bash
  wrangler d1 execute beauteas-db --env production --remote --command="SELECT COUNT(*) FROM redirect_map;"
  ```

---

## Phase 9 — Final pre-switch verification + Apple Pay

Still on the workers.dev URL, before touching DNS:

- ☐ Products, images, orders visible in `/admin`; reviews on PDPs.
- ☐ **One live subscription end-to-end** (real card, small charge): confirm webhook → D1 → confirmation email fired, with a working "Manage Subscription" link and human-readable product names.
- ☐ **Apple Pay** (BMC-81): add `public/.well-known/apple-developer-merchantid-domain-association` (does not exist yet) and register `beauteas.com` in the Stripe dashboard.

---

## Phase 10 — Cutover: the DNS switch (BMC-83)

This is the point of no easy return — everything above must be green first.

- ☐ Point **beauteas.com DNS** at the Worker custom domain.
- ☐ Update **Clerk** allowed domains / redirect URLs to `beauteas.com`.
- ☐ Verify the Stripe **live webhook** is hitting `https://beauteas.com/...` (not the workers.dev host).
- ☐ Submit `https://beauteas.com/sitemap.xml` to **Google Search Console** (BMC-85).
- ☐ *(No customer migration email — prod starts fresh; customers register on the new site. BMC-84 stays canceled.)*

---

## Phase 11 — Post-cutover verification (first 60 min, then 24h)

**First hour:**
- ☐ `curl -I https://beauteas.com/products/<old-slug>` → **301**.
- ☐ Google Rich Results Test on a live product URL — Product + Breadcrumb + Organization JSON-LD valid.
- ☐ Place one real order; confirm the Resend confirmation email + the order in `/admin`.
- ☐ Create + immediately cancel a real subscription; confirm lifecycle emails + working manage links.
- ☐ **Auth check:** unauthenticated `curl` to `/api/orders` and `/api/orders/refund` → **401/403**.
- ☐ `/api/tax` on a live checkout returns `"calculated_by": "stripe"` (not `"fallback"`) — confirms Phase 0 tax registration.
- ☐ `wrangler tail --env production` clean of errors; a forced error produces an **alert email** (confirms the Tail Worker).

**First 24h:**
- ☐ Stripe dashboard: payment/subscription success rate + webhook delivery (no failures).
- ☐ Search Console: no crawl / redirect errors.
- ☐ A **new** customer can register + log in (prod Clerk), place an order, and see it in their account.

---

## Rollback plan

- **Before the DNS switch (Phases 0–9):** trivial — Shopify is still authoritative. Fix forward, re-run the migration (`wrangler d1 export` backup → wipe → re-run). No customer impact.
- **After the DNS switch (Phase 10+):** revert beauteas.com DNS back to Shopify (still in read-only = clean fallback), lift Shopify read-only. Manually reconcile any orders placed on Mercora during the brief live window. **Keep Shopify as fallback for 1–2 weeks** before decommissioning.

---

## Not blockers — post-launch backlog (the store runs fine without these)

All Low/Medium, deliberately deferred: Chai mascot asset (BMC-89), gift-card-validate rate limit (BMC-124), pending-order TTL sweep (BMC-195), order-read path unification (BMC-191), storefront polish bundle (BMC-190), recommendations merchandising controls (BMC-166), review-reminder scale hardening (BMC-199), N+1 perf (BMC-185, descoped — catalog is <10 SKUs), Klaviyo marketing (BMC-71), UX parity: search autocomplete / wishlist / social share / recently-viewed (BMC-73).

---

## Quick command reference

| Action | Command |
|---|---|
| Set a prod secret | `wrangler secret put <NAME> --env production` |
| Apply prod migrations | `wrangler d1 migrations apply beauteas-db --env production --remote` |
| Deploy Tail Worker (do first!) | `cd workers/observability-tail && wrangler deploy --env production` |
| Deploy the app | `npm run deploy:production` |
| Backup prod DB | `wrangler d1 export beauteas-db --env production --remote --output=backup.sql` |
| Export a dev table (data only) | `wrangler d1 export beauteas-db-dev --env dev --remote --table=<t> --no-schema --output=<t>.sql` |
| Load a table into prod | `wrangler d1 execute beauteas-db --env production --remote --file=<t>.sql` |
| Copy R2 objects dev→prod | S3 API / rclone: `beauteas-images-dev` → `beauteas-images` |
| Rebuild Vectorize (prod) | `curl -X POST "https://beauteas.com/api/admin/vectorize" -H "Authorization: Bearer <TOKEN>"` |
| Live logs | `wrangler tail --env production` |

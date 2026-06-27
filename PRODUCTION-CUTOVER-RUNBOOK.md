# BeauTeas: Shopify → Mercora Production Cutover Runbook

**Goal:** Take the completed v1.0 build from its current state (dev-only, no production infra, never run against live data) to **beauteas.com serving live traffic on Mercora**, with no loss of orders, customers, reviews, or search rankings.

**Audience:** Operator running the cutover (Devon).
**Status legend:** ☐ not started · ◐ in progress · ☑ done

> **Reality check:** The *code* for the three launch blockers (SEO, subscriptions, data migration) is built and audited. Everything below is the **operational work that has never been executed**: standing up production infra, running the migration against real data, flipping services to live mode, and the DNS switch. Nothing here has been exercised end-to-end against live Stripe/Clerk/Shopify yet.

---

## 0. P0 Blockers — MUST fix before any production deploy

These are hard gates. Do not deploy to production until all are resolved.

### 0.1 ☑ Re-enable API authentication (SECURITY — inherited from upstream Mercora) — **FIXED**
- **Was:** `lib/auth/unified-auth.ts → authenticateRequest()` returned `{ success: true, permissions: ["admin:*"] }` **unconditionally**, leaving `app/api/orders/route.ts`, `app/api/orders/refund/route.ts` (**refunds!**) and the admin order page unauthenticated in production.
- **Fix applied:** `authenticateRequest()` now fails closed and accepts two credential types:
  1. **API token** — the `ADMIN_VECTORIZE_TOKEN` service secret, or an `api_tokens` row matched by SHA-256 hash, with AND-combined permission checks (wildcard-aware).
  2. **Clerk session** — for the browser admin UI (which sends no token); granted admin via `isUserAdmin()` or Clerk metadata `role === "admin"`. Dev parity: any signed-in user is admin when `NODE_ENV === "development"` only (never true in the deployed Worker), matching `admin-middleware.ts`.
  - Verified: `tsc --noEmit` clean, `next lint` clean, all 3 call sites reviewed. Customer order browsing is unaffected (it uses Clerk `auth()` + userId match, not `authenticateRequest`).
- **Still required at deploy time:**
  - ☐ Runtime check: unauthenticated `curl` to prod `/api/orders?admin=true` and `/api/orders/refund` → expect **401/403** (covered in §8).
  - ☐ Seed `admin_users` with admin Clerk IDs (§0.2) — otherwise admins can't reach the orders UI in prod. Same applies to **local dev only if** you set `NODE_ENV=production` locally.
  - ☑ Server-to-server token auth tooling restored — `scripts/manage-tokens.ts` (`npm run token:generate|list|revoke`) mints/lists/revokes `api_tokens` rows via `wrangler d1 execute`. Hashing verified to match the verifier (`unified-auth.ts`). Targets remote D1 by default; use `--env=production`. Only needed for non-Clerk service callers (carrier webhooks, automation); the admin UI uses the Clerk-session path. To mint a prod token: `npm run token:generate -- --name=<n> --preset=WEBHOOKS_CARRIER --env=production`.

### 0.2 ☐ Seed the admin allow-list
- `admin-middleware.ts` calls `isUserAdmin(userId)` against the `admin_users` table (migration `0002`). In production that table must contain your Clerk user ID(s), or **no one can reach `/admin`.**
- **Action:** After Clerk production instance exists, insert your admin user ID into `admin_users` on the prod DB.

### 0.3 ☐ Set a strong `ADMIN_VECTORIZE_TOKEN` production secret
- Used for server-to-server admin calls (vectorize reindex, etc.). Do not reuse the upstream default (`voltique-admin` / `mercora-dev-bypass`).

---

## 1. Pre-flight — accounts & decisions (T-7 days)

- ☐ Cloudflare account on Workers **paid** plan; note Account ID.
- ☐ **Clerk production instance** created (separate from the `pk_test_…dev` instance). Get `pk_live_…` + `sk_live_…`.
- ☐ **Stripe** business verification complete, **Stripe Tax** enabled, account in **Live** mode available.
- ☐ Decide the **maintenance/migration window** (low-traffic, e.g. overnight). Budget 2–4h.
- ☐ Confirm Shopify data scale (expected: <1K customers, few hundred orders, ~30 products).
- ☐ Obtain **Shopify Admin API** credentials (custom app: API key + secret + store URL) with read scopes for products, customers, orders, content/pages.
- ☐ Obtain **Judge.me** API token (reviews export).
- ☐ Create **R2 API token** (Account ID + Access Key ID + Secret) for the migration's image uploader.
- ☐ Decide subscription economics: frequencies (every 2 weeks / monthly / every 2 months) + discount % (e.g. 10%).

---

## 2. Provision production infrastructure (T-5 days)

```bash
# Production Cloudflare resources
wrangler d1 create beauteas-db
wrangler r2 bucket create beauteas-images
wrangler vectorize create beauteas-index --dimensions=1024 --metric=cosine
```

- ☐ Resources created.
- ☐ **Update `wrangler.jsonc` production env** — replace the three placeholders that are currently committed:
  - `"database_id": "REPLACE_WITH_PRD_DATABASE_ID"` → real prod D1 id
  - `"NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "REPLACE_WITH_LIVE_CLERK_KEY"` → `pk_live_…`
  - `"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY": "REPLACE_WITH_LIVE_STRIPE_KEY"` → `pk_live_…`
- ☐ **Set production secrets:**
  ```bash
  wrangler secret put CLERK_SECRET_KEY      --env production   # sk_live_…
  wrangler secret put STRIPE_SECRET_KEY     --env production   # sk_live_…
  wrangler secret put STRIPE_WEBHOOK_SECRET --env production   # whsec_… (from §4)
  wrangler secret put RESEND_API_KEY        --env production
  wrangler secret put ADMIN_VECTORIZE_TOKEN --env production   # strong random
  ```
- ☐ Apply schema to production DB:
  ```bash
  wrangler d1 migrations apply beauteas-db --env production --remote
  # Confirms migrations 0001–0008 (incl. 0007 subscriptions, 0008 redirect_map)
  ```
- ☐ Verify tables exist:
  ```bash
  wrangler d1 execute beauteas-db --env production --remote \
    --command="SELECT name FROM sqlite_master WHERE type='table';"
  ```
- ☐ **Do NOT run `data/d1/seed.sql` on production** — production data comes from the Shopify migration, not the sample seed.

---

## 3. Configure Stripe for live subscriptions (T-5 days)

The base deployment doc only wires payment events. Subscriptions need more.

- ☐ In **Stripe Live mode**, create the **discount coupon** (e.g. 10% off, forever) → note the coupon/promotion id.
- ☐ Recurring **Prices** per subscribable product: the codebase auto-creates Stripe prices for plans (commit `f4f858d`) — confirm this path runs in live mode, or pre-create prices for the 3 frequencies.
- ☐ Create the **production webhook endpoint** → `https://beauteas.com/api/webhooks/stripe`, subscribed to:
  - `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`
  - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
  - `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.upcoming`
- ☐ Copy the live signing secret → that's the `STRIPE_WEBHOOK_SECRET` set in §2.
- ☐ Test webhook signature handling against prod with the Stripe CLI before cutover:
  `stripe listen --forward-to https://beauteas.com/api/webhooks/stripe` then `stripe trigger customer.subscription.created`.

---

## 4. Migration rehearsal — run against DEV first (T-4 days)

**Always rehearse the full pipeline against the dev DB before touching production.** The orchestrator defaults to `D1_ENV=dev` / `beauteas-db-dev`.

Orchestrator: `npx tsx scripts/shopify-migration/migrate-all.ts` (run order: schema → categories → products → customers → orders → reviews → pages → redirects → validate). It saves an ID map and continues on per-entity failure.

```bash
# Dry-run dependencies & env (file or api extraction mode)
export EXTRACTION_MODE=api          # or 'file' with DATA_DIR pointing at a Shopify export
export SHOPIFY_API_KEY=...
export SHOPIFY_API_SECRET=...
export SHOPIFY_STORE_URL=...
export CLERK_SECRET_KEY=sk_live_...   # customer import → Clerk (use the prod instance)
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ACCOUNT_ID=...

# Rehearse against DEV
export D1_DATABASE_NAME=beauteas-db-dev
export D1_ENV=dev

npx tsx scripts/shopify-migration/migrate-all.ts --entity=categories   # one at a time first
npx tsx scripts/shopify-migration/migrate-all.ts                       # then full run
```

- ☐ Rehearsal completes; review `scripts/shopify-migration/output/migration-report.txt`.
- ☐ `--entity=validate` passes (record counts match per table).
- ☐ Spot-check on dev site: 5 products (price/inventory/images from R2), 5 orders (dates/status), 5 reviews (ratings recalculated), a few CMS pages.
- ☐ Test a migrated customer: trigger Clerk password reset → log in.
- ☐ Test redirects: `curl -I https://beauteas-dev.<subdomain>.workers.dev/products/<slug>` → **301** to `/product/<slug>`.
- ☐ **Customer-import caution:** customers were imported into the **dev** Clerk instance during rehearsal. Use a throwaway/test Clerk instance for rehearsal, OR scope rehearsal customer import to a handful — do **not** spam real customers with reset emails during a rehearsal.

---

## 5. Deploy production build (T-2 days)

- ☐ `npm install`
- ☐ Re-enable auth (§0.1) merged to `main`.
- ☐ Close the minor SEO gap if desired: add `app/robots.ts` (currently still the static `public/robots.txt`).
- ☐ Build + deploy:
  ```bash
  npm run deploy:production       # clean + opennextjs build + deploy --env production
  ```
- ☐ Add custom domain in Cloudflare (Workers → beauteas → Settings → Domains) — but **keep DNS pointed at Shopify** for now (use the `*.workers.dev` URL or a staging host for validation).
- ☐ Smoke test on the workers.dev URL: homepage, product page, category, cart, admin login (after §0.2), AI chat. **Note:** This deploy uses live Stripe keys — test cards will be rejected. Either run a real low-value checkout + immediate refund, or temporarily swap to Stripe test keys for this smoke-test step only, then re-set the live key before DNS cutover.

---

## 6. Production data migration (cutover day, start of window)

- ☐ **Put Shopify in read-only / password-protected mode** (freeze new orders) — fallback if cutover aborts.
- ☐ **Back up the (empty) prod DB** as a baseline:
  ```bash
  wrangler d1 export beauteas-db --env production --remote --output=backup-pre-migration.sql
  ```
- ☐ Run the migration against **production**:
  ```bash
  export D1_DATABASE_NAME=beauteas-db
  export D1_ENV=production
  export CLERK_SECRET_KEY=sk_live_...        # PROD Clerk instance
  # (Shopify + R2 vars as in §4)
  npx tsx scripts/shopify-migration/migrate-all.ts
  ```
- ☐ Review migration report; re-run any failed entity with `--entity=NAME` (ID map persists, so it resumes cleanly).
- ☐ `--entity=validate` passes against production.
- ☐ **Index AI search** on real catalog:
  ```bash
  curl -X POST "https://beauteas.com/api/admin/vectorize" \
    -H "Authorization: Bearer <ADMIN_VECTORIZE_TOKEN>"
  # Expect ~30 products (+ knowledge articles) indexed
  ```
- ☐ Confirm `redirect_map` populated:
  ```bash
  wrangler d1 execute beauteas-db --env production --remote \
    --command="SELECT COUNT(*) FROM redirect_map;"
  ```

---

## 7. Cutover — DNS switch

- ☐ Final pre-switch verification on production (workers.dev URL): products, images, orders visible in `/admin`, reviews on PDPs, one **live** subscription end-to-end (real card, small charge), confirm webhook → D1 → email fired.
- ☐ Apple Pay: add `public/.well-known/apple-developer-merchantid-domain-association` and register `beauteas.com` in Stripe (wallets already configured in `PaymentForm.tsx`).
- ☐ Point **beauteas.com DNS** at the Worker custom domain.
- ☐ Update **Clerk** allowed domains/redirect URLs to `beauteas.com`.
- ☐ Verify Stripe live webhook is hitting `https://beauteas.com/...` (not the workers.dev host).
- ☐ Submit `https://beauteas.com/sitemap.xml` to **Google Search Console**.
- ☐ Send the **customer migration email** (password-reset link) to all migrated customers — *only after* DNS is live so reset links resolve.

---

## 8. Post-cutover verification (first 60 min, then 24h)

First hour:
- ☐ `curl -I https://beauteas.com/products/<old-slug>` → **301** (legacy Shopify URLs).
- ☐ Google Rich Results Test on a live product URL — Product + Breadcrumb + Organization JSON-LD valid.
- ☐ Place one real order; confirm confirmation email (Resend) + order in `/admin`.
- ☐ Create + immediately cancel a real subscription; confirm lifecycle emails have working "Manage Subscription" links → `/subscriptions` and human-readable product names.
- ☐ Unauthenticated `curl` to `/api/orders` and `/api/orders/refund` → **401/403** (confirms §0.1 fix is live).
- ☐ `wrangler tail --env production` clean of errors.

First 24h:
- ☐ Watch Stripe dashboard for payment/subscription success rate and webhook delivery (no failures).
- ☐ Watch Search Console for crawl errors / redirect issues.
- ☐ Confirm a sample of migrated customers can complete password reset + login.

---

## 9. Rollback plan

Trigger if: data validation fails badly, payments don't process, or auth/security regression found.

- **Before DNS switch (steps 0–6):** trivial — Shopify is still authoritative and live. Fix forward on Worker, re-run migration (`wrangler d1 export` backup → wipe → re-run), no customer impact.
- **After DNS switch (step 7+):** revert beauteas.com DNS back to Shopify (still in read-only mode = clean fallback). Lift Shopify read-only. Orders placed on Mercora during the brief live window must be reconciled manually. Keep Shopify as fallback for **at least 1–2 weeks** before decommissioning.

---

## 10. Known gaps / explicitly deferred (NOT cutover blockers)

Per the migration plan these are post-launch; the store operates without them:
- Blog system — **not built**
- Klaviyo marketing integration — **not built** (transactional email via Resend works)
- Gift cards — deferred (fast-follow within first month)
- UX parity: search autocomplete, wishlist, social sharing, recently-viewed — not built
- **No automated test framework** — all verification is manual; treat steps 4/6/8 as the safety net.

---

## Quick command reference

| Action | Command |
|---|---|
| Apply prod schema | `wrangler d1 migrations apply beauteas-db --env production --remote` |
| Backup prod DB | `wrangler d1 export beauteas-db --env production --remote --output=backup.sql` |
| Full migration | `D1_ENV=production D1_DATABASE_NAME=beauteas-db npx tsx scripts/shopify-migration/migrate-all.ts` |
| Single entity | `… migrate-all.ts --entity=products` |
| Validate | `… migrate-all.ts --entity=validate` |
| Reindex AI | `curl -X POST "https://beauteas.com/api/admin/vectorize" -H "Authorization: Bearer <TOKEN>"` |
| Deploy prod | `npm run deploy:production` |
| Live logs | `wrangler tail --env production` |
| Set secret | `wrangler secret put <NAME> --env production` |

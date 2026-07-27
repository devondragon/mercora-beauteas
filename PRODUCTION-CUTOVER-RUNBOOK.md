# BeauTeas: Shopify → Mercora Production Cutover Runbook

**Goal:** Take the finished v1.0 build to **beauteas.com serving live traffic on Mercora**, taking real orders on real credit cards — with no loss of orders, customers, reviews, or search rankings.

**Audience:** Operator running the cutover (Devon).

---

## Read this first

**All development is done.** Every launch-blocking code ticket is merged and audited — auth (fail-closed), inventory decrement/oversell, refund idempotency, server-side tax with charge floors, coupon redemption tracking, order-status gating, and observability. There is **no code left to write** to launch. There is also now an automated test suite (Vitest + Playwright, gated in CI).

**Everything below is operational** — standing up live services, flipping to live keys, **promoting the curated catalog from dev to prod**, and switching DNS. None of it has been exercised end-to-end against live Stripe/Clerk yet, so the manual verification steps (Phases 9 and 11) are the safety net.

**What's already provisioned** (don't redo): prod D1 (`beauteas-db`, id `5dbae836-…`), R2 (`beauteas-images`), and Vectorize (`beauteas-index`) all exist. Migrations **0001–0018 are ALL applied to prod** (0013–0018 applied 2026-07-27; `migrations list` reports none pending). `app/robots.ts` exists. Wallets are wired in `PaymentForm.tsx`.

**Data strategy (decided 2026-07-20):** prod is populated by **copying the curated catalog/content from dev**, NOT by re-running the Shopify ETL against prod. The ETL already ran into dev and the catalog was hand-fixed there; dev is the golden source. **Customers and orders start fresh** — none are migrated (customers re-register on the new site). See Phase 8.

**Progress as of 2026-07-27:** Phases 0, 1, and 2 are essentially complete — Cloudflare paid plan, Clerk production instance, Stripe live + tax registrations, live publishable keys in `wrangler.jsonc`, and **all 6 production secrets set and verified**. Two things surfaced during that work that must be resolved before Phase 7:

> ☑ **RESOLVED — `NEXT_PUBLIC_*` build-time blocker.** Fixed 2026-07-27 via `scripts/build-with-env.mjs`; verified end-to-end with a real production build. See Phase 1.
>
> ⚠️ **Resend was never configured** for this domain — see Phase 2. The domain is now verified in Resend, but no email has ever *sent* from this app in any environment, so the whole email surface is unexercised. See the Phase 9 email smoke test.

**☑ DECIDED 2026-07-27 — hostnames.**

| Host | Role |
|---|---|
| `shop.beauteas.com` | **Staging/validation.** Custom domain on the **production** Worker (prod D1/R2/Vectorize, live keys), gated behind Cloudflare Access. Shopify keeps serving customers on `www` throughout. |
| `www.beauteas.com` | **Permanent production canonical.** What `BASE_URL` resolves to after cutover; keeps the link equity Shopify accumulated. |
| `beauteas.com` (apex) | 301 → `www`, via a Cloudflare Redirect Rule (today this redirect is a Shopify feature and goes inert when DNS leaves). |

`BASE_URL` is now env-driven off `NEXT_PUBLIC_SITE_URL` (`lib/seo/metadata.ts`), set per environment in `wrangler.jsonc` and injected at build time. It is currently `https://shop.beauteas.com` so staging emits its own canonicals rather than pointing crawlers and customer emails at the Shopify store. **Flipping it to `https://www.beauteas.com` is a Phase 10 step and requires a rebuild + redeploy** — it is baked into the bundle, so editing the config alone does nothing.

**Do it in order.** Each phase depends on the ones before it. Check the box, move on.

**Status legend:** ☐ not started · ◐ in progress · ☑ done

---

## Phase 0 — Accounts & decisions (get these first; they have lead time)

You can't do anything else until these exist. None of it is code — it's account setup and business decisions.

- ☑ **Cloudflare** account on the Workers **paid** plan; note the Account ID. *(Done 2026-07-27 — account `e230c667ec437820d64caf703df479b6`.)*
- ☑ **Clerk production instance** (separate from the `pk_test…` dev instance). Get `pk_live_…` + `sk_live_…`. *(Done 2026-07-27.)*
- ☑ **Stripe** business verification complete, **Live mode** available. *(Done 2026-07-27.)*
- ☑ ⚠️ **Stripe Tax registrations / nexus configured in the LIVE account** (BMC-187). *(Done 2026-07-27 — still verify at first live checkout that `/api/tax` returns `"calculated_by": "stripe"`, not `"fallback"`.)* **This is a hard gate, not just "enable Stripe Tax."** `/api/tax` uses nexus-aware Stripe Tax but **falls back to a flat 7% rate** whenever Stripe Tax errors or `STRIPE_SECRET_KEY` is missing. If your live nexus isn't registered, **every order mischarges tax.** Verify in **Stripe Dashboard → Tax → Registrations** that each jurisdiction you have nexus in is registered. (Confirmed working later when a live checkout's `/api/tax` returns `"calculated_by": "stripe"`, not `"fallback"`.)
- ☐ **R2 API token** (Account ID + Access Key ID + Secret) — used to copy image objects from the **dev** bucket to the **prod** bucket (Phase 8).
- ☐ *(Shopify Admin API + Judge.me creds were used for the already-completed dev ETL and are **not** needed again — prod is populated by copying the curated dev catalog, not a fresh Shopify pull. Only revisit if you later decide to migrate order/customer history.)*
- ☐ Decide **subscription economics**: frequencies (e.g. every 2 weeks / monthly / every 2 months) + discount % (e.g. 10%).
- ☐ Decide the **maintenance/migration window** (low-traffic, e.g. overnight). Budget 2–4h.
- ☐ Confirm Shopify data scale (expected: <1K customers, few hundred orders, ~30 products).

---

## Phase 1 — Fill the config placeholders (code)

- ☑ `"NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"` → `pk_live_Y2xlcmsu…` *(Done 2026-07-27.)*
- ☑ `"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"` → `pk_live_51ToUnwF…` *(Done 2026-07-27.)*
- ☑ Verified zero `REPLACE_WITH` placeholders remain in `wrangler.jsonc`.

Commit these. (Publishable keys are safe to commit; **secret** keys go in Phase 2, never in the file.)

### ⛔ BLOCKER — `NEXT_PUBLIC_*` in `wrangler.jsonc` does NOT reach the browser

**Found 2026-07-27. This will break live checkout on day one if not fixed before Phase 7.**

`wrangler.jsonc` `vars` populate the **Worker's runtime `env`**. But Next.js inlines `NEXT_PUBLIC_*` into the **client bundle at build time**, and `lib/stripe.ts:39` captures the key in a module-scope `const`:

```ts
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
```

`npm run deploy:production` runs `opennextjs-cloudflare build` → `next build` with **no environment scoping**, and Next.js loads `.env.local` for production builds at *higher* precedence than `.env.production`. `.env.local` currently holds:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YnVzeS…
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51ToUo…
```

So a production deploy today ships a bundle with **test** publishable keys while the server holds **live** secret keys. The failure mode: the server creates a live PaymentIntent, the browser confirms it with a test-mode key, Stripe rejects on key/mode mismatch — **checkout is broken, and no amount of correct `wrangler.jsonc` config fixes it.**

- ☑ **Clerk was affected too**, not just Stripe. Verified against the pre-fix build — both keys were inlined into client chunks, with no `pk_live` anywhere:
  ```
  common-c3373795-*.js  : pk_test_51ToUo   ← Stripe
  vendors-d43c352d-*.js : pk_test_YnVzeS   ← Clerk
  ```
  `@clerk/nextjs` does **not** read the runtime var — it inlines at build time like any other `NEXT_PUBLIC_*`.

### ☑ FIXED 2026-07-27 — `scripts/build-with-env.mjs`

`deploy:dev` and `deploy:production` now route the build through `scripts/build-with-env.mjs <env>`, which:

1. Parses `wrangler.jsonc` (comment-aware, no new dependency) and reads `env.<target>.vars`.
2. Spawns the build with the `NEXT_PUBLIC_*` values already in `process.env`. This works because `@next/env` snapshots `process.env` *before* loading any `.env` file and **only assigns keys not already present** — so parent-process env beats `.env.local`. `wrangler.jsonc` is now the single source of truth for both build and runtime, with no second copy to drift.
3. **Fails the build** if a wrong-mode key was inlined (`pk_test_` in a production bundle, or `pk_live_` in a dev one), so this class of bug cannot reach a deploy.

> The guard matches the prefix **plus ≥16 chars of key material**. A bare-prefix search false-positives: both the Clerk and Stripe SDKs ship constants like `let i="pk_live_"` for mode detection, which flags every bundle containing those SDKs.

**Verified end-to-end** with a real `opennextjs-cloudflare build`:

```
[build-with-env] Building for "production" with:
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  = pk_live_Y2xlcmsuYmVhdXRl…
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_live_51ToUnwFqgbQQDjY…
[build-with-env] ✓ Bundle check passed — no "pk_test_" key in the production build.
```

Both live keys now land in the exact chunks that previously held test keys; zero test keys remain. Nothing further is needed here — just use `npm run deploy:production` as normal.
- ☐ After deploying, confirm in the browser that the page loads `clerk.beauteas.com` (production FAPI), **not** `*.clerk.accounts.dev`.

---

## Phase 2 — Set production secrets

**☑ All production secrets are set (verified 2026-07-27 via `wrangler secret list --env production`):**

| Secret | Status |
|---|---|
| `CLERK_SECRET_KEY` | ☑ set |
| `STRIPE_SECRET_KEY` | ☑ set |
| `STRIPE_WEBHOOK_SECRET` | ☑ set |
| `RESEND_API_KEY` | ☑ set |
| `ADMIN_VECTORIZE_TOKEN` | ☑ set — generated `openssl rand -hex 32`, piped straight to wrangler, **never displayed or written to disk** |
| `EMAIL_UNSUBSCRIBE_SECRET` | ☑ set — same method |
| `CLERK_PUBLISHABLE_KEY` | ⚠️ set, but **unused** — the app reads `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from `vars`, not this. Harmless; delete to avoid confusion. |

Both generated tokens are **unrecoverable by design** — Cloudflare secrets are write-only. Neither needs to be known by a human:

- `EMAIL_UNSUBSCRIBE_SECRET` is a pure internal HMAC signing key (`lib/email/unsubscribe-token.ts`).
- `ADMIN_VECTORIZE_TOKEN` is only needed for `curl`-based admin calls; the admin UI triggers vectorize via the Clerk session (`ProductManagement.tsx`, `settings/page.tsx`, `KnowledgeManagement.tsx`). **If you ever need the raw value, just re-run `wrangler secret put` with a new one** — nothing else stores a copy, so rotation is free.

To re-generate either without ever seeing the value:
```bash
openssl rand -hex 32 | npx wrangler secret put <NAME> --env production
```

### ⚠️ Resend was never configured for this domain

Found 2026-07-27: `RESEND_API_KEY` was the untouched `re_your_…` placeholder inherited from the upstream Mercora fork, and was absent from `.dev.vars` entirely. **No email has ever sent from this app, in any environment.** The prod secret is now set, but that means every email path is unexercised:

- ☐ Verify `beauteas.com` in Resend (use their default `send.beauteas.com` subdomain flow for SPF/Return-Path — it avoids any collision with Shopify's existing apex SPF while Shopify is still live).
- ☐ Set the key in **all three** places, per the `.dev.vars` gotcha: `.env.local` (for `next dev`), `.dev.vars` (for `preview:dev` + Workers runtime), and `wrangler secret put --env dev`.
- ☐ Smoke-test all four paths against a real inbox: order confirmation (`lib/utils/email.ts:96`), gift card delivery (`:491`), subscription lifecycle (`:632`), review notifications (`lib/utils/review-notifications.ts`).
- ☐ **Wire email failure into alerting.** `order-confirmation.ts:118` logs `console.error`, not `logCritical` — so a misconfigured Resend in prod means every customer silently gets no confirmation and **nothing pages you** (BMC-168 only alerts on `logCritical`). Upgrade this before launch; it sits on the money path.

Note: email failure is fully swallowed and never throws, so it cannot block `finalizePaidOrder` or trigger webhook retries. Enabling Resend is safe and isolated.

---

## ☑ Phase 3 — Apply the remaining prod migrations *(COMPLETE 2026-07-27)*

Migrations **0013–0018** applied to `beauteas-db`. `wrangler d1 migrations list` now reports **"No migrations to apply!"**

```bash
wrangler d1 migrations apply beauteas-db --env production --remote
```

**Pre-flight checks run first:**

- ☑ **Backup taken** before applying — `wrangler d1 export` (40.4 KB, pre-catalog). Prod held only migration-seeded rows; no customers or orders exist yet.
- ☑ **D1 50-char LIKE cap checked** on the data-only migrations. 0016's guards are `'%We do not sell, trade%'` (24 chars) and `'%to be bound by the terms%'` (26) — well clear of the cap that would otherwise silently roll the whole migration back.
- ☑ **Confirmed the 0016 guards actually match prod content** before applying, rather than assuming. Unlike remote dev — which lacks the 0003-seeded pages, so UPDATE-guarded data migrations silently no-op there — **prod did have them**, so 0016 genuinely applied and 0017's backfill correctly did nothing.

**Verified after applying** (checked the effects, not just the ✅ status):

| Migration | Verification |
|---|---|
| 0013 | `product_recommendations` table exists |
| 0014 | `contact`, `refund-policy`, `shipping-policy` pages seeded *(note: the slug is `refund-policy`, not `refund-return-policy`)* |
| 0015 | `shipping_address` column present on `customer_subscriptions` |
| 0016 | `privacy-policy` 604 → **6951** chars, `terms-of-service` 542 → **4586** chars — the boilerplate really was replaced |
| 0017 | Correctly a no-op (0016 matched) |
| 0018 | `email_unsubscribes` table exists |
| 0016 rollback safety | 4 `page_versions` snapshots written, preserving the pre-rewrite content |

- ☑ **Did NOT run `data/d1/seed.sql` or `data/d1/seed-dev.sql` against prod** — prod data comes from the dev promotion (Phase 8). `seed-dev.sql` re-adds the public MCP `test-agent` credential and must stay dev-only (BMC-136).

---

## Phase 4 — Configure Stripe live mode (BMC-76)

In **Stripe Live mode**:

- ☐ Create the **subscription discount coupon** (e.g. 10% off, forever) → note the coupon/promotion id.
- ☐ Recurring **Prices** for subscribable products — the app auto-creates these; confirm the path runs in live mode, or pre-create prices for the 3 frequencies.
- ☐ Create **one** webhook endpoint → `/api/webhooks/stripe` on whichever host you launch on. **Create a single endpoint and *edit its URL* at cutover** rather than adding a second one: each Stripe endpoint gets its own signing secret, the Worker holds only one `STRIPE_WEBHOOK_SECRET`, and running two means deliveries from the second fail signature verification (400) until Stripe backs off. Editing the URL in place preserves the secret — no redeploy, no gap.

- ☐ **Subscribe to exactly these 9 events** — this is the full `switch` in `app/api/webhooks/stripe/route.ts:103-145`; anything else falls to `default:` and only logs:
  - `payment_intent.succeeded` ← **the money path** (`finalizePaidOrder`, gift cards, confirmation email)
  - `payment_intent.payment_failed` (handler is a stub — logs only)
  - `checkout.session.completed` (handler is a stub; you use Payment Element, not Checkout Sessions — **safe to omit**)
  - `customer.subscription.created` / `.updated` / `.deleted`
  - `invoice.payment_succeeded` ← creates renewal orders · `invoice.payment_failed` · `invoice.upcoming`

  > Corrected 2026-07-27: earlier drafts of this runbook listed `customer.subscription.paused` and `.resumed`. **There are no handlers for those** — pause/resume is detected inside `customer.subscription.updated`. Subscribing to them is harmless but does nothing.

- ☐ ⚠️ **Set the endpoint's API version to `2026-06-24.dahlia`** — matching `lib/stripe.ts:75`/`:117`.

  Stripe's guidance is to match the endpoint version to the version your SDK pins: *"for successful deserialization of event objects, the API version set for webhook endpoints should match the version used to generate the SDK."* A mismatch is silent, not loud — `invoice-handlers.ts:30-39` reads the subscription id from `invoice.parent.subscription_details.subscription`, and if that path is absent `getSubscriptionIdFromInvoice()` returns `null` and **every subscription invoice is skipped as a "non-subscription invoice"**: renewals quietly stop creating orders, with only a benign-looking log line.

  > **SDK upgraded 2026-07-27: `stripe` 18.5.0 → 22.3.2**, which pins exactly `2026-06-24.dahlia`. Both `apiVersion` call sites in `lib/stripe.ts` updated to match. Verified across the four-major jump:
  > - `tsc` clean against the v22 types. All webhook handlers are typed as `Stripe.Invoice` / `Stripe.Subscription`, so the compiler validated **every** field access against the dahlia shapes.
  > - `invoice.parent.subscription_details.subscription` still present and still `string | Subscription`.
  > - `current_period_start/end` already read from the **item** (`firstItem?.current_period_start`), which is where dahlia keeps them — the field that most often breaks on Stripe subscription upgrades was already correct.
  > - 899 unit tests pass; OpenNext production build succeeds.

- ⚠️ **Unrelated version sprawl — tracked as [BMC-212](https://linear.app/blackmagicconsulting/issue/BMC-212/retire-cloudflarestripe-live-paymentintent-path-still-runs-on-stripe).** `getStripeClient()` (`lib/stripe.ts:299-315`) returns the hand-rolled `CloudflareStripe` in production, and that class sends `Stripe-Version: 2020-08-27` (`lib/stripe.ts:157`) — **six years old**. So live `createPaymentIntent` / `retrievePaymentIntent` do *not* run on dahlia; only the SDK paths (subscriptions, webhook signature verification) do. It reads only long-stable fields (`id`, `client_secret`, `status`, `amount_received`, `metadata`), so it works. **Not a cutover blocker.**

- ☑ Live signing secret set (2026-07-27). Take it from the **live-mode** endpoint — test and live `whsec_…` look identical and the failure mode is a 400 on every delivery:
  ```bash
  wrangler secret put STRIPE_WEBHOOK_SECRET --env production   # whsec_…
  ```

- ☐ ⚠️ **Add `/api/webhooks` to the maintenance-mode exemption list before cutover.** `middleware.ts:77-81` exempts only `/admin`, `/api/admin`, and `/api/mcp` — so flipping maintenance mode on during the migration window returns a **503 HTML page to Stripe**. It self-heals (Stripe retries with backoff for ~3 days), but you'd be accumulating undelivered payment events during the exact window you care most about.

- ☐ Test signature handling before cutover:
  `stripe listen --forward-to <host>/api/webhooks/stripe` then `stripe trigger customer.subscription.created`.

- ☐ **Gap, not a blocker:** there is no `charge.refunded` or `charge.dispute.*` handler anywhere. A refund issued **from the Stripe Dashboard** will not touch D1 orders or the ledger (only `/api/orders/refund` does), and chargebacks surface via Stripe email only. Subscribing to the events wouldn't help — these are code gaps. Backlog them.

---

## ☑ Phase 5 — Deploy the observability Tail Worker ⚠️ BEFORE the app (BMC-202) *(prod COMPLETE + delivery verified 2026-07-27; dev secrets pending)*

**Critical ordering.** The production Worker config lists `tail_consumers: [{ service: "beauteas-observability-tail" }]`. That binding is **load-bearing**: if the Tail Worker doesn't exist yet, **`npm run deploy:production` in Phase 7 will FAIL**. Deploy it first, and set its two secrets.

```bash
cd workers/observability-tail
wrangler secret put RESEND_API_KEY  --env production   # Resend key (can be the same as the app's)
wrangler secret put ALERT_EMAIL_TO  --env production   # comma-separated recipient list for alerts
wrangler deploy --env production
cd ../..
```

- ☑ **Tail Worker DEPLOYED 2026-07-27 — both environments.** Neither existed before; Phase 7 would have failed.
  | Worker | Version ID |
  |---|---|
  | `beauteas-observability-tail` (production) | `1a6c4ab7-da1a-48de-b454-f56be3fc9711` |
  | `beauteas-observability-tail-dev` | `2499f103-6f43-4b1d-9bf0-4d692d201930` |

  Dev was deployed too because the **dev app Worker carries the same `tail_consumers` binding** — `npm run deploy:dev` would have hit the identical failure. Deploying without secrets is safe: `sendAlertEmail` (`src/index.ts:161-169`) checks for them and logs-and-returns rather than throwing, so it can never break the producing Worker.

- ⛔ **NOT YET ALERTING — two secrets still required.** The Worker is deployed and consuming traces, but with no secrets it silently drops every alert. **This is worse than not deployed, because it looks covered.** Both values are ones only you can supply (`RESEND_API_KEY` is write-only in Cloudflare, so it cannot be copied from the app Worker):
  ```bash
  cd workers/observability-tail
  wrangler secret put RESEND_API_KEY --env production   # same key as the app's
  wrangler secret put ALERT_EMAIL_TO --env production   # comma-separated recipients
  wrangler secret put RESEND_API_KEY --env dev
  wrangler secret put ALERT_EMAIL_TO --env dev
  cd ../..
  ```
  - ☑ **Production secrets set** (2026-07-27) — `RESEND_API_KEY` + `ALERT_EMAIL_TO` both present; a `Source: Secret Change` deployment (`e1ac525d-…`, 22:08:15Z) confirms it independently.
  - ⛔ **DEV secrets NOT set** — `wrangler secret list --env dev` returns `[]`. The dev Tail Worker is deployed but cannot alert. Dev failures are silent until these are added.
  - ☐ Confirm `ALERT_EMAIL_FROM` (`alerts@beauteas.com`, a config var) is on the **Resend-verified domain** — it fails silently otherwise.

### Smoke test run 2026-07-27 — what was and wasn't proven

A temporary producer Worker (`beauteas-tail-smoketest`) was deployed with `tail_consumers` → `beauteas-observability-tail`, used to fire both alert paths, then **deleted** (deletion verified: `code: 10007, Worker does not exist`).

**Proven:**
- The `tail_consumers` wiring resolves — wrangler confirmed *"Your Worker is sending Tail events to: beauteas-observability-tail"* at deploy.
- Traces genuinely flow and carry the alert payloads. Producer tail captured:
  `GET /critical - Ok` → `(log) [critical] {"area":"webhook","event":"smoketest_critical"}` — i.e. a real `CRITICAL_MARKER` line reached the trace pipeline.
- Triggered: **2 uncaught exceptions** + **1 `[critical]` log line**.

- ☑ **DELIVERY CONFIRMED** — **3 alert emails received** at `ALERT_EMAIL_TO`, matching the 3 triggered events exactly (2 uncaught exceptions + 1 `[critical]` line). The full chain is verified end-to-end: trace → Tail Worker → Resend → inbox. This also confirms `ALERT_EMAIL_FROM` (`alerts@beauteas.com`) is accepted by Resend.

  *(Worth noting because `sendAlertEmail` (`src/index.ts:179-202`) **logs nothing on success** — it only logs on a thrown request or non-OK HTTP status, and tailing a tail-consumer Worker yields no output. So the inbox is currently the **only** positive signal that alerting works. See the alert-observability follow-up below.)*

### ⚠️ Two behaviours this test exposed

1. **No cross-batch deduplication.** 3 events produced 3 separate emails. `dedupe()` only collapses duplicates *within a single invocation batch*, and `MAX_ALERTS_PER_INVOCATION` caps per-email volume — but nothing limits the number of *emails*. A sustained fault (e.g. every webhook 500ing during cutover) would generate an email per trace batch, which could mean hundreds. Consider a cooldown or digest window before go-live.
2. **A silently broken alerter is indistinguishable from a healthy one.** If the Resend key rots or the domain verification lapses, the pipeline fails exactly as quietly as the faults it exists to catch. A synthetic heartbeat, or logging Resend's message id on success, would make this observable.

- ☑ **(Optional) Recommendations rebuild cron — correctly SKIPPED.** Verified against prod: `recommendations.strategy` is `"deterministic"`, which needs no cron. Only required if switched to `ai_batch`.
  > Fixed 2026-07-27 while checking: `REBUILD_URL` pointed at the **apex** (`https://beauteas.com/...`). After cutover the apex only 301s to www, and this is a **POST** — redirect handling can drop the method/body, so the rebuild would have silently failed. Now `https://www.beauteas.com/api/admin/recommendations/rebuild`. If deploying against staging first, override to `shop.beauteas.com`.
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
- ☐ **Upload the knowledge articles to prod R2** under `knowledge_md/`. ⚠️ `data/r2/knowledge_md/*.md` is the git source of truth but **there is no sync script** — the files reach R2 only via the admin UI (`/admin/knowledge` → `MEDIA.put`, `app/api/admin/knowledge/route.ts:166-175`) or a manual `wrangler r2 object put`. Editing the repo files changes nothing on its own.

  These were updated 2026-07-27 to tell customers to email **`info@beauteas.com`** (was `hello@`), matching the new From address. Chai answers from the **Vectorize index**, not from R2 or git directly, so this only takes effect after the upload *and* the rebuild below. Until then Chai will keep giving out the old address.
- ☐ **Rebuild Vectorize** from prod (the index is not copyable):
  ```bash
  curl -X POST "https://shop.beauteas.com/api/admin/vectorize" \
    -H "Authorization: Bearer <ADMIN_VECTORIZE_TOKEN>"
  # Expect the real catalog (+ knowledge articles) indexed
  ```
- ☐ Spot-check on prod (workers.dev URL): products with prices/inventory/images, categories, CMS + legal pages, reviews on PDPs, and redirects populated:
  ```bash
  wrangler d1 execute beauteas-db --env production --remote --command="SELECT COUNT(*) FROM redirect_map;"
  ```

---

## Phase 9 — Final pre-switch verification on `shop.beauteas.com`

Shopify is still serving customers on `www` throughout this phase.

- ☐ Add `shop.beauteas.com` as a **Custom Domain** on the production Worker, and put **Cloudflare Access** in front of it. Access (not just `noindex`) is the right gate: it prevents duplicate-content indexing of the real catalog, and prevents a stray real order or a real customer receiving a test email from the staging host.
- ☐ Products, images, orders visible in `/admin`; reviews on PDPs.
- ☐ **Auth is on the production Clerk instance** — confirm the page loads `clerk.beauteas.com` (prod FAPI), **not** `*.clerk.accounts.dev`. *(The live key `pk_live_Y2xlcmsu…` base64-decodes to `clerk.beauteas.com$`, matching the CSP entry at `lib/security-headers.ts:31`.)*
- ☐ **One live subscription end-to-end** (real card, small charge): webhook → D1 → confirmation email, with a working "Manage Subscription" link and human-readable product names.

### ☐ Email smoke test — nothing here has ever run

Resend has never successfully sent from this app, so all four paths are unexercised. Trigger each against a real inbox and check rendering, not just delivery — these are server-rendered templates that fail on undefined fields and broken image URLs:

| Path | How to trigger |
|---|---|
| Order confirmation (`lib/utils/email.ts:96`) | Place a real order on `shop.` |
| Gift card delivery (`:491`) | Buy a gift-card variant |
| Subscription lifecycle (`:632`) | The live subscription test above (create → cancel) |
| Review notifications (`lib/utils/review-notifications.ts`) | Submit a review; for the reminder, insert a `review_reminders` row with a past due date |

Check on each: images actually load (they resolve against `img.beauteas.com`, not a relative path), totals match the order, and **every link points at `shop.beauteas.com`** — not the apex and not the Shopify site. Also click the unsubscribe link end-to-end; it is signed with `EMAIL_UNSUBSCRIBE_SECRET` and without it the review-reminder sender skips silently.

> ⚠️ The `from:` address is hardcoded to `hello@beauteas.com` in 6 places (`lib/utils/email.ts` ×4, `review-notifications.ts` ×2). **Staging sends real, live-branded email.** Use your own addresses for every test, and never point a staging test at a real customer record.

- ☐ **Apple Pay** (BMC-81): add `public/.well-known/apple-developer-merchantid-domain-association` (does not exist yet). Register **both** `shop.beauteas.com` (to test now) and `www.beauteas.com` (for cutover) in the Stripe dashboard — Stripe allows multiple domains, so there is no reason to do this twice.

---

## Phase 10 — Cutover: shop → www (BMC-83)

This is the point of no easy return — everything above must be green first.

- ☐ **Rebuild + redeploy with the final canonical.** Set `NEXT_PUBLIC_SITE_URL` to `https://www.beauteas.com` in `wrangler.jsonc` (production `vars`), then `npm run deploy:production`. **This must be a rebuild** — the value is inlined into the bundle at build time, so editing the config without redeploying changes nothing. Skipping this leaves every canonical tag, sitemap URL, JSON-LD node and email link pointing at `shop.`
- ☐ Add **`www.beauteas.com`** as a Custom Domain on the production Worker. This takes over the DNS record currently pointing at Shopify — that *is* the cutover.
- ☐ Add a Cloudflare **Redirect Rule** for apex → `www` (301). Today this redirect is a Shopify feature and goes inert the moment DNS leaves; without the rule, `beauteas.com` stops resolving to the store.
- ☐ Keep records **proxied** (orange cloud) so rollback is seconds, not a TTL wait. *(Exception: the Clerk `clerk.`/`accounts.` CNAMEs must stay **DNS-only** / grey cloud — Clerk's validation fails behind the CF proxy.)*
- ☐ **Edit the existing Stripe webhook endpoint's URL** to `https://www.beauteas.com/api/webhooks/stripe`. Edit it — do not create a second endpoint — so the signing secret carries over and `STRIPE_WEBHOOK_SECRET` needs no change.
- ☐ Update **Clerk** allowed domains / redirect URLs for `www.beauteas.com`.
- ☐ Remove the Cloudflare Access gate from `shop.`, and 301 `shop.` → `www` (or retire it).
- ☐ Submit `https://www.beauteas.com/sitemap.xml` to **Google Search Console** (BMC-85). No Change of Address needed — `www` was already the canonical under Shopify, which is the whole reason for choosing it.
- ☐ *(No customer migration email — prod starts fresh; customers register on the new site. BMC-84 stays canceled.)*

---

## Phase 11 — Post-cutover verification (first 60 min, then 24h)

**First hour:**
- ☐ `curl -I https://www.beauteas.com/products/<old-slug>` → **301**.
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
| Rebuild Vectorize (prod) | `curl -X POST "https://shop.beauteas.com/api/admin/vectorize" -H "Authorization: Bearer <TOKEN>"` |
| Live logs | `wrangler tail --env production` |

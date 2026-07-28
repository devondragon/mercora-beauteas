# BeauTeas: Shopify → Mercora Production Cutover Runbook

**Goal:** Take the finished v1.0 build to **beauteas.com serving live traffic on Mercora**, taking real orders on real credit cards — with no loss of orders, customers, reviews, or search rankings.

**Audience:** Operator running the cutover (Devon).

---

## Read this first

**All development is done.** Every launch-blocking code ticket is merged and audited — auth (fail-closed), inventory decrement/oversell, refund idempotency, server-side tax with charge floors, coupon redemption tracking, order-status gating, and observability. There is **no code left to write** to launch. There is also now an automated test suite (Vitest + Playwright, gated in CI).

**Everything below is operational** — standing up live services, flipping to live keys, **promoting the curated catalog from dev to prod**, and switching DNS. None of it has been exercised end-to-end against live Stripe/Clerk yet, so the manual verification steps (Phases 9 and 11) are the safety net.

**What's already provisioned** (don't redo): prod D1 (`beauteas-db`, id `5dbae836-…`), R2 (`beauteas-images`), and Vectorize (`beauteas-index`) all exist. Migrations **0001–0018 are ALL applied to prod** (0013–0018 applied 2026-07-27; `migrations list` reports none pending). `app/robots.ts` exists. Wallets are wired in `PaymentForm.tsx`.

**Data strategy (decided 2026-07-20):** prod is populated by **copying the curated catalog/content from dev**, NOT by re-running the Shopify ETL against prod. The ETL already ran into dev and the catalog was hand-fixed there; dev is the golden source. **Customers and orders start fresh** — none are migrated (customers re-register on the new site). See Phase 8.

**Progress as of 2026-07-28 — Phases 0, 1, 2, 3, 5, 7, and 8 are COMPLETE; Phase 9 is nearly done.** Cloudflare paid plan · Clerk production instance (certs issued, `clerk.beauteas.com` FAPI live) · Stripe live + tax registrations · live publishable keys · all 7 production secrets · prod D1 fully migrated (`0001`–`0018`) · Tail Worker alerting verified · **app deployed and serving on `shop.beauteas.com`** · **catalog, images, knowledge, and Vectorize promoted to prod** · **one real live order placed end-to-end** with correct Stripe tax, webhook, inventory decrement, and confirmation email.

> ☑ **RESOLVED — `NEXT_PUBLIC_*` build-time blocker.** Fixed via `scripts/build-with-env.mjs`; verified with a real production build. Would have shipped test Stripe/Clerk keys to the browser against live server keys. See Phase 1.
>
> ☑ **RESOLVED — Resend.** Was never configured (placeholder key inherited from the upstream fork). Domain now verified, key set in all four locations, and email failures now route to `logCritical`. See Phase 2.

> ☑ **RESOLVED — order-confirmation email path.** It has now rendered and delivered for a real order. Two bugs found and fixed doing it: line items carried no image (resolved at send time from product media, commit `6dc60e6`), and there was **no merchant notification at all** — the shop owner had no signal an order needed fulfilling beyond Stripe's payment email (commit `a4376e5`, stopgap for BMC-216).

**⚠️ Still untested: the gift-card, subscription, and review email paths.** Explicitly **not** launch blockers (see the critical path below) — but they have still never rendered, and they are server-rendered templates that fail on undefined fields.

**Next up: Phase 10 (the cutover itself).** The only thing between here and DNS is the short open list in Phase 9 — chiefly **gating `shop.` behind Cloudflare Access**, which is currently wide open and fully crawlable (see below).

**☑ DECIDED 2026-07-27 — hostnames.**

| Host | Role |
|---|---|
| `shop.beauteas.com` | **Staging/validation.** Custom domain on the **production** Worker (prod D1/R2/Vectorize, live keys), gated behind Cloudflare Access. Shopify keeps serving customers on `www` throughout. |
| `www.beauteas.com` | **Permanent production canonical.** What `BASE_URL` resolves to after cutover; keeps the link equity Shopify accumulated. |
| `beauteas.com` (apex) | 301 → `www`, via a Cloudflare Redirect Rule (today this redirect is a Shopify feature and goes inert when DNS leaves). |

`BASE_URL` is now env-driven off `NEXT_PUBLIC_SITE_URL` (`lib/seo/metadata.ts`), set per environment in `wrangler.jsonc` and injected at build time. It is currently `https://shop.beauteas.com` so staging emits its own canonicals rather than pointing crawlers and customer emails at the Shopify store. **Flipping it to `https://www.beauteas.com` is a Phase 10 step and requires a rebuild + redeploy** — it is baked into the bundle, so editing the config alone does nothing.

## ⇒ CRITICAL PATH TO CUTOVER

Everything genuinely blocking go-live, in order. Anything not on this list is optional or post-launch — **do not let it consume cutover time.**

| # | Blocker | Status | Blocked by |
|---|---|---|---|
| ~~1~~ | ~~R2 API token~~ | ⊘ | **not needed** — `sync-images.mjs` uses wrangler, not the S3 API (verified 2026-07-27) |
| 2 | **Deploy app to prod** (Phase 7) | ☑ | done 2026-07-27 — `shop.beauteas.com` live |
| 3 | **Promote catalog + images dev → prod** (Phase 8) | ☑ | done 2026-07-27 — 10 products / 6 categories / 13 pages / 47 images / **18 vectors** indexed |
| 4 | **Verify on `shop.`**: one real order end-to-end + order-confirmation email renders (Phase 9) | ☑ | done 2026-07-27 — order `WEB-GUEST-1785194376707`, `calculated_by: stripe`, webhook OK, inventory 250→249, email delivered |
| 5 | **Gate `shop.` behind Cloudflare Access** (Phase 9) | ☐ | **← the only open blocker.** It is public and crawlable right now |
| 6 | **DNS switch + rebuild with `www` canonical** (Phase 10) | ☐ | #5 |
| 7 | **Post-cutover checks** (Phase 11) | ☐ | #6 |

**Explicitly NOT blocking launch:** subscriptions (not sold at launch — no coupon, no recurring prices, no subscription tests) · the recommendations cron (strategy is `deterministic`) · [BMC-212](https://linear.app/blackmagicconsulting/issue/BMC-212/retire-cloudflarestripe-live-paymentintent-path-still-runs-on-stripe) CloudflareStripe · [BMC-213](https://linear.app/blackmagicconsulting/issue/BMC-213/stripe-dashboard-refunds-are-invisible-to-the-app-over-refund-vector) refund reconciliation · [BMC-214](https://linear.app/blackmagicconsulting/issue/BMC-214/no-chargebackdispute-handling-chargedispute-events-unobserved) disputes · gift-card and review email paths (only the order-confirmation path is on the launch critical path).

---

**Do it in order.** Each phase depends on the ones before it. Check the box, move on.

**Status legend:** ☐ not started · ◐ in progress · ☑ done · ⊘ not needed for launch

---

## Phase 0 — Accounts & decisions (get these first; they have lead time)

You can't do anything else until these exist. None of it is code — it's account setup and business decisions.

- ☑ **Cloudflare** account on the Workers **paid** plan; note the Account ID. *(Done 2026-07-27 — account `e230c667ec437820d64caf703df479b6`.)*
- ☑ **Clerk production instance** (separate from the `pk_test…` dev instance). Get `pk_live_…` + `sk_live_…`. *(Done 2026-07-27.)*
- ☑ **Stripe** business verification complete, **Live mode** available. *(Done 2026-07-27.)*
- ☑ ⚠️ **Stripe Tax registrations / nexus configured in the LIVE account** (BMC-187). *(Done 2026-07-27 — still verify at first live checkout that `/api/tax` returns `"calculated_by": "stripe"`, not `"fallback"`.)* **This is a hard gate, not just "enable Stripe Tax."** `/api/tax` uses nexus-aware Stripe Tax but **falls back to a flat 7% rate** whenever Stripe Tax errors or `STRIPE_SECRET_KEY` is missing. If your live nexus isn't registered, **every order mischarges tax.** Verify in **Stripe Dashboard → Tax → Registrations** that each jurisdiction you have nexus in is registered. (Confirmed working later when a live checkout's `/api/tax` returns `"calculated_by": "stripe"`, not `"fallback"`.)
- ⊘ **NOT NEEDED — verified 2026-07-27.** The runbook previously claimed an R2 API token (Access Key ID + Secret) was required for the dev→prod image copy via "S3 API / rclone". It isn't: `scripts/sync-images.mjs` shells out to `wrangler r2 object put/get` (`:86`, `:130`), so it inherits the existing `CLOUDFLARE_API_TOKEN`. Confirmed by writing a test object to the prod `beauteas-images` bucket and deleting it — both succeeded.
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
- ☑ Confirmed after deploying: the page loads `clerk.beauteas.com` (production FAPI), **not** `*.clerk.accounts.dev`. See Phase 9.

---

## ☑ Phase 2 — Set production secrets *(COMPLETE 2026-07-27)*

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

### ☑ Resend — was never configured for this domain; now set up across all envs

Found 2026-07-27: `RESEND_API_KEY` was the untouched `re_your_…` placeholder inherited from the upstream Mercora fork, and was absent from `.dev.vars` entirely. **No email has ever sent from this app, in any environment.** The prod secret is now set, but that means every email path is unexercised:

- ☑ **`beauteas.com` verified in Resend.** Independently confirmed 2026-07-27: the Tail Worker's Phase 5 smoke test delivered 3 alert emails from `alerts@beauteas.com`, which is only possible on a verified domain.
- ☑ **Key set in all four places** (verified 2026-07-27 by presence check, values never printed):
  | Location | Purpose | Status |
  |---|---|---|
  | `.env.local` | `next dev` | ☑ real key (not the `re_your_` placeholder) |
  | `.dev.vars` | `preview:dev` + local Workers runtime | ☑ real key — **same key as `.env.local`** (fingerprint-matched) |
  | app Worker `--env dev` | deployed dev | ☑ `RESEND_API_KEY` present |
  | app Worker `--env production` | deployed prod | ☑ `RESEND_API_KEY` present |

  Both local files are gitignored (`.gitignore:32`, `:46`) and untracked — confirmed, no key is committed. The dev app Worker also now carries the full 7-secret set, matching production.
- ◐ Smoke-test the four paths against a real inbox. **Order confirmation now PASSES** (real order, 2026-07-27 — see Phase 9). Gift card (`:495`), subscription (`:636`), and review notifications remain unexercised; none is a launch blocker.
- ☑ **Email failure wired into alerting** (commit `951c5be`). `order-confirmation.ts` now calls `logCritical` under a new `"email"` area on both the send-failure and preparation-failure branches, so a broken Resend config pages instead of vanishing into `console.error`. The Tail Worker matches on `CRITICAL_MARKER`, not an area allowlist, so it picked this up with no change.

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

- ⊘ **NOT AT LAUNCH (decided 2026-07-27).** Subscription discount coupon — subscriptions are not being sold at launch.
- ⊘ **NOT AT LAUNCH (decided 2026-07-27).** Recurring Prices for subscribable products. The app auto-creates these on first use, so nothing needs pre-creating if subscriptions are enabled later.
- ☑ **Endpoint created (2026-07-27, self-reported).** One webhook endpoint → `/api/webhooks/stripe`.
  > ⚠️ **Confirm which host it points at.** It should be **`https://shop.beauteas.com/api/webhooks/stripe`** for now. `www` and the apex are still Shopify, so an endpoint pointed there delivers into the old store and every event is lost — silently, because Stripe just records delivery failures you aren't watching. At cutover, **edit this endpoint's URL** to `www` rather than creating a second one, so the signing secret carries over. **Create a single endpoint and *edit its URL* at cutover** rather than adding a second one: each Stripe endpoint gets its own signing secret, the Worker holds only one `STRIPE_WEBHOOK_SECRET`, and running two means deliveries from the second fail signature verification (400) until Stripe backs off. Editing the URL in place preserves the secret — no redeploy, no gap.

- ☑ **Events subscribed (2026-07-27, self-reported)** — exactly these 9 — this is the full `switch` in `app/api/webhooks/stripe/route.ts:103-145`; anything else falls to `default:` and only logs:
  - `payment_intent.succeeded` ← **the money path** (`finalizePaidOrder`, gift cards, confirmation email)
  - `payment_intent.payment_failed` (handler is a stub — logs only)
  - `checkout.session.completed` (handler is a stub; you use Payment Element, not Checkout Sessions — **safe to omit**)
  - `customer.subscription.created` / `.updated` / `.deleted`
  - `invoice.payment_succeeded` ← creates renewal orders · `invoice.payment_failed` · `invoice.upcoming`

  > Corrected 2026-07-27: earlier drafts of this runbook listed `customer.subscription.paused` and `.resumed`. **There are no handlers for those** — pause/resume is detected inside `customer.subscription.updated`. Subscribing to them is harmless but does nothing.

- ☑ ⚠️ **API version set to `2026-06-24.dahlia` (2026-07-27, self-reported)** — matching `lib/stripe.ts:75`/`:117`.

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

- ☑ **`/api/webhooks` exempted from maintenance mode** (commit `951c5be`). Previously `middleware.ts` exempted only `/admin`, `/api/admin`, and `/api/mcp`, so enabling maintenance mode during the migration window would have returned a **503 HTML page to Stripe** — self-healing via retries, but accumulating undelivered payment events during exactly the window you care most about.

- ☑ **Signature handling proven in production 2026-07-27** — by something better than `stripe listen`: the live order `WEB-GUEST-1785194376707` produced a real `payment_intent.succeeded` that Stripe signed, the Worker verified, and the handler processed (order promoted to paid, inventory decremented). That exercises the live `STRIPE_WEBHOOK_SECRET` on the live endpoint at the dahlia API version — the exact combination a CLI test only approximates.
  > At cutover you **edit this endpoint's URL** to `www` rather than creating a second one, so this verified secret carries over unchanged.

- ☑ **Gaps filed as tickets (2026-07-27).** Both are code gaps — subscribing the events alone would not help.
  - **[BMC-213](https://linear.app/blackmagicconsulting/issue/BMC-213/stripe-dashboard-refunds-are-invisible-to-the-app-over-refund-vector) (High)** — no `charge.refunded` handler. Worse than first assessed: the over-refund guard computes its total *exclusively* from `orders.extensions.refunds[]` (`lib/payments/refund-ledger.ts:101-105`), which a Dashboard refund never writes. So a Dashboard refund followed by an app refund **returns the money twice**. Also skips inventory restock and the `refund.*` policy settings.
  - **[BMC-214](https://linear.app/blackmagicconsulting/issue/BMC-214/no-chargebackdispute-handling-chargedispute-events-unobserved) (Medium)** — no `charge.dispute.*` handling. Chargebacks are invisible to the app; the only signal is Stripe's email, so a missed evidence deadline is an automatic loss. Sequence **after** BMC-213 and reuse its reconciliation.

---

## ☑ Phase 5 — Deploy the observability Tail Worker ⚠️ BEFORE the app (BMC-202) *(COMPLETE 2026-07-27 — both envs, delivery verified)*

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
  - ☑ **Dev secrets set** (2026-07-27) — `RESEND_API_KEY` + `ALERT_EMAIL_TO` both present on `beauteas-observability-tail-dev`. Both environments can now alert.
  - ☑ `ALERT_EMAIL_FROM` (`alerts@beauteas.com`) confirmed on the **Resend-verified domain** — proven by the 3 alert emails actually delivered in the smoke test below.

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

## ☑ Phase 7 — Deploy the app to prod + seed admins + smoke test *(COMPLETE 2026-07-27 — DNS still on Shopify)*

- ☑ **`admin_users` seeded** (BMC-77) — verified in prod: `user_3H6h7g2w4I30VDXsdY8lOTvG5Fp` / `super_admin` / `is_active=1`. **Confirmed working, not just present:** the row carries a real `last_login` (2026-07-28T00:51Z), so the full Clerk-session → `isUserAdmin()` → `/admin` path has actually executed in production.
  > The column is `user_id`, **not** `clerk_user_id` — the command previously printed here would have errored. Correct form:
  > ```bash
  > wrangler d1 execute beauteas-db --env production --remote \
  >   --command="INSERT INTO admin_users (user_id, email, display_name, role, created_by, is_active) VALUES ('<clerk_id>','<email>','<name>','super_admin','cutover-seed',1);"
  > ```
- ☑ **Deployed** via `npm run deploy:production` (Tail Worker was already live, so the `tail_consumers` binding resolved).
- ☑ **Custom domain added** — `shop.beauteas.com`, declared in `wrangler.jsonc` production `routes` with `custom_domain: true`. `www` and the apex remain on Shopify, untouched.
  > Note: adding `routes` **disables the `*.workers.dev` URL** for this Worker, so validation happens on `shop.` rather than workers.dev as originally written.
- ☑ **Smoke tested on `shop.`** — homepage, PDP, category nav, cart, `/admin`, and Chai all load. Two production-only faults were found and fixed here, neither reproducible in dev:
  - **Every product image 404'd.** `image-loader.ts` routed everything through `/cdn-cgi/image/...`, which requires Image Transformations enabled for the zone — it wasn't. Now enabled, plus a `NEXT_PUBLIC_IMAGE_TRANSFORMS=false` escape hatch that serves raw objects instead (commit `eaa1245`, regression-tested). Dev never hit this because it has no `NEXT_PUBLIC_IMAGE_CDN` and falls back to `/media`.
  - **`/admin` hung on "Checking access permissions."** Clerk had not yet issued SSL certs for `clerk.beauteas.com` / `accounts.beauteas.com`, so `clerk.browser.js` 403'd and `AdminGuard` never left `isLoaded=false`. Resolved once Clerk finished DNS verification and issued the certs.
- ☑ **Live-key checkout confirmed** — a real low-value order was placed rather than swapping in test keys. See Phase 9.

---

## ☑ Phase 8 — Promote the curated catalog + content from DEV → PROD *(COMPLETE 2026-07-27)*

**Verified live in prod 2026-07-28:** 10 products · 6 categories · 13 pages · 47 R2 images · 8 knowledge articles · **Vectorize index rebuilt to 18 vectors** (10 products + 8 knowledge, `processedUpTo` 2026-07-27T22:58Z).

> ⚠️ **`redirect_map` is EMPTY — 0 rows in prod *and* in dev.** The promotion copied it faithfully; there was simply never anything to copy. Impact is limited but real: only the **structural** fallback redirect applies (`/products/:slug` → 301 `/product/:slug`, `middleware.ts:214-223` — verified working on `shop.`). Any Shopify URL whose **slug** changed during the ETL will 301 to a product that doesn't exist → 404, losing that page's link equity. With ~10 SKUs this is a 10-minute check, not a project: compare the live Shopify product/collection slugs against prod `products.slug`, and insert a `redirect_map` row for each mismatch before Phase 10. See the Phase 11 redirect check.

Cutover-day, start of window. Prod starts fresh (no customers/orders); we copy the **curated catalog/content** from dev. **Prereq: Phase 3 (migrations 0013–0018) applied**, so dev and prod schemas match exactly.

> **Use `scripts/promote-dev-to-prod.mjs`.** It exports the whitelisted tables from dev (`--no-schema`), rewrites `INSERT` → `INSERT OR REPLACE`, loads them into prod, then delegates to `sync-images.mjs` to copy the R2 images (dev → prod) and prints the Vectorize rebuild curl. It is **dry-run by default** (reads only) and **preflights migration parity** — it aborts unless prod already has the 0013–0018 tables. Run the dry run first, then `--execute`:
> ```bash
> node scripts/promote-dev-to-prod.mjs            # dry run: preview row counts + copy/exclude sets
> node scripts/promote-dev-to-prod.mjs --execute  # write catalog/content + images to prod
> ```
> The manual `wrangler d1 export --table … | d1 execute --file …` path below is the fallback if you need to copy tables individually.

- ☐ **Put Shopify in read-only** (freeze new orders) — fallback if cutover aborts. *(Still to do — this belongs to the Phase 10 window, not the catalog promotion.)*
- ☑ Back up the prod DB baseline:
  ```bash
  wrangler d1 export beauteas-db --env production --remote --output=backup-pre-promote.sql
  ```
- ☑ **Copied R2 image objects** dev → prod — 47 objects. Image refs in D1 are **relative keys** (`products/{slug}.{ext}`), so they map 1:1. `scripts/promote-dev-to-prod.mjs` handles this by delegating to `sync-images.mjs pull --env dev` then `push --env production` — **no R2 API token needed**, it uses wrangler and your existing `CLOUDFLARE_API_TOKEN` (verified 2026-07-27). `img.beauteas.com` is confirmed as a custom domain on the prod `beauteas-images` bucket and serving.
- ☑ **Copied the curated D1 tables** dev → prod — **catalog/content only**, table-scoped, `INSERT OR REPLACE` (prod already holds migration-seeded CMS/legal/gift-card-product rows, so a blind dump collides). Copy set:
  ```
  categories · product_types · products · product_variants · inventory · pricing · media
  pages · page_versions · page_templates · redirect_map
  product_reviews · review_media · blog_categories · blog_posts
  subscription_plans · admin_settings
  ```
- ☑ **Did NOT copy** — credentials / admin / customer / transactional / dev-noise:
  ```
  admin_users · api_tokens · mcp_agents · mcp_sessions · mcp_usage · mcp_rate_limits
  customers · addresses · orders · order_webhooks
  customer_subscriptions · subscription_events · processed_webhook_events
  chat_sessions · chat_messages · gift_cards · gift_card_transactions
  review_reminders · email_unsubscribes
  ```
  …and **never** `d1_migrations` (prod tracks its own migration state).
- ☑ **Knowledge articles uploaded to prod R2** under `knowledge_md/` — all 8, verified to contain `info@beauteas.com`. ⚠️ `data/r2/knowledge_md/*.md` is the git source of truth but **there is no sync script** — the files reach R2 only via the admin UI (`/admin/knowledge` → `MEDIA.put`, `app/api/admin/knowledge/route.ts:166-175`) or a manual `wrangler r2 object put`. Editing the repo files changes nothing on its own.
  > This bit once: the first promotion left prod R2 holding the **stale** `hello@` copies, because the promote script syncs `products/` images but not `knowledge_md/`. Re-pushed manually. If you edit knowledge content again, push it *and* rebuild Vectorize.
- ☑ **Vectorize rebuilt** from prod (the index is not copyable) — **18 vectors** (10 products + 8 knowledge articles), `processedUpToDatetime` 2026-07-27T22:58Z. Confirm with `wrangler vectorize info beauteas-index`.
  ```bash
  curl -X POST "https://shop.beauteas.com/api/admin/vectorize" \
    -H "Authorization: Bearer <ADMIN_VECTORIZE_TOKEN>"
  ```
- ☑ Spot-checked on prod (`shop.beauteas.com`): products with prices/inventory/images, category nav, CMS + legal pages all render.
- ☐ **Confirm Chai now gives out `info@beauteas.com`.** The knowledge re-push and the index rebuild happened close together — ask Chai "how do I contact you?" on `shop.` and check the address in the answer. If it still says `hello@`, just re-run the rebuild curl above.
  > Related: Chai has separately been observed inventing a contact address rather than quoting the knowledge base — filed as a backlog ticket (some queries should be answered deterministically, not generatively). Not a launch blocker, but it means a correct index does not *guarantee* a correct answer.

---

## ◐ Phase 9 — Final pre-switch verification on `shop.beauteas.com`

Shopify is still serving customers on `www` throughout this phase.

- ☑ `shop.beauteas.com` added as a **Custom Domain** on the production Worker.
- ⛔ **NOT DONE — `shop.` is NOT gated. This is the one open cutover blocker.** Verified 2026-07-28: `GET /` returns **200 to anyone**, `robots.txt` says `Allow: /`, `/sitemap.xml` is served *and advertised in robots*, and every page self-canonicals to `https://shop.beauteas.com/...`. So the full real catalog is publicly crawlable on a second hostname while `www` still serves Shopify.

  Two distinct harms, both cheap to avoid and expensive to undo:
  1. **Duplicate-content indexing.** If Google indexes `shop.` before cutover, the post-cutover `www` pages compete with an already-indexed twin of themselves — the opposite of the reason `www` was chosen as canonical.
  2. **A stranger can place a real order on staging**, on live Stripe keys, and receive real live-branded email from `info@beauteas.com`.

  **Fix: put Cloudflare Access in front of `shop.`** (Zero Trust → Access → Applications → self-hosted, host `shop.beauteas.com`, policy = your email). Access is the right gate rather than a `noindex`: `app/robots.ts` is not environment-aware — it derives from `BASE_URL` and hardcodes `Allow: /` — so making robots env-conditional would be a code change plus a rebuild, and it would still leave the host open to orders.
- ☑ Products, images, and orders visible in `/admin` — confirmed with the live order below.
- ☑ **Auth is on the production Clerk instance.** Verified end-to-end 2026-07-27: `clerk.beauteas.com` serves a cert with `CN=clerk.beauteas.com`, `clerk.browser.js` returns 200, and `/v1/client` returns 200. The `admin_users` row shows a real `last_login`, so a production Clerk session genuinely authenticated. *(The live key `pk_live_Y2xlcmsu…` base64-decodes to `clerk.beauteas.com$`, matching the CSP entry at `lib/security-headers.ts:31`.)*
  > `accounts.beauteas.com` (Account Portal) returns 403 to `curl` even with browser headers, but the response carries a `server-timing: chlray` — a Cloudflare **challenge**, not the earlier error-1000 misconfiguration. Worth one real-browser click to confirm, since that host handles password reset and email verification.
- ⊘ **DEFERRED — subscriptions not sold at launch.**

### ☑ Live order test — PASSED 2026-07-27

One real order on live Stripe keys: **`WEB-GUEST-1785194376707`**, $21.47, guest checkout.

| Check | Result |
|---|---|
| Order state | `paid` / `processing` |
| **Stripe Tax** | tax computed at **3.27%** — i.e. `calculated_by: "stripe"`, **not** the 7% fallback. This is the Phase 0 nexus gate, confirmed. |
| Webhook | `payment_intent.succeeded` received and processed on the dahlia endpoint |
| Inventory | decremented 250 → 249 |
| Confirmation email | delivered and rendered |

### ◐ Email smoke test — order confirmation PASSED; the rest are unexercised

| Path | Status |
|---|---|
| Order confirmation (`lib/utils/email.ts:103`) | ☑ **delivered and rendered.** Two bugs found: missing line-item images (fixed, `6dc60e6`) and no merchant notification (added, `a4376e5`). |
| Merchant new-order notification (`:893`) | ◐ **built and unit-tested, not yet observed in production.** Place one more order — or refund/re-place — and confirm the owner email arrives. This is the only signal that an order needs fulfilling. |
| Gift card delivery (`:495`) | ☐ not a launch blocker |
| Subscription lifecycle (`:636`) | ⊘ not sold at launch |
| Review notifications (`lib/utils/review-notifications.ts`) | ☐ not a launch blocker |

Check on each: images actually load (they resolve against `img.beauteas.com`, not a relative path), totals match the order, and **every link points at `shop.beauteas.com`** — not the apex and not the Shopify site. Also click the unsubscribe link end-to-end; it is signed with `EMAIL_UNSUBSCRIBE_SECRET` and without it the review-reminder sender skips silently.

> ⚠️ All `from:` addresses are now **`info@beauteas.com`** (updated 2026-07-27; was `hello@`, in 6 places). **Staging sends real, live-branded email.** Use your own addresses for every test, and never point a staging test at a real customer record.

- ☐ **Apple Pay** (BMC-81): add `public/.well-known/apple-developer-merchantid-domain-association` — **confirmed still missing 2026-07-28** (`public/.well-known/` does not exist). Register **both** `shop.beauteas.com` and `www.beauteas.com` in the Stripe dashboard — Stripe allows multiple domains, so there is no reason to do this twice. *Card checkout works without this; only the Apple Pay wallet button is affected.*

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
- ☐ `curl -I https://www.beauteas.com/products/<old-slug>` → **301**. ⚠️ `redirect_map` is empty, so only the structural `/products/:slug` → `/product/:slug` rule fires. Check that the 301 **target actually resolves** (`curl -IL`, expect a final 200) — a 301 into a 404 is worse than no redirect. Test every old Shopify product and collection URL, not one.
- ☐ Google Rich Results Test on a live product URL — Product + Breadcrumb + Organization JSON-LD valid.
- ☐ Place one real order; confirm the Resend confirmation email + the order in `/admin`.
- ⊘ **DEFERRED** — subscriptions not sold at launch.
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
| Promote catalog + images dev→prod | `node scripts/promote-dev-to-prod.mjs --execute` *(dry-run without the flag)* |
| Copy R2 objects dev→prod only | `node scripts/sync-images.mjs pull --env dev` then `push --env production` (wrangler-based; no R2 API token) |
| Check the Vectorize index | `wrangler vectorize info beauteas-index` |
| Rebuild Vectorize (prod) | `curl -X POST "https://shop.beauteas.com/api/admin/vectorize" -H "Authorization: Bearer <TOKEN>"` |
| Live logs | `wrangler tail --env production` |

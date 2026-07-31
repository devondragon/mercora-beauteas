# Cloudflare Environments & Deploys

How `wrangler.jsonc` is laid out, what is bound where, and how builds reach each environment.
Deploy-blocking migration state lives in [`database-migrations.md`](database-migrations.md).

---

## Environments

Two named environments. Resources for both dev and prod are provisioned (D1, R2, Vectorize created).

| | **dev** (`--env dev`) | **production** (`--env production`) |
|---|---|---|
| Worker name | `beauteas-dev` | `beauteas` |
| D1 database | `beauteas-db-dev` (`f88149dc-…`) + preview (`0a037b06-…`) | `beauteas-db` (`5dbae836-ff0f-420c-9ac0-16088ceb60ee`) |
| R2 (`MEDIA` + `NEXT_INC_CACHE_R2_BUCKET`) | `beauteas-images-dev` (+ `-dev-preview`) | `beauteas-images` |
| Vectorize | `beauteas-index-dev` | `beauteas-index` (both 768-dim, cosine) |
| Clerk publishable key | `pk_test_…` (set) | ✅ `pk_live_…` (set) |
| Stripe publishable key | `pk_test_…` (set) | ✅ `pk_live_…` (set) |

- **Shared bindings** (inherited): `ASSETS` (`.open-next/assets`), `AI`, observability enabled, empty `durable_objects`.
- **Compatibility:** date `2026-06-25`, flags `["nodejs_compat", "global_fetch_strictly_public"]`.

## Rate-limit bindings (BMC-180)

Per-env `ratelimits`:

- `AI_RATE_LIMITER` — 20/60s, guards the paid `/api/agent-chat` AI path.
- `PUBLIC_RATE_LIMITER` — 60/60s, guards `tax`, `validate-discount`, `gift-cards/validate`, `payment-intent`, `shipping-options`.

Native Cloudflare rate limiting (best-effort, per-colo); enforced via `lib/rate-limit.ts` (`enforceRateLimit`), which **fails open** if the binding is absent (e.g. plain `next dev`). Distinct `namespace_id`s per env so dev/prod counters don't share.

## Secrets

Per-env via `wrangler secret put … --env <dev|production>` — **never** in `wrangler.jsonc`:

`CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_VECTORIZE_TOKEN`, `EMAIL_UNSUBSCRIBE_SECRET` (signs CAN-SPAM unsubscribe links, BMC-184), `ORDER_STATUS_SECRET` (signs guest order-status HMAC tokens, `lib/order-status/token.ts`, BMC-216A).

⚠️ `ORDER_STATUS_SECRET` is only set in the gitignored local `.dev.vars` so far — remote dev/prod provisioning is BMC-231. Until it is set on a deployed env, guest order-status links **fail closed** there (no token minted or verified) rather than erroring loudly.

Locally, the Workers runtime reads `.dev.vars`, not `.env.local`.

## Binding types

Generated to `cloudflare-env.d.ts` (committed) via `npm run cf-typegen`.

⚠️ **Do not regenerate wholesale.** A newer wrangler CLI rewrites this file's other bindings as **optional** (`DB?`), which breaks existing `env.DB` call sites. The `AI_RATE_LIMITER` / `PUBLIC_RATE_LIMITER` `RateLimit` entries were therefore **hand-added** in the existing required-binding shape — keep them in sync with `wrangler.jsonc` manually.

## Build & deploy commands

```bash
# Local preview on the Workers runtime
npm run preview           # opennextjs-cloudflare build && preview
npm run preview:dev       # opennextjs-cloudflare build && wrangler dev --env dev

# Deploy (OpenNext build + deploy, per environment)
npm run deploy:dev        # clean → opennextjs-cloudflare build → deploy --env dev
npm run deploy:production # clean → opennextjs-cloudflare build → deploy --env production
npm run clean             # rm -rf .open-next .next .wrangler/state .wrangler/public

# Cloudflare types (regenerate after wrangler.jsonc binding changes — see caveat above)
npm run cf-typegen

# CMS page images → R2 (uploads from the committed data/r2/pages/ bytes;
# skips keys that already exist, so it is safe to re-run). Needs CLOUDFLARE_API_TOKEN.
npm run images:pages -- --env dev|production
```

- **Deploys go through OpenNext**, not bare `wrangler deploy`. Worker entry is `.open-next/worker.js`.
- `open-next.config.ts` enables the R2-backed ISR incremental cache (`NEXT_INC_CACHE_R2_BUCKET`).
- `npm run deploy:production` **does** run pending D1 migrations first, from the `predeploy:production` hook (backup → apply → build → deploy); a migration failure aborts the deploy. `deploy:dev` does the same for `beauteas-db-dev` *and* the dev preview DB. Because it auto-applies without inspecting the SQL, migrations must be written expand-first — see [`database-migrations.md`](database-migrations.md#auto-apply-on-deploy-bmc-239).

## Live logs

```bash
npx wrangler tail --env dev
```

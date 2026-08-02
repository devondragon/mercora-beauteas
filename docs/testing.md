# Testing & CI

All three suites participate in the launch-readiness gate.

| Suite | Command | Config | Location | In CI? |
|---|---|---|---|---|
| Unit (Vitest) | `npm test` | `vitest.config.ts` | `tests/unit/**` | ✅ |
| Workers integration | `npm run test:workers` | `vitest.workers.config.mts` (`@cloudflare/vitest-pool-workers`) | `tests/integration/**` | ✅ |
| E2E (Playwright) | `npm run test:e2e` | `playwright.config.ts` | `tests/e2e/**` | ✅ |

Also: `npm run test:watch`, `npm run test:coverage`, `npm run test:e2e:ui`, `npm run test:e2e:headed`.

---

## Launch-readiness gate

`.github/workflows/ci.yml` runs lint, TypeScript, `npm audit --omit=dev`, unit tests, Workers integration tests, the production OpenNext build, and Playwright checkout/browser tests.

Playwright starts `npm run preview:dev` on an isolated port, seeds local D1/R2, and runs against the real OpenNext Worker runtime. CI uses one browser worker to keep the local Worker deterministic. Production deployment queries GitHub Checks and refuses to deploy unless the exact commit passed the job named `Launch readiness gate`.

## Unit tests must not touch Cloudflare bindings

Mock the model layer instead — `vi.mock("@/lib/models/…")` — rather than reaching for the Workers pool. Unit tests cover pure modules and need no secrets or bindings, which is exactly why they can run in CI.

## Deploy is separate from CI

`.github/workflows/production-deploy-guard.yml` is `workflow_dispatch` only. It first requires a successful launch-readiness check for the exact commit, checks `wrangler.jsonc` for `REPLACE_WITH_` placeholders, previews the pending D1 migrations (read-only), then runs `npm run deploy:production` from `main`.

It **does** run migrations, via the `predeploy:production` hook inside that command — backup, apply, then build and deploy, aborting the deploy if the apply fails. See [Auto-apply on deploy](database-migrations.md#auto-apply-on-deploy-bmc-239).

## Local database for tests and dev

`npm run predev` / `npm run seed:local` seed a local D1 + R2 before `next dev`. Plain `next dev` 500s on D1-backed routes without a Workers runtime — use `npm run preview:dev` for anything that needs real bindings.

# Testing & CI

Three suites, only one of which gates a merge.

| Suite | Command | Config | Location | In CI? |
|---|---|---|---|---|
| Unit (Vitest) | `npm test` | `vitest.config.ts` | `tests/unit/**` | ✅ |
| Workers integration | `npm run test:workers` | `vitest.workers.config.mts` (`@cloudflare/vitest-pool-workers`) | `tests/integration/**` | ❌ |
| E2E (Playwright) | `npm run test:e2e` | `playwright.config.ts` | `tests/e2e/**` | ❌ |

Also: `npm run test:watch`, `npm run test:coverage`, `npm run test:e2e:ui`, `npm run test:e2e:headed`.

---

## ⚠️ Only unit tests gate a merge

`.github/workflows/ci.yml` runs, in order: `npm run lint` → `npx tsc --noEmit` → `npm test` → `npm run build`.

It does **not** run `test:workers` or `test:e2e` — Playwright needs a running dev server with local D1/R2 bindings plus test Clerk/Stripe keys, and the Workers pool needs bindings CI doesn't have.

**Consequence:** a regression test only actually blocks a merge if it is unit-style under `tests/unit/`. If you write a regression test for a bug fix, put it there.

## Unit tests must not touch Cloudflare bindings

Mock the model layer instead — `vi.mock("@/lib/models/…")` — rather than reaching for the Workers pool. Unit tests cover pure modules and need no secrets or bindings, which is exactly why they can run in CI.

## Deploy is separate from CI

`.github/workflows/production-deploy-guard.yml` is `workflow_dispatch` only. It checks `wrangler.jsonc` for `REPLACE_WITH_` placeholders, then runs `npm run deploy:production` from `main`.

It does **not** run migrations. See the deploy-ordering blocker in [`database-migrations.md`](database-migrations.md).

## Local database for tests and dev

`npm run predev` / `npm run seed:local` seed a local D1 + R2 before `next dev`. Plain `next dev` 500s on D1-backed routes without a Workers runtime — use `npm run preview:dev` for anything that needs real bindings.

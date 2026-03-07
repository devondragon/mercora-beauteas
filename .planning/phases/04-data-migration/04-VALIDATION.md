---
phase: 4
slug: data-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Migration validation scripts (built into orchestrator) + tsc type checking |
| **Config file** | tsconfig.json (existing) |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsx scripts/shopify-migration/migrate-all.ts --dry-run` |
| **Estimated runtime** | ~10 seconds (type check), ~60 seconds (dry run) |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run migration against local D1 (`--local` flag), verify validation report
- **Before `/gsd:verify-work`:** Full migration run against dev D1 with passing validation report
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | MIGR-01 | type-check | `npx tsc --noEmit` | N/A - scaffold | ⬜ pending |
| 04-01-02 | 01 | 1 | MIGR-01 | type-check | `npx tsc --noEmit` | N/A - scaffold | ⬜ pending |
| 04-02-01 | 02 | 2 | MIGR-02, MIGR-03 | migration-run | `npx tsx scripts/shopify-migration/migrate-categories.ts --local` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | MIGR-02 | migration-run | `npx tsx scripts/shopify-migration/migrate-products.ts --local` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | MIGR-04 | api-call | Clerk Dashboard user count check | ❌ W0 | ⬜ pending |
| 04-02-04 | 02 | 2 | MIGR-05 | migration-run | `npx tsx scripts/shopify-migration/migrate-orders.ts --local` | ❌ W0 | ⬜ pending |
| 04-02-05 | 02 | 2 | MIGR-06 | migration-run | `npx tsx scripts/shopify-migration/migrate-reviews.ts --local` | ❌ W0 | ⬜ pending |
| 04-02-06 | 02 | 2 | MIGR-07 | migration-run | `npx tsx scripts/shopify-migration/migrate-pages.ts --local` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | MIGR-08 | migration-run | `npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM redirect_map"` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 3 | MIGR-09 | validation | Built into orchestrator output | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/shopify-migration/` directory — entire migration script scaffold
- [ ] `migrations/0008_add_redirect_map.sql` — new D1 migration for redirect table
- [ ] `scripts/shopify-migration/lib/types.ts` — shared ETL interfaces
- [ ] `scripts/shopify-migration/lib/id-map.ts` — ID mapping registry
- [ ] `scripts/shopify-migration/lib/wrangler-exec.ts` — D1 SQL execution helper
- [ ] `scripts/shopify-migration/lib/r2-client.ts` — R2 S3 client setup

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clerk customer login | MIGR-04 | Requires real Clerk environment + password reset flow | 1. Pick migrated customer email 2. Trigger password reset 3. Set new password 4. Log in successfully |
| R2 image accessibility | MIGR-02 | Requires R2 API token + real bucket | 1. Run migration with images 2. Check R2 dashboard for uploaded files 3. Verify image URLs resolve |
| Redirect map works | MIGR-08 | Requires deployed middleware + real D1 | 1. Deploy with redirect middleware 2. Visit old Shopify URL 3. Verify 301 redirect to new URL |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

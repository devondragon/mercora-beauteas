---
phase: 04-data-migration
plan: 03
subsystem: database
tags: [migration, redirects, validation, middleware, orchestrator, d1, etl]

# Dependency graph
requires:
  - phase: 04-data-migration/01
    provides: ETL shared library, category/product migration scripts, redirect_map schema
  - phase: 04-data-migration/02
    provides: Customer, order, review, and page migration scripts
  - phase: 01-seo-foundations
    provides: Structural redirect stubs in next.config.ts
provides:
  - Redirect map generator populating D1 redirect_map from migrated entity ID maps
  - Post-migration validation with record counts, spot checks, and R2 image verification
  - Top-level migrate-all.ts orchestrator running all entity migrations in dependency order
  - Middleware D1 redirect lookup for Shopify URLs not covered by structural patterns
affects: [seo-redirects, middleware, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: ["D1 redirect lookup in middleware", "migration orchestrator with per-entity error handling", "validation with count comparison and spot checks"]

key-files:
  created:
    - scripts/shopify-migration/transformers/redirects.ts
    - scripts/shopify-migration/validators/validate.ts
    - scripts/shopify-migration/migrate-all.ts
  modified:
    - middleware.ts
    - scripts/shopify-migration/migrate-categories.ts
    - scripts/shopify-migration/migrate-products.ts
    - scripts/shopify-migration/migrate-customers.ts
    - scripts/shopify-migration/migrate-orders.ts
    - scripts/shopify-migration/migrate-reviews.ts
    - scripts/shopify-migration/migrate-pages.ts

key-decisions:
  - "Middleware D1 redirect lookup scoped to /products/, /collections/, /pages/ paths only"
  - "Redirect lookup wrapped in try/catch so failures never break the site"
  - "migrate-all.ts continues on per-entity failure, logging errors and preserving ID map progress"
  - "All entity migrators refactored to export functions for orchestrator import AND remain standalone-runnable"

patterns-established:
  - "Middleware redirect pattern: try/catch D1 lookup, fail-open to normal request handling"
  - "Migration orchestrator: sequential dependency-order execution with --entity flag for selective runs"
  - "Validation pattern: count comparison + spot checks + R2 image verification"

requirements-completed: [MIGR-08, MIGR-09]

# Metrics
duration: 5min
completed: 2026-03-07
---

# Phase 4 Plan 3: Redirect Map, Validation, Orchestrator, and Middleware Summary

**Redirect map generator from migrated ID maps, post-migration validation with count/spot-check/R2 verification, migrate-all.ts orchestrator with dependency-ordered execution, and middleware D1 redirect lookup for Shopify URL slug changes**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-07T01:00:01Z
- **Completed:** 2026-03-07T01:05:34Z
- **Tasks:** 3 (2 auto + 1 checkpoint)
- **Files modified:** 10

## Accomplishments
- Redirect map generator builds source_path -> target_path entries for products, collections, and pages from migrated ID maps
- Post-migration validation compares source vs D1 record counts per entity, runs 3 spot checks per entity, and verifies R2 image counts
- migrate-all.ts orchestrates the complete pipeline: schema migration -> categories -> products -> customers -> orders -> reviews -> pages -> redirect map -> validation
- Middleware performs D1 redirect_map lookup for Shopify URLs (/products/, /collections/, /pages/) that need slug-level mapping beyond structural redirects
- All entity migrators refactored to export callable functions while remaining standalone-runnable

## Task Commits

Each task was committed atomically:

1. **Task 1: Redirect map generator, validation, and orchestrator** - `285e77d` (feat)
2. **Task 2: Middleware D1 redirect lookup integration** - `483a09f` (feat)
3. **Task 3: Verify complete migration pipeline** - checkpoint approved (no commit)

## Files Created/Modified
- `scripts/shopify-migration/transformers/redirects.ts` - Generates redirect map entries from migrated entity ID maps for products, collections, pages
- `scripts/shopify-migration/validators/validate.ts` - Post-migration validation with record count comparison, spot checks, and R2 image verification
- `scripts/shopify-migration/migrate-all.ts` - Top-level orchestrator running all migrations in dependency order with --entity flag support
- `middleware.ts` - Added D1 redirect_map lookup for Shopify URL paths between maintenance check and final next()
- `scripts/shopify-migration/migrate-categories.ts` - Refactored to export migrateCategories() function for orchestrator
- `scripts/shopify-migration/migrate-products.ts` - Refactored to export migrateProducts() function for orchestrator
- `scripts/shopify-migration/migrate-customers.ts` - Refactored to export migrateCustomers() function for orchestrator
- `scripts/shopify-migration/migrate-orders.ts` - Refactored to export migrateOrders() function for orchestrator
- `scripts/shopify-migration/migrate-reviews.ts` - Refactored to export migrateReviews() function for orchestrator
- `scripts/shopify-migration/migrate-pages.ts` - Refactored to export migratePages() function for orchestrator

## Decisions Made
- Middleware D1 redirect lookup scoped to /products/, /collections/, /pages/ paths only -- avoids unnecessary D1 queries on other routes
- Redirect lookup wrapped in try/catch so failures never break the site (same fail-open pattern as maintenance mode)
- migrate-all.ts continues on per-entity failure, logging errors and preserving ID map progress -- partial migration is better than total failure
- All entity migrators refactored to export functions for orchestrator import AND remain standalone-runnable via import.meta.url check

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**External services require manual configuration.** See the plan frontmatter for required env vars:
- R2 credentials (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID) for image upload
- Shopify credentials or export files for data extraction
- Clerk secret key (CLERK_SECRET_KEY) for customer migration

These were documented in 04-01 and 04-02 plans. No new setup required beyond what was already specified.

## Next Phase Readiness
- Complete Shopify data migration pipeline is ready to run via `npx tsx scripts/shopify-migration/migrate-all.ts`
- Phase 4 (Data Migration) is now complete -- all MIGR requirements (01-09) addressed across plans 01, 02, and 03
- Phase 5 (whatever follows) can proceed with full data in D1 and R2, redirect map populated, and validation available

## Self-Check: PASSED

- All 10 files verified present on disk
- Commit 285e77d verified in git log
- Commit 483a09f verified in git log

---
*Phase: 04-data-migration*
*Completed: 2026-03-07*

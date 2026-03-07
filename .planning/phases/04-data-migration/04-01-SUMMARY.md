---
phase: 04-data-migration
plan: 01
subsystem: database
tags: [etl, shopify, migration, d1, r2, s3, csv-parse, wrangler]

# Dependency graph
requires:
  - phase: 01-seo-foundations
    provides: redirect stubs that redirect_map will populate
provides:
  - ETL shared library (types, ID mapping, config, wrangler D1 helpers, R2 S3 client, CSV reader, Shopify API client, logger)
  - Category migration script (Shopify collections to Mercora categories with localized JSON names)
  - Product/variant/image migration script (price conversion, image download+upload, option mapping)
  - redirect_map D1 table schema and SQL migration
affects: [04-data-migration, seo-redirects]

# Tech tracking
tech-stack:
  added: ["@aws-sdk/client-s3", "csv-parse"]
  patterns: ["ETL pipeline (Extract/Transform/Load)", "wrangler d1 execute for SQL", "S3-compatible R2 API for images", "ID mapping registry with JSON persistence"]

key-files:
  created:
    - scripts/shopify-migration/lib/types.ts
    - scripts/shopify-migration/lib/id-map.ts
    - scripts/shopify-migration/lib/config.ts
    - scripts/shopify-migration/lib/wrangler-exec.ts
    - scripts/shopify-migration/lib/r2-client.ts
    - scripts/shopify-migration/lib/csv-reader.ts
    - scripts/shopify-migration/lib/shopify-api.ts
    - scripts/shopify-migration/lib/logger.ts
    - scripts/shopify-migration/extractors/file-based/collections.ts
    - scripts/shopify-migration/extractors/file-based/products.ts
    - scripts/shopify-migration/extractors/shopify-api/collections.ts
    - scripts/shopify-migration/extractors/shopify-api/products.ts
    - scripts/shopify-migration/transformers/categories.ts
    - scripts/shopify-migration/transformers/products.ts
    - scripts/shopify-migration/loaders/d1-loader.ts
    - scripts/shopify-migration/loaders/r2-loader.ts
    - scripts/shopify-migration/migrate-categories.ts
    - scripts/shopify-migration/migrate-products.ts
    - lib/db/schema/redirect-map.ts
    - migrations/0008_add_redirect_map.sql
  modified:
    - lib/db/schema/index.ts
    - package.json

key-decisions:
  - "Generic loadToD1<T> function signature instead of Record<string, unknown> for type-safe loader calls"
  - "Category names wrapped in JSON localization format {\"en\": value} matching existing seed data convention"
  - "Descriptive IDs (prod_slug, variant_slug_sku) matching existing seed data convention rather than PRD-nanoid"
  - "Product images keyed as products/{handle}.{ext} matching existing R2 folder structure"

patterns-established:
  - "ETL pipeline: extractor -> transformer -> loader with ExtractResult/TransformResult/LoadResult contracts"
  - "Dual extraction paths: file-based (CSV/JSON) and API-based extractors producing same intermediate format"
  - "IdMap registry with JSON persistence for cross-entity ID resolution between migration runs"
  - "wrangler d1 execute --file for SQL loading (scripts cannot use Drizzle ORM due to Workers runtime deps)"

requirements-completed: [MIGR-01, MIGR-02, MIGR-03]

# Metrics
duration: 6min
completed: 2026-03-07
---

# Phase 4 Plan 1: ETL Foundation + Category/Product Migration Summary

**Modular ETL library with shared types/helpers, category migration with localized JSON names, and product/variant/image migration with Shopify price-to-cents conversion and R2 image upload**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-07T00:34:41Z
- **Completed:** 2026-03-07T00:41:25Z
- **Tasks:** 2
- **Files modified:** 24

## Accomplishments
- Built complete ETL shared infrastructure: types, ID mapping, config, wrangler D1 helpers, R2 S3 client, CSV reader, Shopify API client, and migration logger
- Created category migration that transforms Shopify collections to Mercora categories with proper localized JSON name/description/slug format
- Created product migration that handles price conversion (decimal string to cents Money object), image download/upload to R2, option mapping, variant generation, and all JSON field serialization
- Added redirect_map D1 schema and SQL migration for dynamic SEO redirects

## Task Commits

Each task was committed atomically:

1. **Task 1: ETL shared infrastructure and redirect_map schema** - `eaa0dd3` (feat)
2. **Task 2: Categories and products/variants/images migration scripts** - `b77ab86` (feat)

## Files Created/Modified
- `scripts/shopify-migration/lib/types.ts` - ETL intermediate types (ExtractResult, TransformResult, LoadResult, Shopify source types, Mercora insert types)
- `scripts/shopify-migration/lib/id-map.ts` - Shopify-to-Mercora ID mapping registry with JSON persistence
- `scripts/shopify-migration/lib/config.ts` - Environment-based config for Shopify API, R2, D1, and extraction mode
- `scripts/shopify-migration/lib/wrangler-exec.ts` - SQL generation and wrangler d1 execute helper with value escaping
- `scripts/shopify-migration/lib/r2-client.ts` - S3Client for R2 with upload, download-with-retry, and list operations
- `scripts/shopify-migration/lib/csv-reader.ts` - CSV and JSON file reader using csv-parse
- `scripts/shopify-migration/lib/shopify-api.ts` - Shopify Admin REST API client with rate limiting
- `scripts/shopify-migration/lib/logger.ts` - Structured logger with migration report generation
- `scripts/shopify-migration/extractors/file-based/collections.ts` - File-based collection extractor (JSON/CSV)
- `scripts/shopify-migration/extractors/file-based/products.ts` - File-based product extractor with CSV row grouping by Handle
- `scripts/shopify-migration/extractors/shopify-api/collections.ts` - API-based collection extractor
- `scripts/shopify-migration/extractors/shopify-api/products.ts` - API-based product extractor
- `scripts/shopify-migration/transformers/categories.ts` - Collection-to-category transformer with localized JSON
- `scripts/shopify-migration/transformers/products.ts` - Product/variant/image transformer with price conversion
- `scripts/shopify-migration/loaders/d1-loader.ts` - Generic D1 loader with demo data cleanup
- `scripts/shopify-migration/loaders/r2-loader.ts` - Image download and R2 upload loader
- `scripts/shopify-migration/migrate-categories.ts` - Standalone category migration script
- `scripts/shopify-migration/migrate-products.ts` - Standalone product/variant/image migration script
- `lib/db/schema/redirect-map.ts` - Drizzle schema for redirect_map table
- `lib/db/schema/index.ts` - Added redirect-map export
- `migrations/0008_add_redirect_map.sql` - D1 migration for redirect_map table
- `package.json` - Added @aws-sdk/client-s3 and csv-parse devDependencies

## Decisions Made
- Used generic `loadToD1<T>` function signature to accept typed insert records without cast gymnastics
- Category names wrapped in JSON localization format `{"en": value}` matching existing seed data convention (not plain strings)
- Descriptive IDs (`prod_slug`, `variant_slug_sku`, `cat_slug`) matching existing seed data convention rather than PRD-nanoid pattern
- Product images keyed as `products/{handle}.{ext}` matching existing R2 folder structure
- Both extraction modes (API and file-based) supported via config.extractionMode, defaulting to 'file'

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in loadToD1 signature**
- **Found during:** Task 2 (migrate-categories.ts)
- **Issue:** `loadToD1` expected `Record<string, unknown>[]` but typed insert interfaces lack index signature
- **Fix:** Changed to generic `loadToD1<T extends object>` and cast internally for `generateInsertSql`
- **Files modified:** scripts/shopify-migration/loaders/d1-loader.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** b77ab86 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Type fix necessary for compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. R2 credentials and Shopify API keys are configured via environment variables at runtime.

## Next Phase Readiness
- ETL shared library ready for downstream migrators (customers, orders, reviews, pages)
- ID map infrastructure persists category and product mappings for cross-entity references
- redirect_map table schema ready for population by redirect generation in later plans
- Both file-based and API extraction paths work for all entity types

## Self-Check: PASSED

All 20 created files verified present. Both task commits (eaa0dd3, b77ab86) verified in git log.

---
*Phase: 04-data-migration*
*Completed: 2026-03-07*

---
phase: 04-data-migration
plan: 02
subsystem: database
tags: [etl, shopify, migration, d1, clerk, judgeme, reviews, orders, customers, pages]

# Dependency graph
requires:
  - phase: 04-data-migration
    provides: ETL shared library, ID mapping, wrangler helpers, product/category ID maps
provides:
  - Customer migration script (Shopify -> Clerk + D1 with skipPasswordRequirement)
  - Order migration script (Shopify -> D1 with status mapping and price-to-cents conversion)
  - Review migration script (Judge.me -> D1 with IMPORTED order_id and rating recalculation)
  - Page migration script (Shopify CMS -> D1 with Unix integer timestamps)
  - Clerk loader for Clerk Backend API user creation
affects: [04-data-migration, seo-redirects]

# Tech tracking
tech-stack:
  added: ["@clerk/clerk-sdk-node"]
  patterns: ["Clerk Backend API createUser with skipPasswordRequirement", "Synthetic IMPORTED value for NOT NULL FK constraints on migrated data", "Unix integer timestamps for pages table (not ISO 8601)", "Product rating recalculation from review distribution"]

key-files:
  created:
    - scripts/shopify-migration/loaders/clerk-loader.ts
    - scripts/shopify-migration/extractors/file-based/customers.ts
    - scripts/shopify-migration/extractors/file-based/orders.ts
    - scripts/shopify-migration/extractors/file-based/reviews.ts
    - scripts/shopify-migration/extractors/file-based/pages.ts
    - scripts/shopify-migration/extractors/shopify-api/customers.ts
    - scripts/shopify-migration/extractors/shopify-api/orders.ts
    - scripts/shopify-migration/extractors/shopify-api/pages.ts
    - scripts/shopify-migration/transformers/customers.ts
    - scripts/shopify-migration/transformers/orders.ts
    - scripts/shopify-migration/transformers/reviews.ts
    - scripts/shopify-migration/transformers/pages.ts
    - scripts/shopify-migration/migrate-customers.ts
    - scripts/shopify-migration/migrate-orders.ts
    - scripts/shopify-migration/migrate-reviews.ts
    - scripts/shopify-migration/migrate-pages.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Customer ID = Clerk user ID (the app uses Clerk user ID as customer ID, not a separate cust_ prefix)"
  - "Customer records use actual MACH table columns (person, addresses, communication_preferences, extensions) not simplified flat fields"
  - "Order status mapping: fulfilled->delivered, partial->shipped, paid->processing, refunded->refunded, voided/cancelled->cancelled, else->pending"
  - "IMPORTED synthetic value for both order_id and customer_id on migrated reviews (when no matching record exists)"
  - "Pages use integer Unix timestamps per actual schema (not ISO 8601 strings)"

patterns-established:
  - "Clerk user creation with skipPasswordRequirement for migrated customers who must reset password on first login"
  - "Order price conversion: Math.round(parseFloat(shopifyPrice) * 100) for cents-based Money objects"
  - "Product rating recalculation: query review distribution from D1, compute average, UPDATE products.rating JSON"
  - "Dual extraction paths maintained for all entities (API and file-based)"

requirements-completed: [MIGR-04, MIGR-05, MIGR-06, MIGR-07]

# Metrics
duration: 6min
completed: 2026-03-07
---

# Phase 4 Plan 2: Customer, Order, Review, and Page Migration Summary

**Four standalone migration scripts with Clerk user creation (skipPasswordRequirement), order status/price mapping, Judge.me review import with rating recalculation, and CMS page import with Unix timestamps**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-07T00:44:56Z
- **Completed:** 2026-03-07T00:51:31Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments
- Built customer migration pipeline: Shopify extract -> Clerk createUser (with skipPasswordRequirement) -> transform with Clerk user ID as Mercora customer ID -> load to D1 customers table using actual MACH schema columns
- Built order migration with Shopify financial/fulfillment status mapping to Mercora enum, price conversion to cents Money objects, and customer/product ID resolution via idMap
- Built Judge.me review migration with IMPORTED synthetic order_id, email-based customer matching, and post-load product rating recalculation (distribution + average per product)
- Built CMS page migration with correct Unix integer timestamps (not ISO 8601 strings) matching the pages table schema

## Task Commits

Each task was committed atomically:

1. **Task 1: Customer and order migration scripts** - `6f7b33b` (feat)
2. **Task 2: Review and CMS page migration scripts** - `b9a6c3d` (feat)

## Files Created/Modified
- `scripts/shopify-migration/loaders/clerk-loader.ts` - Clerk Backend API user creation with skipPasswordRequirement and duplicate email handling
- `scripts/shopify-migration/extractors/file-based/customers.ts` - File-based customer extractor (CSV/JSON)
- `scripts/shopify-migration/extractors/file-based/orders.ts` - File-based order extractor (CSV/JSON)
- `scripts/shopify-migration/extractors/file-based/reviews.ts` - Judge.me review extractor with publication status filtering
- `scripts/shopify-migration/extractors/file-based/pages.ts` - File-based page extractor (CSV/JSON)
- `scripts/shopify-migration/extractors/shopify-api/customers.ts` - API-based customer extractor
- `scripts/shopify-migration/extractors/shopify-api/orders.ts` - API-based order extractor
- `scripts/shopify-migration/extractors/shopify-api/pages.ts` - API-based page extractor
- `scripts/shopify-migration/transformers/customers.ts` - Customer transformer with Clerk ID integration and MACH column mapping
- `scripts/shopify-migration/transformers/orders.ts` - Order transformer with status mapping, price conversion, and idMap resolution
- `scripts/shopify-migration/transformers/reviews.ts` - Review transformer with IMPORTED order_id, product_handle resolution, and email matching
- `scripts/shopify-migration/transformers/pages.ts` - Page transformer with Unix integer timestamps and HTML-to-meta-description stripping
- `scripts/shopify-migration/migrate-customers.ts` - Standalone customer migration script
- `scripts/shopify-migration/migrate-orders.ts` - Standalone order migration script
- `scripts/shopify-migration/migrate-reviews.ts` - Standalone review migration script with rating recalculation
- `scripts/shopify-migration/migrate-pages.ts` - Standalone page migration script
- `package.json` - Added @clerk/clerk-sdk-node devDependency
- `package-lock.json` - Updated lockfile

## Decisions Made
- Customer ID = Clerk user ID (the app uses Clerk user ID as the customer ID, matching how Clerk auth works -- no separate cust_p_ prefix for migrated customers)
- Customer records written to actual MACH table columns (person JSON, addresses JSON, communication_preferences JSON, extensions JSON) not the simplified MercoraCustomerInsert flat fields
- Order status mapping: Shopify fulfillment_status=fulfilled->delivered, partial->shipped; financial_status=paid->processing, refunded->refunded, voided/cancelled->cancelled; else->pending
- IMPORTED synthetic value for both order_id and customer_id on migrated reviews when no matching record exists in the system
- Pages use integer Unix timestamps matching actual D1 schema (not ISO 8601 strings as some insert types suggested)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Clerk getUserList return type**
- **Found during:** Task 1 (clerk-loader.ts)
- **Issue:** Clerk SDK's getUserList may return User[] directly or { data: User[] } depending on version -- TypeScript errored on `.data` property access
- **Fix:** Added flexible type handling that accepts both array and object-with-data formats
- **Files modified:** scripts/shopify-migration/loaders/clerk-loader.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 6f7b33b (Task 1 commit)

**2. [Rule 1 - Bug] Aligned insert records with actual D1 table columns**
- **Found during:** Task 1 (customer/order transformers)
- **Issue:** MercoraCustomerInsert and MercoraOrderInsert types in types.ts had simplified field names that don't match actual D1 table columns (e.g., types.ts has `email`, `first_name` but actual table has `person` JSON column)
- **Fix:** Created local interface types (CustomerRecord, OrderRecord, ReviewRecord, PageRecord) matching actual SQL column names from the migration files
- **Files modified:** transformers/customers.ts, transformers/orders.ts, transformers/reviews.ts, transformers/pages.ts
- **Verification:** Column names verified against migrations/0001_initial_schema.sql, 0003_add_cms_pages.sql, 0005_add_reviews_tables.sql
- **Committed in:** 6f7b33b (Task 1), b9a6c3d (Task 2)

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes necessary for correct SQL generation. Using wrong column names would cause INSERT failures at runtime. No scope creep.

## Issues Encountered
None

## User Setup Required
None - Clerk secret key and Shopify credentials are configured via environment variables at runtime. No dashboard setup needed for the scripts themselves.

## Next Phase Readiness
- All four entity migration scripts complete and type-checked
- ID map infrastructure carries customer, product, order, and review mappings forward
- Ready for Plan 3: redirect map generation, migration orchestrator, and validation
- Customer migration requires CLERK_SECRET_KEY environment variable at runtime

## Self-Check: PASSED

All 16 created files verified present. Both task commits (6f7b33b, b9a6c3d) verified in git log.

---
*Phase: 04-data-migration*
*Completed: 2026-03-07*

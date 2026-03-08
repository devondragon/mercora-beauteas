# Phase 4: Data Migration - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate all Shopify data (products, variants, images, categories, customers, orders, reviews, CMS pages) to Mercora's D1/R2/Clerk. Generate a redirect map from migrated data to power Phase 1's Shopify URL 301 redirects. Validate migration completeness with record counts and spot checks. No new UI pages — this is a scripts-only phase producing data that the existing storefront consumes.

</domain>

<decisions>
## Implementation Decisions

### Script Architecture
- Modular ETL structure: separate extractor, transformer, and loader per entity, plus a top-level `migrate-all.ts` orchestrator that runs them in dependency order
- Each entity module (migrate-products.ts, migrate-customers.ts, etc.) can run independently for debugging, or the orchestrator runs all sequentially
- Pluggable extractor layer: each entity has a Shopify Admin API extractor AND a file-based extractor (CSV/JSON), both producing the same intermediate format for transformers
- Scripts run locally in Node.js (via tsx), NOT as Cloudflare Workers — full Node.js APIs, no 30-second CPU limit, filesystem access for export files
- D1 access via `wrangler d1 execute`; R2 access via Cloudflare S3-compatible API
- All scripts live in `scripts/shopify-migration/`

### Data Source Access
- Both Shopify Admin API access and export files are available — scripts support either extraction path
- Clerk Backend API used directly for customer import (createUser with skip_password_requirement), not bulk import files — appropriate for <1K customers
- Judge.me reviews: script accepts standard CSV or JSON format regardless of whether data comes from Judge.me API or dashboard export (format TBD by user)

### Review Migration
- Claude's Discretion: handling the NOT NULL order_id constraint on product_reviews for imported reviews (synthetic reference vs schema change — pick the approach that minimizes schema changes while keeping data clean)

### Image Handling
- Download product images from Shopify CDN URLs during migration and upload to R2
- Category images also migrated from Shopify collections to R2 categories/ folder
- Retry 3 times with backoff on failed image downloads, then skip and log the failure — continue migrating everything else
- Claude's Discretion: image filename convention (original Shopify names vs Mercora pattern) — pick based on existing R2 folder structure

### Redirect Map
- Store redirect mappings in a D1 table (not static JSON file) — more flexible, can be updated without redeployment
- Redirect map generated from migrated data: old Shopify URL → new Mercora URL for products, collections, and pages
- Phase 1's next.config.ts redirect stubs will be updated to read from D1 dynamically via middleware

### Validation
- Record count comparison per entity (source vs destination) plus spot-check samples for field accuracy
- Validation runs automatically at the end of the migration orchestrator (not a separate script)
- R2 image validation: verify files exist in R2 listing, no HTTP accessibility check needed
- Generate a summary report showing counts, mismatches, and any skipped/failed records

### Claude's Discretion
- Exact ETL intermediate data formats
- Dependency ordering between entity migrations
- Spot-check sample size and which fields to verify
- ID mapping strategy (Shopify IDs to Mercora nanoid IDs)
- How to handle Shopify data fields that don't map to Mercora schema (drop vs store in extensions)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/utils/r2.ts`: `uploadToR2()`, `uploadImageToR2()`, `listR2Files()` — use for image migration to R2
- `lib/db/schema/products.ts`: Product + variant table definitions — target schema for product migration
- `lib/db/schema/customer.ts`: Customer table with `serializeCustomer()`/`deserializeCustomer()` helpers — use for customer data insertion
- `lib/db/schema/order.ts`: Orders table — target for historical order import
- `lib/db/schema/reviews.ts`: `product_reviews` table with REV-prefixed nanoid IDs — target for Judge.me review import
- `lib/db/schema/pages.ts`: CMS pages table — target for Shopify pages import
- `lib/db/schema/category.ts`: Categories table — target for Shopify collections mapping
- `lib/models/mach/products.ts`: Product CRUD functions (createProduct, etc.) — reference for data format
- `lib/models/mach/customer.ts`: Customer CRUD — reference for customer data format
- `lib/utils/ratings.ts`: Rating calculation helpers — use for recalculating product ratings after review import

### Established Patterns
- Drizzle ORM schema in `lib/db/schema/` with `sqliteTable()` definitions, 6 migrations exist
- Prefixed nanoid IDs: ORD-XXXXXXXX, REV-XXXXXXXXXX, PRD-XXXXXXXX — follow this pattern for new migrated records
- MACH data model: JSON-serialized complex fields (options, media, seo, etc.) in text columns
- R2 folder structure: `products/` for product images, `categories/` for category images
- Wrangler config in `wrangler.jsonc` with dev and production environments

### Integration Points
- `next.config.ts`: Has Shopify redirect stubs from Phase 1 — redirect map from migration will feed into this (or replace with D1-based middleware lookup)
- `middleware.ts`: Existing Clerk middleware — may need redirect lookup integration
- `lib/db/schema/index.ts`: Barrel file for all schemas — add redirect map table if needed
- `data/d1/seed.sql`: Existing seed data (134KB) — migrated data replaces this for the BeauTeas instance
- `migrations/`: 6 existing migrations — add new migration for redirect map table

</code_context>

<specifics>
## Specific Ideas

- Data scale is small: ~30 products, <1K customers, few hundred orders. Sequential processing is fine, no need for batching or parallelism.
- Stripe is the billing authority for subscriptions — no subscription data migration in this phase. Existing subscriptions on Shopify (if any) would need to be recreated in Stripe directly.
- Judge.me reviews need product rating recalculation after import — use existing `lib/utils/ratings.ts` helpers.
- Customers cannot have passwords migrated from Shopify — Clerk users created with `skip_password_requirement`, customers must trigger password reset on first login.
- The STATE.md blocker note says: "Shopify Admin API version, Clerk Backend API user creation params, and Judge.me export format need verification before Phase 4" — researcher should investigate these.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-data-migration*
*Context gathered: 2026-03-06*

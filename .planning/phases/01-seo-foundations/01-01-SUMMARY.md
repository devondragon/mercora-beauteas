---
phase: 01-seo-foundations
plan: 01
subsystem: seo
tags: [sitemap, redirects, next.js, shopify-migration, xml]

# Dependency graph
requires: []
provides:
  - "Dynamic sitemap generation from database (app/sitemap.ts)"
  - "Shopify URL redirect rules (next.config.ts redirects())"
affects: [04-data-migration, seo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Next.js App Router MetadataRoute.Sitemap convention for dynamic sitemaps"
    - "Next.js redirects() config for structural URL pattern mapping"

key-files:
  created:
    - app/sitemap.ts
  modified:
    - next.config.ts

key-decisions:
  - "Used Next.js MetadataRoute.Sitemap convention instead of manual XML generation"
  - "Used permanent: true (308) instead of statusCode: 301 per Next.js best practice"
  - "Imported all three data sources from @/lib/models barrel export for consistency"

patterns-established:
  - "Dynamic sitemap: app/sitemap.ts default export async function returning MetadataRoute.Sitemap"
  - "Shopify redirect stubs: structural patterns in next.config.ts, slug-level mapping deferred to Phase 4"

requirements-completed: [SEO-01, SEO-07]

# Metrics
duration: 6min
completed: 2026-03-05
---

# Phase 1 Plan 1: Sitemap & Redirects Summary

**Dynamic sitemap from DB (products, categories, CMS pages) and three Shopify URL redirect patterns for migration equity preservation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-05T22:51:41Z
- **Completed:** 2026-03-05T22:57:33Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Dynamic sitemap at /sitemap.xml auto-discovers all active products, active categories, and published CMS pages from database
- Deleted static public/sitemap.xml so dynamic route takes precedence
- Three Shopify URL redirect patterns (/products/, /collections/, /pages/) return 308 permanent redirects to Mercora equivalents

## Task Commits

Each task was committed atomically:

1. **Task 1: Create dynamic sitemap replacing static XML** - `bac720a` (feat)
2. **Task 2: Add Shopify URL redirect rules to next.config.ts** - `6861d9d` (feat)

## Files Created/Modified
- `app/sitemap.ts` - Dynamic sitemap generation using Next.js MetadataRoute.Sitemap; fetches products, categories, pages via Promise.all
- `next.config.ts` - Added redirects() with three Shopify-to-Mercora URL pattern mappings
- `public/sitemap.xml` - Deleted (static file would shadow dynamic route)

## Decisions Made
- Used Next.js MetadataRoute.Sitemap convention rather than manual XML string building -- type-safe, auto-served at /sitemap.xml
- Used `permanent: true` flag (produces 308) instead of `statusCode: 301` -- this is the standard Next.js approach and Google treats 308 identically to 301 for SEO
- Imported from `@/lib/models` barrel export (not direct file paths) to match existing project convention seen in most app/ files
- Called `listCategories({ status: "active" })` with string (not array) since the function accepts both forms and defaults to active anyway -- explicit is clearer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Sitemap and redirects are ready; they will serve live data once deployed
- Phase 4 (MIGR-08) will add product-specific slug mapping if Shopify slugs differ from Mercora slugs
- Remaining Phase 1 plans (01-02: structured data/meta tags, 01-03: robots.txt/canonical URLs) can proceed independently

## Self-Check: PASSED

- app/sitemap.ts: FOUND
- public/sitemap.xml: CONFIRMED DELETED
- 01-01-SUMMARY.md: FOUND
- Commit bac720a: FOUND
- Commit 6861d9d: FOUND

---
*Phase: 01-seo-foundations*
*Completed: 2026-03-05*

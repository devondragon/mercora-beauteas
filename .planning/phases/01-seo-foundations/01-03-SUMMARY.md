---
phase: 01-seo-foundations
plan: 03
subsystem: seo
tags: [next.js, json-ld, structured-data, schema.org, rich-results, product-schema, breadcrumbs, organization]

# Dependency graph
requires:
  - phase: 01-seo-foundations plan 02
    provides: "lib/seo/metadata.ts with resolveLocalizedField, resolveImageUrl, BASE_URL helpers"
provides:
  - "lib/seo/json-ld.tsx with JsonLdScript component and buildProductJsonLd, buildOrganizationJsonLd, buildBreadcrumbJsonLd builders"
  - "Product pages render Product + Breadcrumb JSON-LD structured data"
  - "Category pages render Breadcrumb JSON-LD structured data"
  - "Root layout renders Organization JSON-LD structured data"
affects: [seo, rich-results, google-search-console]

# Tech tracking
tech-stack:
  added: []
  patterns: [JSON-LD builder pattern with XSS-safe serialization, module-level static JSON-LD for layout, per-request dynamic JSON-LD for pages]

key-files:
  created:
    - lib/seo/json-ld.tsx
  modified:
    - app/product/[slug]/page.tsx
    - app/category/[slug]/page.tsx
    - app/layout.tsx

key-decisions:
  - "File uses .tsx extension instead of .ts (plan specified .ts) because JSX requires .tsx in TypeScript"
  - "Product breadcrumbs use Home > Product Name (not Home > Category > Product) because category IDs in product data would require extra DB queries to resolve names"
  - "Organization JSON-LD built at module level (static data) rather than per-request for performance"
  - "AggregateOffer used when variants have differing prices, single Offer otherwise"

patterns-established:
  - "JSON-LD builder pattern: pure functions returning schema.org objects, separate JsonLdScript component for rendering"
  - "XSS-safe serialization via JSON.stringify().replace(/</, \\u003c) -- official Next.js pattern"

requirements-completed: [SEO-04, SEO-05, SEO-06]

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 1 Plan 3: JSON-LD Structured Data Summary

**Schema.org Product, Organization, and BreadcrumbList JSON-LD on product pages, category pages, and root layout with XSS-safe serialization and cents-to-dollars price conversion**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T23:00:14Z
- **Completed:** 2026-03-05T23:03:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created JSON-LD builder library (`lib/seo/json-ld.tsx`) with `JsonLdScript`, `buildProductJsonLd`, `buildOrganizationJsonLd`, `buildBreadcrumbJsonLd` exports
- Product pages render Product JSON-LD with name, description, images, brand, offers (price in dollars, currency, availability), and aggregateRating when reviews exist
- Product and category pages render BreadcrumbList JSON-LD for breadcrumb trail rich results
- Root layout renders Organization JSON-LD with BeauTeas identity, logo, description, and social profile links
- All JSON-LD uses XSS-safe serialization (angle brackets escaped to `\u003c`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create JSON-LD builder functions library** - `f4da027` (feat)
2. **Task 2: Wire JSON-LD into product page, category page, and root layout** - `d034347` (feat)

## Files Created/Modified
- `lib/seo/json-ld.tsx` - JSON-LD builder functions and JsonLdScript component (281 lines)
- `app/product/[slug]/page.tsx` - Added Product + Breadcrumb JSON-LD script tags
- `app/category/[slug]/page.tsx` - Added Breadcrumb JSON-LD script tag
- `app/layout.tsx` - Added Organization JSON-LD script tag in body

## Decisions Made
- Used `.tsx` extension instead of plan-specified `.ts` because the file contains JSX (`<script>` element in JsonLdScript component)
- Product breadcrumbs use `Home > Product Name` pattern (not `Home > Category > Product`) because product `categories` field contains IDs not names, and resolving category names would require extra DB queries -- can be enhanced post-launch
- Organization JSON-LD is built at module level since it only uses static brand config data, avoiding unnecessary per-request computation
- `AggregateOffer` with `lowPrice`/`highPrice` is used when product variants have differing prices; single `Offer` with `price` otherwise

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Renamed file from .ts to .tsx**
- **Found during:** Task 1 (Create JSON-LD builder functions)
- **Issue:** Plan specified `lib/seo/json-ld.ts` but the file contains JSX (the `<script>` element in `JsonLdScript`), which requires a `.tsx` extension for TypeScript to compile
- **Fix:** Created file as `lib/seo/json-ld.tsx` instead of `.ts`
- **Files modified:** lib/seo/json-ld.tsx (created with correct extension)
- **Verification:** TypeScript compiles cleanly with zero errors
- **Committed in:** f4da027 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** File extension change was necessary for TypeScript compilation. All imports use `@/lib/seo/json-ld` which resolves regardless of `.ts` vs `.tsx` extension. No functional impact.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 1 SEO foundations are complete (sitemap, redirects, page metadata, structured data)
- JSON-LD builders in `lib/seo/json-ld.tsx` are ready for reuse if additional page types need structured data
- Rich results can be validated via Google Rich Results Test once site is deployed

## Self-Check: PASSED

All 4 created/modified files verified on disk. Both task commits (f4da027, d034347) verified in git log.

---
*Phase: 01-seo-foundations*
*Completed: 2026-03-05*

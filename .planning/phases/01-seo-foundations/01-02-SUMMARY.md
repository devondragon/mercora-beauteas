---
phase: 01-seo-foundations
plan: 02
subsystem: seo
tags: [next.js, metadata, open-graph, twitter-cards, canonical-url, seo]

# Dependency graph
requires:
  - phase: none
    provides: n/a
provides:
  - "lib/seo/metadata.ts with BASE_URL, SITE_NAME, resolveLocalizedField, resolveImageUrl helpers"
  - "generateMetadata export on product pages with OG tags, Twitter cards, canonical URLs"
  - "generateMetadata export on category pages with OG tags, canonical URLs"
  - "metadataBase and title template on root layout for relative canonical URL resolution"
affects: [01-seo-foundations, structured-data, social-sharing]

# Tech tracking
tech-stack:
  added: []
  patterns: [Next.js generateMetadata with async params, shared SEO helper module, R2 image CDN URL resolution]

key-files:
  created:
    - lib/seo/metadata.ts
  modified:
    - app/layout.tsx
    - app/product/[slug]/page.tsx
    - app/category/[slug]/page.tsx

key-decisions:
  - "Product pages include Twitter summary_large_image cards; category pages omit Twitter cards (lower social sharing likelihood)"
  - "Localized field resolution uses en locale first, then first available value, then fallback"
  - "resolveImageUrl handles string, object.url, and object.file.url shapes with R2 CDN prefix for relative paths"

patterns-established:
  - "SEO helpers in lib/seo/metadata.ts: shared across all page types for consistent metadata generation"
  - "generateMetadata pattern: async function awaiting Promise<params>, fetching entity, resolving SEO fields with fallbacks"

requirements-completed: [SEO-02, SEO-03]

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 1 Plan 2: Page Metadata Summary

**generateMetadata with OG tags, Twitter cards, and canonical URLs on product and category pages using shared SEO helpers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T22:52:00Z
- **Completed:** 2026-03-05T22:55:27Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created shared SEO metadata helper module (`lib/seo/metadata.ts`) with constants and utility functions for localized field resolution and image URL handling
- Added `generateMetadata` to product pages with full OG tags (title, description, image, url, siteName), Twitter summary_large_image cards, and canonical URLs
- Added `generateMetadata` to category pages with OG tags and canonical URLs, supporting localized SEO fields
- Updated root layout with `metadataBase` for relative canonical URL resolution and `title.template` for consistent page titles

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared SEO metadata helpers and update root layout** - `edf56ec` (feat)
2. **Task 2: Add generateMetadata to product and category pages** - `68226fe` (feat)

## Files Created/Modified
- `lib/seo/metadata.ts` - Shared SEO constants (BASE_URL, SITE_NAME) and helpers (resolveLocalizedField, resolveImageUrl)
- `app/layout.tsx` - Added metadataBase and title template to root metadata export
- `app/product/[slug]/page.tsx` - Added generateMetadata with OG/Twitter/canonical; fixed params await for Next.js 15
- `app/category/[slug]/page.tsx` - Added generateMetadata with OG/canonical; fixed params await for Next.js 15

## Decisions Made
- Product pages include Twitter `summary_large_image` cards; category pages omit Twitter cards since categories are less likely to be shared on social platforms
- Localized field resolution prioritizes `en` locale, then first available value, then empty string fallback
- `resolveImageUrl` accepts `unknown` and handles string, `{url}`, and `{file: {url}}` shapes defensively, prefixing relative paths with the R2 CDN base URL

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed params not being awaited in existing page components**
- **Found during:** Task 2 (both product and category pages)
- **Issue:** Existing page components used `params.slug` directly without awaiting the Promise, which is incorrect in Next.js 15 where params is a Promise
- **Fix:** Changed both page components to destructure params with `const { slug } = await params` and updated all references
- **Files modified:** app/product/[slug]/page.tsx, app/category/[slug]/page.tsx
- **Verification:** TypeScript compiles cleanly, lint passes
- **Committed in:** 68226fe (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix was explicitly called for in the plan. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SEO metadata foundation is complete for product and category pages
- Shared helpers in `lib/seo/metadata.ts` are ready for reuse by structured data (JSON-LD) implementation
- `metadataBase` enables all child pages to use relative canonical URLs

## Self-Check: PASSED

All 4 created/modified files verified on disk. Both task commits (edf56ec, 68226fe) verified in git log.

---
*Phase: 01-seo-foundations*
*Completed: 2026-03-05*

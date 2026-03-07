---
phase: 06-pre-launch-polish
plan: 01
subsystem: webhooks, seo
tags: [stripe, email, redirects, next.js, drizzle]

# Dependency graph
requires:
  - phase: 02-subscription-infra
    provides: Stripe webhook handlers and subscription model layer
  - phase: 01-seo-foundations
    provides: BASE_URL constant, resolveLocalizedField helper, Shopify redirect patterns
provides:
  - Correct subscription lifecycle email content (manage URLs, product names, frequency)
  - SEO-standard 301 redirects for Shopify URL patterns
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Product name resolution via DB lookup with resolveLocalizedField for localized JSON fields"
    - "Plan lookup chain: d1Sub.plan_id -> getSubscriptionPlanById() -> plan.product_id -> getProductName()"

key-files:
  created: []
  modified:
    - app/api/webhooks/stripe/handlers/subscription-handlers.ts
    - app/api/webhooks/stripe/handlers/invoice-handlers.ts
    - next.config.ts

key-decisions:
  - "Duplicated getProductName helper in both handler files for simplicity -- no shared util extraction needed for 2 call sites"
  - "All manageUrl values point to /subscriptions list page per user decision, not per-subscription URLs"

patterns-established:
  - "Product name resolution: getProductName(productId) using getDbAsync + products table + resolveLocalizedField"

requirements-completed: [SUBI-08, SUBX-09, SEO-07]

# Metrics
duration: 2min
completed: 2026-03-07
---

# Phase 6 Plan 1: Pre-Launch Email & Redirect Fixes Summary

**Fixed 6 subscription lifecycle emails with working manage URLs, human-readable product names, and correct frequencies; changed Shopify redirects from 308 to 301**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T03:43:21Z
- **Completed:** 2026-03-07T03:45:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- All 6 subscription email sends now use `${BASE_URL}/subscriptions` for the manage link instead of broken per-subscription URLs
- Product names resolved from the products table via DB lookup (e.g., "Jasmine Green Tea" instead of "prod_jasmine-green")
- Subscription frequency pulled from plan data with 'monthly' fallback instead of hardcoded 'monthly'
- Shopify URL redirects (/products/, /collections/, /pages/) return 301 instead of 308

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix webhook email content (manageUrl, productName, frequency)** - `09e5085` (fix)
2. **Task 2: Fix Shopify redirect status codes from 308 to 301** - `366c793` (fix)

## Files Created/Modified
- `app/api/webhooks/stripe/handlers/subscription-handlers.ts` - Added getProductName helper, getSubscriptionPlanById import, BASE_URL import; fixed 4 email sends
- `app/api/webhooks/stripe/handlers/invoice-handlers.ts` - Added getProductName helper, getSubscriptionPlanById import, BASE_URL import; fixed 2 email sends
- `next.config.ts` - Changed permanent: true to statusCode: 301 on all 3 Shopify redirect patterns

## Decisions Made
- Duplicated getProductName helper in both handler files rather than extracting to a shared module -- two call sites does not warrant a shared import
- All manage URLs point to `/subscriptions` (list page) per user decision from planning phase

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pre-launch polish plan 1 complete
- Subscription emails ready for production with correct content
- Shopify redirects ready for DNS cutover with proper 301 status codes

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 06-pre-launch-polish*
*Completed: 2026-03-07*

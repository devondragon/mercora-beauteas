---
phase: 03-subscription-customer-experience
plan: 01
subsystem: api, ui
tags: [stripe, subscriptions, next.js, api-routes, clerk-auth, toggle-group]

# Dependency graph
requires:
  - phase: 02-subscription-infrastructure
    provides: Stripe SDK setup (getStripeForWorkers), subscription schema + model layer, webhook handlers
provides:
  - 7 subscription API routes (setup-intent, CRUD, pause, resume, skip, cancel)
  - Subscribe & Save toggle UI component for product pages
  - Product page integration fetching subscription plans server-side
affects: [03-subscription-customer-experience plan 02 (checkout), plan 03 (management dashboard)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Stripe customer search by metadata for idempotent customer creation
    - Subscription ownership verification via getSubscriptionsByCustomer before lifecycle actions
    - Server-side subscription plan fetch passed as prop to client component

key-files:
  created:
    - app/api/setup-intent/route.ts
    - app/api/subscriptions/route.ts
    - app/api/subscriptions/[id]/pause/route.ts
    - app/api/subscriptions/[id]/resume/route.ts
    - app/api/subscriptions/[id]/skip/route.ts
    - app/api/subscriptions/[id]/cancel/route.ts
    - components/subscription/SubscriptionToggle.tsx
  modified:
    - app/product/[slug]/page.tsx
    - app/product/[slug]/ProductDisplay.tsx
    - lib/types/subscription.ts

key-decisions:
  - "Used stripe.customers.search instead of stripe.customers.list for metadata-based lookup (list API does not support metadata filter in this SDK version)"
  - "SubscriptionPlan.created_at/updated_at changed to string | null to match Drizzle schema output"

patterns-established:
  - "Subscription ownership check: getSubscriptionsByCustomer(userId) then find by id before any lifecycle action"
  - "Subscribe & Save toggle: SubscriptionToggle component handles both purchase modes with onAddToCart callback"

requirements-completed: [SUBX-01, SUBX-08]

# Metrics
duration: 4min
completed: 2026-03-06
---

# Phase 3 Plan 1: Subscription API & Subscribe UI Summary

**7 subscription API routes with Clerk auth and ownership checks, plus Subscribe & Save toggle on product pages with frequency picker and discount display**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-06T21:31:48Z
- **Completed:** 2026-03-06T21:36:16Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- 7 API routes covering full subscription lifecycle: setup-intent, list, create, pause, resume, skip, cancel
- All routes enforce Clerk authentication and lifecycle routes verify subscription ownership
- Subscribe & Save toggle component with mode switch, frequency picker, discounted price display, and Save X% badge
- Product pages fetch subscription plans server-side and conditionally show toggle when plans exist

## Task Commits

Each task was committed atomically:

1. **Task 1: Create subscription API routes** - `d4a6101` (feat)
2. **Task 2: Add Subscribe & Save UI to product pages** - `c0c7ae6` (feat)

## Files Created/Modified
- `app/api/setup-intent/route.ts` - POST endpoint creating Stripe SetupIntent with customer lookup/creation
- `app/api/subscriptions/route.ts` - GET (list with plan enrichment) and POST (create via Stripe) endpoints
- `app/api/subscriptions/[id]/pause/route.ts` - POST endpoint to pause subscription (void behavior)
- `app/api/subscriptions/[id]/resume/route.ts` - POST endpoint to resume paused subscription
- `app/api/subscriptions/[id]/skip/route.ts` - POST endpoint to skip next renewal (pause until period end)
- `app/api/subscriptions/[id]/cancel/route.ts` - POST endpoint to cancel at period end
- `components/subscription/SubscriptionToggle.tsx` - Client component with purchase mode toggle, frequency picker, price display
- `app/product/[slug]/page.tsx` - Added listSubscriptionPlans fetch and subscriptionPlans prop
- `app/product/[slug]/ProductDisplay.tsx` - Integrated SubscriptionToggle, added subscriptionPlans prop
- `lib/types/subscription.ts` - Fixed created_at/updated_at to allow null (matches Drizzle schema)

## Decisions Made
- Used `stripe.customers.search` instead of `stripe.customers.list` for metadata-based Clerk user lookup, because the Stripe SDK's `list` API does not support metadata filtering
- Changed `SubscriptionPlan.created_at` and `updated_at` from `string` to `string | null` to match the Drizzle ORM schema return type

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stripe customer lookup API mismatch**
- **Found during:** Task 1 (Create subscription API routes)
- **Issue:** Plan specified `stripe.customers.list({ limit: 1, metadata: { clerk_user_id: userId } })` but the Stripe SDK CustomerListParams does not support a `query` or `metadata` filter
- **Fix:** Switched to `stripe.customers.search({ query: 'metadata["clerk_user_id"]:"..."', limit: 1 })` which supports metadata-based search
- **Files modified:** app/api/setup-intent/route.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** d4a6101 (Task 1 commit)

**2. [Rule 1 - Bug] SubscriptionPlan type mismatch with Drizzle schema**
- **Found during:** Task 2 (Add Subscribe & Save UI)
- **Issue:** `SubscriptionPlan` interface defined `created_at: string` and `updated_at: string` but Drizzle returns `string | null` for these columns
- **Fix:** Updated type to `string | null` for both fields
- **Files modified:** lib/types/subscription.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** c0c7ae6 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes were type-level corrections. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Subscription API routes are ready for Plan 02 (subscription checkout flow) to consume
- Subscribe Now button routes to `/subscribe/checkout?product={slug}&plan={planId}` which Plan 02 will implement
- Plan 03 (management dashboard) can use GET /api/subscriptions and lifecycle endpoints

## Self-Check: PASSED

All 8 files verified present. Both task commits (d4a6101, c0c7ae6) confirmed in git log.

---
*Phase: 03-subscription-customer-experience*
*Completed: 2026-03-06*

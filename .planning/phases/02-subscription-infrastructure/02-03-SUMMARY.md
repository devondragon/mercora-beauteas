---
phase: 02-subscription-infrastructure
plan: 03
subsystem: webhooks
tags: [stripe, webhooks, email, subscription-lifecycle, invoice, resend, d1-sync]

# Dependency graph
requires:
  - phase: 02-subscription-infrastructure
    plan: 01
    provides: "Drizzle schema, TypeScript types, and 14 CRUD model functions for subscription data access"
  - phase: 02-subscription-infrastructure
    plan: 02
    provides: "getStripeForWorkers() and verifyWebhookSignature() for Workers-compatible Stripe operations"
provides:
  - "Webhook dispatcher with async HMAC-SHA256 signature verification, event dedup, and routing for 9 event types"
  - "Subscription handlers for created/updated/deleted with D1 state sync, audit events, and lifecycle emails"
  - "Invoice handlers for payment_succeeded (renewal), payment_failed (past_due), and upcoming (audit for Phase 3 skip-next)"
  - "sendSubscriptionEmail() supporting 6 lifecycle event types with branded HTML templates"
  - "getSubscriptionPlanByStripePriceId() model function for plan lookup from webhook data"
affects: [03-customer-experience, 05-admin-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [webhook-dedup-flow, fire-and-forget-emails, invoice-parent-subscription-lookup, subscription-item-period-dates]

key-files:
  created:
    - app/api/webhooks/stripe/handlers/subscription-handlers.ts
    - app/api/webhooks/stripe/handlers/invoice-handlers.ts
  modified:
    - app/api/webhooks/stripe/route.ts
    - lib/utils/email.ts
    - lib/models/mach/subscriptions.ts

key-decisions:
  - "Stripe API 2025-08-27.basil: period dates accessed via subscription.items.data[0] not subscription directly"
  - "Stripe API 2025-08-27.basil: invoice subscription ID accessed via invoice.parent.subscription_details.subscription"
  - "Email sending is fire-and-forget (errors logged, not propagated) to avoid failing webhook processing"
  - "Added getSubscriptionPlanByStripePriceId to model layer for plan lookup from webhook subscription data"

patterns-established:
  - "Webhook dedup flow: isProcessed check -> handle event -> recordEvent (skip on dup, don't record on failure)"
  - "Fire-and-forget emails: .catch(err => console.error()) pattern prevents email failures from blocking webhook processing"
  - "Invoice subscription lookup: extract from invoice.parent.subscription_details.subscription (API 2025-08-27.basil)"
  - "Subscription period dates: access via items.data[0].current_period_start/end (API 2025-08-27.basil)"

requirements-completed: [SUBI-06, SUBI-07, SUBI-08]

# Metrics
duration: 7min
completed: 2026-03-06
---

# Phase 2 Plan 3: Webhook Handlers and Subscription Emails Summary

**Stripe webhook pipeline with 6 subscription/invoice handlers, event dedup, async HMAC-SHA256 verification, and branded lifecycle emails via Resend**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-06T02:29:37Z
- **Completed:** 2026-03-06T02:36:57Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Rewrote webhook route with async verifyWebhookSignature replacing broken constructEvent, adding event dedup and proper error handling (HTTP 500 for retry)
- Implemented 3 subscription handlers (created/updated/deleted) with D1 state sync, audit trail, and lifecycle emails; pause/resume detected via pause_collection field
- Implemented 3 invoice handlers (payment_succeeded for renewals, payment_failed with failure reason and past_due status, upcoming for Phase 3 skip-next plumbing)
- Added sendSubscriptionEmail() with branded HTML templates for all 6 lifecycle event types matching existing BeauTeas email branding
- Adapted to Stripe API 2025-08-27.basil type changes (subscription period on items, invoice subscription on parent)

## Task Commits

Each task was committed atomically:

1. **Task 1: Subscription email functions** - `5b3b3ae` (feat)
2. **Task 2: Webhook route rewrite and subscription/invoice handlers** - `3d7fc45` (feat)

## Files Created/Modified
- `lib/utils/email.ts` - Added sendSubscriptionEmail() with 6 event types, branded HTML template, frequency display mapping
- `app/api/webhooks/stripe/route.ts` - Rewritten with async signature verification, dedup, and routing to extracted handlers
- `app/api/webhooks/stripe/handlers/subscription-handlers.ts` - Handlers for customer.subscription.created/updated/deleted
- `app/api/webhooks/stripe/handlers/invoice-handlers.ts` - Handlers for invoice.payment_succeeded/payment_failed/upcoming
- `lib/models/mach/subscriptions.ts` - Added getSubscriptionPlanByStripePriceId() for plan lookup from webhook data

## Decisions Made
- **Stripe API type adaptation:** In API version 2025-08-27.basil, `current_period_start`/`current_period_end` moved from Subscription to SubscriptionItem, and Invoice `subscription` field moved to `parent.subscription_details.subscription`. Adapted all handlers accordingly.
- **Fire-and-forget emails:** Email sending uses `.catch()` to log errors without failing the webhook handler. Webhook reliability takes priority over email delivery -- emails can be retried separately.
- **Model function addition:** Added `getSubscriptionPlanByStripePriceId()` to support plan lookup from Stripe webhook data. Required by handleSubscriptionCreated to map Stripe price IDs to D1 plans.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added getSubscriptionPlanByStripePriceId model function**
- **Found during:** Task 2 (subscription handlers)
- **Issue:** No model function existed to look up a subscription plan by its Stripe price ID, which is needed by handleSubscriptionCreated to map incoming webhook data to D1 plans
- **Fix:** Added getSubscriptionPlanByStripePriceId() to lib/models/mach/subscriptions.ts
- **Files modified:** lib/models/mach/subscriptions.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 3d7fc45 (Task 2 commit)

**2. [Rule 1 - Bug] Adapted to Stripe API 2025-08-27.basil type changes**
- **Found during:** Task 2 (subscription and invoice handlers)
- **Issue:** TypeScript compilation failed because `subscription.current_period_start`, `subscription.current_period_end`, and `invoice.subscription` don't exist in Stripe API 2025-08-27.basil types
- **Fix:** Used `subscription.items.data[0].current_period_start/end` for period dates and `invoice.parent?.subscription_details?.subscription` for invoice subscription lookup
- **Files modified:** subscription-handlers.ts, invoice-handlers.ts
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** 3d7fc45 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. The model function was required for handler functionality. The Stripe API type adaptation was required for TypeScript compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All subscription lifecycle webhook handlers are operational and ready for production
- Phase 3 (customer experience) can build subscription management UI with the webhook pipeline synchronizing state
- Phase 3 SUBX-06 (skip-next) only needs to add conditional logic inside the existing handleInvoiceUpcoming handler
- Email manage URLs point to `https://beauteas.com/account/subscriptions/{id}` -- Phase 3 builds those pages

## Self-Check: PASSED

All 5 created/modified files verified on disk. Both task commits (5b3b3ae, 3d7fc45) found in git log.

---
*Phase: 02-subscription-infrastructure*
*Completed: 2026-03-06*

# Phase 6: Pre-Launch Polish - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix three quality issues identified by the v1.0 milestone audit before DNS cutover: broken "Manage Subscription" links in emails (INT-01), internal IDs displayed instead of product names in emails (INT-02), and Shopify redirects returning 308 instead of 301 (FLOW-01). No new features — targeted fixes to existing code only.

</domain>

<decisions>
## Implementation Decisions

### Email Manage URL (INT-01)
- Change all `manageUrl` references in webhook handlers to point to `/subscriptions` (the existing subscription list page), not `/account/subscriptions/{id}` (which doesn't exist)
- Use an environment variable (e.g., `process.env.NEXT_PUBLIC_SITE_URL` or existing site config) for the base domain instead of hardcoding `https://beauteas.com`
- The "Update Payment Method" button in payment_failed emails should also link to `/subscriptions`
- Affects 6 locations: subscription-handlers.ts (lines 113, 161, 188, 277) and invoice-handlers.ts (lines 121, 191)

### Email Product Name Resolution (INT-02)
- Resolve human-readable product names via DB lookup in webhook handlers: plan.product_id -> products table -> extract `en` value from JSON name field
- Show product name only (e.g., "Jasmine Green Tea"), not variant details
- Product names are stored as JSON localized strings `{"en": "Jasmine Green Tea"}` — extract the `en` key
- Follows the same pattern as existing `getCustomerDetails()` which already does a Stripe API lookup per email send

### Redirect Status Codes (308 -> 301)
- Fix in next.config.ts only — change `permanent: true` to `statusCode: 301` on all three Shopify redirect patterns
- Middleware D1 redirect_map lookups already default to 301, no changes needed there
- Three redirects affected: /products/:slug, /collections/:slug, /pages/:slug

### Claude's Discretion
- Exact approach for the plan -> product lookup chain (helper function vs inline, join strategy)
- Whether to use `statusCode: 301` alone or with `permanent: false` in next.config.ts (follow Next.js docs)
- Frequency resolution for emails (currently hardcoded as 'monthly' fallback in several handlers)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getCustomerDetails()` in subscription-handlers.ts and invoice-handlers.ts: Pattern for per-email data enrichment via API/DB lookup
- `lib/models/mach/subscriptions.ts`: `getSubscriptionPlanByStripePriceId()`, `getSubscriptionByStripeId()` — existing plan/sub lookups
- `lib/models/mach/product.ts`: Product query functions for name resolution
- `lib/utils/email.ts`: `sendSubscriptionEmail()` with `SubscriptionEmailData` type — the email function all handlers call

### Established Patterns
- Fire-and-forget email sending: `sendSubscriptionEmail(...).catch(err => console.error(...))`
- Webhook handlers do Stripe API calls for customer data already — DB lookups for product names are consistent
- JSON localized names: `{"en": "value"}` format used across all product data

### Integration Points
- `app/api/webhooks/stripe/handlers/subscription-handlers.ts`: 4 manageUrl references + 4 productName references to fix
- `app/api/webhooks/stripe/handlers/invoice-handlers.ts`: 2 manageUrl references + 2 productName references to fix
- `next.config.ts`: 3 redirect entries with `permanent: true` to change to `statusCode: 301`

</code_context>

<specifics>
## Specific Ideas

- The audit identified exact line numbers and file locations for all fixes — this is surgical correction, not exploratory work
- INT-01 and INT-02 are in the same files and can be fixed together in a single pass through the webhook handlers
- The 308->301 fix is a one-line change per redirect entry in next.config.ts

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-pre-launch-polish*
*Context gathered: 2026-03-06*

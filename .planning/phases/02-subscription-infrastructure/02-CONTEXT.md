# Phase 2: Subscription Infrastructure - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Database schema, Stripe API integration, and webhook pipeline so that subscriptions can be created, billed, and synchronized between Stripe and D1. This phase builds the plumbing that Phase 3 (customer experience) and Phase 5 (admin UI) depend on. No user-facing UI in this phase.

</domain>

<decisions>
## Implementation Decisions

### Schema Design
- Dedicated `subscription_plans` table with rows per product/frequency combination (product_id, frequency, discount_percent, stripe_price_id). Admin can toggle plans on/off per product.
- Track ALL lifecycle events in `subscription_events`: created, renewed, payment_failed, paused, resumed, skipped, canceled, updated. Full audit trail needed for Phase 5 admin timeline view (SUBA-03).
- `customer_subscriptions` links to the existing `customers` table via customer_id (not direct Clerk user ID). Single customer record ties Clerk ID, Stripe customer ID, and subscription data together.
- Prefixed nanoid IDs consistent with existing codebase: SUB-XXXXXXXX for subscriptions, PLN-XXXXXXXX for plans, EVT-XXXXXXXX for events.

### Stripe Integration
- Try Stripe Node SDK v18 with `nodejs_compat` first. If it works, use SDK directly for subscription methods and deprecate CloudflareStripe adapter. If it fails, fall back to extending CloudflareStripe with subscription methods.
- Keep all Stripe integration in the same `lib/stripe.ts` file regardless of approach.
- If staying with CloudflareStripe, upgrade API version from '2020-08-27' to '2025-08-27.basil' (match Node SDK version) for current subscription API features.
- Create Stripe customers eagerly at any checkout (one-time or subscription), not just at subscription time. Useful for saved cards and future features.

### Webhook Architecture
- Add subscription event handlers to the existing `app/api/webhooks/stripe/route.ts` endpoint. Single Stripe webhook URL. Handlers can be refactored into separate files if the switch statement grows too large.
- Event ID dedup table (`processed_webhook_events`) to handle Stripe retry duplicates. Check before processing, skip duplicates.
- Fix broken CloudflareStripe webhook verification (SUBI-05) using Web Crypto API for HMAC-SHA256 signature validation. No external dependencies.
- Return HTTP 500 on processing failures to trigger Stripe automatic retry (exponential backoff up to 72 hours). Combined with dedup table, retries are safe.

### Email Notifications
- Send emails for ALL 6 lifecycle events: subscription created, renewed (payment succeeded), payment failed, paused, resumed, canceled.
- Include "Manage Subscription" links in emails pointing to customer subscription page URL (Phase 3 builds the actual page, but link is ready).
- Payment failure emails include next retry date (from Stripe) and link to update payment method. Key for reducing involuntary churn.

### Claude's Discretion
- Email template approach (inline HTML vs React Email components) — choose based on existing patterns and what's practical
- Exact subscription_events table column structure
- Handler file organization within the webhook route (inline vs extracted functions)
- Processed webhook events table cleanup/retention strategy

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CloudflareStripe` class (`lib/stripe.ts`): fetch-based Stripe adapter with URL-encoded body support. Has `createPaymentIntent`, `calculateTax`, and broken `webhooks.constructEvent`. Extend with subscription methods if Node SDK doesn't work.
- `lib/utils/email.ts`: Resend integration with inline HTML templates for order emails. Pattern to follow for subscription emails.
- `emails/OrderConfirmation.tsx`: React Email template (secondary pattern). Could be used as reference for subscription email components.
- `lib/db.ts`: `getDb()` (sync, Server Components) and `getDbAsync()` (async, API routes) with React `cache()` wrapping.
- `lib/models/mach/`: CRUD function pattern per entity. Follow for subscription model layer.

### Established Patterns
- Drizzle ORM schema in `lib/db/schema/` with `sqliteTable()` definitions. 6 migrations exist in `migrations/`.
- Model layer in `lib/models/mach/` with verb-noun CRUD functions (`listProducts`, `getProductBySlug`, `createProduct`).
- Prefixed nanoid IDs: `ORD-XXXXXXXX`, `REV-XXXXXXXXXX`.
- MACH-compliant API responses with `{ data, meta: { schema } }` format.
- Admin auth via `checkAdminPermissions()` in `lib/auth/admin-middleware.ts`.

### Integration Points
- `app/api/webhooks/stripe/route.ts`: Existing webhook handler — add subscription event cases to switch statement.
- `lib/db/schema/index.ts`: Barrel file re-exporting all schemas — add new subscription schemas here.
- `lib/models/index.ts`: Barrel file for models — add subscription model exports.
- `lib/types/index.ts`: Type barrel — add subscription types.
- `customers` table (`lib/db/schema/customer.ts`): Foreign key target for customer_subscriptions.
- `getStripeClient()` / `getCloudflareStripe()` in `lib/stripe.ts`: Entry points for Stripe API calls.

</code_context>

<specifics>
## Specific Ideas

- Research whether Stripe Node SDK v18 works on Cloudflare Workers with `nodejs_compat` flag before deciding on CloudflareStripe extension. This could simplify the entire Stripe integration significantly.
- The broken webhook verification (CloudflareStripe.webhooks.constructEvent just parses JSON) is a security-critical fix (SUBI-05). Must be resolved before any subscription webhooks go live.
- Three subscription frequencies: every 2 weeks, monthly, every 2 months. Discount is ~10% off the one-time price.
- Stripe is the billing authority — D1 is the sync layer. Subscription state changes flow from Stripe webhooks to D1, not the other way around.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-subscription-infrastructure*
*Context gathered: 2026-03-05*

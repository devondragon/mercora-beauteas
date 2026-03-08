# Phase 3: Subscription Customer Experience - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Customers can subscribe to tea products at a discount, manage their subscriptions (pause, resume, skip, cancel), and receive email notifications for subscription lifecycle events. This phase builds the customer-facing UI and API routes on top of the schema, models, Stripe integration, and webhook handlers delivered in Phase 2. Admin subscription management is Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Subscribe & Save UI (Product Page)
- Toggle above the price area: "One-time purchase" / "Subscribe & Save" — selecting Subscribe updates the visible price to show the discount
- Frequency picker appears when Subscribe is selected, using a shadcn Select dropdown matching the existing variant selector style. Options: "Every 2 weeks", "Monthly", "Every 2 months"
- Discount display: original price struck through, subscription price in green, "Save X%" badge (consistent with existing sale price pattern using compare_at_price strikethrough)
- CTA button behavior: Claude's discretion — pick the approach that best fits the checkout architecture (direct "Subscribe Now" vs cart-based)

### Subscription Checkout
- Separate dedicated page (e.g. /subscribe/checkout), NOT reusing the existing one-time CheckoutClient — avoids mixing PaymentIntent and SetupIntent logic
- Collect: email, name, payment method (SetupIntent), and shipping address — full info needed for first fulfillment
- Require Clerk sign-in before subscription checkout — links subscription to customer record, enables management page
- After subscription is created, redirect to a confirmation page showing: product, frequency, next billing date, discount applied, and link to manage subscriptions

### Subscription Management
- Dedicated page at /subscriptions (requires Clerk auth) listing all customer subscriptions
- Each subscription displayed as a card showing: product name/image, status badge (Active/Paused/Canceled), next billing date, frequency, and subscription price
- Inline action buttons on each card — active subscriptions show Pause, Skip Next, Cancel; paused subscriptions show Resume, Cancel
- Cancel requires a confirmation dialog: "Are you sure? Your subscription will remain active until [end date]." with Cancel / Confirm buttons

### API Routes
- GET /api/subscriptions — list authenticated user's subscriptions
- POST /api/subscriptions — create a new subscription (SetupIntent + Stripe Subscription creation)
- POST /api/subscriptions/[id]/pause — pause subscription
- POST /api/subscriptions/[id]/resume — resume subscription
- POST /api/subscriptions/[id]/skip — skip next renewal
- POST /api/subscriptions/[id]/cancel — cancel subscription

### Claude's Discretion
- CTA button approach on product page (direct subscribe vs cart-based flow)
- Subscription checkout page layout and step organization
- Empty state on /subscriptions page when no subscriptions exist
- Loading states and error handling patterns
- Whether to show subscription plans on products that don't have plans configured

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProductDisplay.tsx` (app/product/[slug]/ProductDisplay.tsx): Client component with variant selector, price display with sale strikethrough, add-to-cart button — subscription toggle integrates here
- `CheckoutClient.tsx` (components/checkout/): Multi-step checkout with ShippingForm, PaymentForm, StripeProvider, OrderSummary — reference for subscription checkout flow structure
- shadcn/ui components: Select, Toggle, ToggleGroup, Card, Badge, Button, Dialog, Sheet — all available for subscription UI
- `lib/stores/cart-store.ts`: Zustand store with checkout state — may need extension or a parallel subscription store
- `lib/utils/email.ts`: Already has subscription email functions from Phase 2 (sendSubscriptionCreatedEmail, etc.)
- `lib/models/mach/subscriptions.ts`: Full CRUD model layer for subscription_plans, customer_subscriptions, subscription_events
- `lib/types/subscription.ts`: SubscriptionPlan, CustomerSubscription, SubscriptionEvent, SubscriptionEmailData types
- `lib/stripe.ts`: getStripeForWorkers() with Stripe SDK, verifyWebhookSignature — use for SetupIntent and Subscription creation

### Established Patterns
- Server Component page.tsx fetches data, passes to "use client" display component (ProductPage → ProductDisplay pattern)
- API routes use getDbAsync(), MACH-compliant JSON responses, try/catch error handling
- Clerk auth via `auth()` in server components, `authenticateRequest()` in API routes
- Dark theme with neutral-800/900 backgrounds, orange-500 accent color
- Toast notifications via sonner for user feedback

### Integration Points
- `app/product/[slug]/ProductDisplay.tsx`: Add subscription toggle/frequency picker to existing purchase section
- `app/api/webhooks/stripe/route.ts`: Already handles subscription lifecycle events — no changes needed
- `lib/db/schema/subscription.ts`: Schema ready — subscription_plans needs to be populated for products
- `lib/models/mach/subscriptions.ts`: Model functions ready for API route handlers
- Clerk middleware (`middleware.ts`): May need /subscriptions and /subscribe routes added to auth config

</code_context>

<specifics>
## Specific Ideas

- The subscription toggle on product pages should feel like Amazon's "Subscribe & Save" — a clear choice between one-time and recurring, not hidden behind tabs or separate pages
- Subscription checkout should be simpler than one-time checkout — fewer steps since it's a single product, not a cart of items
- The /subscriptions management page should work as a standalone feature now, designed to slot into a future account section (ACCT-04) without redesign

</specifics>

<deferred>
## Deferred Ideas

- Full customer account pages (dashboard, orders, addresses, settings) — ACCT-01 through ACCT-05, post-launch
- Subscription management within account pages — ACCT-04, will integrate with /subscriptions page built here
- Changing subscription frequency after creation — could be added as an enhancement
- Updating payment method for existing subscription — post-launch

</deferred>

---

*Phase: 03-subscription-customer-experience*
*Context gathered: 2026-03-06*

# Phase 5: Subscription Admin - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin dashboard for monitoring subscription health, managing plans, and investigating individual subscription histories. Internal tooling only — no customer-facing changes. Builds on the subscription schema, models, and Stripe integration delivered in Phases 2 and 3.

</domain>

<decisions>
## Implementation Decisions

### Metrics Dashboard
- D1-based MRR calculation: count active subscriptions x plan price x discount. No Stripe API calls on dashboard load.
- Extended KPI set displayed as stat cards (no charts): active subscriptions, MRR, churn rate, paused subscriptions, new subscriptions this month, revenue trend vs last month
- 30-day rolling churn rate: cancellations in last 30 days / active subscriptions at start of period
- Stat card layout matching existing admin dashboard pattern (DashboardStats cards in app/admin/page.tsx)

### Subscription Table
- Columns: status (badge), customer name/email, product name, frequency, next billing date, subscription price, created date, total lifetime revenue, payment status
- Filter by status (Active/Paused/Canceled/All) + text search by customer name/email
- View-only rows — click a row to navigate to subscription detail view. No inline admin actions (use Stripe dashboard for direct subscription management)
- Server-side pagination (e.g., 20 per page), matching existing orders page pattern

### Event Timeline (Detail View)
- Vertical timeline with color-coded dots per event type: green for created/renewed, yellow for paused/skipped, red for canceled/payment_failed
- Detail page layout: subscription summary card at top (customer, product, status, frequency, current period, created date, Stripe subscription ID) + event timeline below
- "View in Stripe" button linking to dashboard.stripe.com/subscriptions/{stripe_subscription_id} for admin troubleshooting
- Human-readable event descriptions only (e.g., "Payment succeeded — $24.99 charged", "Subscription paused by customer"). No raw Stripe data display.

### Plan Management
- Per-product configuration embedded in the existing product editor (ProductEditor.tsx) — add a "Subscriptions" section with enable toggle, frequency checkboxes, and discount % input
- Per-product discount percentage (stored in subscription_plans.discount_percent), defaulting to 10%
- Edit rules for plans with active subscribers: discount % can be changed (applies to new subscribers only), frequency options can be toggled on/off (existing subscribers keep theirs), plans can be deactivated (is_active=false) but not deleted
- No separate /admin/subscriptions/plans page — plan config lives in product editor

### Sidebar Navigation
- "Subscriptions" link added to AdminSidebar navItems array (SUBA-05)

### Claude's Discretion
- Exact stat card styling and layout within the metrics row
- Loading states and error handling for dashboard API calls
- Pagination component choice (existing pattern or new)
- How to join subscription data with product/customer data for table display (query strategy)
- Product editor subscription section layout and form controls
- Empty states for dashboard and table when no subscriptions exist

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/models/mach/subscriptions.ts`: Full CRUD model layer — `getSubscriptionStats()`, `listSubscriptionPlans()`, `getSubscriptionEvents()`, `getSubscriptionsByCustomer()`, `getSubscriptionByStripeId()`
- `lib/db/schema/subscription.ts`: Schema for subscription_plans, customer_subscriptions, subscription_events with indexes
- `app/admin/page.tsx`: Existing admin dashboard with DashboardStats interface and stat cards — pattern to follow for subscription metrics
- `components/admin/AdminSidebar.tsx`: navItems array — add Subscriptions entry here
- `components/admin/ProductEditor.tsx`: Existing product editor component — add subscription section here
- `components/ui/`: shadcn components (Card, Badge, Button, Table) — use for subscription UI
- `lib/auth/admin-middleware.ts`: `checkAdminPermissions()` for admin route protection

### Established Patterns
- Admin pages: Server Component page.tsx fetches data, passes to "use client" ClientComponent.tsx
- Admin theme: bg-neutral-950 text-white, orange-500/600 accent, neutral-800/900 cards
- Admin tables: Client-side filtering with status tabs + search input (see orders/reviews pages)
- API routes: getDbAsync(), MACH-compliant JSON responses, try/catch error handling
- Status badges: colored Badge component with status-appropriate colors

### Integration Points
- `app/admin/layout.tsx`: Admin layout with AdminSidebar — new subscription pages render within this
- `components/admin/AdminSidebar.tsx`: Add "Subscriptions" nav item
- `components/admin/ProductEditor.tsx`: Add subscription plan configuration section
- `lib/models/mach/subscriptions.ts`: Existing model functions — may need new queries for admin table (paginated list with joins)
- `app/api/admin/`: API routes for admin data — add subscription admin endpoints here

</code_context>

<specifics>
## Specific Ideas

- The subscription table should feel consistent with existing admin tables (orders, products) — same visual language, same interaction patterns
- Plan management in the product editor keeps the workflow simple: admin edits a product, sees subscription config right there, toggles it on/off
- "View in Stripe" link in detail view is important for troubleshooting — admin shouldn't need to copy-paste Stripe IDs manually

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-subscription-admin*
*Context gathered: 2026-03-06*

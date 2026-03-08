# Phase 5: Subscription Admin - Research

**Researched:** 2026-03-06
**Domain:** Admin dashboard UI, D1 aggregation queries, Next.js App Router pages
**Confidence:** HIGH

## Summary

Phase 5 builds an internal admin dashboard for subscription management. All the hard infrastructure work is done -- the D1 schema (`subscription_plans`, `customer_subscriptions`, `subscription_events`), the model layer (`lib/models/mach/subscriptions.ts`), and the Stripe webhook integration are all complete from Phases 2 and 3. This phase is purely UI and API routes for admin consumption.

The existing admin dashboard provides strong patterns to follow: `"use client"` components with `fetch()` calls to `/api/admin/*` endpoints, shadcn components (Card, Badge, Button, Input, Table), neutral-950/800/700 color scheme with orange-500/600 accents, and server-side pagination via `limit`/`offset` query parameters. The orders page is the closest pattern match for the subscription table (pagination controls, status filtering, expandable rows).

**Primary recommendation:** Follow existing admin patterns exactly. The subscription model layer needs 3-4 new query functions (paginated list with joins, churn calculation, MRR calculation), then the UI is straightforward Card/Badge/Table composition matching what already exists.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D1-based MRR calculation: count active subscriptions x plan price x discount. No Stripe API calls on dashboard load.
- Extended KPI set displayed as stat cards (no charts): active subscriptions, MRR, churn rate, paused subscriptions, new subscriptions this month, revenue trend vs last month
- 30-day rolling churn rate: cancellations in last 30 days / active subscriptions at start of period
- Stat card layout matching existing admin dashboard pattern (DashboardStats cards in app/admin/page.tsx)
- Subscription table columns: status (badge), customer name/email, product name, frequency, next billing date, subscription price, created date, total lifetime revenue, payment status
- Filter by status (Active/Paused/Canceled/All) + text search by customer name/email
- View-only rows -- click a row to navigate to subscription detail view. No inline admin actions (use Stripe dashboard for direct subscription management)
- Server-side pagination (e.g., 20 per page), matching existing orders page pattern
- Vertical timeline with color-coded dots per event type: green for created/renewed, yellow for paused/skipped, red for canceled/payment_failed
- Detail page layout: subscription summary card at top (customer, product, status, frequency, current period, created date, Stripe subscription ID) + event timeline below
- "View in Stripe" button linking to dashboard.stripe.com/subscriptions/{stripe_subscription_id} for admin troubleshooting
- Human-readable event descriptions only (e.g., "Payment succeeded -- $24.99 charged", "Subscription paused by customer"). No raw Stripe data display.
- Per-product configuration embedded in the existing product editor (ProductEditor.tsx) -- add a "Subscriptions" section with enable toggle, frequency checkboxes, and discount % input
- Per-product discount percentage (stored in subscription_plans.discount_percent), defaulting to 10%
- Edit rules for plans with active subscribers: discount % can be changed (applies to new subscribers only), frequency options can be toggled on/off (existing subscribers keep theirs), plans can be deactivated (is_active=false) but not deleted
- No separate /admin/subscriptions/plans page -- plan config lives in product editor
- "Subscriptions" link added to AdminSidebar navItems array (SUBA-05)

### Claude's Discretion
- Exact stat card styling and layout within the metrics row
- Loading states and error handling for dashboard API calls
- Pagination component choice (existing pattern or new)
- How to join subscription data with product/customer data for table display (query strategy)
- Product editor subscription section layout and form controls
- Empty states for dashboard and table when no subscriptions exist

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUBA-01 | Admin subscription dashboard showing active subscription count, MRR, and churn rate | Stat card pattern from `app/admin/page.tsx`, D1 aggregation queries for metrics, new model functions for MRR/churn |
| SUBA-02 | Admin filterable table of all subscriptions with status, customer, product, and frequency columns | Orders page pagination/filter pattern, new paginated query with LEFT JOIN to plans/products/customers |
| SUBA-03 | Admin subscription detail view with full event timeline | Detail page pattern from `app/admin/orders/[id]/page.tsx`, existing `getSubscriptionEvents()` model function, vertical timeline CSS |
| SUBA-04 | Admin UI to manage subscription plans (which products have subscription options, frequencies, discount percentage) | ProductEditor.tsx section addition, new API endpoints for plan CRUD, existing `listSubscriptionPlans()` and `createSubscriptionPlan()` |
| SUBA-05 | "Subscriptions" added to admin sidebar navigation | Single entry in `AdminSidebar.tsx` navItems array, use `RepeatIcon` or similar from lucide-react |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 14.x | Page routing, API routes | Already used throughout project |
| Drizzle ORM | (project version) | D1 queries with type safety | Already used in all model files |
| shadcn/ui | (project version) | Card, Badge, Button, Input, Table, Switch | Already available in `components/ui/` |
| lucide-react | (project version) | Icons for stat cards, nav, timeline | Already used throughout admin |
| Clerk | (project version) | Auth via `checkAdminPermissions()` | Already securing admin routes |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sonner | (project version) | Toast notifications | Already configured in admin layout via `<Toaster>` |

### Alternatives Considered
None needed -- this phase uses only existing project dependencies. No new libraries required.

## Architecture Patterns

### Recommended Project Structure
```
app/admin/subscriptions/
  page.tsx                    # Dashboard + table page (client component)
  [id]/
    page.tsx                  # Detail view with event timeline (client component)
app/api/admin/subscriptions/
  route.ts                    # GET: paginated list, stats
  [id]/
    route.ts                  # GET: single subscription with events
  plans/
    route.ts                  # GET/POST/PUT: plan management for product editor
components/admin/
  AdminSidebar.tsx            # Modified: add Subscriptions nav item
  ProductEditor.tsx           # Modified: add Subscriptions section
lib/models/mach/
  subscriptions.ts            # Extended: new admin query functions
```

### Pattern 1: Admin Page (Client Component with API Fetch)
**What:** Every admin page is a `"use client"` component that fetches data from `/api/admin/*` endpoints on mount.
**When to use:** All admin pages in this project.
**Example:**
```typescript
// Source: app/admin/orders/page.tsx (established pattern)
"use client";
import { useState, useEffect, useCallback } from "react";

export default function AdminSubscriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);

  const fetchData = useCallback(async (page: number = 1) => {
    try {
      setLoading(true);
      const offset = (page - 1) * 20;
      const response = await fetch(`/api/admin/subscriptions?limit=20&offset=${offset}`);
      if (response.ok) {
        const result = await response.json();
        setData(result.data);
        // handle pagination meta...
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(1); }, [fetchData]);
  // render...
}
```

### Pattern 2: Admin API Route with Auth Check
**What:** Every admin API route starts with `checkAdminPermissions()` and returns MACH-compliant JSON.
**When to use:** All `/api/admin/*` routes.
**Example:**
```typescript
// Source: app/api/admin/reviews/route.ts (established pattern)
import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";

export async function GET(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json({ success: false, error: auth.error }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    // ... fetch data from model layer ...
    return NextResponse.json({ success: true, data, meta: { total, limit, offset } });
  } catch (error) {
    console.error("Failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load data" }, { status: 500 });
  }
}
```

### Pattern 3: Stat Card Layout
**What:** Grid of Card components with icon, label, and value.
**When to use:** Dashboard metrics display.
**Example:**
```typescript
// Source: app/admin/page.tsx (established pattern)
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
  <Card className="bg-neutral-800 border-neutral-700 p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-400">Active Subscriptions</p>
        <p className="text-2xl font-bold text-green-400">{stats.active}</p>
        <p className="text-xs text-gray-500 mt-1">Currently active</p>
      </div>
      <div className="w-12 h-12 bg-green-600/20 rounded-lg flex items-center justify-center">
        <Repeat className="w-6 h-6 text-green-400" />
      </div>
    </div>
  </Card>
  {/* ... more stat cards ... */}
</div>
```

### Pattern 4: Server-Side Pagination with Client Filtering
**What:** API returns paginated results, client applies status filter + search within current page. Pagination controls match orders page.
**When to use:** Subscription table.
**Example:**
```typescript
// Source: app/admin/orders/page.tsx (established pattern)
// Server-side: /api/admin/subscriptions?limit=20&offset=0&status=active&search=john
// Client-side: filteredSubscriptions = subscriptions.filter(...)
// Pagination: First/Prev/[1][2][3]/Next/Last with orange-600 active state
```

### Pattern 5: Dynamic Detail Page
**What:** `app/admin/subscriptions/[id]/page.tsx` fetches single subscription + events, renders summary card + timeline.
**When to use:** Subscription detail view (SUBA-03).
**Example:**
```typescript
// Source: app/admin/orders/[id]/page.tsx (established pattern)
"use client";
import { useParams, useRouter } from "next/navigation";

export default function SubscriptionDetailPage() {
  const params = useParams();
  const subscriptionId = params.id as string;
  // fetch /api/admin/subscriptions/${subscriptionId}
  // render summary card + event timeline
}
```

### Pattern 6: Product Editor Section Addition
**What:** Add a new collapsible section inside `ProductEditor.tsx` for subscription plan config.
**When to use:** SUBA-04 plan management.
**Key consideration:** The ProductEditor uses local state for all fields and serializes on save. The subscription section needs to:
1. Load existing plans for the product via separate API call on mount (not part of product data)
2. Track local state for enable toggle, frequency checkboxes, discount input
3. Save subscription plans via separate API call (not part of the product save flow) OR integrate into the onSave callback

**Recommended approach:** Add subscription state to ProductEditor, fetch plans on product load, save plans via dedicated `/api/admin/subscriptions/plans` endpoint triggered during the product save flow.

### Anti-Patterns to Avoid
- **Calling Stripe API on dashboard load:** MRR/churn must be calculated from D1 data only. Stripe calls would be slow and expensive.
- **Building a separate plan management page:** Decision is to embed in ProductEditor. Do not create `/admin/subscriptions/plans`.
- **Inline editing in subscription table:** Decision is view-only rows with navigation to detail page. No edit buttons in the table.
- **Deleting subscription plans:** Plans with active subscribers must be deactivated (is_active=false), not deleted. Schema has no cascading deletes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pagination controls | Custom pagination component | Copy pagination JSX from `app/admin/orders/page.tsx` | Exact same pattern needed, already battle-tested |
| Status badges | Custom badge styling | `Badge` component with status-based className | Already used throughout admin with consistent colors |
| Admin auth | Custom auth checks | `checkAdminPermissions()` from `lib/auth/admin-middleware.ts` | Already handles dev mode, tokens, and Clerk |
| Toast notifications | Custom error display | `sonner` toast already configured in admin layout | Already wired in `AdminLayout` |
| Date formatting | Manual date string parsing | `new Date(iso).toLocaleDateString()` | Pattern used consistently in orders page |
| Currency formatting | Manual string concatenation | `Intl.NumberFormat` pattern from orders page | Handles cents-to-dollars conversion correctly |

**Key insight:** This phase introduces zero new UI patterns. Every component, layout, and interaction pattern has a working example in the existing admin pages.

## Common Pitfalls

### Pitfall 1: MRR Calculation with Discount
**What goes wrong:** Calculating MRR as `count * price` without applying the discount_percent from subscription_plans.
**Why it happens:** The price is stored on the product variant, discount on the plan. Need to join both.
**How to avoid:** MRR = SUM(variant_price * (1 - discount_percent/100)) for all active subscriptions. Query must join customer_subscriptions -> subscription_plans -> products -> variants.
**Warning signs:** MRR seems too high compared to actual Stripe revenue.

### Pitfall 2: Churn Rate Division by Zero
**What goes wrong:** No active subscriptions at start of period causes division by zero.
**Why it happens:** New store with no subscription history.
**How to avoid:** Guard: `churnRate = startActive > 0 ? (canceledInPeriod / startActive) * 100 : 0`
**Warning signs:** NaN or Infinity displayed in stat card.

### Pitfall 3: Product Name Resolution from JSON
**What goes wrong:** Product names in the `products` table are stored as JSON localization format `{"en": "Green Tea"}`, not plain strings.
**Why it happens:** MACH Alliance data model uses localized fields.
**How to avoid:** Parse JSON and extract the `en` value: `JSON.parse(product.name).en || Object.values(JSON.parse(product.name))[0]`. The ProductEditor already does this pattern (line 253-254).
**Warning signs:** Table shows `{"en":"Green Tea"}` instead of `Green Tea`.

### Pitfall 4: Customer ID is Clerk User ID
**What goes wrong:** Looking up customer info in a `customers` table when the `customer_id` in subscriptions is actually the Clerk user ID.
**Why it happens:** Decision from Phase 04-02: "Customer ID = Clerk user ID (the app uses Clerk user ID as customer ID, not a separate cust_ prefix)".
**How to avoid:** Join customer_subscriptions.customer_id to customers.id, and parse the `person` JSON field for name/email. Or use Clerk's user data if customer record doesn't have it.
**Warning signs:** Customer name/email shows as null in the subscription table.

### Pitfall 5: Subscription Price Not Stored on Subscription
**What goes wrong:** Trying to read price from customer_subscriptions when it's not a column there.
**Why it happens:** Price lives on the product variant, discount on the plan. The actual subscription price = variant price * (1 - discount/100).
**How to avoid:** Must join through plan_id -> subscription_plans -> product_id -> products -> variants to get price. Or store a computed `subscription_price` on the subscription record (but this doesn't exist in current schema).
**Warning signs:** Price column shows null/undefined in table.

### Pitfall 6: ProductEditor State Management Complexity
**What goes wrong:** Subscription plan data conflicts with the product save flow because plans are managed in a separate table.
**Why it happens:** ProductEditor calls `onSave(productData)` which goes to the product API. Subscription plans are in a different table with different API.
**How to avoid:** On product editor open, fetch plans via `/api/admin/subscriptions/plans?productId=XXX`. On save, first save product, then save plans via separate API call. Keep the flows independent.
**Warning signs:** Plans disappear after product save, or plans save but product data doesn't.

### Pitfall 7: Event Timeline "details" Field Parsing
**What goes wrong:** Assuming the `details` field in subscription_events is always present or always JSON.
**Why it happens:** The field is optional (`text('details')`) and webhook handlers store varying formats.
**How to avoid:** Always check for null/undefined. Parse as JSON if it starts with `{`, otherwise display as-is. Generate human-readable descriptions from `event_type` + `details` combination.
**Warning signs:** Timeline shows "null" or crashes on JSON.parse.

## Code Examples

### D1 Paginated Subscription Query with Joins
```typescript
// New function for lib/models/mach/subscriptions.ts
import { sql, eq, and, like, or, desc, count } from 'drizzle-orm';

export async function listSubscriptionsAdmin(options: {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}) {
  const db = await getDbAsync();

  // Build conditions
  const conditions = [];
  if (options.status && options.status !== 'all') {
    conditions.push(eq(customer_subscriptions.status, options.status));
  }

  // For search, we'd need to join customers table
  // D1/SQLite approach: use subquery or raw SQL for cross-table search

  const whereClause = conditions.length > 0
    ? and(...conditions)
    : undefined;

  const [items, [{ total }]] = await Promise.all([
    db.select()
      .from(customer_subscriptions)
      .where(whereClause)
      .orderBy(desc(customer_subscriptions.created_at))
      .limit(options.limit)
      .offset(options.offset),
    db.select({ total: count() })
      .from(customer_subscriptions)
      .where(whereClause),
  ]);

  return { items, total };
}
```

### MRR Calculation Query
```typescript
// New function for lib/models/mach/subscriptions.ts
export async function getSubscriptionMRR() {
  const db = await getDbAsync();
  // MRR = sum of (plan price * (1 - discount/100)) for active subs
  // Since variant prices are JSON in products table, this needs
  // application-level calculation after fetching
  const activeSubs = await db
    .select({
      plan_id: customer_subscriptions.plan_id,
      discount_percent: subscription_plans.discount_percent,
      product_id: subscription_plans.product_id,
    })
    .from(customer_subscriptions)
    .innerJoin(
      subscription_plans,
      eq(customer_subscriptions.plan_id, subscription_plans.id)
    )
    .where(eq(customer_subscriptions.status, 'active'));

  // Then look up product prices and compute MRR in application code
  return activeSubs;
}
```

### Churn Rate Calculation
```typescript
// New function for lib/models/mach/subscriptions.ts
export async function getChurnRate() {
  const db = await getDbAsync();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Canceled in last 30 days
  const [{ canceledCount }] = await db
    .select({ canceledCount: count() })
    .from(subscription_events)
    .where(
      and(
        eq(subscription_events.event_type, 'canceled'),
        sql`${subscription_events.created_at} >= ${thirtyDaysAgo}`
      )
    );

  // Active at start of period (current active + canceled in period)
  const [{ activeCount }] = await db
    .select({ activeCount: count() })
    .from(customer_subscriptions)
    .where(eq(customer_subscriptions.status, 'active'));

  const startActive = activeCount + canceledCount;
  const churnRate = startActive > 0 ? (canceledCount / startActive) * 100 : 0;

  return { churnRate, canceledCount, activeCount, startActive };
}
```

### AdminSidebar Nav Item Addition
```typescript
// In components/admin/AdminSidebar.tsx navItems array
// Add after "Orders" entry:
import { Repeat } from "lucide-react";

{
  label: "Subscriptions",
  href: "/admin/subscriptions",
  icon: Repeat,
  description: "Subscription management"
}
```

### Event Timeline Component Pattern
```typescript
// Subscription detail page timeline rendering
const eventColors: Record<string, string> = {
  created: 'bg-green-500',
  renewed: 'bg-green-500',
  paused: 'bg-yellow-500',
  skipped: 'bg-yellow-500',
  resumed: 'bg-yellow-500',
  canceled: 'bg-red-500',
  payment_failed: 'bg-red-500',
  updated: 'bg-blue-500',
};

const eventDescriptions: Record<string, (details?: string) => string> = {
  created: () => 'Subscription created',
  renewed: (d) => d ? `Payment succeeded -- ${d}` : 'Subscription renewed',
  paused: () => 'Subscription paused by customer',
  skipped: () => 'Next delivery skipped',
  resumed: () => 'Subscription resumed',
  canceled: () => 'Subscription canceled',
  payment_failed: (d) => d ? `Payment failed -- ${d}` : 'Payment failed',
  updated: (d) => d ? `Subscription updated -- ${d}` : 'Subscription updated',
};

// Timeline layout:
// <div className="relative pl-8 space-y-6">
//   {events.map(event => (
//     <div key={event.id} className="relative">
//       <div className={`absolute left-[-20px] w-3 h-3 rounded-full ${eventColors[event.event_type]}`} />
//       <div className="text-sm text-white">{eventDescriptions[event.event_type](event.details)}</div>
//       <div className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString()}</div>
//     </div>
//   ))}
//   {/* Vertical line connecting dots */}
//   <div className="absolute left-[-14px] top-0 bottom-0 w-px bg-neutral-700" />
// </div>
```

### Product Editor Subscription Section
```typescript
// Added inside ProductEditor.tsx after "Extensions & Custom Fields" section
// New state variables:
const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
const [subFrequencies, setSubFrequencies] = useState<{biweekly: boolean, monthly: boolean, bimonthly: boolean}>({
  biweekly: false, monthly: false, bimonthly: false
});
const [subDiscount, setSubDiscount] = useState("10");
const [existingPlans, setExistingPlans] = useState<any[]>([]);
const [hasActiveSubscribers, setHasActiveSubscribers] = useState(false);

// Fetch on product load:
useEffect(() => {
  if (product?.id) {
    fetch(`/api/admin/subscriptions/plans?productId=${product.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.plans?.length > 0) {
          setSubscriptionEnabled(true);
          setSubDiscount(data.plans[0].discount_percent.toString());
          setSubFrequencies({
            biweekly: data.plans.some((p: any) => p.frequency === 'biweekly' && p.is_active),
            monthly: data.plans.some((p: any) => p.frequency === 'monthly' && p.is_active),
            bimonthly: data.plans.some((p: any) => p.frequency === 'bimonthly' && p.is_active),
          });
          setExistingPlans(data.plans);
          setHasActiveSubscribers(data.hasActiveSubscribers || false);
        }
      });
  }
}, [product?.id]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate plan management page | Embedded in product editor | Phase 5 decision | Simpler admin workflow |
| Stripe API for metrics | D1-only calculations | Phase 5 decision | Faster dashboard loads, no API rate limits |
| Charts for metrics | Stat cards only | Phase 5 decision | Simpler implementation, matches existing dashboard |

**Not applicable:** No deprecated libraries or major version changes affect this phase. All dependencies are stable.

## Open Questions

1. **Customer name/email resolution strategy**
   - What we know: `customer_subscriptions.customer_id` is a Clerk user ID. The `customers` table has a `person` JSON field with name/email data.
   - What's unclear: Whether all subscription customers have entries in the `customers` table, or if some only exist in Clerk.
   - Recommendation: Join to customers table first, fall back to showing just the customer_id if no match. Do not call Clerk API from admin list endpoint (too slow for table rendering).

2. **Subscription price for table display**
   - What we know: No `price` column on `customer_subscriptions`. Price = variant price * (1 - discount/100).
   - What's unclear: Whether all subscription products have a single variant or could have multiple. How to know which variant the subscription is for.
   - Recommendation: Join through `subscription_plans.product_id` to get the product, then use the default variant's price. The subscription checkout flow (Phase 3) creates subscriptions for specific products, so the default variant price is correct for single-product-per-plan subscriptions.

3. **"New subscriptions this month" metric**
   - What we know: Need to count subscriptions created in current calendar month.
   - What's unclear: Whether to use `customer_subscriptions.created_at` or `subscription_events` with type 'created'.
   - Recommendation: Use `customer_subscriptions.created_at` with SQL date filtering -- simpler and the source of truth.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None installed -- no test framework in project |
| Config file | none -- see Wave 0 |
| Quick run command | `npx tsc --noEmit` (type checking only) |
| Full suite command | `npx tsc --noEmit && npx next build` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUBA-01 | Dashboard displays active count, MRR, churn rate | manual-only | Manual: visit /admin/subscriptions, verify stat cards | N/A |
| SUBA-02 | Filterable table with status, customer, product, frequency | manual-only | Manual: visit /admin/subscriptions, filter by status, search | N/A |
| SUBA-03 | Detail view with event timeline | manual-only | Manual: click subscription row, verify timeline | N/A |
| SUBA-04 | Plan management in product editor | manual-only | Manual: edit product, configure subscription section | N/A |
| SUBA-05 | Subscriptions link in admin sidebar | smoke | `npx tsc --noEmit` (type-checks navItems array) | N/A |

**Justification for manual-only:** This phase is 100% admin UI with no business logic that can be unit tested without a browser. The project has no test framework installed (confirmed: no jest, vitest, or testing-library in package.json). Previous phases (Phase 02) established `tsc --noEmit` as the automated validation approach. Type checking catches the most likely errors (wrong prop types, missing imports, schema mismatches).

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit`
- **Per wave merge:** `npx tsc --noEmit && npx next build`
- **Phase gate:** `npx next build` succeeds + manual verification of all 5 requirements

### Wave 0 Gaps
None -- no test infrastructure to set up. Use `tsc --noEmit` per established project convention (Phase 02 decision).

## Sources

### Primary (HIGH confidence)
- `app/admin/page.tsx` -- Dashboard stat card pattern, color scheme, layout
- `app/admin/orders/page.tsx` -- Pagination controls, status filtering, table layout, client-side search
- `app/admin/orders/[id]/page.tsx` -- Detail page pattern with useParams, back navigation
- `app/api/admin/reviews/route.ts` -- API route pattern with checkAdminPermissions, limit/offset, MACH JSON response
- `lib/models/mach/subscriptions.ts` -- Existing model functions, query patterns, Drizzle usage
- `lib/db/schema/subscription.ts` -- Full schema with all columns, indexes, and types
- `components/admin/AdminSidebar.tsx` -- navItems array structure, icon pattern
- `components/admin/ProductEditor.tsx` -- Section layout, state management, save flow
- `lib/auth/admin-middleware.ts` -- checkAdminPermissions() function signature and behavior
- `lib/db.ts` -- getDbAsync() pattern for API routes

### Secondary (MEDIUM confidence)
- `lib/db/schema/customer.ts` -- Customer table structure for join queries (person field is JSON)
- `lib/db/schema/products.ts` -- Products table structure (name is JSON localized)
- `.planning/phases/05-subscription-admin/05-CONTEXT.md` -- All locked decisions

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all existing project dependencies, no new libraries
- Architecture: HIGH -- every pattern has a direct precedent in existing admin pages
- Pitfalls: HIGH -- identified from direct code inspection of schema, models, and existing admin pages
- Query strategy: MEDIUM -- MRR calculation requires multi-table joins through JSON fields, which is complex in D1/SQLite

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable -- admin UI patterns don't change rapidly)

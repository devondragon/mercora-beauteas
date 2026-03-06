# Phase 3: Subscription Customer Experience - Research

**Researched:** 2026-03-06
**Domain:** Stripe Subscriptions (SetupIntent flow), React UI (subscription toggle, management), Next.js API routes
**Confidence:** HIGH

## Summary

Phase 3 builds the customer-facing subscription experience on top of the complete infrastructure delivered in Phase 2 (schema, models, Stripe SDK, webhooks, emails). The work divides into three areas: (1) product page subscription UI with toggle and frequency picker, (2) a dedicated subscription checkout flow using Stripe SetupIntents, and (3) a subscription management page with pause/resume/skip/cancel actions.

All Stripe operations use the existing `getStripeForWorkers()` function (Stripe SDK v18.5.0 with `createFetchHttpClient()`) -- NOT the legacy `CloudflareStripe` class. The model layer (`lib/models/mach/subscriptions.ts`) and email functions (`lib/utils/email.ts`) are fully built and ready to consume. The webhook handler already processes all subscription lifecycle events and triggers emails. The primary work is therefore building UI components, API routes, and wiring them to existing infrastructure.

**Primary recommendation:** Use the SetupIntent-first pattern: collect payment method via SetupIntent with `usage: 'off_session'`, confirm on client with `stripe.confirmSetup()`, then create the Stripe Subscription server-side with `default_payment_method`. This is the approach specified in the user's decisions and is the correct pattern for subscriptions where the first charge happens via the subscription itself (not at setup time).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Toggle above the price area: "One-time purchase" / "Subscribe & Save" -- selecting Subscribe updates the visible price to show the discount
- Frequency picker appears when Subscribe is selected, using a shadcn Select dropdown matching the existing variant selector style. Options: "Every 2 weeks", "Monthly", "Every 2 months"
- Discount display: original price struck through, subscription price in green, "Save X%" badge (consistent with existing sale price pattern using compare_at_price strikethrough)
- Separate dedicated page (e.g. /subscribe/checkout), NOT reusing the existing one-time CheckoutClient -- avoids mixing PaymentIntent and SetupIntent logic
- Collect: email, name, payment method (SetupIntent), and shipping address -- full info needed for first fulfillment
- Require Clerk sign-in before subscription checkout -- links subscription to customer record, enables management page
- After subscription is created, redirect to a confirmation page showing: product, frequency, next billing date, discount applied, and link to manage subscriptions
- Dedicated page at /subscriptions (requires Clerk auth) listing all customer subscriptions
- Each subscription displayed as a card showing: product name/image, status badge (Active/Paused/Canceled), next billing date, frequency, and subscription price
- Inline action buttons on each card -- active subscriptions show Pause, Skip Next, Cancel; paused subscriptions show Resume, Cancel
- Cancel requires a confirmation dialog: "Are you sure? Your subscription will remain active until [end date]." with Cancel / Confirm buttons
- API routes: GET /api/subscriptions, POST /api/subscriptions, POST /api/subscriptions/[id]/pause, POST /api/subscriptions/[id]/resume, POST /api/subscriptions/[id]/skip, POST /api/subscriptions/[id]/cancel

### Claude's Discretion
- CTA button approach on product page (direct subscribe vs cart-based flow)
- Subscription checkout page layout and step organization
- Empty state on /subscriptions page when no subscriptions exist
- Loading states and error handling patterns
- Whether to show subscription plans on products that don't have plans configured

### Deferred Ideas (OUT OF SCOPE)
- Full customer account pages (dashboard, orders, addresses, settings) -- ACCT-01 through ACCT-05, post-launch
- Subscription management within account pages -- ACCT-04, will integrate with /subscriptions page built here
- Changing subscription frequency after creation -- could be added as an enhancement
- Updating payment method for existing subscription -- post-launch
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUBX-01 | Product pages show "One-time purchase" vs "Subscribe & Save" toggle with frequency dropdown and discount display | ProductDisplay.tsx extension, subscription_plans query by product_id, price calculation with discount_percent |
| SUBX-02 | Dedicated subscription checkout flow using Stripe SetupIntent for payment method collection | SetupIntent API pattern, StripeProvider + PaymentElement reuse, /subscribe/checkout route |
| SUBX-03 | After SetupIntent confirmation, Stripe Subscription is created with selected product, frequency, and discount applied | stripe.subscriptions.create() with default_payment_method, Stripe Price creation, coupon/discount handling |
| SUBX-04 | Customer can pause an active subscription | stripe.subscriptions.update() with pause_collection behavior, existing webhook handler detects pause |
| SUBX-05 | Customer can resume a paused subscription | stripe.subscriptions.update() clearing pause_collection, existing webhook handler detects resume |
| SUBX-06 | Customer can skip the next renewal | Void upcoming invoice via stripe.invoices.voidInvoice() triggered by invoice.upcoming webhook, or use pause_collection with resumes_at |
| SUBX-07 | Customer can cancel a subscription | stripe.subscriptions.update() with cancel_at_period_end: true, existing webhook handler processes deletion |
| SUBX-08 | API routes for subscription actions | Six routes using auth() from Clerk, getStripeForWorkers(), and existing model functions |
| SUBX-09 | Email sent on subscription lifecycle events | Already implemented in Phase 2 -- webhook handlers call sendSubscriptionEmail() for all events |
</phase_requirements>

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | 18.5.0 | Server-side Stripe SDK (subscriptions, setup intents, prices) | Already installed, Workers-compatible via createFetchHttpClient() |
| @stripe/react-stripe-js | 3.9.2 | PaymentElement for SetupIntent confirmation | Already installed, reuse pattern from existing PaymentForm |
| @stripe/stripe-js | 7.8.0 | Client-side Stripe.js loader | Already installed, used by StripeProvider |
| @clerk/nextjs | 6.25.5 | Auth for API routes and page protection | Already installed, auth() and useUser() patterns established |
| drizzle-orm | 0.35.2 | D1 database queries | Already installed, subscription models ready |
| sonner | 2.0.6 | Toast notifications | Already installed, used throughout the app |
| zustand | 5.0.6 | Client state management | Already installed, may need for subscription checkout state |
| resend | 4.8.0 | Transactional email | Already installed, email functions ready in lib/utils/email.ts |

### Supporting (Already Installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.525.0 | Icons for subscription cards and status badges | Status indicators, action buttons |
| @radix-ui/react-dialog | 1.1.14 | Cancel confirmation dialog | Wraps shadcn Dialog component |
| @radix-ui/react-select | 2.2.6 | Frequency picker dropdown | Wraps shadcn Select component |
| @radix-ui/react-toggle-group | 1.1.10 | One-time / Subscribe toggle | Wraps shadcn ToggleGroup component |

### No New Dependencies Required
The existing `package.json` contains everything needed for this phase.

## Architecture Patterns

### Recommended Project Structure
```
app/
  product/[slug]/
    ProductDisplay.tsx          # MODIFY: add subscription toggle + frequency picker
    page.tsx                    # MODIFY: fetch subscription plans for product
  subscribe/
    checkout/
      page.tsx                  # NEW: server component, requires auth
      SubscribeCheckoutClient.tsx  # NEW: client component for checkout flow
    confirmation/
      page.tsx                  # NEW: confirmation page after subscription created
  subscriptions/
    page.tsx                    # NEW: server component, requires auth
    SubscriptionsClient.tsx     # NEW: client component for subscription management
  api/
    subscriptions/
      route.ts                  # NEW: GET (list) + POST (create)
      [id]/
        pause/route.ts          # NEW: POST pause
        resume/route.ts         # NEW: POST resume
        skip/route.ts           # NEW: POST skip
        cancel/route.ts         # NEW: POST cancel
    setup-intent/
      route.ts                  # NEW: POST creates SetupIntent
components/
  subscription/
    SubscriptionToggle.tsx      # NEW: one-time / subscribe toggle
    FrequencyPicker.tsx         # NEW: frequency dropdown
    SubscriptionPriceDisplay.tsx # NEW: discount price display
    SubscriptionCard.tsx        # NEW: subscription card for management page
```

### Pattern 1: Server Component Page + Client Display Component
**What:** Server components fetch data and pass to client components for interactivity
**When to use:** Every page in this phase follows this pattern, consistent with existing app architecture
**Example:**
```typescript
// app/subscriptions/page.tsx (Server Component)
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getSubscriptionsByCustomer } from "@/lib/models/mach/subscriptions";
import SubscriptionsClient from "./SubscriptionsClient";

export default async function SubscriptionsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const subscriptions = await getSubscriptionsByCustomer(userId);
  return <SubscriptionsClient subscriptions={subscriptions} />;
}
```

### Pattern 2: API Route with Clerk Auth
**What:** API routes use `auth()` from Clerk to get the authenticated user
**When to use:** All subscription API routes require authentication
**Example:**
```typescript
// app/api/subscriptions/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionsByCustomer } from "@/lib/models/mach/subscriptions";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const subscriptions = await getSubscriptionsByCustomer(userId);
  return NextResponse.json({ subscriptions });
}
```

### Pattern 3: SetupIntent Flow (Subscribe Checkout)
**What:** Collect payment method via SetupIntent, then create Subscription server-side
**When to use:** Subscription checkout -- this is the LOCKED decision from CONTEXT.md
**Flow:**
1. Client POSTs to `/api/setup-intent` with customer info
2. Server creates/retrieves Stripe Customer, creates SetupIntent with `usage: 'off_session'`
3. Server returns `clientSecret` to client
4. Client renders PaymentElement inside StripeProvider with the clientSecret
5. Client calls `stripe.confirmSetup()` (NOT `confirmPayment()`)
6. On success, client POSTs to `/api/subscriptions` with SetupIntent ID, product, frequency
7. Server retrieves SetupIntent to get `payment_method`, creates Stripe Subscription with `default_payment_method`
8. Stripe fires `customer.subscription.created` webhook -> D1 record created, email sent
9. Client redirects to /subscribe/confirmation

### Pattern 4: Stripe Action Routes
**What:** Each subscription lifecycle action is a separate POST route
**When to use:** Pause, resume, skip, cancel actions
**Example:**
```typescript
// app/api/subscriptions/[id]/pause/route.ts
import { auth } from "@clerk/nextjs/server";
import { getStripeForWorkers } from "@/lib/stripe";
import { getSubscriptionsByCustomer } from "@/lib/models/mach/subscriptions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Verify subscription belongs to this user
  const subs = await getSubscriptionsByCustomer(userId);
  const sub = subs.find(s => s.id === id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stripe = getStripeForWorkers();
  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    pause_collection: { behavior: 'void' }
  });

  return NextResponse.json({ success: true });
}
```

### Anti-Patterns to Avoid
- **Mixing PaymentIntent and SetupIntent:** The one-time checkout uses PaymentIntent; subscription checkout uses SetupIntent. Do NOT reuse CheckoutClient.tsx.
- **Direct D1 state mutation for subscription status:** Never update D1 subscription status directly from API routes. Always go through Stripe API, and let the webhook handler update D1. Stripe is the billing authority.
- **Storing sensitive payment data:** Never store card details. The SetupIntent flow attaches the PaymentMethod to the Stripe Customer automatically.
- **Blocking webhook processing on email:** Email sending is fire-and-forget (already implemented in Phase 2 handlers). Never await email sends in webhook handlers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Payment method collection | Custom card form | Stripe PaymentElement via @stripe/react-stripe-js | PCI compliance, SCA/3DS handling, multiple payment methods |
| Billing cycle management | Custom recurring billing logic | Stripe Subscriptions API | Retry logic, dunning, proration, tax handling |
| Subscription state machine | Custom state transitions | Stripe as authority + webhook sync to D1 | Stripe handles all edge cases (failed payments, retries, grace periods) |
| Discount/coupon application | Custom discount calculation | Stripe Coupons/Prices | Stripe handles discount on recurring invoices automatically |
| Email templating | Custom HTML generation | Existing sendSubscriptionEmail() | Already built in Phase 2, handles all lifecycle events |

**Key insight:** The subscription lifecycle is managed entirely by Stripe. The API routes in this phase are thin wrappers that call Stripe SDK methods. D1 is a read cache updated by webhooks, not a source of truth for billing state.

## Common Pitfalls

### Pitfall 1: Using confirmPayment Instead of confirmSetup
**What goes wrong:** Using `stripe.confirmPayment()` with a SetupIntent clientSecret causes a "No such payment_intent" error
**Why it happens:** SetupIntents and PaymentIntents have different confirmation methods
**How to avoid:** Use `stripe.confirmSetup({ elements, confirmParams: { return_url } })` for subscription checkout
**Warning signs:** Error messages mentioning "payment_intent" in the subscription checkout flow

### Pitfall 2: Not Verifying Subscription Ownership
**What goes wrong:** A user could pause/cancel another user's subscription by guessing the ID
**Why it happens:** API routes check auth but don't verify the subscription belongs to the authenticated user
**How to avoid:** Always fetch the user's subscriptions via `getSubscriptionsByCustomer(userId)` and verify the target subscription is in the list
**Warning signs:** No ownership check before Stripe API call

### Pitfall 3: Skip-Next Implementation Complexity
**What goes wrong:** "Skip next" doesn't have a single Stripe API call -- it requires coordination
**Why it happens:** Stripe has `pause_collection` with `void` behavior, but no native "skip one" operation
**How to avoid:** Two approaches (recommend Option A):
- **Option A:** Use `pause_collection` with `behavior: 'void'` and `resumes_at` set to one period after current_period_end. This voids the next invoice and automatically resumes.
- **Option B:** Store a `skip_next_renewal` flag in D1, then in the `invoice.upcoming` webhook handler, void the upcoming invoice via `stripe.invoices.voidInvoice()`. More complex, requires webhook modification.
**Warning signs:** Skip action appears to work but next invoice still charges

### Pitfall 4: Stripe Customer Creation Race Condition
**What goes wrong:** Multiple concurrent subscription attempts create duplicate Stripe Customers for the same user
**Why it happens:** First checkout creates customer, second checkout doesn't see it yet
**How to avoid:** Store stripe_customer_id in the customers table (already has external_references field). Check for existing Stripe Customer before creating a new one. Use Clerk userId as metadata for lookup.
**Warning signs:** Multiple Stripe Customers with the same email

### Pitfall 5: Subscription Plans Not Seeded
**What goes wrong:** Product page shows no subscription option because subscription_plans table is empty
**Why it happens:** Plans need to be populated with product_id, frequency, discount_percent, and stripe_price_id before the UI can show them
**How to avoid:** Include a seeding task that creates subscription plans for relevant products and corresponding Stripe Prices
**Warning signs:** listSubscriptionPlans(productId) returns empty array

### Pitfall 6: Price Amounts in Cents vs Dollars
**What goes wrong:** Subscription shows $0.15 instead of $15.00
**Why it happens:** Stripe prices are in cents; the existing variant price.amount is also in cents; but display code sometimes divides by 100 inconsistently
**How to avoid:** Follow the existing pattern: store in cents, divide by 100 for display using `(price / 100).toFixed(2)`. The subscription price should be calculated as: `variant_price * (1 - discount_percent / 100)`
**Warning signs:** Prices look oddly small or large

### Pitfall 7: Stripe API Version Mismatch (2025-08-27.basil)
**What goes wrong:** Period dates, invoice subscription fields, or other API responses have unexpected structure
**Why it happens:** The project uses Stripe API version `2025-08-27.basil` which moved period dates to subscription items and changed invoice.subscription to invoice.parent.subscription_details
**How to avoid:** Follow the patterns already established in Phase 2 webhook handlers. Access period dates from `subscription.items.data[0].current_period_start/end`. Access invoice subscription from `invoice.parent.subscription_details.subscription`.
**Warning signs:** `undefined` values when reading period dates from subscription root

## Code Examples

### SetupIntent Creation (Server-Side)
```typescript
// Source: Stripe SetupIntents API docs + existing lib/stripe.ts pattern
import { getStripeForWorkers } from '@/lib/stripe';

export async function createSetupIntentForSubscription(stripeCustomerId: string) {
  const stripe = getStripeForWorkers();
  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    usage: 'off_session', // Optimize for recurring payments
    automatic_payment_methods: { enabled: true },
  });
  return setupIntent;
}
```

### SetupIntent Confirmation (Client-Side)
```typescript
// Source: @stripe/react-stripe-js confirmSetup pattern
import { useStripe, useElements } from '@stripe/react-stripe-js';

const stripe = useStripe();
const elements = useElements();

const { error } = await stripe.confirmSetup({
  elements,
  confirmParams: {
    return_url: `${window.location.origin}/subscribe/confirmation`,
  },
  redirect: 'if_required',
});

if (!error) {
  // SetupIntent succeeded, now create subscription via API
  const res = await fetch('/api/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      setupIntentId: setupIntent.id,
      planId: selectedPlanId,
      shippingAddress: address,
    }),
  });
}
```

### Subscription Creation After SetupIntent (Server-Side)
```typescript
// Source: Stripe Subscriptions API docs
import { getStripeForWorkers } from '@/lib/stripe';

export async function createSubscription(
  stripeCustomerId: string,
  stripePriceId: string,
  paymentMethodId: string,
  metadata: Record<string, string>
) {
  const stripe = getStripeForWorkers();
  const subscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: stripePriceId }],
    default_payment_method: paymentMethodId,
    metadata,
    // discount can be applied via coupon or at the price level
  });
  return subscription;
}
```

### Pause Subscription
```typescript
// Source: Stripe pause_collection docs
const stripe = getStripeForWorkers();
await stripe.subscriptions.update(stripeSubscriptionId, {
  pause_collection: { behavior: 'void' },
});
// Webhook customer.subscription.updated fires -> handler detects pause -> D1 updated -> email sent
```

### Resume Subscription
```typescript
// Source: Stripe pause_collection docs
const stripe = getStripeForWorkers();
await stripe.subscriptions.update(stripeSubscriptionId, {
  pause_collection: '', // Empty string clears pause_collection
});
// Webhook customer.subscription.updated fires -> handler detects resume -> D1 updated -> email sent
```

### Skip Next Renewal (Recommended Approach)
```typescript
// Source: Stripe pause_collection with resumes_at
const stripe = getStripeForWorkers();
// Get current period end from subscription items (API version 2025-08-27.basil)
const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
const currentPeriodEnd = sub.items.data[0]?.current_period_end;

if (currentPeriodEnd) {
  // Pause with auto-resume after one billing period
  // resumes_at must be at least the current period end
  await stripe.subscriptions.update(stripeSubscriptionId, {
    pause_collection: {
      behavior: 'void',
      resumes_at: currentPeriodEnd, // Auto-resume at next period
    },
  });
}
```

### Cancel Subscription (Graceful)
```typescript
// Source: Stripe Subscriptions cancel docs
const stripe = getStripeForWorkers();
await stripe.subscriptions.update(stripeSubscriptionId, {
  cancel_at_period_end: true,
});
// Subscription stays active until period end, then customer.subscription.deleted fires
```

### Subscription Toggle Component Pattern
```typescript
// Pattern consistent with existing ProductDisplay.tsx
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const [purchaseMode, setPurchaseMode] = useState<'one-time' | 'subscribe'>('one-time');
const [selectedFrequency, setSelectedFrequency] = useState<string>('monthly');

// In JSX, above price area:
<ToggleGroup
  type="single"
  value={purchaseMode}
  onValueChange={(val) => val && setPurchaseMode(val as 'one-time' | 'subscribe')}
  className="w-full"
>
  <ToggleGroupItem value="one-time" className="flex-1">One-time purchase</ToggleGroupItem>
  <ToggleGroupItem value="subscribe" className="flex-1">Subscribe & Save</ToggleGroupItem>
</ToggleGroup>
```

### Subscription Price Calculation
```typescript
// Calculate discounted subscription price from variant price + plan discount
function getSubscriptionPrice(variantPriceInCents: number, discountPercent: number): number {
  return Math.round(variantPriceInCents * (1 - discountPercent / 100));
}

// Display example:
const subPrice = getSubscriptionPrice(price, plan.discount_percent);
// Original: <span className="line-through text-gray-500">${(price / 100).toFixed(2)}</span>
// Discounted: <span className="text-green-400 font-bold">${(subPrice / 100).toFixed(2)}</span>
// Badge: <span className="bg-green-500/10 text-green-400 text-xs px-2 py-1 rounded">Save {plan.discount_percent}%</span>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CloudflareStripe fetch adapter | getStripeForWorkers() with Stripe SDK | Phase 2 | Use SDK for all new code; CloudflareStripe preserved for backward compat only |
| invoice.subscription field | invoice.parent.subscription_details.subscription | Stripe API 2025-08-27.basil | Webhook handlers already use new pattern |
| Period dates on Subscription root | Period dates on SubscriptionItem | Stripe API 2025-08-27.basil | Access via subscription.items.data[0].current_period_start/end |
| Separate webhook endpoints | Unified webhook handler with dedup | Phase 2 | All subscription events already handled |

**Deprecated/outdated:**
- CloudflareStripe class: Preserved for existing checkout, but do NOT extend it. Use `getStripeForWorkers()` for all subscription operations.
- `invoice.subscription`: Replaced by `invoice.parent.subscription_details.subscription` in API version 2025-08-27.basil.

## Stripe Pricing Strategy

Stripe Subscriptions require a Stripe Price object (recurring) for each product/frequency combination. Two approaches:

### Approach A: Pre-create Stripe Prices (Recommended)
Create Stripe Prices during plan seeding and store the `stripe_price_id` in the `subscription_plans` table. The schema already has this column.

```typescript
const stripe = getStripeForWorkers();
const price = await stripe.prices.create({
  currency: 'usd',
  unit_amount: discountedPriceInCents, // variant price minus discount
  recurring: {
    interval: frequencyToInterval(frequency), // 'week' | 'month'
    interval_count: frequencyToIntervalCount(frequency), // 2 for biweekly, 1 for monthly, 2 for bimonthly
  },
  product_data: {
    name: `${productName} - ${frequencyLabel} Subscription`,
  },
  metadata: { product_id: productId, frequency },
});
```

Frequency to Stripe interval mapping:
| Frequency | interval | interval_count |
|-----------|----------|----------------|
| biweekly | week | 2 |
| monthly | month | 1 |
| bimonthly | month | 2 |

### Approach B: Use Stripe Coupons for Discount
Create Stripe Prices at full price, then apply a percentage coupon. More flexible if discount changes, but adds complexity. Not recommended for this phase.

**Decision: Use Approach A.** Pre-bake the discounted price into the Stripe Price. Simpler, and the subscription_plans table already has `stripe_price_id`. If the discount percentage changes, create a new Price (Stripe Prices are immutable).

## CTA Button Recommendation (Claude's Discretion)

**Recommendation: Direct "Subscribe Now" button** that navigates to `/subscribe/checkout?product={slug}&plan={planId}`.

Rationale:
- Subscription is a single product, not a cart of items
- Cart-based flow would require extending the cart store with subscription-specific state
- User decided subscription checkout is a separate dedicated page, not the cart checkout
- Amazon's "Subscribe & Save" uses a direct button, which the user specifically referenced as the desired UX

The existing "Add to Cart" button remains for one-time purchases. When the toggle is on "Subscribe & Save", the CTA switches to "Subscribe Now".

## Empty State Recommendation (Claude's Discretion)

For `/subscriptions` with no subscriptions:
```
[Tea leaf illustration or empty state icon]
"No subscriptions yet"
"Subscribe to your favorite teas and save on every delivery."
[Browse Products button -> /]
```

Consistent with the existing pattern in checkout when cart is empty.

## Open Questions

1. **Subscription plan seeding data**
   - What we know: The `subscription_plans` table exists but is empty. Plans need product_id, frequency, discount_percent, and stripe_price_id.
   - What's unclear: Which specific products should have subscription plans? What discount percentage?
   - Recommendation: Create plans for all products with a default 10% discount (matches schema default). Plans can be managed in Phase 5 (admin UI, SUBA-04). For now, seed via a script or API call.

2. **Stripe Customer mapping**
   - What we know: Clerk userId is used as customer_id in D1. The webhook handler uses `subscription.metadata?.customer_id || stripeCustomerId` as the customer identifier.
   - What's unclear: Should we create a MACH Customer record during subscription checkout, or just use Clerk userId directly?
   - Recommendation: Use Clerk userId as customer_id, store stripe_customer_id in subscription record. Create Stripe Customer with Clerk userId in metadata for webhook lookup. MACH Customer creation can be deferred to account pages (ACCT-*).

3. **Skip-next webhook modification**
   - What we know: The `invoice.upcoming` handler exists but only creates an audit event. Skip-next using `pause_collection` with `resumes_at` does NOT require webhook changes.
   - What's unclear: Whether `resumes_at` on pause_collection auto-resumes reliably
   - Recommendation: Use `pause_collection` with `resumes_at` for skip-next. This is the simplest approach and avoids modifying the webhook handler. Store a `skipped` event in subscription_events for the audit trail.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None configured (consistent with Phase 2 decision) |
| Config file | None |
| Quick run command | `npx tsc --noEmit` |
| Full suite command | `npx tsc --noEmit && npx next build` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUBX-01 | Subscription toggle + frequency picker on product page | manual | Visual inspection of product page | N/A |
| SUBX-02 | SetupIntent checkout flow | manual | Navigate /subscribe/checkout, enter test card | N/A |
| SUBX-03 | Subscription creation after SetupIntent | manual + tsc | `npx tsc --noEmit` (type-checks API route) | N/A Wave 0 |
| SUBX-04 | Pause subscription | manual | Click Pause on /subscriptions, verify Stripe Dashboard | N/A |
| SUBX-05 | Resume subscription | manual | Click Resume on /subscriptions, verify Stripe Dashboard | N/A |
| SUBX-06 | Skip next renewal | manual | Click Skip Next, verify pause_collection in Stripe | N/A |
| SUBX-07 | Cancel subscription | manual | Click Cancel, confirm dialog, verify Stripe | N/A |
| SUBX-08 | API routes exist and respond correctly | manual + tsc | `npx tsc --noEmit` + curl testing | N/A Wave 0 |
| SUBX-09 | Emails sent on lifecycle events | existing | Already tested in Phase 2 via webhook handlers | Exists |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit`
- **Per wave merge:** `npx tsc --noEmit && npx next build`
- **Phase gate:** Full build green + manual E2E walkthrough with Stripe test mode

### Wave 0 Gaps
- No test framework installed (consistent with Phase 2 precedent)
- Validation relies on TypeScript type checking and manual Stripe test mode verification
- SUBX-09 emails are already implemented and tested via Phase 2 webhook handlers

## Available shadcn/ui Components

Components confirmed available in `components/ui/`:
- `toggle.tsx`, `toggle-group.tsx` -- for one-time/subscribe toggle
- `select.tsx` -- for frequency picker
- `card.tsx` -- for subscription management cards
- `badge.tsx` -- for status badges and "Save X%" badges
- `button.tsx` -- for action buttons
- `dialog.tsx` -- for cancel confirmation
- `input.tsx`, `label.tsx` -- for checkout form fields
- `alert-dialog.tsx` -- alternative for cancel confirmation (has built-in cancel/confirm pattern)
- `separator.tsx` -- for visual separation in cards
- `loading.tsx` -- for loading states

## Existing Model Functions Available

From `lib/models/mach/subscriptions.ts` (built in Phase 2):
- `listSubscriptionPlans(productId?)` -- fetch plans for a product or all plans
- `getSubscriptionPlanById(id)` -- single plan lookup
- `getSubscriptionPlanByStripePriceId(stripePriceId)` -- lookup by Stripe price
- `createSubscriptionPlan(data)` -- create a plan (for seeding)
- `getSubscriptionByStripeId(stripeSubId)` -- lookup by Stripe subscription ID
- `getSubscriptionsByCustomer(customerId)` -- list customer's subscriptions
- `createCustomerSubscription(data)` -- create D1 subscription record
- `updateSubscriptionStatus(id, updates)` -- update status
- `createSubscriptionEvent(data)` -- audit trail
- `getSubscriptionEvents(subscriptionId)` -- event history

From `lib/models/mach/products.ts`:
- `getProduct(id)` -- fetch product by ID (needed for subscription cards to show product name/image)
- `getProductBySlug(slug)` -- fetch product by slug (product page)

From `lib/utils/email.ts` (built in Phase 2):
- `sendSubscriptionEmail(type, data)` -- sends lifecycle emails (already called by webhook handlers)

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `lib/stripe.ts`, `lib/models/mach/subscriptions.ts`, `lib/types/subscription.ts`, `lib/db/schema/subscription.ts`, `lib/utils/email.ts`, `app/api/webhooks/stripe/route.ts`, `app/product/[slug]/ProductDisplay.tsx`, `components/checkout/CheckoutClient.tsx`, `components/checkout/PaymentForm.tsx`, `components/checkout/StripeProvider.tsx`
- [Stripe Pause Payment Collection docs](https://docs.stripe.com/billing/subscriptions/pause-payment) - pause_collection behavior options, resume pattern
- [Stripe Create Subscription API](https://docs.stripe.com/api/subscriptions/create) - subscription creation parameters
- [Stripe Cancel Subscription API](https://docs.stripe.com/api/subscriptions/cancel) - cancellation with cancel_at_period_end
- [Stripe Save and Reuse Payment Methods](https://docs.stripe.com/payments/save-and-reuse) - SetupIntent flow with Elements

### Secondary (MEDIUM confidence)
- [Stripe Build Subscriptions Integration](https://docs.stripe.com/billing/subscriptions/build-subscriptions) - subscription flow patterns
- [Stripe Setup Intents API](https://docs.stripe.com/payments/setup-intents) - SetupIntent usage parameter
- [Stripe Collect Payment Deferred](https://docs.stripe.com/payments/accept-a-payment-deferred?platform=web&type=subscription) - deferred intent pattern

### Tertiary (LOW confidence)
- None -- all findings verified with official Stripe docs or codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and used in production
- Architecture: HIGH -- follows established patterns from existing checkout and webhook code
- Stripe API patterns: HIGH -- verified against official Stripe docs, consistent with SDK v18.5.0 and API version 2025-08-27.basil
- Pitfalls: HIGH -- derived from codebase analysis and Stripe documentation
- Skip-next implementation: MEDIUM -- pause_collection with resumes_at is documented but less commonly used than other approaches

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable -- Stripe API and installed libraries are pinned)

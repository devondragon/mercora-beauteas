# Phase 2: Subscription Infrastructure - Research

**Researched:** 2026-03-05
**Domain:** Stripe Subscriptions + D1 Schema + Webhook Pipeline on Cloudflare Workers
**Confidence:** HIGH

## Summary

Phase 2 builds the subscription plumbing: D1 database schema, Stripe SDK integration for subscription lifecycle operations, and webhook-driven state synchronization. The project already has Stripe SDK v18.5.0 installed with `apiVersion: '2025-08-27.basil'` on the StripeServer instance. The critical discovery is that **Stripe Node SDK works natively on Cloudflare Workers** when initialized with `Stripe.createFetchHttpClient()` and `Stripe.createSubtleCryptoProvider()` -- this means the custom CloudflareStripe adapter can be replaced entirely for new subscription methods, and the broken webhook verification (SUBI-05) can be fixed by switching to the SDK's `constructEventAsync` with the SubtleCrypto provider.

The "pause subscription" feature (`stripe.subscriptions.pause()`) is a Stripe Preview API and NOT available in the stable SDK v18.5.0. Pausing must use `stripe.subscriptions.update()` with `pause_collection` parameter, which pauses billing but keeps the subscription active. This changes the webhook event model: `customer.subscription.paused` and `customer.subscription.resumed` events are NOT fired; instead, `customer.subscription.updated` fires with the `pause_collection` field set or cleared.

**Primary recommendation:** Use the Stripe Node SDK directly (not CloudflareStripe) for all subscription operations. Initialize with `createFetchHttpClient()` for Workers compatibility. Fix webhook verification with `constructEventAsync` + `createSubtleCryptoProvider()`. Use `pause_collection` (not the Preview `pause` endpoint) for subscription pausing.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Dedicated `subscription_plans` table with rows per product/frequency combination (product_id, frequency, discount_percent, stripe_price_id). Admin can toggle plans on/off per product.
- Track ALL lifecycle events in `subscription_events`: created, renewed, payment_failed, paused, resumed, skipped, canceled, updated. Full audit trail needed for Phase 5 admin timeline view (SUBA-03).
- `customer_subscriptions` links to the existing `customers` table via customer_id (not direct Clerk user ID). Single customer record ties Clerk ID, Stripe customer ID, and subscription data together.
- Prefixed nanoid IDs consistent with existing codebase: SUB-XXXXXXXX for subscriptions, PLN-XXXXXXXX for plans, EVT-XXXXXXXX for events.
- Try Stripe Node SDK v18 with `nodejs_compat` first. If it works, use SDK directly for subscription methods and deprecate CloudflareStripe adapter. If it fails, fall back to extending CloudflareStripe with subscription methods.
- Keep all Stripe integration in the same `lib/stripe.ts` file regardless of approach.
- If staying with CloudflareStripe, upgrade API version from '2020-08-27' to '2025-08-27.basil' (match Node SDK version) for current subscription API features.
- Create Stripe customers eagerly at any checkout (one-time or subscription), not just at subscription time. Useful for saved cards and future features.
- Add subscription event handlers to the existing `app/api/webhooks/stripe/route.ts` endpoint. Single Stripe webhook URL. Handlers can be refactored into separate files if the switch statement grows too large.
- Event ID dedup table (`processed_webhook_events`) to handle Stripe retry duplicates. Check before processing, skip duplicates.
- Fix broken CloudflareStripe webhook verification (SUBI-05) using Web Crypto API for HMAC-SHA256 signature validation. No external dependencies.
- Return HTTP 500 on processing failures to trigger Stripe automatic retry (exponential backoff up to 72 hours). Combined with dedup table, retries are safe.
- Send emails for ALL 6 lifecycle events: subscription created, renewed (payment succeeded), payment failed, paused, resumed, canceled.
- Include "Manage Subscription" links in emails pointing to customer subscription page URL (Phase 3 builds the actual page, but link is ready).
- Payment failure emails include next retry date (from Stripe) and link to update payment method. Key for reducing involuntary churn.

### Claude's Discretion
- Email template approach (inline HTML vs React Email components) -- choose based on existing patterns and what's practical
- Exact subscription_events table column structure
- Handler file organization within the webhook route (inline vs extracted functions)
- Processed webhook events table cleanup/retention strategy

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUBI-01 | D1 schema with `subscription_plans`, `customer_subscriptions`, and `subscription_events` tables via Drizzle ORM | Schema design patterns documented below; existing schema/migration patterns analyzed; nanoid ID patterns confirmed |
| SUBI-02 | TypeScript types for SubscriptionPlan, CustomerSubscription, and SubscriptionEvent | Type conventions documented; existing type barrel pattern (`lib/types/index.ts`) confirmed |
| SUBI-03 | Model layer with CRUD operations for subscription plans, customer subscriptions, and stats queries | Existing model pattern in `lib/models/mach/` analyzed; verb-noun function convention confirmed |
| SUBI-04 | Stripe SDK extended with subscriptions.create/update/cancel, customers.create/retrieve, setupIntents.create, and prices.create/list methods | **Stripe Node SDK v18.5.0 confirmed working on Workers** with `createFetchHttpClient()`; all required methods verified present in SDK |
| SUBI-05 | Webhook signature verification fixed with proper HMAC validation (security critical) | `constructEventAsync` + `createSubtleCryptoProvider()` verified as the correct Workers-compatible approach; replaces broken CloudflareStripe stub |
| SUBI-06 | Webhook handler processes customer.subscription.created/updated/deleted/paused/resumed events | Subscription pause uses `pause_collection` (stable API), not Preview `pause` endpoint; events documented with correct mapping |
| SUBI-07 | Webhook handler processes invoice.payment_succeeded, invoice.payment_failed, and invoice.upcoming events | Invoice event types and data shapes documented; renewal order creation pattern specified |
| SUBI-08 | Each webhook event updates D1 state, creates audit event, and triggers email | Email pattern (Resend + inline HTML) documented; dedup table design specified; handler architecture pattern provided |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | 18.5.0 (installed) | Stripe API client for subscriptions, customers, prices, webhooks | Already installed; confirmed working on Cloudflare Workers with fetchHttpClient; has all required subscription methods |
| drizzle-orm | 0.35.3 (installed) | Type-safe ORM for D1 schema definitions | Already used for all existing tables; consistent with codebase |
| resend | 4.8.0 (installed) | Transactional email delivery | Already used for order confirmation/status emails; `lib/utils/email.ts` pattern established |
| nanoid | 3.3.11 (transitive) | Prefixed ID generation | Already used in reviews schema and order model; needs explicit `package.json` addition |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @react-email/components | 0.4.0 (installed) | React Email template components | Already installed; `emails/OrderConfirmation.tsx` exists as reference |
| @react-email/render | 1.1.4 (installed) | Render React Email to HTML | Already installed; pair with @react-email/components |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stripe Node SDK | CloudflareStripe adapter | SDK is now confirmed working on Workers; adapter would be redundant new code |
| Inline HTML emails | React Email components | React Email is installed and has an existing template; recommend inline HTML for subscription emails because existing order emails use inline HTML and it's simpler for the email utility pattern |
| Manual HMAC verification | stripe.webhooks.constructEventAsync | SDK method is more maintainable and handles edge cases (timestamp tolerance, signature scheme versioning) |

**Installation:**
```bash
npm install nanoid
```
Note: `nanoid` is already available as a transitive dependency but should be added as an explicit dependency per CONCERNS.md.

## Architecture Patterns

### Recommended Project Structure
```
lib/
  stripe.ts                           # Add getStripeForWorkers() with fetchHttpClient + subtleCrypto
  db/
    schema/
      subscription.ts                 # subscription_plans, customer_subscriptions, subscription_events tables
      webhook-events.ts               # processed_webhook_events dedup table
      index.ts                        # Add new schema exports
  models/
    mach/
      subscriptions.ts                # CRUD for subscription_plans, customer_subscriptions, subscription_events
      index.ts                        # Add subscription exports
  types/
    subscription.ts                   # SubscriptionPlan, CustomerSubscription, SubscriptionEvent types
    index.ts                          # Add subscription type exports
  utils/
    email.ts                          # Add subscription email functions alongside existing order emails
app/
  api/
    webhooks/
      stripe/
        route.ts                      # Extend with subscription event handlers
        handlers/                     # Optional: extracted handler functions if switch grows large
          subscription-handlers.ts
          invoice-handlers.ts
migrations/
  0007_add_subscription_tables.sql    # New migration for all subscription tables
```

### Pattern 1: Stripe SDK Initialization for Cloudflare Workers
**What:** Initialize Stripe with fetch-based HTTP client and SubtleCrypto provider for Workers compatibility
**When to use:** Any server-side Stripe operation running on Cloudflare Workers
**Example:**
```typescript
// Source: Cloudflare blog + Stripe SDK docs + OpenNext docs
import Stripe from 'stripe';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

export function getStripeForWorkers(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil',
    httpClient: Stripe.createFetchHttpClient(),
    typescript: true,
  });
}

// For webhook verification (async required in Workers)
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<Stripe.Event> {
  const stripe = getStripeForWorkers();
  return stripe.webhooks.constructEventAsync(
    payload,
    signature,
    secret,
    undefined,       // tolerance (use default 300 seconds)
    cryptoProvider    // SubtleCrypto for Workers
  );
}
```

### Pattern 2: Schema Definition with Prefixed Nanoid IDs
**What:** Define Drizzle schema tables with prefixed nanoid primary keys matching existing codebase pattern
**When to use:** All new subscription tables
**Example:**
```typescript
// Source: Existing pattern from lib/db/schema/reviews.ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const subscription_plans = sqliteTable('subscription_plans', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => `PLN-${nanoid(8).toUpperCase()}`),
  product_id: text('product_id').notNull(),
  frequency: text('frequency', {
    enum: ['biweekly', 'monthly', 'bimonthly']
  }).notNull(),
  discount_percent: integer('discount_percent').notNull().default(10),
  stripe_price_id: text('stripe_price_id'),
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Pattern 3: Model Layer CRUD Functions
**What:** Verb-noun CRUD functions following existing pattern in `lib/models/mach/`
**When to use:** All subscription data access
**Example:**
```typescript
// Source: Existing pattern from lib/models/mach/customer.ts, lib/models/mach/orders.ts
import { getDbAsync } from '@/lib/db';
import { subscription_plans } from '@/lib/db/schema/subscription';
import { eq, and, desc } from 'drizzle-orm';

export async function listSubscriptionPlans(productId?: string) {
  const db = await getDbAsync();
  if (productId) {
    return db.select().from(subscription_plans)
      .where(and(
        eq(subscription_plans.product_id, productId),
        eq(subscription_plans.is_active, true)
      ));
  }
  return db.select().from(subscription_plans)
    .where(eq(subscription_plans.is_active, true));
}

export async function createSubscriptionPlan(data: {
  product_id: string;
  frequency: 'biweekly' | 'monthly' | 'bimonthly';
  discount_percent: number;
  stripe_price_id?: string;
}) {
  const db = await getDbAsync();
  const [plan] = await db.insert(subscription_plans)
    .values(data)
    .returning();
  return plan;
}
```

### Pattern 4: Webhook Event Dedup
**What:** Check processed_webhook_events table before processing to prevent duplicate handling
**When to use:** Every incoming Stripe webhook event
**Example:**
```typescript
// Idempotency pattern for webhook processing
export async function processWebhookEvent(event: Stripe.Event) {
  const db = await getDbAsync();

  // Check dedup table
  const [existing] = await db.select()
    .from(processed_webhook_events)
    .where(eq(processed_webhook_events.event_id, event.id))
    .limit(1);

  if (existing) {
    console.log(`Skipping duplicate event: ${event.id}`);
    return { duplicate: true };
  }

  // Process the event
  try {
    await handleEvent(event);

    // Record as processed
    await db.insert(processed_webhook_events).values({
      event_id: event.id,
      event_type: event.type,
      processed_at: new Date().toISOString(),
    });

    return { success: true };
  } catch (error) {
    // Don't record -- returning 500 triggers Stripe retry
    throw error;
  }
}
```

### Pattern 5: Subscription Email (Inline HTML)
**What:** Use inline HTML templates following the existing `lib/utils/email.ts` pattern
**When to use:** All subscription lifecycle email notifications
**Example:**
```typescript
// Source: Existing pattern from lib/utils/email.ts
export async function sendSubscriptionEmail(
  type: 'created' | 'renewed' | 'payment_failed' | 'paused' | 'resumed' | 'canceled',
  data: SubscriptionEmailData
): Promise<EmailResult> {
  const resendClient = getResendClient();
  const { subject, html } = generateSubscriptionEmailContent(type, data);

  const { data: result, error } = await resendClient.emails.send({
    from: 'BeauTeas<hello@beauteas.com>',
    to: [data.customerEmail],
    subject: `${subject} - BeauTeas`,
    html,
  });

  if (error) {
    console.error(`Subscription ${type} email error:`, error);
    return { success: false, error: error.message || 'Email sending failed' };
  }
  return { success: true, id: result?.id };
}
```

### Anti-Patterns to Avoid
- **Self-referential HTTP calls:** The existing webhook handler calls its own `/api/orders` endpoint via fetch (documented in CONCERNS.md). New subscription handlers should call model functions directly, NOT make HTTP calls to their own API routes.
- **Synchronous constructEvent in Workers:** The existing code uses `stripe.webhooks.constructEvent()` (sync). On Workers, MUST use `constructEventAsync()` with SubtleCryptoProvider.
- **Using the Preview pause API:** `stripe.subscriptions.pause()` does not exist in SDK v18.5.0. Use `stripe.subscriptions.update(subId, { pause_collection: { behavior: 'void' } })` instead.
- **Relying on `customer.subscription.paused` events:** When using `pause_collection`, Stripe fires `customer.subscription.updated` (not `.paused`). Check the `pause_collection` field on the subscription object to detect pause/resume.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature verification | Manual HMAC-SHA256 with Web Crypto | `stripe.webhooks.constructEventAsync()` with `createSubtleCryptoProvider()` | Handles timestamp tolerance, signature scheme versioning, encoding edge cases |
| Stripe API calls | Custom fetch wrapper (CloudflareStripe extensions) | `stripe.subscriptions.create/update/cancel` etc. via SDK | SDK provides typed responses, automatic retries, proper error types, pagination helpers |
| ID generation | `Date.now() + Math.random()` pattern (used in orders.ts) | `nanoid(8)` with prefix | Cryptographically random, shorter, no timestamp leakage |
| Email HTML rendering | String concatenation for complex emails | Inline HTML template functions (existing pattern) | Consistent with codebase; React Email is available but overkill for simple subscription emails |
| Subscription billing | Custom interval calculation | Stripe recurring prices with `interval` and `interval_count` | Stripe handles timezone-aware billing cycles, proration, retries |

**Key insight:** Stripe is the billing authority. D1 is the sync layer. Never compute billing state locally -- always derive it from Stripe webhook events.

## Common Pitfalls

### Pitfall 1: Using constructEvent (sync) Instead of constructEventAsync
**What goes wrong:** `stripe.webhooks.constructEvent()` relies on Node.js `crypto` module for HMAC. On Cloudflare Workers, this either fails silently or throws a runtime error.
**Why it happens:** The existing codebase uses the sync version successfully in local dev (Node.js runtime) but it will fail on Workers.
**How to avoid:** Always use `constructEventAsync()` with `Stripe.createSubtleCryptoProvider()`. This uses the Web Crypto API available in Workers.
**Warning signs:** Webhook verification works in `npm run dev` but fails after deploy.

### Pitfall 2: Pause Subscription via Preview API
**What goes wrong:** Calling `stripe.subscriptions.pause()` throws "is not a function" because the method doesn't exist in stable SDK.
**Why it happens:** Stripe's "pause subscription" feature is in Preview API (requires `Stripe-Version: preview` header). The stable SDK v18.5.0 does not include it.
**How to avoid:** Use `stripe.subscriptions.update(subId, { pause_collection: { behavior: 'void' } })` to pause billing. Use `stripe.subscriptions.update(subId, { pause_collection: '' })` to resume.
**Warning signs:** TypeScript type errors when trying to call `.pause()`.

### Pitfall 3: Expecting customer.subscription.paused Webhook Events
**What goes wrong:** Webhook handler has a case for `customer.subscription.paused` but it never fires.
**Why it happens:** `pause_collection` (the stable API) does NOT change subscription status to "paused" and does NOT fire `.paused`/`.resumed` events. It fires `customer.subscription.updated` with `pause_collection` field set.
**How to avoid:** Handle pause/resume detection inside the `customer.subscription.updated` handler by checking `event.data.object.pause_collection`.
**Warning signs:** Pausing works in Stripe Dashboard but D1 doesn't reflect the change.

### Pitfall 4: Missing nanoid Dependency
**What goes wrong:** Build fails in CI or on fresh install because `nanoid` is not in `package.json`.
**Why it happens:** Currently available as a transitive dependency of postcss/other packages. Already flagged in CONCERNS.md.
**How to avoid:** Run `npm install nanoid` before using it in new subscription schema files.
**Warning signs:** "Cannot find module 'nanoid'" errors.

### Pitfall 5: Webhook Handler Returns 200 on Processing Error
**What goes wrong:** Stripe marks the event as delivered and never retries, even though processing failed and D1 state is inconsistent.
**Why it happens:** Catching errors and returning 200 "for safety" to avoid Stripe disabling the endpoint.
**How to avoid:** Return 500 on genuine processing failures. Stripe retries with exponential backoff up to 72 hours. The dedup table ensures retried events are not double-processed after partial success.
**Warning signs:** Missing subscription records in D1 with no error logs.

### Pitfall 6: Reading Request Body Twice
**What goes wrong:** `req.text()` or `req.json()` can only be called once on a Request. If you call it for logging and then again for verification, the second call returns empty.
**Why it happens:** Workers Request bodies are streams that can only be consumed once.
**How to avoid:** Call `req.text()` once, store in a variable, pass the string to both the webhook verification and any logging.
**Warning signs:** "Body has already been used" error, or webhook verification fails with empty body.

### Pitfall 7: Stripe Customer ID Not Stored on Customer Record
**What goes wrong:** Cannot look up D1 customer from Stripe webhook because there's no mapping.
**Why it happens:** Stripe webhooks contain `customer: "cus_..."` but D1 `customers` table has its own ID scheme. Without storing the Stripe customer ID, you cannot correlate events.
**How to avoid:** Store `stripe_customer_id` in the customer's `external_references` JSON field (existing column), or add a dedicated column. The context decision says "Single customer record ties Clerk ID, Stripe customer ID, and subscription data together."
**Warning signs:** Webhook handler cannot find the D1 customer for incoming subscription events.

## Code Examples

### Stripe Subscription Creation
```typescript
// Source: Stripe API docs (docs.stripe.com/api/subscriptions/create)
const stripe = getStripeForWorkers();

const subscription = await stripe.subscriptions.create({
  customer: 'cus_Na6dX7aXxi11N4',
  items: [
    { price: 'price_1MowQULkdIwHu7ixraBm864M' },
  ],
  payment_behavior: 'default_incomplete',
  payment_settings: {
    save_default_payment_method: 'on_subscription',
  },
  expand: ['latest_invoice.payment_intent'],
});
```

### Stripe Customer Creation
```typescript
// Source: Stripe API docs
const stripe = getStripeForWorkers();

const customer = await stripe.customers.create({
  email: customerEmail,
  name: customerName,
  metadata: {
    mercora_customer_id: d1CustomerId,
    clerk_user_id: clerkUserId,
  },
});

// Store stripe customer ID back on D1 customer record
```

### Pause Subscription (Using pause_collection)
```typescript
// Source: Stripe docs (docs.stripe.com/billing/subscriptions/pause-payment)
const stripe = getStripeForWorkers();

// Pause: void invoices during pause
const paused = await stripe.subscriptions.update(subscriptionId, {
  pause_collection: { behavior: 'void' },
});

// Resume: clear pause_collection
const resumed = await stripe.subscriptions.update(subscriptionId, {
  pause_collection: null as any, // SDK quirk: need to pass null/empty to clear
});
```

### Cancel Subscription
```typescript
// Source: Stripe API docs (docs.stripe.com/api/subscriptions/cancel)
const stripe = getStripeForWorkers();

// Cancel at end of period (recommended for subscriptions)
const canceled = await stripe.subscriptions.update(subscriptionId, {
  cancel_at_period_end: true,
});

// OR immediate cancellation
const canceledNow = await stripe.subscriptions.cancel(subscriptionId);
```

### Webhook Handler with Async Verification
```typescript
// Source: Cloudflare blog, Stripe SDK docs, jross.me
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyWebhookSignature } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  const body = await req.text(); // Read ONCE
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await verifyWebhookSignature(body, signature, getWebhookSecret());
  } catch (error) {
    console.error('Webhook verification failed:', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Dedup check, then process
  try {
    const result = await processWebhookEvent(event);
    if (result.duplicate) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
```

### Migration SQL Pattern
```sql
-- Source: Existing pattern from migrations/0005_add_reviews_tables.sql
-- Migration: 0007_add_subscription_tables.sql

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('biweekly', 'monthly', 'bimonthly')),
  discount_percent INTEGER NOT NULL DEFAULT 10,
  stripe_price_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'canceled', 'past_due', 'incomplete', 'trialing')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  pause_collection TEXT,  -- JSON: Stripe pause_collection object when paused
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  canceled_at TEXT
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES customer_subscriptions(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'renewed', 'payment_failed', 'paused', 'resumed', 'skipped', 'canceled', 'updated')),
  stripe_event_id TEXT,
  details TEXT,  -- JSON: event-specific data (invoice ID, failure reason, etc.)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sub_plans_product ON subscription_plans(product_id);
CREATE INDEX IF NOT EXISTS idx_cust_subs_customer ON customer_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_subs_stripe_id ON customer_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_cust_subs_status ON customer_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sub_events_subscription ON subscription_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at ON processed_webhook_events(processed_at);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CloudflareStripe custom adapter | Stripe Node SDK with `createFetchHttpClient()` | Oct 2025 (Cloudflare announcement) | SDK works natively on Workers; custom adapter no longer needed |
| `constructEvent` (sync) | `constructEventAsync` with SubtleCryptoProvider | Available since stripe-node v11.10.0 | Required for Workers; sync version uses Node.js crypto |
| `stripe.subscriptions.pause()` | `stripe.subscriptions.update({ pause_collection })` | Pause is Preview API only | Stable API uses pause_collection on update |
| CloudflareStripe API v2020-08-27 | Stripe SDK API v2025-08-27.basil | Current SDK version | Many new subscription features, pause_collection improvements |

**Deprecated/outdated:**
- `CloudflareStripe.webhooks.constructEvent`: Currently just parses JSON without verification. SECURITY CRITICAL to replace.
- `CloudflareStripe` adapter for new methods: No longer needed since SDK works on Workers. Keep existing `createPaymentIntent` and `calculateTax` working but add new subscription methods via SDK directly.
- `getStripeClient()` runtime detection: The `getStripeClient()` function tries to detect Workers vs Node.js runtime. With `createFetchHttpClient()`, a single Stripe instance works in both environments.

## Open Questions

1. **Stripe Customer ID Storage Location**
   - What we know: The `customers` table has an `external_references` JSON column for cross-system IDs. The `extensions` column could also work.
   - What's unclear: Whether to use `external_references` (semantically correct) or add a dedicated `stripe_customer_id` text column for faster lookups.
   - Recommendation: Use `external_references` JSON field with key `stripe_customer_id`. This avoids a migration to alter the customers table and follows the MACH pattern. For fast lookups, query by the field using JSON extraction in SQL or maintain a mapping in `customer_subscriptions.stripe_customer_id`.

2. **Processed Webhook Events Cleanup**
   - What we know: The dedup table will grow over time. Stripe retries within 72 hours, so events older than 72 hours are safe to delete.
   - What's unclear: Best cleanup strategy for D1 (no cron jobs natively).
   - Recommendation: Inline cleanup during webhook processing: delete events older than 7 days before inserting new ones. This is simple, self-maintaining, and 7 days provides generous safety margin beyond the 72-hour retry window.

3. **Email Template Approach (Claude's Discretion)**
   - What we know: Existing order emails use inline HTML in `lib/utils/email.ts`. React Email is also installed with `emails/OrderConfirmation.tsx` as a template.
   - Recommendation: **Use inline HTML** in `lib/utils/email.ts`. Reasoning: (a) order emails already use this pattern, (b) subscription emails are simpler than order emails (no item tables), (c) keeps all email logic in one file, (d) React Email adds build complexity for marginal benefit on simple templates.

4. **Handler File Organization (Claude's Discretion)**
   - What we know: The existing webhook route has 4 event handlers as inline functions. Adding 6+ subscription events will make the file large.
   - Recommendation: **Extract handlers into separate files** under `app/api/webhooks/stripe/handlers/`. Keep the route.ts as the dispatcher with verification and dedup, delegate to handler functions. This keeps each file focused and testable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None configured (per CLAUDE.md: "No formal testing framework currently configured") |
| Config file | none -- see Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` (after setup) |
| Full suite command | `npx vitest run` (after setup) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUBI-01 | Schema tables created with correct columns, types, constraints | unit | `npx vitest run tests/schema/subscription.test.ts -t "schema"` | No -- Wave 0 |
| SUBI-02 | TypeScript types compile correctly with expected shapes | unit (type-check) | `npx tsc --noEmit` | N/A (uses tsc) |
| SUBI-03 | Model CRUD operations (create, read, update, list) work against D1 | integration | `npx vitest run tests/models/subscriptions.test.ts` | No -- Wave 0 |
| SUBI-04 | Stripe SDK methods callable with correct parameters | integration | `npx vitest run tests/stripe/subscription-methods.test.ts` | No -- Wave 0 |
| SUBI-05 | Webhook verification rejects invalid signatures, accepts valid ones | unit | `npx vitest run tests/webhooks/signature-verification.test.ts` | No -- Wave 0 |
| SUBI-06 | Subscription webhook events update D1 state correctly | integration | `npx vitest run tests/webhooks/subscription-handlers.test.ts` | No -- Wave 0 |
| SUBI-07 | Invoice webhook events create renewal records and handle failures | integration | `npx vitest run tests/webhooks/invoice-handlers.test.ts` | No -- Wave 0 |
| SUBI-08 | Webhook processing creates audit events and triggers emails | integration | `npx vitest run tests/webhooks/lifecycle-integration.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` (type checking, fast)
- **Per wave merge:** `npx vitest run` (full suite if vitest is configured)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Install vitest: `npm install -D vitest` (no test framework exists)
- [ ] Create `vitest.config.ts` with path aliases matching tsconfig
- [ ] `tests/` directory structure matching test map above
- [ ] Test utilities for D1 mock/in-memory SQLite (vitest with better-sqlite3 or D1 miniflare)
- [ ] Stripe mock/stub utilities for testing without live API calls

*(Note: Given the project has no test infrastructure, Wave 0 test setup may be deferred to avoid blocking subscription implementation. TypeScript compilation (`tsc --noEmit`) provides basic validation without test framework setup.)*

## Sources

### Primary (HIGH confidence)
- Cloudflare blog: [Announcing native support for Stripe's JavaScript SDK in Cloudflare Workers](https://blog.cloudflare.com/announcing-stripe-support-in-workers/) - Confirms SDK works with fetchHttpClient
- OpenNext docs: [Stripe API on Cloudflare](https://opennext.js.org/cloudflare/howtos/stripeAPI) - Documents `httpClient: Stripe.createFetchHttpClient()` pattern
- Stripe Node SDK v18.5.0 installed in project - Verified available methods: `subscriptions.create/update/cancel/resume`, `customers.create/retrieve`, `setupIntents.create`, `prices.create/list`, `webhooks.constructEventAsync`
- Stripe docs: [Create a Subscription](https://docs.stripe.com/api/subscriptions/create?lang=node) - API parameters
- Stripe docs: [Pause payment collection](https://docs.stripe.com/billing/subscriptions/pause-payment) - Documents `pause_collection` as stable API
- Stripe docs: [Using webhooks with subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks) - Full event list
- Stripe docs: [Pause subscriptions](https://docs.stripe.com/billing/subscriptions/pause) - Documents Preview API pause (NOT available in stable SDK)
- Existing codebase: `lib/stripe.ts`, `app/api/webhooks/stripe/route.ts`, `lib/utils/email.ts`, `lib/db/schema/reviews.ts`, `lib/models/mach/customer.ts` - Established patterns

### Secondary (MEDIUM confidence)
- [jross.me: Verifying Stripe Webhook Signatures with Cloudflare Workers](https://jross.me/verifying-stripe-webhook-signatures-cloudflare-workers/) - Documents `constructEventAsync` + `createSubtleCryptoProvider()` pattern
- [gebna.gg: Stripe Webhook in Cloudflare Workers](https://gebna.gg/blog/stripe-webhook-cloudflare-workers) - Additional webhook verification examples
- [Cloudflare blog: A year of improving Node.js compatibility](https://blog.cloudflare.com/nodejs-workers-2025/) - nodejs_compat improvements in 2025

### Tertiary (LOW confidence)
- None -- all critical claims verified against installed SDK and official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and versions verified in package.json/node_modules
- Architecture: HIGH - Patterns directly derived from existing codebase files, verified SDK methods
- Pitfalls: HIGH - Tested SDK method availability (pause undefined), verified constructEventAsync exists, confirmed API version compatibility
- Webhook events: MEDIUM - pause_collection event behavior inferred from docs; should be validated with Stripe test mode during implementation

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable -- Stripe SDK and Drizzle ORM are mature, low churn)

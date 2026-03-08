# Phase 6: Pre-Launch Polish - Research

**Researched:** 2026-03-06
**Domain:** Webhook email content quality fixes + Next.js redirect status codes
**Confidence:** HIGH

## Summary

Phase 6 is a surgical correction phase addressing three quality issues identified during the v1.0 milestone audit. The work is entirely scoped to existing code -- no new features, no new dependencies, no new patterns. All three fixes modify code written in Phase 1 and Phase 2 with well-understood patterns already established in the codebase.

The three issues are: (1) broken "Manage Subscription" links in 6 email sends across 2 webhook handler files, (2) internal product/plan IDs displayed instead of human-readable product names in those same 6 email sends, and (3) Shopify URL redirects returning 308 instead of 301 in next.config.ts. The fixes are small, targeted, and low-risk because they reuse existing patterns (DB lookups, localized field parsing, Next.js redirect config).

**Primary recommendation:** Fix all three issues in a single focused pass. Email fixes (INT-01 + INT-02) share the same files and can be combined. The redirect fix (FLOW-01) is a separate one-line-per-entry change in next.config.ts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Change all `manageUrl` references in webhook handlers to point to `/subscriptions` (the existing subscription list page), not `/account/subscriptions/{id}` (which doesn't exist)
- Use an environment variable (e.g., `process.env.NEXT_PUBLIC_SITE_URL` or existing site config) for the base domain instead of hardcoding `https://beauteas.com`
- The "Update Payment Method" button in payment_failed emails should also link to `/subscriptions`
- Affects 6 locations: subscription-handlers.ts (lines 113, 161, 188, 277) and invoice-handlers.ts (lines 121, 191)
- Resolve human-readable product names via DB lookup in webhook handlers: plan.product_id -> products table -> extract `en` value from JSON name field
- Show product name only (e.g., "Jasmine Green Tea"), not variant details
- Product names are stored as JSON localized strings `{"en": "Jasmine Green Tea"}` -- extract the `en` key
- Follows the same pattern as existing `getCustomerDetails()` which already does a Stripe API lookup per email send
- Fix in next.config.ts only -- change `permanent: true` to `statusCode: 301` on all three Shopify redirect patterns
- Middleware D1 redirect_map lookups already default to 301, no changes needed there
- Three redirects affected: /products/:slug, /collections/:slug, /pages/:slug

### Claude's Discretion
- Exact approach for the plan -> product lookup chain (helper function vs inline, join strategy)
- Whether to use `statusCode: 301` alone or with `permanent: false` in next.config.ts (follow Next.js docs)
- Frequency resolution for emails (currently hardcoded as 'monthly' fallback in several handlers)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUBI-08 | Each webhook event updates D1 subscription state, creates audit event, and triggers appropriate email | Email content quality fixes (INT-01 manage URL, INT-02 product name) ensure emails contain correct, actionable information |
| SUBX-09 | Email sent on subscription created, renewed, payment failed, paused, resumed, and canceled events | Same -- emails are sent but contain broken links and internal IDs; these fixes make the emails production-ready |
| SEO-07 | Shopify URLs redirect via 301 to Mercora equivalents | Currently returning 308 (Next.js `permanent: true` default); fix to explicit `statusCode: 301` satisfies the requirement literally |
</phase_requirements>

## Standard Stack

### Core (already in project -- no new dependencies)

| Library | Version | Purpose | Relevance to Phase |
|---------|---------|---------|-------------------|
| Next.js | 15.3.5 | Framework | `next.config.ts` redirect configuration |
| Drizzle ORM | 0.35.2 | DB access | Product name lookup via existing `products` table |
| Stripe Node SDK | 18.4.0 | Webhook data | Context for subscription/invoice handler data flow |
| Resend | 4.8.0 | Email sending | Already used by `sendSubscriptionEmail()` -- no changes needed |

### No New Dependencies Required

This phase adds zero new packages. All fixes use existing imports, patterns, and utilities.

## Architecture Patterns

### Existing Pattern: Product Name Resolution (already used in admin)

The admin subscription model (`lib/models/mach/subscriptions.ts`) already implements the exact product name resolution pattern needed. The `parseProductName` helper (line 190) and the join chain `subscription_plans -> products` (used in `listSubscriptionsAdmin` and `getSubscriptionDetail`) demonstrate the canonical approach.

**Lookup chain:** `plan.product_id` -> `products` table -> `name` column -> JSON parse `{"en": "Jasmine Green Tea"}` -> extract `en` key

**Existing helper (already in codebase):**
```typescript
// lib/models/mach/subscriptions.ts line 190
function parseProductName(name: string | null | undefined): string {
  if (!name) return 'Unknown Product';
  const parsed = safeJsonParse<Record<string, string>>(name);
  if (parsed && typeof parsed === 'object') {
    return parsed.en || parsed[Object.keys(parsed)[0]] || 'Unknown Product';
  }
  return name;
}
```

This helper is currently module-private to `subscriptions.ts`. The webhook handlers need a similar capability.

### Existing Pattern: Per-Email Data Enrichment

Each webhook handler already calls `getCustomerDetails(stripeCustomerId)` which makes a Stripe API call per email send. Adding a DB lookup for product name is consistent with this pattern -- it adds one lightweight D1 query alongside the existing Stripe API call.

**Current flow (per handler):**
1. Process webhook event (update D1 state, create audit event)
2. Call `getCustomerDetails(stripeCustomerId)` -- Stripe API lookup
3. Call `sendSubscriptionEmail(type, data)` -- fire-and-forget

**Updated flow:**
1. Process webhook event (update D1 state, create audit event)
2. Call `getCustomerDetails(stripeCustomerId)` -- Stripe API lookup
3. Resolve product name from DB -- D1 lookup (new)
4. Call `sendSubscriptionEmail(type, data)` with resolved name -- fire-and-forget

### Existing Pattern: BASE_URL Constant

`lib/seo/metadata.ts` exports `BASE_URL = "https://beauteas.com"`. This is the project's canonical site URL constant, already used across `app/product/[slug]/page.tsx`, `app/category/[slug]/page.tsx`, `app/layout.tsx`, and `app/sitemap.ts`.

**Recommendation for manageUrl:** Import `BASE_URL` from `@/lib/seo/metadata` in both handler files. This is consistent with the rest of the codebase. The CONTEXT.md mentions using an environment variable, but `BASE_URL` is the established pattern -- it is a hardcoded constant but centralized in one place, making it easy to change later. If an env var approach is preferred, it could be added to `metadata.ts` as `export const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://beauteas.com"`, keeping the single source of truth.

### Next.js Redirect Config: statusCode vs permanent

Per official Next.js docs (verified 2026-02-27):
- `permanent: true` uses HTTP 308 (preserves request method)
- `permanent: false` uses HTTP 307 (temporary, not cached)
- `statusCode` property can be used **instead of** `permanent`, but **not both**
- `statusCode: 301` is valid and produces a standard 301 redirect

**Syntax:**
```typescript
// BEFORE (current)
{ source: "/products/:slug", destination: "/product/:slug", permanent: true }

// AFTER (fix)
{ source: "/products/:slug", destination: "/product/:slug", statusCode: 301 }
```

The `statusCode` and `permanent` properties are mutually exclusive. Use `statusCode: 301` alone -- do not combine with `permanent: false`.

### Anti-Patterns to Avoid

- **Fetching full product with variants for name resolution:** The `getProduct()` function loads all variants, which is wasteful when only the name is needed. Use a targeted query: `db.select({ name: products.name }).from(products).where(eq(products.id, productId)).limit(1)`.
- **Duplicating parseProductName logic:** The helper already exists in `subscriptions.ts`. Either extract it to a shared utility or import/re-export it.
- **Hardcoding URL path per subscription ID:** The user decision says link to `/subscriptions` (the list page), not `/subscriptions/{id}`. Do not construct per-subscription URLs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Product name from JSON | Manual JSON.parse + key extraction | Existing `parseProductName()` pattern from `subscriptions.ts` | Handles null, parse errors, missing `en` key with graceful fallback |
| Site base URL | Inline `process.env.NEXT_PUBLIC_SITE_URL` checks | `BASE_URL` from `@/lib/seo/metadata` | Centralized, already used in 6+ files across the project |
| Localized field extraction | Custom parsing | `resolveLocalizedField()` from `@/lib/seo/metadata` | Already handles string, Record, null with fallback -- identical to parseProductName's logic |

**Key insight:** The `resolveLocalizedField()` function in `lib/seo/metadata.ts` does exactly the same thing as `parseProductName()` -- extracts `en` from a JSON localized field with fallback. The webhook handlers could use either. `resolveLocalizedField` is already exported and public, while `parseProductName` is module-private. Using `resolveLocalizedField` would avoid code duplication.

## Common Pitfalls

### Pitfall 1: Forgetting the payment_failed "Update Payment Method" Button
**What goes wrong:** The `payment_failed` email template has TWO links using `manageUrl` -- one in the "Manage Subscription" button (shared across all email types) and one in the "Update Payment Method" button (specific to `payment_failed` in the `getTypeSpecificContent` function).
**Why it happens:** The `getTypeSpecificContent` function in `lib/utils/email.ts` line 584 uses `data.manageUrl` for the "Update Payment Method" button. This is separate from the "Manage Subscription" button rendered in the main template.
**How to avoid:** The `manageUrl` field in `SubscriptionEmailData` flows to both buttons. Fixing the value at the handler level automatically fixes both buttons -- no changes needed in `email.ts`.
**Warning signs:** Only checking the handler files and missing that the template uses `manageUrl` in two places.

### Pitfall 2: Plan ID vs Product ID Confusion
**What goes wrong:** In `handleSubscriptionCreated`, the plan is fetched directly (via `getSubscriptionPlanByStripePriceId`), so `plan.product_id` is available. In all other handlers (`handleSubscriptionUpdated`, `handleSubscriptionDeleted`, invoice handlers), the D1 subscription record `d1Sub` is fetched, which has `plan_id` (the subscription plan's ID), not `product_id` directly.
**Why it happens:** Two different lookup paths:
  - `handleSubscriptionCreated`: stripe price ID -> `getSubscriptionPlanByStripePriceId()` -> plan with `product_id`
  - Other handlers: stripe subscription ID -> `getSubscriptionByStripeId()` -> d1Sub with `plan_id`
**How to avoid:** For handlers that start from `d1Sub`, first fetch the plan via `getSubscriptionPlanById(d1Sub.plan_id)` to get `plan.product_id`, then fetch the product name.
**Warning signs:** Trying to use `d1Sub.plan_id` as a product ID -- it is a plan ID like `PLN-ABC12345`, not a product ID like `prod_jasmine-green`.

### Pitfall 3: Frequency Fallback Still Hardcoded
**What goes wrong:** All handlers except `handleSubscriptionCreated` hardcode `frequency: 'monthly' as SubscriptionFrequency`. This is listed under "Claude's Discretion" in CONTEXT.md.
**Why it happens:** Phase 2 deferred frequency resolution; Phase 3 did not address it.
**How to avoid:** Since the plan is now being fetched for product name resolution anyway, the `plan.frequency` value is available at no extra cost. Use it instead of the hardcoded `'monthly'` fallback.
**Warning signs:** Leaving the hardcoded frequency when the plan is already fetched.

### Pitfall 4: statusCode + permanent Conflict
**What goes wrong:** TypeScript type error or runtime confusion if both `statusCode: 301` and `permanent: true/false` are specified.
**Why it happens:** Next.js docs explicitly state these are mutually exclusive.
**How to avoid:** Replace `permanent: true` with `statusCode: 301`. Do not add `permanent: false` alongside it.
**Warning signs:** Type errors from NextConfig redirect type.

## Code Examples

### Fix 1: manageUrl (INT-01) -- All 6 Locations

```typescript
// Source: CONTEXT.md locked decision + lib/seo/metadata.ts existing pattern
import { BASE_URL } from '@/lib/seo/metadata';

// BEFORE (broken):
manageUrl: `https://beauteas.com/account/subscriptions/${d1Sub.id}`,

// AFTER (fixed):
manageUrl: `${BASE_URL}/subscriptions`,
```

All 6 locations get the same value. No per-subscription ID in the URL.

### Fix 2: Product Name Resolution (INT-02) -- Helper Pattern

```typescript
// Source: Existing pattern from lib/models/mach/subscriptions.ts
import { getSubscriptionPlanById } from '@/lib/models/mach/subscriptions';
import { resolveLocalizedField } from '@/lib/seo/metadata';

// Lightweight product name lookup (avoids loading variants)
async function getProductName(productId: string): Promise<string> {
  try {
    const db = await getDbAsync();
    const [product] = await db
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    return product ? resolveLocalizedField(product.name, 'Your Subscription') : 'Your Subscription';
  } catch (error) {
    console.error('[webhook] Failed to resolve product name:', error);
    return 'Your Subscription';
  }
}

// In handleSubscriptionCreated (plan already fetched):
const productName = await getProductName(plan.product_id);

// In other handlers (need plan lookup first):
const plan = await getSubscriptionPlanById(d1Sub.plan_id);
const productName = plan ? await getProductName(plan.product_id) : 'Your Subscription';
```

### Fix 3: Redirect Status Code (FLOW-01) -- next.config.ts

```typescript
// Source: Next.js docs (verified 2026-02-27)
// https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects

// BEFORE:
{ source: "/products/:slug", destination: "/product/:slug", permanent: true }

// AFTER:
{ source: "/products/:slug", destination: "/product/:slug", statusCode: 301 }
```

Three entries, same change on each.

### Fix 4: Frequency Resolution (bonus, under Claude's Discretion)

```typescript
// When plan is already fetched for product name, frequency is free:

// BEFORE:
frequency: 'monthly' as SubscriptionFrequency,

// AFTER:
frequency: (plan?.frequency || 'monthly') as SubscriptionFrequency,
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `permanent: true` (308) | `statusCode: 301` | Next.js 9.5+ (2020) | Both are permanent redirects; 301 is more universally understood by legacy crawlers |
| Hardcoded `https://beauteas.com` in webhook handlers | Import `BASE_URL` from `@/lib/seo/metadata` | Phase 1 (established pattern) | Centralizes site URL; already used across 6+ files |
| `plan.product_id` as productName | DB lookup with localized name parsing | This phase (INT-02 fix) | Emails show "Jasmine Green Tea" instead of "prod_jasmine-green" |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None configured (no test runner in devDependencies) |
| Config file | None |
| Quick run command | `npx tsc --noEmit` (type checking) |
| Full suite command | `npx tsc --noEmit && npx next lint` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUBI-08 | Email manageUrl points to /subscriptions | manual-only | Visual inspection of handler code | N/A |
| SUBX-09 | Email productName shows human-readable names | manual-only | Visual inspection of handler code | N/A |
| SEO-07 | Redirects return 301 status code | manual-only | `curl -I localhost:3000/products/test-slug` | N/A |

**Justification for manual-only:** No test framework is configured in this project. TypeScript compilation (`tsc --noEmit`) validates type correctness. Behavioral verification requires either manual inspection or integration testing against a running server.

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit`
- **Per wave merge:** `npx tsc --noEmit && npx next lint`
- **Phase gate:** Type check green + manual inspection of changed lines

### Wave 0 Gaps
None required -- the fixes are surgical code changes verified by TypeScript compilation and code review. No new test infrastructure is warranted for 3 targeted corrections to existing files.

## Open Questions

1. **BASE_URL vs Environment Variable**
   - What we know: `BASE_URL` is hardcoded as `"https://beauteas.com"` in `lib/seo/metadata.ts` and used across the project. CONTEXT.md mentions using an env var.
   - What's unclear: Whether to change `BASE_URL` to read from `process.env.NEXT_PUBLIC_SITE_URL` or keep the hardcoded constant.
   - Recommendation: Import the existing `BASE_URL` constant. It is already the project's single source of truth. If env var support is desired later, change it in `metadata.ts` once and all consumers benefit. This is not a Phase 6 concern -- it is infrastructure, not a bug fix.

2. **JSON product.name field parsing**
   - What we know: Product names are stored as `{"en": "Jasmine Green Tea"}` in the `products.name` column. Both `parseProductName` (in subscriptions.ts) and `resolveLocalizedField` (in metadata.ts) handle this format.
   - What's unclear: Whether `product.name` could ever be a plain string (not JSON) in production data.
   - Recommendation: Use `resolveLocalizedField` which handles both plain strings and JSON objects gracefully. Fallback to `'Your Subscription'` if null/undefined.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `subscription-handlers.ts`, `invoice-handlers.ts`, `next.config.ts`, `lib/utils/email.ts`, `lib/models/mach/subscriptions.ts`, `lib/models/mach/products.ts`, `lib/seo/metadata.ts`, `lib/types/subscription.ts`
- `.planning/v1.0-MILESTONE-AUDIT.md` -- gap definitions INT-01, INT-02, FLOW-01
- `.planning/phases/06-pre-launch-polish/06-CONTEXT.md` -- locked implementation decisions

### Secondary (MEDIUM confidence)
- [Next.js redirects docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects) -- verified 2026-02-27, confirms `statusCode` and `permanent` are mutually exclusive

### Tertiary (LOW confidence)
None -- all findings verified against codebase or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing code
- Architecture: HIGH -- reusing established patterns already in the codebase
- Pitfalls: HIGH -- identified from direct code inspection of all affected files

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable -- no external dependencies changing)

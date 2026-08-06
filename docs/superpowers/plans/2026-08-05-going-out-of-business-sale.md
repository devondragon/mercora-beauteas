# Going-Out-of-Business Sale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the BeauTeas storefront into a terminal clearance sale — flat per-box pricing, a 10-box minimum, quantity-tiered shipping, no subscriptions, no returns — with content that explains the closure honestly, all in place before the DNS cutover.

**Architecture:** Sale rules live in a new `lib/sale/` module that answers three questions (how many boxes is this cart, does it clear the minimum, which shipping tier applies). Every consumer resolves through it, mirroring how every shipping consumer already resolves through `resolveShippingOptions`. Prices, tiers, and the minimum are admin settings and catalog data, so almost nothing about the sale is hardcoded. Product withdrawal reuses the existing `isPubliclyPurchasableProduct` seam.

**Tech Stack:** Next.js App Router on Cloudflare Workers (OpenNext), D1 + Drizzle (runtime queries only), raw SQL migrations via Wrangler, Vitest for unit tests, Stripe for payments and tax.

**Spec:** [`docs/superpowers/specs/2026-08-05-going-out-of-business-sale-design.md`](../specs/2026-08-05-going-out-of-business-sale-design.md)

## Global Constraints

- **Never write raw `*100` or `/100`.** All money flows through `lib/money` (`Money.fromMinor/fromMajor/fromStored`, `.toMinorUnits()` at Stripe, `.toJSON()` to persist, `.format()` to display). See `docs/money.md`.
- **Shipping `cost` units differ by side of the boundary.** Server-side (`resolveShippingOptions`, `shipping.methods[].cost`, `shipping.tiers[].cost`, the `/api/shipping-options` response body) it is **major units (dollars)**. Client-side, after `CheckoutClient` maps through `majorToMinor`, it is **integer minor units**. Documented in `lib/types/shipping.ts`.
- **Migrations are hand-written raw SQL** in `migrations/NNNN_name.sql`, tracked by Wrangler by filename. No `drizzle-kit generate`. This plan adds `0025` and `0026`; `0011`–`0024` are taken.
- **Never expand and contract in the same migration.** Both migrations here are additive only.
- **D1 has no `db.transaction()`.** Use `db.batch()` for atomic writes.
- **Unit tests must not touch Cloudflare bindings.** `vitest.config.ts` collects `tests/unit/**/*.test.{ts,tsx}` only; anything calling `getCloudflareContext()` must be mocked. This is the suite CI gates.
- **Run `npm run lint` before considering any task done.**
- **Commit message scope is `goob:`** for every sale commit, so the Mercora upstreaming program can filter them mechanically. The two platform fixes in Task 1 use `fix:` instead — see that task.
- **Copy voice:** warm, a little girlie, matching Chai — but sincere. The thank-you is the emotional center, not the discount.
- **Stock age is described as "several years in sealed, airtight storage."** Never "a few years" (understates five), never a best-by reference (there is no printed date).

---

## File Structure

**New files**

| Path | Responsibility |
| --- | --- |
| `lib/sale/rules.ts` | **Pure** sale rules: box counting, minimum check, tier selection, prompt copy. No imports beyond types — safe in a client bundle. |
| `lib/sale/settings.ts` | `getSaleRules()` — the one settings read. Server-only; imports `@/lib/utils/settings`. |
| `app/api/sale-rules/route.ts` | Public read of `{ minimumBoxes, finalSale }` for client-side prompts. |
| `components/checkout/FinalSaleNotice.tsx` | The checkout disclosure block. |
| `scripts/goob-reprice.mjs` | Repricing with a persisted pre-sale baseline. |
| `migrations/0025_seed_goob_sale_settings.sql` | Settings rows for the sale. |
| `migrations/0026_goob_content.sql` | `/thank-you` page, refund-policy rewrite, withdrawal redirects. |
| `docs/goob-announcement-email.md` | Announcement copy for you to send manually. |

**Modified files**

| Path | Change |
| --- | --- |
| `lib/config/commerce.ts` | Status-aware withdrawal in `isPubliclyPurchasableProduct`; new `isSellableVariant`. |
| `lib/services/order-pricing.ts` | Refuse to price withdrawn products and variants. |
| `lib/services/shipping-options.ts` | Quantity tiers. |
| `lib/services/checkout-charges.ts` | Thread box count into the charge floor. |
| `app/api/shipping-options/route.ts` | Pass box count. |
| `app/api/payment-intent/route.ts` | Reject under-minimum carts. |
| `app/api/orders/route.ts` | Reject under-minimum carts. |
| `components/cart/CartDrawer.tsx` | Minimum prompt on the checkout link. |
| `components/checkout/CheckoutClient.tsx` | Minimum gate + final-sale notice. |
| `app/admin/settings/page.tsx` | Shipping tier editor. |
| `app/product/[slug]/ProductDisplay.tsx` | Gate the subscription toggle; "Sold out". |
| `components/ProductCard.tsx` | "Sold out". |
| `components/PromotionalBanner.tsx` | Link support. |
| `lib/ai/deterministic-answers.ts` | Final-sale, tiers, minimum, closing, freshness. |
| `lib/utils/email.ts` | Final-sale line in the order confirmation. |
| `app/page.tsx` | Closing hero. |

---

## Task 1: Make archiving a product actually withdraw it

Archiving is how the three bundle SKUs get discontinued, but today it does nothing: `getProductBySlug` doesn't filter on status, and `computeCatalogLineCents` validates the variant→product binding and price presence but never checks status. An archived product still renders a working PDP and is still purchasable server-side.

This is a platform bug, not sale behavior — a merchant who archives a product reasonably expects it to stop selling. Commit it as `fix:` and add it to the post-baseline platform fixes list in `mercora-upstreaming-plan.md`.

**Critical safety property:** a missing or null status must be treated as **active**. `product_variants.status` and `products.status` both default to `'active'` in the schema, but a NULL row must not take the whole catalog offline. Only an explicit non-active value withdraws.

**Files:**
- Modify: `lib/config/commerce.ts`
- Modify: `lib/services/order-pricing.ts:139-175` (`catalogUnitPriceCents`)
- Modify: `docs/mercora-upstreaming-plan.md` (post-baseline platform fixes list)
- Test: `tests/unit/config/commerce-withdrawal.test.ts` (create)
- Test: `tests/unit/lib/services/order-pricing.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `isActiveStatus(status: unknown): boolean` — true for `'active'`, `undefined`, `null`, and `''`; false otherwise.
  - `isPubliclyPurchasableProduct(product: { id?: unknown; slug?: unknown; type?: unknown; status?: unknown }): boolean` — existing name, now also false for non-active status.
  - `isSellableVariant(variant: { status?: unknown } | null | undefined): boolean` — false for a null variant or an explicit non-active status.

- [ ] **Step 1: Write the failing test for status-aware withdrawal**

Create `tests/unit/config/commerce-withdrawal.test.ts`:

```ts
/**
 * A merchant archiving a product must actually stop it selling (GOOB).
 *
 * `isPubliclyPurchasableProduct` is already the withdrawal seam — the PDP
 * (`app/product/[slug]/page.tsx:122`) and the sitemap both call it to keep
 * launch-disabled gift cards off the storefront. Before this change it only
 * knew about gift cards, so archiving the going-out-of-business bundle SKUs
 * left them rendering a working PDP and priceable server-side.
 *
 * Missing status must read as ACTIVE. Both status columns default to 'active',
 * but a NULL row must never take the entire catalog offline.
 */
import { describe, it, expect } from 'vitest';
import {
  isActiveStatus,
  isPubliclyPurchasableProduct,
  isSellableVariant,
} from '@/lib/config/commerce';

describe('isActiveStatus', () => {
  it('treats an explicit active status as active', () => {
    expect(isActiveStatus('active')).toBe(true);
  });

  it('treats missing status as active so a NULL row cannot dark the catalog', () => {
    expect(isActiveStatus(undefined)).toBe(true);
    expect(isActiveStatus(null)).toBe(true);
    expect(isActiveStatus('')).toBe(true);
  });

  it('treats every other status as withdrawn', () => {
    expect(isActiveStatus('archived')).toBe(false);
    expect(isActiveStatus('inactive')).toBe(false);
    expect(isActiveStatus('draft')).toBe(false);
    expect(isActiveStatus('discontinued')).toBe(false);
  });
});

describe('isPubliclyPurchasableProduct — status', () => {
  it('keeps an active tea product purchasable', () => {
    expect(
      isPubliclyPurchasableProduct({ id: 'tea-1', slug: 'morning', status: 'active' })
    ).toBe(true);
  });

  it('keeps a product with no status purchasable', () => {
    expect(isPubliclyPurchasableProduct({ id: 'tea-1', slug: 'morning' })).toBe(true);
  });

  it('withdraws an archived product', () => {
    expect(
      isPubliclyPurchasableProduct({
        id: 'bundle-1',
        slug: 'clearly-calendula-sample-pack',
        status: 'archived',
      })
    ).toBe(false);
  });

  it('still withdraws a launch-disabled gift card regardless of status', () => {
    expect(
      isPubliclyPurchasableProduct({ id: 'gift-card', slug: 'gift-card', status: 'active' })
    ).toBe(false);
  });
});

describe('isSellableVariant', () => {
  it('accepts an active variant', () => {
    expect(isSellableVariant({ status: 'active' })).toBe(true);
  });

  it('accepts a variant with no status', () => {
    expect(isSellableVariant({})).toBe(true);
  });

  it('rejects a discontinued variant', () => {
    expect(isSellableVariant({ status: 'discontinued' })).toBe(false);
  });

  it('rejects a null variant', () => {
    expect(isSellableVariant(null)).toBe(false);
    expect(isSellableVariant(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/config/commerce-withdrawal.test.ts`
Expected: FAIL — `isActiveStatus` and `isSellableVariant` are not exported from `@/lib/config/commerce`.

- [ ] **Step 3: Implement the status checks**

In `lib/config/commerce.ts`, add above `isPubliclyPurchasableProduct`:

```ts
/**
 * Whether a `status` column value means "still sellable".
 *
 * FAILS OPEN on a missing value. `products.status` and `product_variants.status`
 * both default to 'active' in the schema, but a NULL row must not withdraw the
 * catalog — the blast radius of a false negative here is the entire storefront,
 * while a false positive is one product that should have been archived.
 */
export function isActiveStatus(status: unknown): boolean {
  if (status === undefined || status === null || status === '') return true;
  return typeof status === 'string' && status.toLowerCase() === 'active';
}

/**
 * Whether a resolved catalog variant may be sold. A null variant is never
 * sellable — the caller could not resolve it, so there is nothing to price.
 */
export function isSellableVariant(
  variant: { status?: unknown } | null | undefined
): boolean {
  if (!variant) return false;
  return isActiveStatus(variant.status);
}
```

Then change `isPubliclyPurchasableProduct` to consider status:

```ts
export function isPubliclyPurchasableProduct(product: {
  id?: unknown;
  slug?: unknown;
  type?: unknown;
  status?: unknown;
}): boolean {
  if (!isActiveStatus(product.status)) return false;
  return giftCardPurchasesEnabled() || !isGiftCardPurchaseProduct(product);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/config/commerce-withdrawal.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the failing test for the server pricing refusal**

Append to `tests/unit/lib/services/order-pricing.test.ts`:

```ts
describe('computeCatalogLineCents — withdrawn catalog entries (GOOB)', () => {
  it('refuses to price a line whose product is archived', async () => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'var-bundle',
      product_id: 'bundle-1',
      status: 'active',
      price: { amount: 4500, currency: 'USD' },
    } as any);
    vi.mocked(getProduct).mockResolvedValue({
      id: 'bundle-1',
      slug: 'clearly-calendula-sample-pack',
      status: 'archived',
    } as any);

    const [line] = await computeCatalogLineCents([
      { product_id: 'bundle-1', variant_id: 'var-bundle', quantity: 1 },
    ]);

    expect(line).toHaveProperty('error');
    expect((line as { error: string }).error).toMatch(/withdrawn/i);
  });

  it('refuses to price a line whose variant is discontinued', async () => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'var-old',
      product_id: 'tea-1',
      status: 'discontinued',
      price: { amount: 2500, currency: 'USD' },
    } as any);
    vi.mocked(getProduct).mockResolvedValue({
      id: 'tea-1',
      slug: 'morning',
      status: 'active',
    } as any);

    const [line] = await computeCatalogLineCents([
      { product_id: 'tea-1', variant_id: 'var-old', quantity: 1 },
    ]);

    expect(line).toHaveProperty('error');
    expect((line as { error: string }).error).toMatch(/withdrawn/i);
  });

  it('still prices an active product and variant', async () => {
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'var-tea-1',
      product_id: 'tea-1',
      status: 'active',
      price: { amount: 200, currency: 'USD' },
    } as any);
    vi.mocked(getProduct).mockResolvedValue({
      id: 'tea-1',
      slug: 'morning',
      status: 'active',
    } as any);

    const [line] = await computeCatalogLineCents([
      { product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 10 },
    ]);

    expect(line).toEqual({ cents: 2000 });
  });
});
```

Add `computeCatalogLineCents` to the existing import list from `@/lib/services/order-pricing` at the top of that file if it is not already there.

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/services/order-pricing.test.ts -t "withdrawn catalog entries"`
Expected: FAIL — the archived product is priced at 4500 instead of erroring.

- [ ] **Step 7: Implement the refusal in the pricing path**

In `lib/services/order-pricing.ts`, extend the import from `@/lib/config/commerce` to include `isPubliclyPurchasableProduct` and `isSellableVariant`, then add a withdrawal check inside the per-line callback of `computeCatalogLineCents`, immediately after the existing gift-card block and before `normalizeQuantity`:

```ts
      // GOOB: a withdrawn catalog entry must not be priceable. `status` is the
      // merchant's withdrawal control (the PDP and sitemap already honour it via
      // isPubliclyPurchasableProduct); before this check, archiving a product
      // hid it from browsing while leaving it buyable by direct request.
      const withdrawalVariant = item.variant_id
        ? await getProductVariant(item.variant_id)
        : null;
      if (item.variant_id && !isSellableVariant(withdrawalVariant)) {
        return { error: `line ${i} references a withdrawn variant` };
      }

      const withdrawalProductId = item.product_id ?? withdrawalVariant?.product_id;
      if (withdrawalProductId) {
        const withdrawalProduct = await getProduct(withdrawalProductId);
        // A product that does not resolve is left to the pricing step below,
        // which already fails it closed with a more precise reason.
        if (withdrawalProduct && !isPubliclyPurchasableProduct(withdrawalProduct)) {
          return { error: `line ${i} references a withdrawn product` };
        }
      }
```

- [ ] **Step 8: Run the full pricing suite to verify it passes and nothing regressed**

Run: `npx vitest run tests/unit/lib/services/order-pricing.test.ts tests/unit/lib/services/order-pricing-charge-floor.test.ts tests/unit/config/commerce-withdrawal.test.ts`
Expected: PASS. If pre-existing tests fail because their `getProduct` mock returns `undefined`, that is correct behavior (an unresolvable product is skipped by the guard, not withdrawn) — verify the failure is a mock-shape issue and add `status: 'active'` to those fixtures rather than weakening the guard.

- [ ] **Step 9: Record the platform fix for upstreaming**

Add an entry to the post-baseline platform fixes list in `docs/mercora-upstreaming-plan.md` naming this commit's SHA, `lib/config/commerce.ts`, and `lib/services/order-pricing.ts`, with the one-line reason: archiving a product did not stop it selling.

- [ ] **Step 10: Lint and commit**

```bash
npm run lint
git add lib/config/commerce.ts lib/services/order-pricing.ts \
  tests/unit/config/commerce-withdrawal.test.ts \
  tests/unit/lib/services/order-pricing.test.ts \
  docs/mercora-upstreaming-plan.md
git commit -m "fix: archiving a product now withdraws it from sale

Status was never checked by the PDP or the server pricing path, so an
archived product still rendered and was still purchasable by direct
request. isPubliclyPurchasableProduct now honours status, and
computeCatalogLineCents refuses withdrawn products and variants.

Missing status reads as active so a NULL row cannot dark the catalog."
```

---

## Task 2: Seed the sale settings

Every sale number lives in `admin_settings` so it can be changed without a deploy. `defaultSettings` in `lib/db/schema/settings.ts` only seeds fresh installs, so existing databases need these rows written explicitly.

Tier costs seed at `0` — you set the real values in admin after weighing boxes (Task 8 builds that editor). A `0` tier is visibly wrong in the storefront rather than silently plausible, which is the failure mode you want if the step is missed.

**Files:**
- Create: `migrations/0025_seed_goob_sale_settings.sql`
- Modify: `lib/db/schema/settings.ts` (add the same rows to `defaultSettings` so fresh installs match)

**Interfaces:**
- Consumes: nothing.
- Produces: settings keys `sale.minimum_boxes` (number), `sale.final_sale` (boolean), `sale.subscriptions_enabled` (boolean), `shipping.tiers` (object), `promotions.banner_link` (string). `shipping.free_methods` is set to `[]`.

- [ ] **Step 1: Write the migration**

Create `migrations/0025_seed_goob_sale_settings.sql`:

```sql
-- 0025_seed_goob_sale_settings.sql
--
-- Settings for the going-out-of-business sale.
--
-- Data-only and additive. INSERT OR IGNORE leaves an operator's existing choice
-- untouched on re-run, matching 0021. The UPDATE at the bottom is deliberate and
-- is the ONE value that must change rather than be inserted — see below.
--
-- WHY free_methods IS EMPTIED RATHER THAN ZEROING THE THRESHOLD
-- resolveShippingOptions reads `settings['store.free_shipping_threshold'] || 75`.
-- A falsy value — 0, null, absent — therefore RESTORES the $75 threshold rather
-- than disabling it. Free shipping is switched off by removing every method from
-- `shipping.free_methods`, which makes the `freeMethods.includes(m.id)` test
-- false for all methods regardless of the threshold.
--
-- Tier costs seed at 0 and are set in the admin Shipping tab once boxes have been
-- weighed. A 0 tier reads as obviously unset in the storefront; a guessed number
-- would read as intentional.

INSERT OR IGNORE INTO admin_settings (key, value, category, description, data_type)
VALUES
  (
    'sale.minimum_boxes',
    '10',
    'sale',
    'Minimum number of boxes required to check out',
    'number'
  ),
  (
    'sale.final_sale',
    'true',
    'sale',
    'All sales are final (no returns); damaged or lost shipments are still made right',
    'boolean'
  ),
  (
    'sale.subscriptions_enabled',
    'false',
    'sale',
    'Show subscription options on the storefront',
    'boolean'
  ),
  (
    'shipping.tiers',
    '[{"max_boxes":20,"cost":0},{"max_boxes":40,"cost":0},{"max_boxes":null,"cost":0}]',
    'shipping',
    'Quantity-tiered shipping cost in dollars; the last entry has a null max_boxes and covers everything above',
    'object'
  ),
  (
    'promotions.banner_link',
    '"/thank-you"',
    'promotions',
    'URL the promotional banner links to',
    'string'
  );

-- Free shipping OFF. This row already exists on every deployed database (it is in
-- the initial settings seed), so INSERT OR IGNORE would no-op — it must be an
-- UPDATE. Guarded so it cannot create a row on a database that somehow lacks one.
UPDATE admin_settings
SET value = '[]', updated_at = CURRENT_TIMESTAMP
WHERE key = 'shipping.free_methods';
```

- [ ] **Step 2: Verify the SQL parses against local D1**

Run: `npx wrangler d1 execute beauteas-db-dev --local --file migrations/0025_seed_goob_sale_settings.sql`
Expected: no error. If the local DB is empty, run `npm run preview:dev` once first to seed it.

- [ ] **Step 3: Add matching rows to the fresh-install defaults**

In `lib/db/schema/settings.ts`, append to the `defaultSettings` array so a brand-new database is identical to a migrated one:

```ts
  // Going-out-of-business sale (0025)
  {
    key: 'sale.minimum_boxes',
    value: JSON.stringify(10),
    category: 'sale',
    description: 'Minimum number of boxes required to check out',
    data_type: 'number'
  },
  {
    key: 'sale.final_sale',
    value: JSON.stringify(true),
    category: 'sale',
    description: 'All sales are final (no returns); damaged or lost shipments are still made right',
    data_type: 'boolean'
  },
  {
    key: 'sale.subscriptions_enabled',
    value: JSON.stringify(false),
    category: 'sale',
    description: 'Show subscription options on the storefront',
    data_type: 'boolean'
  },
  {
    key: 'shipping.tiers',
    value: JSON.stringify([
      { max_boxes: 20, cost: 0 },
      { max_boxes: 40, cost: 0 },
      { max_boxes: null, cost: 0 }
    ]),
    category: 'shipping',
    description: 'Quantity-tiered shipping cost in dollars; the last entry has a null max_boxes and covers everything above',
    data_type: 'object'
  },
  {
    key: 'promotions.banner_link',
    value: JSON.stringify('/thank-you'),
    category: 'promotions',
    description: 'URL the promotional banner links to',
    data_type: 'string'
  },
```

- [ ] **Step 4: Verify the migration is queued and nothing earlier is pending**

Run: `npm run db:migrate:status:dev`
Expected: `0025_seed_goob_sale_settings.sql` listed as not-yet-applied; `0011`–`0024` applied.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add migrations/0025_seed_goob_sale_settings.sql lib/db/schema/settings.ts
git commit -m "goob: seed sale settings (minimum, tiers, final-sale, banner link)"
```

---

## Task 3: The sale rules module

One place owns box counting, the minimum check, and tier selection. Everything else — the shipping quote, the charge floor, both API gates, the cart UI, Chai — resolves through it, so the rule cannot drift between call sites the way the shipping rates did before BMC-242.

**Split across two files, and the split is load-bearing.** The cart drawer and checkout page are client components, and `getSettings` reaches `lib/db` → `getCloudflareContext` plus the entire Drizzle schema barrel. A single module would drag D1 into the browser bundle. `rules.ts` is pure and importable anywhere; `settings.ts` holds the one server-side read. This is the same split, for the same reason, that moved `resolveShippingOptions` out of `checkout-charges.ts` to keep the Stripe SDK off the chat route (BMC-242).

**Files:**
- Create: `lib/sale/rules.ts` (pure — must import nothing but types)
- Create: `lib/sale/settings.ts` (server-only)
- Test: `tests/unit/lib/sale/rules.test.ts`
- Test: `tests/unit/lib/sale/settings.test.ts`

**Interfaces:**
- Consumes: `getSettings` from `@/lib/utils/settings` (already exists), in `settings.ts` only.
- Produces from `@/lib/sale/rules` (pure):
  - `interface ShippingTier { max_boxes: number | null; cost: number }` — `cost` in **major units**.
  - `interface SaleRules { minimumBoxes: number; finalSale: boolean; subscriptionsEnabled: boolean; tiers: ShippingTier[] }`
  - `countBoxes(items: Array<{ quantity?: unknown }>): number`
  - `checkMinimumOrder(boxes: number, minimumBoxes: number): { ok: boolean; short: number }`
  - `resolveShippingTier(tiers: ShippingTier[], boxes: number): ShippingTier | null`
  - `minimumOrderMessage(short: number, minimumBoxes: number): string`
  - `DEFAULT_MINIMUM_BOXES: number` (10)
- Produces from `@/lib/sale/settings` (server-only):
  - `getSaleRules(): Promise<SaleRules>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/sale/rules.test.ts`:

```ts
/**
 * Unit tests for the going-out-of-business sale rules.
 *
 * This module is the single source for three numbers that appear in five places
 * each (cart drawer, checkout page, /api/payment-intent, /api/orders, Chai). It
 * is pinned directly here rather than only through its callers, for the same
 * reason `shipping-options.test.ts` exists.
 */
import { describe, it, expect } from 'vitest';

import {
  countBoxes,
  checkMinimumOrder,
  resolveShippingTier,
  minimumOrderMessage,
  type ShippingTier,
} from '@/lib/sale/rules';

describe('countBoxes', () => {
  it('sums line quantities', () => {
    expect(countBoxes([{ quantity: 4 }, { quantity: 6 }])).toBe(10);
  });

  it('ignores lines with an unusable quantity', () => {
    // The pricing path independently fails such a line closed, so the cart is
    // rejected either way — this must not throw or produce NaN.
    expect(countBoxes([{ quantity: 5 }, { quantity: 'many' }, { quantity: -3 }])).toBe(5);
  });

  it('truncates a fractional quantity rather than counting a partial box', () => {
    expect(countBoxes([{ quantity: 2.9 }])).toBe(2);
  });

  it('returns zero for an empty or non-array cart', () => {
    expect(countBoxes([])).toBe(0);
    expect(countBoxes(null as never)).toBe(0);
  });
});

describe('checkMinimumOrder', () => {
  it('rejects a cart below the minimum and reports the shortfall', () => {
    expect(checkMinimumOrder(6, 10)).toEqual({ ok: false, short: 4 });
  });

  it('accepts a cart exactly at the minimum', () => {
    expect(checkMinimumOrder(10, 10)).toEqual({ ok: true, short: 0 });
  });

  it('accepts a cart above the minimum', () => {
    expect(checkMinimumOrder(11, 10)).toEqual({ ok: true, short: 0 });
  });

  it('accepts everything when the minimum is zero', () => {
    expect(checkMinimumOrder(1, 0)).toEqual({ ok: true, short: 0 });
  });
});

describe('resolveShippingTier', () => {
  const TIERS: ShippingTier[] = [
    { max_boxes: 20, cost: 8 },
    { max_boxes: 40, cost: 14 },
    { max_boxes: null, cost: 22 },
  ];

  it('picks the first tier at the minimum order size', () => {
    expect(resolveShippingTier(TIERS, 10)).toEqual({ max_boxes: 20, cost: 8 });
  });

  it('picks the first tier at its upper bound — the bound is inclusive', () => {
    expect(resolveShippingTier(TIERS, 20)).toEqual({ max_boxes: 20, cost: 8 });
  });

  it('crosses into the second tier one box later', () => {
    expect(resolveShippingTier(TIERS, 21)).toEqual({ max_boxes: 40, cost: 14 });
  });

  it('picks the second tier at its upper bound', () => {
    expect(resolveShippingTier(TIERS, 40)).toEqual({ max_boxes: 40, cost: 14 });
  });

  it('falls into the open-ended tier above the last bound', () => {
    expect(resolveShippingTier(TIERS, 41)).toEqual({ max_boxes: null, cost: 22 });
    expect(resolveShippingTier(TIERS, 500)).toEqual({ max_boxes: null, cost: 22 });
  });

  it('returns null when no tier is configured', () => {
    expect(resolveShippingTier([], 10)).toBeNull();
  });

  it('sorts unordered tiers rather than trusting admin input order', () => {
    const unordered: ShippingTier[] = [
      { max_boxes: null, cost: 22 },
      { max_boxes: 40, cost: 14 },
      { max_boxes: 20, cost: 8 },
    ];

    expect(resolveShippingTier(unordered, 15)).toEqual({ max_boxes: 20, cost: 8 });
  });
});

describe('minimumOrderMessage', () => {
  it('uses the singular for one box short', () => {
    expect(minimumOrderMessage(1, 10)).toBe('Add 1 more box to check out — 10 box minimum.');
  });

  it('uses the plural for more than one', () => {
    expect(minimumOrderMessage(4, 10)).toBe('Add 4 more boxes to check out — 10 box minimum.');
  });
});
```

- [ ] **Step 2: Write the failing tests for the settings read**

Create `tests/unit/lib/sale/settings.test.ts`:

```ts
/**
 * `getSaleRules` is the ONE settings read behind the sale. It lives apart from
 * `lib/sale/rules.ts` because the cart drawer and checkout page import the pure
 * rules into a client bundle, and `getSettings` reaches lib/db →
 * getCloudflareContext plus the whole Drizzle schema barrel.
 *
 * Both booleans default to the SALE posture. A settings outage must never render
 * a storefront that implies returns are accepted or subscriptions still sold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/utils/settings', () => ({ getSettings: vi.fn() }));

import { getSaleRules } from '@/lib/sale/settings';
import { getSettings } from '@/lib/utils/settings';

function withSettings(sale: Record<string, unknown>, shipping: Record<string, unknown> = {}) {
  vi.mocked(getSettings).mockImplementation(async (category?: string) =>
    category === 'sale' ? sale : shipping
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  withSettings({}, {});
});

describe('getSaleRules', () => {
  it('falls back to a 10-box final sale when nothing is configured', async () => {
    const rules = await getSaleRules();

    expect(rules.minimumBoxes).toBe(10);
    expect(rules.finalSale).toBe(true);
    expect(rules.subscriptionsEnabled).toBe(false);
  });

  it('reads the configured values', async () => {
    withSettings({
      'sale.minimum_boxes': 6,
      'sale.final_sale': false,
      'sale.subscriptions_enabled': true,
    });

    const rules = await getSaleRules();

    expect(rules.minimumBoxes).toBe(6);
    expect(rules.finalSale).toBe(false);
    expect(rules.subscriptionsEnabled).toBe(true);
  });

  it('coerces a numeric-string minimum, as settings values can arrive quoted', async () => {
    withSettings({ 'sale.minimum_boxes': '12' });

    expect((await getSaleRules()).minimumBoxes).toBe(12);
  });

  it('ignores a nonsensical minimum rather than blocking every checkout', async () => {
    withSettings({ 'sale.minimum_boxes': 'lots' });

    expect((await getSaleRules()).minimumBoxes).toBe(10);
  });

  it('reads tiers from the shipping category', async () => {
    withSettings({}, { 'shipping.tiers': [{ max_boxes: null, cost: 12 }] });

    expect((await getSaleRules()).tiers).toEqual([{ max_boxes: null, cost: 12 }]);
  });

  it('returns no tiers when the setting is malformed', async () => {
    withSettings({}, { 'shipping.tiers': 'nonsense' });

    expect((await getSaleRules()).tiers).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run tests/unit/lib/sale/`
Expected: FAIL — cannot resolve `@/lib/sale/rules` or `@/lib/sale/settings`.

- [ ] **Step 4: Implement the pure rules**

Create `lib/sale/rules.ts`. **It must import nothing but types** — it is imported into client components, and a runtime import of `@/lib/utils/settings` here would pull D1 into the browser bundle.

```ts
/**
 * === Going-out-of-business sale rules (pure) ===
 *
 * The SINGLE source for the sale's purchase rules: the box minimum, the
 * quantity-tiered shipping bands, and whether the store is in final-sale mode.
 *
 * Every consumer resolves through here — the cart drawer and checkout page (the
 * customer-facing prompt), `/api/payment-intent` and `/api/orders` (the
 * authoritative gates), `resolveShippingOptions` (the quote and the charge
 * floor), and `lib/ai/deterministic-answers.ts` (what Chai tells people). That
 * is the same discipline `lib/services/shipping-options.ts` enforces for rates,
 * and for the same reason: a number stated in five places drifts.
 *
 * Every remaining SKU is a single box, so a cart's box count is its quantity
 * total. The bundle SKUs that were not one box are withdrawn (see
 * `isPubliclyPurchasableProduct`).
 *
 * PURE ON PURPOSE — do not add a runtime import here. The cart drawer and
 * checkout page import this module into a client bundle, and the settings read
 * reaches lib/db → getCloudflareContext plus the whole Drizzle schema barrel.
 * The settings read lives in `lib/sale/settings.ts` for exactly that reason,
 * mirroring why `resolveShippingOptions` was split out of `checkout-charges.ts`
 * to keep the Stripe SDK off the chat route (BMC-242).
 */

/** A shipping band. `cost` is MAJOR units (dollars), matching `shipping.methods[].cost`. */
export interface ShippingTier {
  /** Inclusive upper bound in boxes. `null` means "everything above the previous tier". */
  max_boxes: number | null;
  cost: number;
}

export interface SaleRules {
  minimumBoxes: number;
  finalSale: boolean;
  subscriptionsEnabled: boolean;
  tiers: ShippingTier[];
}

export const DEFAULT_MINIMUM_BOXES = 10;

/**
 * Total boxes in a cart. A line with an unusable quantity contributes 0 — the
 * catalog pricing path fails that same line closed, so the cart is rejected
 * regardless, and this must never produce NaN.
 */
export function countBoxes(items: Array<{ quantity?: unknown }>): number {
  if (!Array.isArray(items)) return 0;

  return items.reduce<number>((total, item) => {
    const raw = item?.quantity;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return total;
    return total + Math.floor(n);
  }, 0);
}

export function checkMinimumOrder(
  boxes: number,
  minimumBoxes: number
): { ok: boolean; short: number } {
  const short = Math.max(0, minimumBoxes - boxes);
  return { ok: short === 0, short };
}

/**
 * The band a box count falls into. Bounds are INCLUSIVE, and the tiers are
 * sorted here rather than trusting the order an admin saved them in — the
 * settings editor lets rows be reordered.
 */
export function resolveShippingTier(tiers: ShippingTier[], boxes: number): ShippingTier | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;

  const sorted = [...tiers].sort((a, b) => {
    if (a.max_boxes === null) return 1;
    if (b.max_boxes === null) return -1;
    return a.max_boxes - b.max_boxes;
  });

  return sorted.find((tier) => tier.max_boxes === null || boxes <= tier.max_boxes) ?? null;
}

export function minimumOrderMessage(short: number, minimumBoxes: number): string {
  const boxes = short === 1 ? 'box' : 'boxes';
  return `Add ${short} more ${boxes} to check out — ${minimumBoxes} box minimum.`;
}
```

- [ ] **Step 5: Implement the settings read**

Create `lib/sale/settings.ts`:

```ts
/**
 * The one settings read behind the sale.
 *
 * Separate from `lib/sale/rules.ts` so the pure rules stay importable from
 * client components — `getSettings` reaches lib/db → getCloudflareContext and
 * the Drizzle schema barrel, none of which belongs in a browser bundle.
 */

import { getSettings } from '@/lib/utils/settings';
import { DEFAULT_MINIMUM_BOXES, type SaleRules, type ShippingTier } from '@/lib/sale/rules';

/** Settings values arrive JSON-parsed, but a quoted number stays a string. */
function toPositiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export async function getSaleRules(): Promise<SaleRules> {
  const [sale, shipping] = await Promise.all([getSettings('sale'), getSettings('shipping')]);

  return {
    minimumBoxes: toPositiveInt(sale['sale.minimum_boxes'], DEFAULT_MINIMUM_BOXES),
    // Both booleans default to the SALE posture, not the pre-sale one: if the
    // settings read comes back empty the store must behave as closing, never as
    // if returns were still accepted or subscriptions still sold.
    finalSale: sale['sale.final_sale'] !== false,
    subscriptionsEnabled: sale['sale.subscriptions_enabled'] === true,
    tiers: Array.isArray(shipping['shipping.tiers'])
      ? (shipping['shipping.tiers'] as ShippingTier[])
      : [],
  };
}
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `npx vitest run tests/unit/lib/sale/`
Expected: PASS — 17 in `rules.test.ts`, 6 in `settings.test.ts`.

- [ ] **Step 7: Prove the pure module stays client-safe**

Run: `grep -n "^import" lib/sale/rules.ts`
Expected: no output, or only `import type` lines. A runtime import in this file is the defect the split exists to prevent.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add lib/sale/rules.ts lib/sale/settings.ts \
  tests/unit/lib/sale/rules.test.ts tests/unit/lib/sale/settings.test.ts
git commit -m "goob: add the sale rules module (minimum, box count, shipping tiers)

Pure rules and the settings read are split so the cart drawer and checkout
page can import the rules without pulling D1 into the client bundle."
```

---

## Task 4: Quantity-tiered shipping

`resolveShippingOptions` currently prices flat per method. It gains an optional box count; when `shipping.tiers` is configured, every enabled method is priced from the matching tier instead of its own `cost`.

The free-shipping branch stays in place and is disabled by the empty `free_methods` list from Task 2 — gate, don't delete, per the baseline preservation design.

**Files:**
- Modify: `lib/services/shipping-options.ts`
- Test: `tests/unit/lib/services/shipping-options.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveShippingTier`, `type ShippingTier` from `@/lib/sale/rules` (Task 3).
- Produces: `resolveShippingOptions(goodsCents: number, opts?: { subtotalPriceable?: boolean; boxes?: number }): Promise<ResolvedShippingOptions>` — existing name and return shape, new `boxes` option.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lib/services/shipping-options.test.ts`:

```ts
describe('resolveShippingOptions — quantity tiers (GOOB)', () => {
  const TIERS = [
    { max_boxes: 20, cost: 8 },
    { max_boxes: 40, cost: 14 },
    { max_boxes: null, cost: 22 },
  ];

  it('prices the method from the tier matching the box count', async () => {
    withSettings({
      'shipping.tiers': TIERS,
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    const { options } = await resolveShippingOptions(2000, { boxes: 10 });

    expect(options).toEqual([{ id: 'standard', label: 'Standard', cost: 8, estimatedDays: 5 }]);
  });

  it('crosses tiers at the inclusive bound', async () => {
    withSettings({
      'shipping.tiers': TIERS,
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000, { boxes: 20 })).options[0].cost).toBe(8);
    expect((await resolveShippingOptions(2000, { boxes: 21 })).options[0].cost).toBe(14);
    expect((await resolveShippingOptions(2000, { boxes: 41 })).options[0].cost).toBe(22);
  });

  it('ignores the per-method cost entirely once tiers are configured', async () => {
    withSettings({
      'shipping.tiers': [{ max_boxes: null, cost: 22 }],
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000, { boxes: 10 })).options[0].cost).toBe(22);
  });

  it('keeps the flat per-method cost when no tiers are configured', async () => {
    withSettings({
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000, { boxes: 10 })).options[0].cost).toBe(5.99);
  });

  it('charges the lowest tier when the box count is unknown', async () => {
    // The floor is a MINIMUM the charge must clear, so an unknown count must
    // never invent a higher one and reject an honest order. Callers that can
    // price a cart always know the count; an unpriceable cart is rejected before
    // this is reached.
    withSettings({
      'shipping.tiers': TIERS,
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
    });

    expect((await resolveShippingOptions(2000)).options[0].cost).toBe(8);
  });

  it('charges nothing for a method still listed as free', async () => {
    // Free shipping is switched off in production by emptying free_methods; the
    // mechanic itself stays intact and must keep working if it is ever re-enabled.
    withSettings(
      {
        'shipping.tiers': TIERS,
        'shipping.methods': [
          { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
        ],
        'shipping.free_methods': ['standard'],
      },
      { 'store.free_shipping_threshold': 20 }
    );

    expect((await resolveShippingOptions(2000, { boxes: 10 })).options[0].cost).toBe(0);
  });

  it('charges the tier when free_methods is empty, whatever the threshold says', async () => {
    withSettings(
      {
        'shipping.tiers': TIERS,
        'shipping.methods': [
          { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
        ],
        'shipping.free_methods': [],
      },
      { 'store.free_shipping_threshold': 1 }
    );

    expect((await resolveShippingOptions(999999, { boxes: 10 })).options[0].cost).toBe(8);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/services/shipping-options.test.ts -t "quantity tiers"`
Expected: FAIL — costs come back as 5.99 because the `boxes` option is ignored.

- [ ] **Step 3: Implement tiered pricing**

In `lib/services/shipping-options.ts`, add the import:

```ts
import { resolveShippingTier, type ShippingTier } from '@/lib/sale/rules';
```

Change the signature and the cost calculation:

```ts
export async function resolveShippingOptions(
  goodsCents: number,
  opts: { subtotalPriceable?: boolean; boxes?: number } = {}
): Promise<ResolvedShippingOptions> {
```

Inside, after `freeMethods` is resolved, add:

```ts
  // GOOB: when tiers are configured they REPLACE the per-method cost — the sale
  // ships a single Standard method priced by quantity, so a method's own `cost`
  // is no longer the rate anyone pays. Absent tiers, the flat per-method model
  // is untouched.
  //
  // An unknown box count resolves to the LOWEST tier on purpose. This function
  // also produces the charge floor, which is a minimum the collected amount must
  // clear; inventing a higher tier would reject honest orders. Callers that can
  // price a cart always know its box count.
  const tiers = (shippingSettings['shipping.tiers'] as ShippingTier[] | undefined) ?? [];
  const tier = tiers.length > 0 ? resolveShippingTier(tiers, opts.boxes ?? 0) : null;
```

Then replace the `options` mapping:

```ts
  const options: ShippingOption[] = enabled.map((m: any) => ({
    id: m.id,
    label: m.label,
    cost:
      qualifiesForFreeShipping && freeMethods.includes(m.id)
        ? 0
        : tier
          ? tier.cost
          : m.cost,
    estimatedDays: m.estimatedDays,
  }));
```

Update the module docblock's consumer table to note that the rate is now quantity-tiered.

- [ ] **Step 4: Run the whole shipping suite to verify it passes**

Run: `npx vitest run tests/unit/lib/services/shipping-options.test.ts`
Expected: PASS. The pre-existing default and free-threshold tests still pass, because no tiers are configured in their fixtures.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add lib/services/shipping-options.ts tests/unit/lib/services/shipping-options.test.ts
git commit -m "goob: price shipping by box-count tier"
```

---

## Task 5: Thread the box count through the quote and the charge floor

The quote a customer sees and the floor the server enforces must resolve the same tier. Both already have the item list in hand; they just need to pass its box count.

`computeExpectedChargeExtras` returns early when a cart is unpriceable, so no tier ever gets resolved from an untrustworthy cart.

**Files:**
- Modify: `lib/services/checkout-charges.ts:188-193` (`computeShippingFloorCents`), `:323` (call site)
- Modify: `app/api/shipping-options/route.ts:71-73`
- Test: `tests/unit/lib/services/checkout-charges.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveShippingOptions(goodsCents, { boxes })` (Task 4), `countBoxes` (Task 3).
- Produces: `computeShippingFloorCents(goodsCents: number, boxes?: number): Promise<number>` — new second parameter, optional so existing callers keep compiling.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/lib/services/checkout-charges.test.ts`:

```ts
describe('computeShippingFloorCents — box-count tiers (GOOB)', () => {
  it('floors at the tier matching the box count, not the cheapest tier', async () => {
    withSettings({
      'shipping.tiers': [
        { max_boxes: 20, cost: 8 },
        { max_boxes: null, cost: 22 },
      ],
      'shipping.methods': [
        { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5, enabled: true },
      ],
      'shipping.free_methods': [],
    });

    expect(await computeShippingFloorCents(2000, 10)).toBe(800);
    expect(await computeShippingFloorCents(8000, 40)).toBe(2200);
  });
});
```

If `tests/unit/lib/services/checkout-charges.test.ts` does not already define a `withSettings` helper and mock `@/lib/utils/settings`, copy the mock and helper verbatim from the top of `tests/unit/lib/services/shipping-options.test.ts`, and import `computeShippingFloorCents` from `@/lib/services/checkout-charges`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/services/checkout-charges.test.ts -t "box-count tiers"`
Expected: FAIL — both assertions return 800, because the box count is never passed.

- [ ] **Step 3: Thread the count through the floor**

In `lib/services/checkout-charges.ts`:

```ts
export async function computeShippingFloorCents(
  goodsCents: number,
  boxes?: number
): Promise<number> {
  const { options } = await resolveShippingOptions(goodsCents, { boxes });
  if (options.length === 0) return 0;
  // `option.cost` is major-unit dollars; convert to cents for the floor.
  const costsCents = options.map((o) => formatAmountForStripe(o.cost));
  return Math.max(0, Math.min(...costsCents));
}
```

Add the import `import { countBoxes } from '@/lib/sale/rules';` and update the call site inside `computeExpectedChargeExtras`:

```ts
  // The tier is resolved from the SAME items list that produced the goods total,
  // so the quote and the floor cannot disagree. Quantity is client-supplied, but
  // under-reporting it to reach a cheaper tier also shrinks the goods subtotal,
  // and both are recomputed here from one list — so the two stay consistent.
  const shippingCents = await computeShippingFloorCents(goodsCents, countBoxes(items));
```

- [ ] **Step 4: Pass the count from the quote endpoint**

In `app/api/shipping-options/route.ts`, add `import { countBoxes } from "@/lib/sale/rules";` and update the resolve call:

```ts
    const { options } = await resolveShippingOptions(subtotalCents, {
      subtotalPriceable: errors.length === 0,
      boxes: countBoxes(lineItems),
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/services/checkout-charges.test.ts tests/unit/app/api/payment-intent-tax-shipping-floor.test.ts tests/unit/app/api/orders-post-tax-shipping-floor.test.ts`
Expected: PASS. The floor tests still pass because their fixtures configure no tiers.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add lib/services/checkout-charges.ts app/api/shipping-options/route.ts \
  tests/unit/lib/services/checkout-charges.test.ts
git commit -m "goob: resolve the shipping tier from the cart's box count"
```

---

## Task 6: Reject under-minimum carts server-side

The client prompt (Task 7) is advisory. These two endpoints are the gates that actually hold — the same split the charge floor uses.

**Files:**
- Modify: `app/api/payment-intent/route.ts`
- Modify: `app/api/orders/route.ts`
- Test: `tests/unit/app/api/sale-minimum-order.test.ts` (create)

**Interfaces:**
- Consumes: `countBoxes`, `checkMinimumOrder`, `minimumOrderMessage` from `@/lib/sale/rules`; `getSaleRules` from `@/lib/sale/settings`.
- Produces: both endpoints return `400` with `{ error: <minimumOrderMessage output> }` for an under-minimum cart.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/api/sale-minimum-order.test.ts`:

```ts
/**
 * The 10-box minimum must hold server-side (GOOB).
 *
 * The cart drawer and checkout page prompt for it, but that copy is advisory —
 * a crafted request bypasses the UI entirely. These prove both money endpoints
 * refuse an under-minimum cart before any Stripe work happens.
 *
 * Same mocking shape as `payment-intent-catalog-guard.test.ts`: the handler
 * never touches the Workers runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(async () => ({ userId: null })) }));

const enforceRateLimit = vi.fn(async () => null);
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

// Only the settings read is mocked; the pure rules run for real, so the test
// exercises the same box counting production uses.
const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: (...args: unknown[]) => getSaleRules(...args),
}));

import { NextRequest } from 'next/server';
import { POST as paymentIntentPost } from '@/app/api/payment-intent/route';

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
  getSaleRules.mockResolvedValue({
    minimumBoxes: 10,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [{ max_boxes: null, cost: 22 }],
  });
});

const post = (handler: (req: NextRequest) => Promise<Response>, body: unknown) =>
  handler(
    new NextRequest('http://localhost/api/payment-intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('POST /api/payment-intent — box minimum', () => {
  it('rejects a cart below the minimum with an actionable message', async () => {
    const res = await post(paymentIntentPost, {
      amount: 1200,
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 6 }],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Add 4 more boxes to check out — 10 box minimum.');
  });

  it('does not reject a cart at the minimum for this reason', async () => {
    const res = await post(paymentIntentPost, {
      amount: 2000,
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 10 }],
    });

    // It may still fail for unrelated reasons (no Stripe in a unit test); what
    // matters is that it is not the minimum-order rejection.
    if (res.status === 400) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/box minimum/);
    }
  });

  it('rejects a cart with no items at all', async () => {
    const res = await post(paymentIntentPost, { amount: 2000, items: [] });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/box minimum/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/app/api/sale-minimum-order.test.ts`
Expected: FAIL — the under-minimum cart is not rejected with that message.

- [ ] **Step 3: Add the gate to the payment-intent route**

In `app/api/payment-intent/route.ts`, add the import:

```ts
import { countBoxes, checkMinimumOrder, minimumOrderMessage } from '@/lib/sale/rules';
import { getSaleRules } from '@/lib/sale/settings';
```

Immediately after the request body is parsed and `items` is resolved — and **before** any Stripe call or catalog pricing work — insert:

```ts
  // GOOB: the box minimum is a purchase rule, so it is enforced here rather than
  // only in the cart UI. Runs before any Stripe work so a rejected cart costs
  // nothing. `items` is the same list the catalog floor prices, so the count the
  // gate sees is the count the shipping tier is resolved from.
  const saleRules = await getSaleRules();
  const minimum = checkMinimumOrder(countBoxes(items), saleRules.minimumBoxes);
  if (!minimum.ok) {
    return NextResponse.json(
      { error: minimumOrderMessage(minimum.short, saleRules.minimumBoxes) },
      { status: 400 }
    );
  }
```

Note: `items` is assigned at line 159 as `Array.isArray(draft.items) ? draft.items : []`. Place the gate after that assignment. If the top-level `items` field is present, prefer it — use `const gateItems = Array.isArray(body.items) ? body.items : items;` and count `gateItems`, so a request that supplies only the draft is still gated.

- [ ] **Step 4: Add the same gate to the orders route**

In `app/api/orders/route.ts`, add the identical import and place the same block immediately after the order payload's `items` are resolved and before any charge verification. Use the same error message so the two endpoints cannot disagree.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/app/api/sale-minimum-order.test.ts tests/unit/app/api/payment-intent-catalog-guard.test.ts tests/unit/app/api/orders-post-charge-verification.test.ts`
Expected: PASS. If pre-existing order/payment-intent tests now fail with a box-minimum error, their fixture carts are below 10 — raise those fixtures' quantities rather than weakening the gate.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add app/api/payment-intent/route.ts app/api/orders/route.ts \
  tests/unit/app/api/sale-minimum-order.test.ts
git commit -m "goob: reject under-minimum carts at both money endpoints"
```

---

## Task 7: The customer-facing minimum prompt

The cart and checkout need the minimum to render the prompt. A small public endpoint serves it so the number lives in settings, not in two client bundles.

**Files:**
- Create: `app/api/sale-rules/route.ts`
- Modify: `components/cart/CartDrawer.tsx:143-153`
- Modify: `components/checkout/CheckoutClient.tsx`
- Test: `tests/unit/app/api/sale-rules-route.test.ts` (create)

**Interfaces:**
- Consumes: `countBoxes`, `checkMinimumOrder`, `minimumOrderMessage` from `@/lib/sale/rules` (the client components import from here and **only** here); `getSaleRules` from `@/lib/sale/settings` (the route only); `useCartStore` from `@/lib/stores/cart-store`.
- Produces: `GET /api/sale-rules` → `{ minimumBoxes: number; finalSale: boolean }`.

- [ ] **Step 1: Write the failing test for the endpoint**

Create `tests/unit/app/api/sale-rules-route.test.ts`:

```ts
/**
 * `GET /api/sale-rules` exists so the cart drawer and checkout page can render
 * the box-minimum prompt from settings rather than hardcoding 10 in two client
 * bundles. It exposes only the two public numbers — never the full settings
 * object, which carries operational keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const enforceRateLimit = vi.fn(async () => null);
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({ getSaleRules: (...a: unknown[]) => getSaleRules(...a) }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sale-rules/route';

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
});

const get = () => GET(new NextRequest('http://localhost/api/sale-rules'));

describe('GET /api/sale-rules', () => {
  it('returns the minimum and the final-sale flag', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [],
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ minimumBoxes: 10, finalSale: true });
  });

  it('does not leak the rest of the sale settings', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [{ max_boxes: null, cost: 22 }],
    });

    const body = (await (await get()).json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['finalSale', 'minimumBoxes']);
  });

  it('fails safe to a closed-sale posture when settings cannot be read', async () => {
    getSaleRules.mockRejectedValue(new Error('D1 unavailable'));

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ minimumBoxes: 10, finalSale: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/app/api/sale-rules-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/sale-rules/route`.

- [ ] **Step 3: Implement the endpoint**

Create `app/api/sale-rules/route.ts`:

```ts
/**
 * Public read of the two sale numbers the storefront UI needs: the box minimum
 * and whether the store is in final-sale mode.
 *
 * Exists so the cart drawer and checkout page render the prompt from settings
 * instead of hardcoding 10 in two client bundles. Deliberately narrow — the
 * `sale` settings category also carries operational flags, and the full object
 * has no business on the public internet.
 *
 * The gates that actually enforce the minimum are `/api/payment-intent` and
 * `/api/orders`; this endpoint is for copy only.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSaleRules } from '@/lib/sale/settings';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit('PUBLIC_RATE_LIMITER', `sale-rules:${getClientIp(req)}`);
  if (limited) return limited;

  try {
    const { minimumBoxes, finalSale } = await getSaleRules();
    return NextResponse.json({ minimumBoxes, finalSale });
  } catch (error) {
    // Fail to the SALE posture, never the pre-sale one: a settings outage must
    // not render a storefront that implies returns are accepted or that any
    // cart size can check out.
    console.error('[sale-rules] settings read failed:', error);
    return NextResponse.json({ minimumBoxes: 10, finalSale: true });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/app/api/sale-rules-route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the prompt to the cart drawer**

In `components/cart/CartDrawer.tsx`, add near the other hooks:

```tsx
  const [minimumBoxes, setMinimumBoxes] = useState(10);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sale-rules')
      .then((r) => r.json() as Promise<{ minimumBoxes: number }>)
      .then((r) => {
        if (!cancelled) setMinimumBoxes(r.minimumBoxes);
      })
      .catch(() => {
        /* keep the default — the server gate is authoritative either way */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const boxes = countBoxes(items);
  const minimum = checkMinimumOrder(boxes, minimumBoxes);
```

Import `useState`/`useEffect` from React and `countBoxes, checkMinimumOrder, minimumOrderMessage` from `@/lib/sale/rules`. Then replace the checkout link block so the button is disabled and the prompt shows:

```tsx
                {!minimum.ok && (
                  <p className="mb-2 text-sm text-state-warning">
                    {minimumOrderMessage(minimum.short, minimumBoxes)}
                  </p>
                )}
                <Button asChild={minimum.ok} disabled={!minimum.ok} className="w-full">
                  {minimum.ok ? (
                    <Link href="/checkout" onClick={() => setCartOpen(false)}>
                      Proceed to Checkout
                    </Link>
                  ) : (
                    <span>Proceed to Checkout</span>
                  )}
                </Button>
```

Match the existing `Button` usage in the file — if it already uses `asChild` with a `Link` child, keep that shape and only add the `disabled` and the prompt.

- [ ] **Step 6: Add the gate to the checkout page**

In `components/checkout/CheckoutClient.tsx`, fetch the rules the same way, then return a blocking panel before the step flow renders — rather than wiring into each step's button, which would leave the payment step reachable by going back:

```tsx
  if (!minimum.ok) {
    return (
      <div className="mx-auto max-w-xl rounded-xl bg-white p-8 text-center">
        <h2 className="mb-2 text-lg font-semibold text-text-primary">
          Just a few more boxes
        </h2>
        <p className="mb-6 text-sm text-text-muted">
          {minimumOrderMessage(minimum.short, minimumBoxes)} We&rsquo;re shipping the
          last of our stock, so orders go out in batches of at least {minimumBoxes}.
        </p>
        <Button asChild>
          <Link href="/category/clearly-calendula">Back to the teas</Link>
        </Button>
      </div>
    );
  }
```

Confirm the category slug against the live catalog before committing; `app/page.tsx` fetches `getProductsByCategory("cat_clearly_calendula")`, so the URL slug may differ from the category id.

- [ ] **Step 7: Verify in a real runtime**

Run: `npm run preview:dev`
Then: add 6 boxes to the cart, confirm the drawer shows "Add 4 more boxes to check out — 10 box minimum." and the checkout button is disabled; visit `/checkout` directly and confirm the blocking panel renders; add 4 more and confirm both clear.

Plain `npm run dev` will 500 on these routes — it has no Workers bindings.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add app/api/sale-rules/route.ts components/cart/CartDrawer.tsx \
  components/checkout/CheckoutClient.tsx tests/unit/app/api/sale-rules-route.test.ts
git commit -m "goob: prompt for the box minimum in the cart and at checkout"
```

---

## Task 8: Admin shipping tier editor

This is what makes the tier prices editable once boxes have been weighed, without a deploy or a SQL command.

**Files:**
- Modify: `app/admin/settings/page.tsx` (the `shipping` tab and its `ShippingSettings` type)

**Interfaces:**
- Consumes: the `shipping.tiers` settings key from Task 2; `type ShippingTier` from `@/lib/sale/rules`.
- Produces: no new exports — an admin UI that writes `shipping.tiers`.

- [ ] **Step 1: Extend the settings type**

In `app/admin/settings/page.tsx`, add to the `ShippingSettings` interface (around line 83):

```ts
  tiers: Array<{ max_boxes: number | null; cost: number }>;
```

and to the `useState` initializer (around line 156):

```ts
    tiers: [
      { max_boxes: 20, cost: 0 },
      { max_boxes: 40, cost: 0 },
      { max_boxes: null, cost: 0 },
    ],
```

- [ ] **Step 2: Load the value**

In the settings-parsing block (around line 239), alongside the existing shipping keys:

```ts
            if (setting.key === 'shipping.tiers') setShippingSettings(prev => ({ ...prev, tiers: value }));
```

- [ ] **Step 3: Render the editor**

In the shipping tab's JSX, add a section above the existing methods editor:

```tsx
<div className="mb-8">
  <h3 className="text-lg font-semibold mb-1">Shipping by quantity</h3>
  <p className="text-sm text-text-muted mb-4">
    Cost in dollars for an order up to and including that many boxes. The last row
    has no upper bound and covers everything above. These replace the per-method
    cost below.
  </p>
  {shippingSettings.tiers.map((tier, i) => (
    <div key={i} className="flex items-center gap-3 mb-2">
      <span className="text-sm w-28">
        {tier.max_boxes === null ? 'More than above' : `Up to ${tier.max_boxes} boxes`}
      </span>
      {tier.max_boxes !== null && (
        <input
          type="number"
          min={1}
          value={tier.max_boxes}
          onChange={(e) => {
            const tiers = [...shippingSettings.tiers];
            tiers[i] = { ...tiers[i], max_boxes: parseInt(e.target.value, 10) || 1 };
            setShippingSettings({ ...shippingSettings, tiers });
          }}
          className="w-24 rounded border px-2 py-1"
          aria-label={`Tier ${i + 1} maximum boxes`}
        />
      )}
      <input
        type="number"
        min={0}
        step="0.01"
        value={tier.cost}
        onChange={(e) => {
          const tiers = [...shippingSettings.tiers];
          tiers[i] = { ...tiers[i], cost: parseFloat(e.target.value) || 0 };
          setShippingSettings({ ...shippingSettings, tiers });
        }}
        className="w-24 rounded border px-2 py-1"
        aria-label={`Tier ${i + 1} cost in dollars`}
      />
    </div>
  ))}
</div>
```

- [ ] **Step 4: Save the value**

In the save handler, include `shipping.tiers` in the payload alongside `shipping.methods` and `shipping.free_methods`, following the exact shape the existing shipping keys use.

- [ ] **Step 5: Verify in a real runtime**

Run: `npm run preview:dev`
Then: open `/admin/settings`, go to the Shipping tab, set the three tiers to test values (8 / 14 / 22), save, reload, and confirm the values persisted. Then add 10 boxes to a cart and confirm checkout quotes $8.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add app/admin/settings/page.tsx
git commit -m "goob: edit quantity shipping tiers from the admin settings page"
```

---

## Task 9: Turn off subscriptions on the storefront

Gate, don't delete. Subscriptions are a named Mercora upstreaming target and the hardest-to-reconstruct part of the preserved `v1.0.0` baseline, so the code stays and only the entry point is hidden. `/subscribe/*` is already fail-closed in production — `POST /api/subscriptions` rejects any plan without a `stripe_price_id`, and live Stripe subscription prices were deliberately never configured.

**Files:**
- Modify: `app/product/[slug]/page.tsx` (read the flag server-side)
- Modify: `app/product/[slug]/ProductDisplay.tsx:401` (conditional render)

**Interfaces:**
- Consumes: `getSaleRules` from `@/lib/sale/settings` (the server component only — `ProductDisplay` receives a plain boolean prop and must not import it).
- Produces: `ProductDisplay` accepts a new `subscriptionsEnabled?: boolean` prop, defaulting to `false`.

- [ ] **Step 1: Pass the flag from the server component**

In `app/product/[slug]/page.tsx`, add `import { getSaleRules } from '@/lib/sale/settings';`, resolve it alongside the existing product fetch, and pass it down:

```tsx
  const { subscriptionsEnabled } = await getSaleRules();
```

Add `subscriptionsEnabled={subscriptionsEnabled}` to the `<ProductDisplay />` invocation.

- [ ] **Step 2: Gate the toggle**

In `ProductDisplay.tsx`, add `subscriptionsEnabled = false` to the component's props with that default, then wrap the existing `<SubscriptionToggle ... />` at line 401:

```tsx
                {subscriptionsEnabled && (
                  <SubscriptionToggle
                    /* existing props unchanged */
                  />
                )}
```

Defaulting to `false` matters: a caller that forgets the prop hides the toggle rather than showing it.

- [ ] **Step 3: Check that nothing else pitches subscriptions**

Run:

```bash
grep -rn -i "subscri" lib/ai/deterministic-answers.ts lib/mcp/tools/ components/HeaderClient.tsx app/page.tsx
```

Expected: no customer-facing copy offering a subscription. If any is found, remove or gate it in this commit and note it in the message. Matches in `lib/mcp/tools/order.ts` that only *read* existing subscription orders are fine and should be left alone.

- [ ] **Step 4: Verify in a real runtime**

Run: `npm run preview:dev`
Then: open any product page and confirm no subscription option renders, and that adding to cart still works.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add app/product/\[slug\]/page.tsx app/product/\[slug\]/ProductDisplay.tsx
git commit -m "goob: hide the subscription toggle behind sale.subscriptions_enabled

Routes, handlers, and schema are left intact — subscriptions are a named
upstreaming target and the flow is already fail-closed in production
(no plan carries a stripe_price_id)."
```

---

## Task 10: The repricing script

Sets every active variant to the flat per-box rate and preserves the true pre-sale price as `compare_at_price`, which makes the strikethrough render on the PDP, catalog cards, and Chai's product cards with no code change.

The baseline file is what makes re-running safe. Without it, a second run would set compare-at to the already-discounted price and the "original" would ratchet down each time.

The pure planning function is exported and unit-tested, following `scripts/d1-migrate.mjs` / `tests/unit/scripts/d1-migrate-plan.test.ts`. `vitest.config.ts` excludes `scripts/**` from *coverage*, not from testing.

**Files:**
- Create: `scripts/goob-reprice.mjs`
- Test: `tests/unit/scripts/goob-reprice-plan.test.ts`
- Create at runtime: `data/goob/price-baseline.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `planReprice({ variants, rate, baseline }): { plan: Array<{ id, priceMinor, compareAtMinor }>, baseline: Record<string, number> }` — exported from the script for testing. `rate` is major-unit dollars; both returned amounts are integer **minor** units.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scripts/goob-reprice-plan.test.ts`:

```ts
/**
 * The repricing planner (GOOB).
 *
 * The baseline file is the whole point. `compare_at_price` must always hold the
 * genuine PRE-SALE price, so re-running at a different rate has to read the
 * original from the baseline rather than from whatever price is currently on the
 * variant — otherwise each run would ratchet the "original" downward and the
 * strikethrough would quietly become a lie.
 *
 * Pure-function test with no D1: same shape as `d1-migrate-plan.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { planReprice } from '../../../scripts/goob-reprice.mjs';

const VARIANTS = [
  { id: 'var-morning', price: { amount: 2400, currency: 'USD' }, compare_at_price: null },
  { id: 'var-evening', price: { amount: 2400, currency: 'USD' }, compare_at_price: null },
];

describe('planReprice — first run', () => {
  it('sets every variant to the per-box rate', () => {
    const { plan } = planReprice({ variants: VARIANTS, rate: 2, baseline: {} });

    expect(plan).toEqual([
      { id: 'var-morning', priceMinor: 200, compareAtMinor: 2400 },
      { id: 'var-evening', priceMinor: 200, compareAtMinor: 2400 },
    ]);
  });

  it('captures the pre-sale prices into a new baseline', () => {
    const { baseline } = planReprice({ variants: VARIANTS, rate: 2, baseline: {} });

    expect(baseline).toEqual({ 'var-morning': 2400, 'var-evening': 2400 });
  });
});

describe('planReprice — re-run at a different rate', () => {
  it('reprices from the baseline, not from the discounted price', () => {
    const discounted = [
      { id: 'var-morning', price: { amount: 200, currency: 'USD' }, compare_at_price: { amount: 2400, currency: 'USD' } },
    ];

    const { plan } = planReprice({
      variants: discounted,
      rate: 3,
      baseline: { 'var-morning': 2400 },
    });

    expect(plan).toEqual([{ id: 'var-morning', priceMinor: 300, compareAtMinor: 2400 }]);
  });

  it('never lets the baseline ratchet downward', () => {
    const discounted = [
      { id: 'var-morning', price: { amount: 200, currency: 'USD' }, compare_at_price: { amount: 2400, currency: 'USD' } },
    ];

    const { baseline } = planReprice({
      variants: discounted,
      rate: 3,
      baseline: { 'var-morning': 2400 },
    });

    expect(baseline['var-morning']).toBe(2400);
  });

  it('adopts an existing compare_at_price as the baseline for a variant it has never seen', () => {
    // clearly-calendula-sample-pack-on-sale may already carry a compare-at from a
    // prior promotion. That value is the real pre-sale price, not the current one.
    const preexisting = [
      { id: 'var-promo', price: { amount: 1800, currency: 'USD' }, compare_at_price: { amount: 2400, currency: 'USD' } },
    ];

    const { plan, baseline } = planReprice({ variants: preexisting, rate: 2, baseline: {} });

    expect(baseline['var-promo']).toBe(2400);
    expect(plan).toEqual([{ id: 'var-promo', priceMinor: 200, compareAtMinor: 2400 }]);
  });
});

describe('planReprice — bad input', () => {
  it('throws on a non-positive rate rather than zeroing the catalog', () => {
    expect(() => planReprice({ variants: VARIANTS, rate: 0, baseline: {} })).toThrow(/rate/i);
    expect(() => planReprice({ variants: VARIANTS, rate: -1, baseline: {} })).toThrow(/rate/i);
  });

  it('skips a variant with no usable price rather than pricing it at zero', () => {
    const broken = [{ id: 'var-broken', price: null, compare_at_price: null }];

    expect(planReprice({ variants: broken, rate: 2, baseline: {} }).plan).toEqual([]);
  });

  it('rounds a fractional rate to whole cents', () => {
    const { plan } = planReprice({ variants: [VARIANTS[0]], rate: 2.005, baseline: {} });

    expect(plan[0].priceMinor).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/scripts/goob-reprice-plan.test.ts`
Expected: FAIL — cannot resolve `scripts/goob-reprice.mjs`.

- [ ] **Step 3: Implement the planner and the script**

Create `scripts/goob-reprice.mjs`:

```js
#!/usr/bin/env node
/**
 * Reprice the catalog for the going-out-of-business sale.
 *
 *   node scripts/goob-reprice.mjs --rate 2.00 [--dry-run]
 *   D1_REMOTE=true node scripts/goob-reprice.mjs --rate 2.00
 *
 * Every remaining SKU is one box, so every active variant is set to the flat
 * per-box rate, with its genuine PRE-SALE price kept as compare_at_price so the
 * strikethrough on the PDP, the catalog cards, and Chai's product cards is true.
 *
 * `data/goob/price-baseline.json` is written on first run and read on every run
 * after. Re-running at a different rate therefore reprices from the ORIGINAL
 * price, not from the already-discounted one — without it the "original" would
 * ratchet downward on each run.
 *
 * Amounts are stored as integer MINOR units, per lib/money.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

const BASELINE_PATH = 'data/goob/price-baseline.json';

/**
 * Pure planner — exported for unit testing.
 *
 * @param {{ variants: Array<{id: string, price: any, compare_at_price: any}>, rate: number, baseline: Record<string, number> }} args
 * @returns {{ plan: Array<{id: string, priceMinor: number, compareAtMinor: number}>, baseline: Record<string, number> }}
 */
export function planReprice({ variants, rate, baseline }) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`--rate must be a positive number of dollars, got: ${rate}`);
  }

  const priceMinor = Math.round(rate * 100);
  const nextBaseline = { ...baseline };
  const plan = [];

  for (const variant of variants) {
    // An existing compare_at_price is the real pre-sale price for a variant we
    // have never recorded — a prior promotion already moved `price` down.
    const recorded = nextBaseline[variant.id];
    const preSaleMinor =
      recorded ??
      (variant.compare_at_price?.amount ?? variant.price?.amount);

    if (typeof preSaleMinor !== 'number' || !Number.isFinite(preSaleMinor)) continue;

    nextBaseline[variant.id] = preSaleMinor;
    plan.push({ id: variant.id, priceMinor, compareAtMinor: preSaleMinor });
  }

  return { plan, baseline: nextBaseline };
}

function d1(sql) {
  const args = [
    'wrangler', 'd1', 'execute',
    process.env.D1_REMOTE === 'true' ? 'beauteas-db' : 'beauteas-db-dev',
    process.env.D1_REMOTE === 'true' ? '--remote' : '--local',
    '--json', '--command', sql,
  ];
  return JSON.parse(execFileSync('npx', args, { encoding: 'utf8' }));
}

function main() {
  const rateArg = process.argv[process.argv.indexOf('--rate') + 1];
  const rate = Number(rateArg);
  const dryRun = process.argv.includes('--dry-run');

  const rows = d1(
    `SELECT v.id, v.price, v.compare_at_price FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.status = 'active' AND p.status = 'active'`
  );
  const variants = (rows[0]?.results ?? []).map((r) => ({
    id: r.id,
    price: typeof r.price === 'string' ? JSON.parse(r.price) : r.price,
    compare_at_price:
      typeof r.compare_at_price === 'string'
        ? JSON.parse(r.compare_at_price)
        : r.compare_at_price,
  }));

  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : {};

  const result = planReprice({ variants, rate, baseline });

  for (const row of result.plan) {
    console.log(
      `${row.id}: ${(row.compareAtMinor / 100).toFixed(2)} -> ${(row.priceMinor / 100).toFixed(2)}`
    );
  }

  if (dryRun) {
    console.log(`\n[dry-run] ${result.plan.length} variants would change. Nothing written.`);
    return;
  }

  for (const row of result.plan) {
    d1(
      `UPDATE product_variants
       SET price = '${JSON.stringify({ amount: row.priceMinor, currency: 'USD' })}',
           compare_at_price = '${JSON.stringify({ amount: row.compareAtMinor, currency: 'USD' })}',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = '${row.id}'`
    );
  }

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(result.baseline, null, 2) + '\n');
  console.log(`\nRepriced ${result.plan.length} variants. Baseline written to ${BASELINE_PATH}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/scripts/goob-reprice-plan.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Dry-run against local D1**

Run: `node scripts/goob-reprice.mjs --rate 2.00 --dry-run`
Expected: one line per active variant showing the old and new price, then "Nothing written." Confirm the count matches the number of blends you expect, and that no bundle SKU appears (they should be archived by then — if they are still active, that is Task 13's data step, and seeing them here is expected at this point).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add scripts/goob-reprice.mjs tests/unit/scripts/goob-reprice-plan.test.ts
git commit -m "goob: add the catalog repricing script with a pre-sale baseline"
```

---

## Task 11: Make Chai agree with the sale

Today `refundWindowAnswer()` tells customers "You've got 30 days from delivery to start a return," read live from `refund.return_window_days`. Setting that to `0` would produce "You've got 0 days," so this needs a real final-sale branch.

Watch the regex design. This file carries scars from over-broad matching: the `free[-\s]shipping` lookbehind that stopped "plastic-free shipping" hitting the rate card, and the narrowed business-address patterns that stopped "Where are you from?" returning a postal address. A freshness rule must not swallow ordinary product questions.

**Files:**
- Modify: `lib/ai/deterministic-answers.ts`
- Test: `tests/unit/lib/ai/deterministic-answers.test.ts` (extend)

**Interfaces:**
- Consumes: `getSaleRules` from `@/lib/sale/settings`; `resolveShippingOptions` (already imported there).
- Produces: three new categories in the `DeterministicCategory` union — `"minimum_order"`, `"store_closing"`, `"tea_freshness"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lib/ai/deterministic-answers.test.ts`, following the file's existing mocking setup:

```ts
describe('final-sale returns answer (GOOB)', () => {
  it('states that sales are final instead of quoting a return window', async () => {
    getSaleRules.mockResolvedValue({ minimumBoxes: 10, finalSale: true, subscriptionsEnabled: false, tiers: [] });

    const answer = await resolveDeterministicAnswer('what is your return policy?');

    expect(answer).toMatch(/final/i);
    expect(answer).not.toMatch(/\d+ days/);
  });

  it('still names the damaged-or-lost exception so the policy reads as fair', async () => {
    getSaleRules.mockResolvedValue({ minimumBoxes: 10, finalSale: true, subscriptionsEnabled: false, tiers: [] });

    const answer = await resolveDeterministicAnswer('can i return this?');

    expect(answer).toMatch(/damaged|arrives? broken|never arrives/i);
  });

  it('falls back to the return window when final sale is off', async () => {
    getSaleRules.mockResolvedValue({ minimumBoxes: 10, finalSale: false, subscriptionsEnabled: false, tiers: [] });
    getRefundPolicy.mockResolvedValue({ returnWindowDays: 30 });

    expect(await resolveDeterministicAnswer('what is your return policy?')).toMatch(/30 days/);
  });
});

describe('minimum order answer (GOOB)', () => {
  it.each([
    'is there a minimum order?',
    'what is the minimum order?',
    'do i have to buy a minimum?',
    'how many boxes do i have to buy?',
  ])('answers %s with the configured minimum', async (question) => {
    getSaleRules.mockResolvedValue({ minimumBoxes: 10, finalSale: true, subscriptionsEnabled: false, tiers: [] });

    expect(await resolveDeterministicAnswer(question)).toMatch(/10 boxes/);
  });

  it('does not hijack an unrelated question about order status', async () => {
    expect(classifyDeterministicQuestion('where is my order?')).not.toBe('minimum_order');
  });
});

describe('tea freshness answer (GOOB)', () => {
  it.each([
    'how old is the tea?',
    'is the tea still fresh?',
    'is this tea expired?',
    'when does this tea expire?',
  ])('answers %s honestly about age and storage', async (question) => {
    expect(await resolveDeterministicAnswer(question)).toMatch(/sealed|airtight/i);
  });

  it('does not hijack an ordinary product question', () => {
    // The freshness rule must be narrow. These are questions the catalog and
    // retrieval answer far better than a canned line about storage.
    expect(classifyDeterministicQuestion('what is in the morning blend?')).not.toBe('tea_freshness');
    expect(classifyDeterministicQuestion('how do i brew this?')).not.toBe('tea_freshness');
    expect(classifyDeterministicQuestion('how much caffeine is in it?')).not.toBe('tea_freshness');
  });
});

describe('store closing answer (GOOB)', () => {
  it.each([
    'are you going out of business?',
    'why are you closing?',
    'is beauteas shutting down?',
  ])('answers %s and points at the closing page', async (question) => {
    expect(await resolveDeterministicAnswer(question)).toMatch(/thank-you/);
  });
});

describe('tiered shipping answer (GOOB)', () => {
  it('states the tiers and drops the free-shipping sentence', async () => {
    const answer = await resolveDeterministicAnswer('how much is shipping?');

    expect(answer).not.toMatch(/free shipping/i);
  });
});
```

Add a `vi.mock('@/lib/sale/settings', ...)` block exposing a `getSaleRules` spy, matching the shape the file already uses for `@/lib/utils/settings`. Do not mock `@/lib/sale/rules` — it is pure and should run for real.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/ai/deterministic-answers.test.ts -t "GOOB"`
Expected: FAIL — the returns answer still quotes a day count and the new categories don't exist.

- [ ] **Step 3: Add the final-sale branch**

In `lib/ai/deterministic-answers.ts`, add `import { getSaleRules } from '@/lib/sale/settings';` and rewrite `refundWindowAnswer`:

```ts
async function refundWindowAnswer(): Promise<string> {
  try {
    const { finalSale } = await getSaleRules();
    if (finalSale) {
      // Driven by the same setting the policy page reflects, so Chai and the
      // site cannot drift. Stating a return window that no longer exists is the
      // same class of failure as inventing one.
      return `We're closing up shop, so every order is final sale — no returns or exchanges on the teas 💕 That said, if your order arrives damaged or never turns up, we'll absolutely make it right. Just email ${CONTACT_EMAIL} and we'll sort it out. Full details: ${REFUND_POLICY_URL}`;
    }

    const { returnWindowDays } = await getRefundPolicy();
    return `You've got ${returnWindowDays} days from delivery to start a return 💕 Full details live on our refund policy page (${REFUND_POLICY_URL}) — and if you'd rather just ask a person, ${CONTACT_EMAIL} is the fastest way.`;
  } catch (error) {
    console.error("[chai] refund policy lookup failed:", error);
    return `Our full return policy is here: ${REFUND_POLICY_URL} — and if you'd rather ask a person, email ${CONTACT_EMAIL} 💕`;
  }
}
```

- [ ] **Step 4: Add the three new categories**

Add `"minimum_order" | "store_closing" | "tea_freshness"` to the `DeterministicCategory` union, then add these rules to the table. Place `minimum_order` and `store_closing` **before** `shipping_rates` (which is last on purpose) and `tea_freshness` after them:

```ts
  {
    category: "minimum_order",
    // Answered from `sale.minimum_boxes` in D1, so no sync `answer`.
    patterns: [
      /\bminimum (order|purchase|quantity|number)\b/i,
      /\b(order|buy|purchase) minimum\b/i,
      /\bhow many (boxes|tins|do i have to|must i)\b.{0,25}\b(buy|order|purchase)\b/i,
      /\bdo i have to buy\b.{0,20}\b(minimum|at least)\b/i,
      /\bis there a minimum\b/i,
    ],
  },
  {
    category: "store_closing",
    patterns: [
      /\b(going out of business|shutting down|shutting up shop|closing down|winding down)\b/i,
      /\bwhy (are|is)\b.{0,20}\b(you|beauteas)\b.{0,15}\bclos(ing|e)\b/i,
      /\b(are|is)\b.{0,15}\b(you|beauteas)\b.{0,15}\bclos(ing|ed)\b/i,
      /\b(last|final) chance\b.{0,20}\b(buy|order)\b/i,
    ],
    answer: () =>
      `We are, yes 💕 After a lot of thought we're closing BeauTeas for good, and everything left is going out at clearance prices. The whole story — and a very big thank-you — is here: ${SITE_URL}/thank-you`,
  },
  {
    category: "tea_freshness",
    // DELIBERATELY NARROW. The subject must be age, freshness, or expiry — an
    // earlier draft matching a bare /\bfresh\b/ swallowed "is this freshly
    // blended?" and "what's the freshest thing you have?", which retrieval and
    // the catalog answer far better than a canned line about storage.
    patterns: [
      /\bhow (old|fresh)\b.{0,20}\b(is|are)\b.{0,20}\b(the |this |your )?(tea|teas|blend|blends|stock)\b/i,
      /\b(tea|teas|blend|blends|stock)\b.{0,20}\b(expired?|expiry|expiration|out of date|past its date)\b/i,
      /\b(is|are)\b.{0,20}\b(the |this |your )?(tea|teas|blend|blends)\b.{0,20}\bstill (good|fresh|drinkable|ok|okay)\b/i,
      /\bshelf life\b/i,
      /\bwhen does\b.{0,25}\bexpire\b/i,
    ],
    answer: () =>
      `Honest answer: our remaining stock has been in sealed, airtight storage for several years 💕 It's been kept carefully and it's still lovely to drink — the aroma is a little gentler than a fresh harvest, which is part of why everything is priced the way it is. More on that here: ${SITE_URL}/thank-you`,
  },
```

- [ ] **Step 5: Wire the async answers**

In `resolveDeterministicAnswer`, alongside the existing `refund_window` and `shipping_rates` branches:

```ts
  if (category === "minimum_order") return minimumOrderAnswer();
```

And add:

```ts
/** Minimum-order answer, read from `sale.minimum_boxes` so it cannot drift. */
async function minimumOrderAnswer(): Promise<string> {
  try {
    const { minimumBoxes } = await getSaleRules();
    return `There's a ${minimumBoxes} boxes minimum on orders right now 💕 Mix and match however you like across the Morning, Afternoon and Evening blends — it all counts toward the same total. It keeps shipping affordable while we clear the last of our stock.`;
  } catch (error) {
    console.error("[chai] minimum order lookup failed:", error);
    return `There's a minimum order while we clear the last of our stock — your cart will tell you exactly how many more boxes you need 💕`;
  }
}
```

- [ ] **Step 6: Drop the free-shipping sentence when nothing is free**

In `freeShippingSentence`, return an empty string when `freeMethodIds` is empty, so the tiered rate card doesn't advertise a perk that no longer exists:

```ts
  if (!freeMethodIds || freeMethodIds.length === 0) return "";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/ai/deterministic-answers.test.ts`
Expected: PASS — including every pre-existing test. If an existing refund-window test now fails, it is asserting the pre-sale answer; update it to set `finalSale: false` rather than removing the assertion.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add lib/ai/deterministic-answers.ts tests/unit/lib/ai/deterministic-answers.test.ts
git commit -m "goob: make Chai's answers agree with the closing sale

refundWindowAnswer now branches on sale.final_sale rather than quoting a
return window that no longer exists, and adds minimum-order, closing, and
freshness answers. Freshness patterns are deliberately narrow so ordinary
product questions still reach retrieval."
```

---

## Task 12: Storefront copy

Four small changes, grouped because they are one reviewable unit: nothing should say "Coming Soon" about a sold-out product during a closing sale, the banner needs to link somewhere, checkout needs its disclosure, and the confirmation email needs the final-sale line.

**Files:**
- Modify: `components/ProductCard.tsx:206`
- Modify: `app/product/[slug]/ProductDisplay.tsx:506`
- Modify: `components/PromotionalBanner.tsx`
- Create: `components/checkout/FinalSaleNotice.tsx`
- Modify: `components/checkout/CheckoutClient.tsx`
- Modify: `lib/utils/email.ts:187`

**Interfaces:**
- Consumes: `promotions.banner_link` from Task 2.
- Produces: `<FinalSaleNotice />` — no props.

- [ ] **Step 1: Fix the sold-out copy**

In `components/ProductCard.tsx:206`, change `"Coming Soon"` to `"Sold out"`. In `app/product/[slug]/ProductDisplay.tsx:506`, change `Coming soon` to `Sold out`.

- [ ] **Step 2: Add link support to the banner**

In `components/PromotionalBanner.tsx`, read the new setting and wrap the text:

```tsx
    const bannerLink = promotionSettings['promotions.banner_link'] || '';
```

Then replace the `<p>` with:

```tsx
          {bannerLink ? (
            <Link href={bannerLink} className="text-sm font-medium underline underline-offset-2">
              {bannerText}
            </Link>
          ) : (
            <p className="text-sm font-medium">{bannerText}</p>
          )}
```

Add `import Link from "next/link";` at the top.

- [ ] **Step 3: Build the checkout notice**

Create `components/checkout/FinalSaleNotice.tsx`:

```tsx
/**
 * Final-sale and stock-age disclosure, shown at checkout.
 *
 * Deliberately a notice rather than a required checkbox: the goal is that nobody
 * is surprised, not that they are made to feel they are signing something. The
 * same facts are on /thank-you, in Chai's answers, and in the refund policy.
 */
import Link from "next/link";

export default function FinalSaleNotice() {
  return (
    <div className="rounded-lg border-l-4 border-primary-500 bg-surface-light p-4 text-sm text-text-muted">
      <p className="mb-2 font-semibold text-text-primary">
        A couple of honest notes before you order
      </p>
      <p className="mb-2">
        We&rsquo;re closing BeauTeas for good, so every order is final — no returns
        or exchanges. If something arrives damaged or never turns up, we&rsquo;ll
        still make it right, always.
      </p>
      <p>
        And our remaining stock has been in sealed, airtight storage for several
        years. It&rsquo;s been kept carefully and it&rsquo;s still lovely to drink
        — the aroma is a little gentler than a fresh harvest, which is part of why
        it&rsquo;s priced the way it is.{" "}
        <Link href="/thank-you" className="underline hover:text-text-primary">
          More about all of this here.
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Place the notice at checkout**

In `components/checkout/CheckoutClient.tsx`, render `<FinalSaleNotice />` inside the payment step, directly above the Stripe payment form, and keep it out of the confirmation step — matching how the existing policy-links block at line 512 is hidden once `currentStep === 'confirmation'`.

- [ ] **Step 5: Add the line to the order confirmation email**

In `lib/utils/email.ts`, change the line at 187 to carry the final-sale note:

```html
          <p style="color: #64748b; font-size: 16px; line-height: 24px; margin: 0 0 16px;">Thank you for your order — truly. Your teas are being prepared and will be shipped soon. As part of our closing sale this order is final sale, but if anything arrives damaged or goes missing we'll still make it right.</p>
```

- [ ] **Step 6: Verify in a real runtime**

Run: `npm run preview:dev`
Then: confirm the banner links to `/thank-you`, a sold-out product reads "Sold out" on both the card and the PDP, and the notice renders on the payment step but not on confirmation.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add components/ProductCard.tsx app/product/\[slug\]/ProductDisplay.tsx \
  components/PromotionalBanner.tsx components/checkout/FinalSaleNotice.tsx \
  components/checkout/CheckoutClient.tsx lib/utils/email.ts
git commit -m "goob: sold-out copy, banner link, checkout notice, email final-sale line"
```

---

## Task 13: Content — the closing page, policy rewrite, homepage, redirects

CMS pages live in the `pages` table and are seeded by migration, as `0014`, `0016`, and `0019` did.

**Note on remote dev:** the remote dev database lacks some `0003`-seeded pages, so `UPDATE`-guarded page migrations silently no-op there. Pair every `UPDATE` with an `INSERT OR IGNORE` so the row exists to update.

**Files:**
- Create: `migrations/0026_goob_content.sql`
- Modify: `app/page.tsx` (hero copy)
- Create: `docs/goob-announcement-email.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a published page at `/thank-you`; `redirect_map` rows for the withdrawn bundle URLs.

- [ ] **Step 1: Draft the `/thank-you` copy**

Write the page body covering, in this order: the thank-you; why the store is closing (advertising costs up, shipping costs up, a soft economy for a luxury purchase — wordsmithed warmly, not as a list of grievances); what it means for customers (clearance pricing, the 10-box minimum, tiered shipping, final sale with the damaged-or-lost exception); and the stock-age note using the exact phrasing "sealed, airtight storage for several years."

Review this copy with the owner before writing the migration. It is the emotional center of the whole project and is the one deliverable here that is not mechanically verifiable.

- [ ] **Step 2: Write the content migration**

Create `migrations/0026_goob_content.sql` following the structure of `migrations/0016_rewrite_legal_pages.sql`:

```sql
-- 0026_goob_content.sql
--
-- Content for the going-out-of-business sale: the /thank-you page, the
-- final-sale rewrite of the refund policy, and 301s for the withdrawn bundle
-- SKUs.
--
-- Every page write is INSERT OR IGNORE followed by UPDATE. The remote dev
-- database is missing some 0003-seeded pages, so an UPDATE-only data migration
-- silently no-ops there while reporting success.

INSERT OR IGNORE INTO pages (slug, title, content, status, created_at, updated_at)
VALUES ('thank-you', 'Thank You', '', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE pages
SET title = 'Thank You',
    content = '<!-- approved copy from Step 1 -->',
    status = 'published',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'thank-you';

UPDATE pages
SET content = '<!-- final-sale refund policy: all sales final, damaged or lost still made right -->',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = 'refund-policy';

INSERT OR IGNORE INTO redirect_map (source_path, target_path, status_code)
VALUES
  ('/product/clearly-calendula-sample-pack', '/thank-you', 301),
  ('/product/clearly-calendula-sample-pack-on-sale', '/thank-you', 301),
  ('/product/clearly-calendula-full-package', '/thank-you', 301);
```

Verify the `pages` and `redirect_map` column names against `lib/db/schema/pages.ts` and `lib/db/schema/redirect-map.ts` before running — match them exactly rather than trusting the shape above. Confirm the three product slugs against the live catalog; `data/d1/seed.sql` is thin and the real catalog has more products than it does.

- [ ] **Step 3: Apply and verify locally**

Run: `npx wrangler d1 execute beauteas-db-dev --local --file migrations/0026_goob_content.sql`
Then: `npm run preview:dev` and confirm `/thank-you` renders the copy, `/refund-policy` shows the final-sale text, and a withdrawn product URL 301s to `/thank-you`.

- [ ] **Step 4: Replace the homepage hero**

In `app/page.tsx`, rewrite the hero heading and description to lead with the closing story and link to `/thank-you`. Keep the three featured blends below it — they are the thing being sold. The existing `isPubliclyPurchasableProduct` filter already drops the withdrawn bundles, so no change is needed there.

- [ ] **Step 5: Draft the announcement email**

Create `docs/goob-announcement-email.md` with a subject line and body in the same voice: the thank-you first, the closing second, the practical details last (clearance pricing, minimum, final sale, aged stock, link to `/thank-you`). No send path is built — the real customer list lives in Shopify, not in the fresh production database.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add migrations/0026_goob_content.sql app/page.tsx docs/goob-announcement-email.md
git commit -m "goob: closing page, final-sale policy, homepage hero, withdrawal redirects"
```

---

## Task 14: Documentation and the production rollout

**Files:**
- Modify: `docs/cutover-status.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the project docs**

In `docs/cutover-status.md`, replace the status paragraph to describe the store's sale state and note that the DNS switch now follows the sale going live. In `CLAUDE.md`, update the status blockquote at the top and add `sale.*` and `shipping.tiers` to the settings the reader should know about.

- [ ] **Step 2: Run the full local gate**

```bash
npm run lint
npx tsc --noEmit
npm test
```

Expected: all three clean. Do not proceed to production with any failure.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/cutover-status.md CLAUDE.md
git commit -m "goob: document the sale state"
```

- [ ] **Step 4: Check what is about to land on production**

Run: `npm run db:migrate:status:production`
Expected: `0025` and `0026` listed as pending, nothing unexpected. The deploy hook applies them with a pre-flight R2 backup before the build.

- [ ] **Step 5: Deploy**

Run: `npm run deploy:production > /tmp/goob-deploy.log 2>&1; tail -40 /tmp/goob-deploy.log`

Never pipe a deploy through `head` or `grep` — a SIGPIPE has previously killed wrangler mid-deploy, leaving migrations applied and the Worker not uploaded. Confirm the log contains both "Uploaded" and a "Current Version ID".

- [ ] **Step 6: Set the tier prices**

In `/admin/settings` → Shipping, enter the three tier costs from your box weighing. Save, then reload to confirm they persisted.

- [ ] **Step 7: Withdraw the bundles and reprice**

In `/admin/products`, set `clearly-calendula-sample-pack`, `clearly-calendula-sample-pack-on-sale`, and `clearly-calendula-full-package` to **archived**. Confirm each PDP now 404s and each redirects.

Then recount inventory per blend and enter it, and run:

```bash
D1_REMOTE=true node scripts/goob-reprice.mjs --rate 2.00 --dry-run
D1_REMOTE=true node scripts/goob-reprice.mjs --rate 2.00
```

Review the dry-run output before the real run. Commit the resulting `data/goob/price-baseline.json`.

- [ ] **Step 8: Turn on the banner**

In `/admin/settings` → Promotions, enable the banner, set its text, and confirm it links to `/thank-you`.

- [ ] **Step 9: Reindex the knowledge base**

Reindex Vectorize so `/thank-you`, the FAQ, and the rewritten refund policy are retrievable. Follow the indexing procedure in `docs/ai-chai.md`.

- [ ] **Step 10: Verify the sale end to end on production**

On `shop.beauteas.com`: add 6 boxes and confirm the cart blocks checkout with the prompt; add 4 more and confirm checkout opens; confirm shipping quotes the tier-1 price; confirm the final-sale notice renders at payment; place one real order and confirm the confirmation email carries the final-sale line. Ask Chai "what's your return policy", "how much is shipping", "is there a minimum order", "how old is the tea", and "why are you closing" — every answer must agree with the site.

- [ ] **Step 11: Then, and only then, the DNS switch**

Proceed to runbook Phase 10.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: catalog simplification → 1, 10, 13; settings → 2; sale rules → 3; tiered shipping → 4, 5; minimum enforcement → 6, 7; admin editor → 8; subscriptions → 9; repricing → 10; Chai → 11; content and disclosure → 12, 13; testing and rollout → every task's test steps plus 14. The spec's operational items (inventory recount, box weighing, breaking down pre-assembled bundles) appear in Task 14 steps 6–7.

**Two items carry deliberate judgment calls rather than fixed content:**
- Task 13 Step 1 requires owner review of the `/thank-you` copy before the migration is written. This is not a placeholder — the surrounding constraints (order of sections, required phrasings, voice) are specified; only the prose itself is authored in the task.
- Task 2 seeds tier costs at `0` by design, set in admin at Task 14 Step 6. Documented as a decision, with the reasoning.

**Client/server boundary.** `lib/sale/rules.ts` is pure and is the only sale module the cart drawer and checkout page import; `getSaleRules` lives in `lib/sale/settings.ts` because `getSettings` reaches `lib/db` → `getCloudflareContext` and the Drizzle schema barrel. Task 3 Step 7 asserts the pure module has no runtime imports. Tasks 5, 6, 9, and 11 import `getSaleRules` from `@/lib/sale/settings`; Task 7's client components import only from `@/lib/sale/rules`.

**Type consistency.** `countBoxes`, `checkMinimumOrder`, `resolveShippingTier`, `minimumOrderMessage`, `getSaleRules`, `ShippingTier`, and `SaleRules` are defined in Task 3 and used with identical names and signatures in Tasks 4, 5, 6, 7, 9, and 11. `isActiveStatus` / `isSellableVariant` / `isPubliclyPurchasableProduct` are defined in Task 1 and used in Task 10's SQL predicate. `resolveShippingOptions`'s new `boxes` option (Task 4) matches its consumers in Task 5. `planReprice`'s return shape matches its test.

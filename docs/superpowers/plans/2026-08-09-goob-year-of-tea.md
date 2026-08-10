# A Year of Tea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the closing sale a per-blend "Make it a year" CTA (36 boxes = 360 cups) and live boxes-remaining counts, so orders get bigger than the 10-box minimum.

**Architecture:** One pure module (`lib/sale/year-supply.ts`) owns all box math and stock reading; two small components consume it; counts render server-side from data the pages already fetch. A raw-SQL migration writes the 10-bags-per-box fact into the FAQ and blend descriptions so both customers and Chai's vector index can reach it, and a new deterministic answer keeps Chai from guessing.

**Tech Stack:** Next.js App Router on Cloudflare Workers (OpenNext), Drizzle over D1, Zustand cart store, Vitest + jsdom, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-09-goob-year-of-tea-design.md`

## Global Constraints

- **Never write raw `*100` / `/100`.** All money flows through `lib/money` (`Money.fromMinor`, `.format()`). Multiplying an integer minor-unit price by a box count is fine; converting between major and minor by hand is not. See CLAUDE.md.
- **`lib/sale/year-supply.ts` must stay pure.** No runtime imports (no `lib/db`, no `getCloudflareContext`, no settings reads). Client components import it. This mirrors the contract documented at the top of `lib/sale/rules.ts`.
- **No em dashes (U+2014) in any customer-facing content.** Migration `0027` swept them and has already run; it will not clean up after new content. Grep every migration and copy string for the character before committing.
- **The next migration number is `0030`.** `0011`-`0029` are taken. Never renumber an applied migration.
- **Migrations must be idempotent** — guarded so a second application is a no-op.
- **Run `npm run lint` before considering any task done.**
- **No hardcoded dollar amounts in copy.** Every figure derives from the live variant price; `scripts/goob-reprice.mjs` is designed to run more than once.
- Unit tests live in `tests/unit/**/*.test.{ts,tsx}` and are the only suite CI gates.

---

### Task 1: The pure box-math module

**Files:**
- Create: `lib/sale/year-supply.ts`
- Test: `tests/unit/lib/sale/year-supply.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `CUPS_PER_BOX: number`, `YEAR_SUPPLY_BOXES: number`, `boxesLeft(variant: StockVariant | null | undefined): number | null`, `yearSupplyOffer(left: number | null, alreadyInCart: number): YearSupplyOffer | null`, `type YearSupplyOffer = { boxes: number; kind: 'year' | 'rest' }`, `type StockVariant = { inventory?: { quantity?: unknown; track_inventory?: unknown; allow_backorder?: unknown } | null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/sale/year-supply.test.ts`:

```ts
/**
 * Box math for the closing sale. A box is 10 tea bags, so 36 boxes is a year at
 * a cup a day - the cadence the store's own subscriptions ran at (3 boxes a
 * month of one blend).
 *
 * `boxesLeft` returning null rather than 0 is the load-bearing part. Two other
 * readers already treat untracked inventory as unlimited (`isVariantAvailable`
 * in lib/db/schema/products.ts, `hasAvailableStock` in
 * lib/recommendations/blend.ts); a third that ignored those flags would print
 * "0 boxes left" on a variant that is actually purchasable.
 */
import { describe, it, expect } from 'vitest';
import {
  CUPS_PER_BOX,
  YEAR_SUPPLY_BOXES,
  boxesLeft,
  yearSupplyOffer,
} from '@/lib/sale/year-supply';

describe('constants', () => {
  it('pins a box at 10 cups and a year at 36 boxes', () => {
    expect(CUPS_PER_BOX).toBe(10);
    expect(YEAR_SUPPLY_BOXES).toBe(36);
    expect(YEAR_SUPPLY_BOXES * CUPS_PER_BOX).toBe(360);
  });
});

describe('boxesLeft', () => {
  it('reads a tracked quantity', () => {
    expect(boxesLeft({ inventory: { quantity: 250, track_inventory: true } })).toBe(250);
  });

  it('treats a missing track_inventory flag as tracked', () => {
    expect(boxesLeft({ inventory: { quantity: 42 } })).toBe(42);
  });

  it.each([
    ['no variant', null],
    ['undefined variant', undefined],
    ['no inventory record', {}],
    ['null inventory', { inventory: null }],
  ])('returns null when there is nothing to read (%s)', (_label, variant) => {
    expect(boxesLeft(variant as never)).toBeNull();
  });

  it('returns null for untracked inventory - unlimited, not zero', () => {
    expect(boxesLeft({ inventory: { quantity: 0, track_inventory: false } })).toBeNull();
  });

  it('returns null when backorder is allowed - never runs out', () => {
    expect(boxesLeft({ inventory: { quantity: 0, allow_backorder: true } })).toBeNull();
  });

  it('clamps a negative quantity to zero rather than reporting it', () => {
    expect(boxesLeft({ inventory: { quantity: -5, track_inventory: true } })).toBe(0);
  });

  it('returns null for a non-numeric quantity rather than NaN', () => {
    expect(boxesLeft({ inventory: { quantity: 'lots' } })).toBeNull();
  });

  it('floors a fractional quantity', () => {
    expect(boxesLeft({ inventory: { quantity: 12.9 } })).toBe(12);
  });
});

describe('yearSupplyOffer', () => {
  it('offers a full year when 36 or more are available', () => {
    expect(yearSupplyOffer(36, 0)).toEqual({ boxes: 36, kind: 'year' });
    expect(yearSupplyOffer(600, 0)).toEqual({ boxes: 36, kind: 'year' });
  });

  it('offers the remainder between 1 and 35', () => {
    expect(yearSupplyOffer(35, 0)).toEqual({ boxes: 35, kind: 'rest' });
    expect(yearSupplyOffer(24, 0)).toEqual({ boxes: 24, kind: 'rest' });
    expect(yearSupplyOffer(1, 0)).toEqual({ boxes: 1, kind: 'rest' });
  });

  it('subtracts what the cart already holds', () => {
    // 40 in stock, 10 already in the cart: a full year no longer fits, so offer
    // the 30 that do. Without this a second click queues 72 boxes against 40 and
    // /api/payment-intent rejects the whole cart at checkout.
    expect(yearSupplyOffer(40, 10)).toEqual({ boxes: 30, kind: 'rest' });
    expect(yearSupplyOffer(100, 10)).toEqual({ boxes: 36, kind: 'year' });
  });

  it('offers nothing when the cart already covers the stock', () => {
    expect(yearSupplyOffer(20, 20)).toBeNull();
    expect(yearSupplyOffer(20, 25)).toBeNull();
  });

  it('offers nothing at zero stock or when the count is unknown', () => {
    expect(yearSupplyOffer(0, 0)).toBeNull();
    expect(yearSupplyOffer(null, 0)).toBeNull();
  });

  it('treats a non-finite cart quantity as an empty cart', () => {
    expect(yearSupplyOffer(100, Number.NaN)).toEqual({ boxes: 36, kind: 'year' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/sale/year-supply.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sale/year-supply"`.

- [ ] **Step 3: Write the implementation**

Create `lib/sale/year-supply.ts`:

```ts
/**
 * === Year-supply box math (pure) ===
 *
 * The SINGLE source for how boxes translate into time and into a one-click
 * offer. A box is 10 tea bags, so 36 boxes is a year at a cup a day - which is
 * not an invented round number, it is the cadence the store's own subscriptions
 * ran at (3 boxes a month of a single blend).
 *
 * PURE ON PURPOSE - do not add a runtime import here, for the same reason
 * `lib/sale/rules.ts` carries the same warning: the PDP and catalog cards pull
 * this into a client bundle, and a `lib/db` import drags getCloudflareContext
 * and the whole Drizzle schema barrel in with it.
 *
 * No money lives in this module. Every dollar figure is formatted by the
 * caller from the live variant price, because `scripts/goob-reprice.mjs` is
 * built to run more than once (data/goob/price-baseline.json makes a second
 * markdown safe) and a constant here would outlive the price it described.
 */

/** Tea bags in a box, and therefore cups. */
export const CUPS_PER_BOX = 10;

/** Boxes in a year at a cup a day: 3 a month, the old subscription cadence. */
export const YEAR_SUPPLY_BOXES = 36;

/** The inventory shape this module reads. Structural, so any variant fits. */
export interface StockVariant {
  inventory?: {
    quantity?: unknown;
    track_inventory?: unknown;
    allow_backorder?: unknown;
  } | null;
}

/**
 * Boxes on hand, or `null` meaning "no count to show".
 *
 * `null` covers every case where a number would be misleading rather than
 * merely absent: no inventory record, `track_inventory === false`, or
 * `allow_backorder` - all of which mean unlimited to the two readers that
 * already exist (`isVariantAvailable` in lib/db/schema/products.ts,
 * `hasAvailableStock` in lib/recommendations/blend.ts). Rendering "0 boxes
 * left" for an untracked variant would be worse than rendering nothing.
 *
 * A negative quantity (reachable through the backorder path in
 * lib/services/inventory-adjustment.ts) clamps to 0 rather than displaying.
 */
export function boxesLeft(variant: StockVariant | null | undefined): number | null {
  const inventory = variant?.inventory;
  if (!inventory) return null;
  if (inventory.track_inventory === false) return null;
  if (inventory.allow_backorder === true) return null;

  const quantity = inventory.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return null;

  return Math.max(0, Math.floor(quantity));
}

export type YearSupplyOffer = { boxes: number; kind: 'year' | 'rest' };

/**
 * What the "Make it a year" button should offer, or `null` for "do not render".
 *
 * `alreadyInCart` is subtracted first. Without it a second click queues 72
 * boxes against 40 in stock; `/api/payment-intent`'s availability gate catches
 * that, but at checkout, which is a bad place to discover it.
 */
export function yearSupplyOffer(
  left: number | null,
  alreadyInCart: number
): YearSupplyOffer | null {
  if (left === null) return null;

  const inCart = Number.isFinite(alreadyInCart) ? Math.max(0, alreadyInCart) : 0;
  const available = left - inCart;
  if (available <= 0) return null;

  return available >= YEAR_SUPPLY_BOXES
    ? { boxes: YEAR_SUPPLY_BOXES, kind: 'year' }
    : { boxes: available, kind: 'rest' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/sale/year-supply.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add lib/sale/year-supply.ts tests/unit/lib/sale/year-supply.test.ts
git commit -m "goob: add the pure year-supply box math"
```

---

### Task 2: The boxes-left readout, on catalog cards

**Files:**
- Create: `components/sale/BoxesLeft.tsx`
- Modify: `components/ProductCard.tsx` (the availability block around line 91)
- Test: `tests/unit/components/boxes-left.test.tsx`

**Interfaces:**
- Consumes: `boxesLeft` from Task 1.
- Produces: `BoxesLeft` default export, props `{ boxes: number | null; className?: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/boxes-left.test.tsx`:

```tsx
/**
 * The scarcity readout. Renders NOTHING for an unknown count, because
 * `boxesLeft` returns null for untracked and backorder-allowed variants where a
 * number would be a lie rather than an omission.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BoxesLeft from '@/components/sale/BoxesLeft';

describe('BoxesLeft', () => {
  it('states the count', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={250} />)).toContain('250 boxes left');
  });

  it('uses the singular for one', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={1} />)).toContain('1 box left');
  });

  it('groups thousands so a four-digit count stays readable', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={1232} />)).toContain('1,232 boxes left');
  });

  it('says sold out at zero, never "Backordered"', () => {
    const html = renderToStaticMarkup(<BoxesLeft boxes={0} />);
    expect(html).toContain('Sold out');
    expect(html).not.toContain('Backorder');
  });

  it('renders nothing when the count is unknown', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={null} />)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/boxes-left.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/sale/BoxesLeft"`.

- [ ] **Step 3: Write the component**

Create `components/sale/BoxesLeft.tsx`:

```tsx
/**
 * Boxes-remaining readout for the closing sale.
 *
 * Renders nothing on a null count. `boxesLeft` (lib/sale/year-supply.ts)
 * returns null for untracked / backorder-allowed variants, where any number
 * would misrepresent stock rather than merely omit it.
 *
 * Zero reads as sold out, NOT "Backordered" - the wording this replaced on the
 * PDP. Nothing is being restocked; the shop is closing.
 */
interface BoxesLeftProps {
  boxes: number | null;
  className?: string;
}

export default function BoxesLeft({ boxes, className }: BoxesLeftProps) {
  if (boxes === null) return null;

  if (boxes === 0) {
    return <p className={className ?? 'text-xs font-semibold text-text-muted'}>Sold out</p>;
  }

  const noun = boxes === 1 ? 'box' : 'boxes';
  return (
    <p className={className ?? 'text-xs font-semibold text-state-warning'}>
      {boxes.toLocaleString('en-US')} {noun} left
    </p>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/boxes-left.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the catalog card**

In `components/ProductCard.tsx`, replace the availability block (currently `const quantityInStock = defaultVariant?.inventory?.quantity ?? 0;` and the `availability` line that follows it) with:

```tsx
  // Availability logic. `boxesLeft` (not `?? 0`) so an untracked or
  // backorder-allowed variant reads as unlimited rather than sold out - the
  // same semantics isVariantAvailable and hasAvailableStock already use.
  const boxes = boxesLeft(defaultVariant);
  const availability = boxes === 0 ? "coming_soon" : "available";
```

Add the import alongside the existing ones at the top of the file:

```tsx
import { boxesLeft } from "@/lib/sale/year-supply";
import BoxesLeft from "@/components/sale/BoxesLeft";
```

Then render `<BoxesLeft boxes={boxes} />` directly beneath the price block in the card body.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. `tests/unit/components/product-card-anchor-nesting.test.tsx` must still pass — `BoxesLeft` renders a `<p>`, never an anchor, so the one-anchor invariant holds.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add components/sale/BoxesLeft.tsx components/ProductCard.tsx tests/unit/components/boxes-left.test.tsx
git commit -m "goob: show boxes remaining on catalog cards"
```

---

### Task 3: Replace the PDP stock line

**Files:**
- Modify: `app/product/[slug]/ProductDisplay.tsx` (two blocks, currently near lines 454 and 472)
- Test: `tests/unit/components/product-display-boxes-left.test.tsx`

**Interfaces:**
- Consumes: `boxesLeft` (Task 1), `BoxesLeft` (Task 2).
- Produces: nothing new.

The PDP renders `{quantityInStock > 0 ? \`${quantityInStock} in stock\` : "Backordered"}` in **two** places, both gated on `selectedVariant?.inventory`. Both are replaced. Leaving either produces "250 in stock" next to "Only 250 boxes left".

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/product-display-boxes-left.test.tsx`, following the mocking pattern in the existing `tests/unit/components/product-display-withdrawn-variant.test.tsx` (read that file first and mirror its mocks — it already stubs whatever `ProductDisplay` needs from the Next runtime and the stores). Assert:

```tsx
  it('shows the closing-sale box count, not the old stock line', async () => {
    const html = renderToStaticMarkup(<ProductDisplay product={makeProduct({ quantity: 250 })} />);
    expect(html).toContain('250 boxes left');
    expect(html).not.toContain('in stock');
  });

  it('never says Backordered when stock is gone', async () => {
    const html = renderToStaticMarkup(<ProductDisplay product={makeProduct({ quantity: 0 })} />);
    expect(html).not.toContain('Backordered');
    expect(html).toContain('Sold out');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/product-display-boxes-left.test.tsx`
Expected: FAIL — the markup still contains "in stock".

- [ ] **Step 3: Replace both blocks**

Replace each of the two occurrences of:

```tsx
                {selectedVariant?.inventory && (
                  <p className="text-xs text-text-muted">
                    {quantityInStock > 0 ? `${quantityInStock} in stock` : "Backordered"}
                  </p>
                )}
```

with:

```tsx
                <BoxesLeft boxes={boxesLeft(selectedVariant)} />
```

The `selectedVariant?.inventory &&` guard is no longer needed: `boxesLeft` returns null without an inventory record and `BoxesLeft` renders nothing on null.

Add the imports at the top of the file:

```tsx
import { boxesLeft } from "@/lib/sale/year-supply";
import BoxesLeft from "@/components/sale/BoxesLeft";
```

Leave `quantityInStock` and `available` (line 191-192) in place — other logic on the page reads them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/product-display-boxes-left.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint, full suite, commit**

```bash
npm run lint && npm test
git add app/product/\[slug\]/ProductDisplay.tsx tests/unit/components/product-display-boxes-left.test.tsx
git commit -m "goob: replace the PDP stock line with the box count"
```

---

### Task 4: The "Make it a year" button

**Files:**
- Create: `components/sale/YearSupplyButton.tsx`
- Modify: `app/product/[slug]/ProductDisplay.tsx` (beneath the Add to Cart control)
- Test: `tests/unit/components/year-supply-button.test.tsx`

**Interfaces:**
- Consumes: `boxesLeft`, `yearSupplyOffer`, `CUPS_PER_BOX` (Task 1); `useCartStore` from `@/lib/stores/cart-store`.
- Produces: `YearSupplyButton` default export, props `{ variant: ProductVariant; productId: string; name: string; imageUrl: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/year-supply-button.test.tsx`:

```tsx
/**
 * The one-click year supply. Its whole decision lives in `yearSupplyOffer`
 * (lib/sale/year-supply.ts), so this file covers the wiring: the label reflects
 * the offer, the dollar figure comes from the LIVE variant price rather than a
 * constant, and a click adds exactly the offered quantity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import YearSupplyButton from '@/components/sale/YearSupplyButton';

const addItem = vi.fn();
let cartItems: Array<{ variantId: string; quantity: number }> = [];

vi.mock('@/lib/stores/cart-store', () => ({
  useCartStore: (selector: (s: unknown) => unknown) =>
    selector({ items: cartItems, addItem }),
}));

const variant = (quantity: number) => ({
  id: 'var_morning',
  price: { amount: 300, currency: 'USD' },
  inventory: { quantity, track_inventory: true },
});

const props = (quantity: number) => ({
  variant: variant(quantity) as never,
  productId: 'prod_morning',
  name: 'Clearly Calendula Morning',
  imageUrl: '/morning.jpg',
});

beforeEach(() => {
  addItem.mockClear();
  cartItems = [];
});

describe('YearSupplyButton', () => {
  it('offers a year priced from the live variant price', () => {
    render(<YearSupplyButton {...props(373)} />);
    // 36 boxes at $3.00 = $108.00, formatted by lib/money, never hardcoded.
    expect(screen.getByRole('button').textContent).toContain('36 boxes');
    expect(screen.getByRole('button').textContent).toContain('$108.00');
  });

  it('states the cups so the year claim is checkable', () => {
    render(<YearSupplyButton {...props(373)} />);
    expect(screen.getByText(/360 cups/)).toBeTruthy();
  });

  it('adds exactly 36 boxes on click', () => {
    render(<YearSupplyButton {...props(373)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0]).toMatchObject({
      variantId: 'var_morning',
      productId: 'prod_morning',
      price: 300,
      quantity: 36,
    });
  });

  it('offers the remainder when fewer than 36 are left', () => {
    render(<YearSupplyButton {...props(24)} />);
    expect(screen.getByRole('button').textContent).toContain('last 24');
    fireEvent.click(screen.getByRole('button'));
    expect(addItem.mock.calls[0][0].quantity).toBe(24);
  });

  it('accounts for what is already in the cart', () => {
    cartItems = [{ variantId: 'var_morning', quantity: 10 }];
    render(<YearSupplyButton {...props(40)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(addItem.mock.calls[0][0].quantity).toBe(30);
  });

  it('renders nothing when sold out', () => {
    const { container } = render(<YearSupplyButton {...props(0)} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the price cannot be read', () => {
    const { container } = render(
      <YearSupplyButton {...props(373)} variant={{ id: 'v', inventory: { quantity: 373 } } as never} />
    );
    expect(container.innerHTML).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/year-supply-button.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `components/sale/YearSupplyButton.tsx`:

```tsx
'use client';

/**
 * One-click year supply for a single blend.
 *
 * The decision is entirely `yearSupplyOffer` (lib/sale/year-supply.ts), which
 * is pure and tested there; this component only renders it and dispatches one
 * addItem. It subtracts what the cart already holds, so clicking twice cannot
 * queue more boxes than exist - /api/payment-intent would reject that, but not
 * until checkout.
 *
 * The price is read from the variant every render. A constant would go stale
 * the moment scripts/goob-reprice.mjs runs again, which it is built to do.
 */
import { Money } from '@/lib/money';
import { useCartStore } from '@/lib/stores/cart-store';
import { CUPS_PER_BOX, boxesLeft, yearSupplyOffer } from '@/lib/sale/year-supply';
import type { ProductVariant } from '@/lib/types';

interface YearSupplyButtonProps {
  variant: ProductVariant;
  productId: string;
  name: string;
  imageUrl: string;
}

export default function YearSupplyButton({
  variant,
  productId,
  name,
  imageUrl,
}: YearSupplyButtonProps) {
  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);

  const alreadyInCart = (items ?? [])
    .filter((item) => item.variantId === variant?.id)
    .reduce((total, item) => total + (item.quantity ?? 0), 0);

  const offer = yearSupplyOffer(boxesLeft(variant), alreadyInCart);

  const unitAmount = variant?.price?.amount;
  const currency = variant?.price?.currency ?? 'USD';
  // No offer, or no readable price: render nothing rather than a $NaN button.
  if (!offer || typeof unitAmount !== 'number' || !Number.isFinite(unitAmount)) {
    return null;
  }

  // Integer minor units times a box count - exact, and not a major/minor
  // conversion, so lib/money's boundary rules are satisfied by formatting alone.
  const total = Money.fromMinor(unitAmount * offer.boxes, currency).format();
  const label =
    offer.kind === 'year'
      ? `Make it a year - ${offer.boxes} boxes, ${total}`
      : `Take the last ${offer.boxes} - ${total}`;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() =>
          addItem({
            variantId: variant.id,
            productId,
            name,
            price: unitAmount,
            quantity: offer.boxes,
            primaryImageUrl: imageUrl,
          })
        }
        className="w-full rounded border border-secondary-400 px-4 py-2 text-sm font-semibold text-secondary-600 transition hover:bg-secondary-400 hover:text-text-inverse"
      >
        {label}
      </button>
      <p className="mt-1 text-center text-xs text-text-muted">
        {offer.boxes * CUPS_PER_BOX} cups
        {offer.kind === 'year' ? ', one a day for a year' : ', everything we have left'}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/year-supply-button.test.tsx`
Expected: PASS, 7 tests.

If `@testing-library/react` is not already a devDependency, use `renderToStaticMarkup` for the label assertions and call the exported pure helpers directly for the click behaviour instead of adding a dependency. Check with `node -e "require.resolve('@testing-library/react')"` before writing the test.

- [ ] **Step 5: Wire it into the PDP**

In `app/product/[slug]/ProductDisplay.tsx`, render it directly beneath the existing Add to Cart button (the one near line 478 whose handler calls `useCartStore.getState().addItem`), passing the same `productId`, `name`, and image values that handler already uses:

```tsx
<YearSupplyButton
  variant={selectedVariant}
  productId={product.id}
  name={name}
  imageUrl={imageUrl}
/>
```

Import it at the top:

```tsx
import YearSupplyButton from "@/components/sale/YearSupplyButton";
```

- [ ] **Step 6: Lint, full suite, commit**

```bash
npm run lint && npm test
git add components/sale/YearSupplyButton.tsx app/product/\[slug\]/ProductDisplay.tsx tests/unit/components/year-supply-button.test.tsx
git commit -m "goob: add the one-click year supply to the PDP"
```

---

### Task 5: The homepage total

**Files:**
- Modify: `app/page.tsx` (the hero block, lines 65-86, and the fetch at line 57)

**Interfaces:**
- Consumes: `boxesLeft` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Compute the total**

`app/page.tsx` already fetches the three blends with variants at line 57. Beneath the `featuredProducts` assignment, add:

```tsx
  // Live shop total. `force-dynamic` on the root layout overrides this page's
  // `revalidate`, so every request re-renders and the number is current -
  // verified against dev, which returns `cache-control: no-store`.
  //
  // Blends whose count is unknown (untracked / backorder) contribute nothing,
  // and if NONE of them report a number the line is omitted entirely rather
  // than claiming zero boxes remain.
  const blendBoxCounts = featuredProducts
    .map((product) => boxesLeft(product.variants?.find((v) => v.id === product.default_variant_id) ?? product.variants?.[0]))
    .filter((count): count is number => count !== null);
  const totalBoxesLeft = blendBoxCounts.length > 0
    ? blendBoxCounts.reduce((sum, count) => sum + count, 0)
    : null;
```

Import at the top:

```tsx
import { boxesLeft } from "@/lib/sale/year-supply";
```

- [ ] **Step 2: Render it in the hero**

Immediately after the existing closing paragraph (the one ending "Read the whole story here."), add:

```tsx
        {totalBoxesLeft !== null && (
          <p className="text-text-primary text-base sm:text-lg font-semibold mb-6 sm:mb-8">
            {totalBoxesLeft.toLocaleString("en-US")} boxes left in the whole shop.
          </p>
        )}
```

- [ ] **Step 3: Verify against dev**

```bash
npm run deploy:dev
curl -s https://beauteas-dev.justblackmagic.workers.dev/ | grep -o "[0-9,]* boxes left in the whole shop"
```

Expected: a number matching the sum of the three blends' inventory. Cross-check with:

```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev -y \
  --command "SELECT SUM(json_extract(inventory,'\$.quantity')) FROM product_variants WHERE sku IN ('BTCCM1','BTCCA1','BTCCE1');"
```

- [ ] **Step 4: Lint, full suite, commit**

```bash
npm run lint && npm test
git add app/page.tsx
git commit -m "goob: put the shop-wide box count in the homepage hero"
```

---

### Task 6: Migration 0030 — write the box math into the content

**Files:**
- Create: `migrations/0030_goob_box_math_content.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the 10-bags-per-box fact in the `faq` page and the three blend descriptions, reachable by Chai's vector index.

Guards are on **absence of the new text**, not on a copy of the old text. That is idempotent, and it avoids the trap that the guards would otherwise have to match the post-`0026`/`0027` wording rather than the original. `json_set` + `json_extract` + `||` is confirmed working on D1.

- [ ] **Step 1: Write the migration**

Create `migrations/0030_goob_box_math_content.sql`:

```sql
-- Migration: 0030_goob_box_math_content
-- Date: 2026-08-09
--
-- The closing sale's "a year of tea is 36 boxes" framing rests on one fact that
-- is currently stored NOWHERE in this system: a box holds 10 tea bags. It is not
-- in the product descriptions, not in the CMS pages, and not on the variant
-- records. Chai therefore had no grounding for "how long does a box last?" and
-- would answer from vector context that does not contain the number.
--
-- This writes the fact into the two places that reach both a customer and the
-- vector index: the FAQ page and the three blend descriptions.
--
-- Idempotent: every UPDATE is guarded on the ABSENCE of the new text, so a
-- second application is a no-op. Guarding on absence rather than on a copy of
-- the old text also means these do not have to track 0026's and 0027's
-- rewrites of the same rows.
--
-- No em dashes (U+2014) anywhere below - 0027 swept them from customer-facing
-- content and has already run, so it will not clean up after this file.
-- Verified by grepping this file for the character before committing.

UPDATE "pages"
SET "content" = "content" ||
  '<h2>How many cups is a box?</h2>' ||
  '<p>Each box holds 10 tea bags, so a box is 10 cups. At a cup a day that is about ten days. ' ||
  'Most of our subscribers went through 3 boxes a month of their favourite blend, which is why 36 boxes works out to a year.</p>'
WHERE "slug" = 'faq'
  AND "content" NOT LIKE '%How many cups is a box%';

UPDATE "products"
SET "description" = json_set(
      "description",
      '$.en',
      json_extract("description", '$.en') || ' Each box holds 10 tea bags, so a box is 10 cups, about ten days at a cup a day.'
    )
WHERE "slug" IN (
    'clearly-calendula-morning',
    'clearly-calendula-afternoon',
    'clearly-calendula-evening'
  )
  AND json_extract("description", '$.en') NOT LIKE '%10 tea bags%';
```

- [ ] **Step 2: Verify no em dashes**

```bash
grep -c $'—' migrations/0030_goob_box_math_content.sql
```

Expected: `0`.

- [ ] **Step 3: Preview, then apply to dev**

```bash
npm run db:migrate:status:dev
npm run deploy:dev
```

Expected: status lists `0030_goob_box_math_content.sql` as pending on both dev databases; the deploy applies it after taking a backup.

- [ ] **Step 4: Verify the content and the idempotency**

```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev -y \
  --command "SELECT substr(content, -260) FROM pages WHERE slug = 'faq';"
npx wrangler d1 execute beauteas-db-dev --remote --env dev -y \
  --command "SELECT slug, substr(json_extract(description,'\$.en'), -90) FROM products WHERE slug LIKE 'clearly-calendula-%';"
```

Expected: the FAQ ends with the new section; each of the three blends ends with the new sentence, and no other product does.

Then confirm re-running is a no-op by executing the migration file's statements a second time and checking the text did not double:

```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev -y --file migrations/0030_goob_box_math_content.sql
npx wrangler d1 execute beauteas-db-dev --remote --env dev -y \
  --command "SELECT slug, length(json_extract(description,'\$.en')) FROM products WHERE slug LIKE 'clearly-calendula-%';"
```

Expected: lengths unchanged from the previous step.

- [ ] **Step 5: Commit**

```bash
git add migrations/0030_goob_box_math_content.sql
git commit -m "goob: write the ten-bags-per-box fact into the FAQ and blend copy"
```

---

### Task 7: Chai's box-math answer

**Files:**
- Modify: `lib/ai/deterministic-answers.ts` (the `DeterministicCategory` union at line 46, the `RULES` table, and `resolveDeterministicAnswer` at line 323)
- Modify: `tests/unit/lib/ai/deterministic-answers.test.ts`

**Interfaces:**
- Consumes: `CUPS_PER_BOX`, `YEAR_SUPPLY_BOXES` (Task 1).
- Produces: a new `"box_math"` member of `DeterministicCategory`.

This file has a documented history of pattern hijacks (`bcf5f1c` fixed a `minimum_order` regression and a cross-category hijack; `2be87d9` narrowed `minimum_order` and `store_closing`). The pattern goes in **narrow**, and the tests carry negative cases alongside positive ones.

**Ordering matters.** `box_math` must sit **before** `minimum_order` in `RULES` — "how many boxes should I buy?" is a box-math question, and `minimum_order`'s obligation-shaped pattern (`how many boxes ... should i ... buy`) would otherwise claim it and answer about the minimum instead.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/lib/ai/deterministic-answers.test.ts`:

```ts
describe('box_math', () => {
  it.each([
    'how long does a box last?',
    'how many cups is a box?',
    'how many tea bags are in a box?',
    'how much should I buy?',
    'how many boxes should I buy?',
    'how many boxes is a year?',
  ])('classifies %s', (question) => {
    expect(classifyQuery(question)).toBe('box_math');
  });

  it.each([
    // minimum_order owns the obligation shape - what a shopper MUST buy.
    ['do I have to buy a minimum?', 'minimum_order'],
    ['is there a minimum order?', 'minimum_order'],
    // These belong to other rules or to retrieval.
    ['how long does shipping take?', 'shipping_rates'],
    ['how old is the tea?', 'tea_freshness'],
    ['how many boxes did I order?', null],
    ['what is in the morning blend?', null],
    ['how long does the tea last once opened?', null],
  ])('does not claim %s', (question, expected) => {
    expect(classifyQuery(question)).toBe(expected);
  });

  it('answers with the box math and a price read from the catalog', async () => {
    getProductBySlug.mockResolvedValue({
      default_variant_id: 'var_morning',
      variants: [{ id: 'var_morning', price: { amount: 300, currency: 'USD' } }],
    });
    const answer = await resolveDeterministicAnswer('box_math');
    expect(answer).toContain('10 tea bags');
    expect(answer).toContain('36 boxes');
    expect(answer).toContain('$108.00');
  });

  it('omits the figure rather than guessing when the price read fails', async () => {
    getProductBySlug.mockRejectedValue(new Error('D1 unavailable'));
    const answer = await resolveDeterministicAnswer('box_math');
    expect(answer).toContain('10 tea bags');
    expect(answer).not.toContain('$');
  });

  it('omits the figure when the blend has no readable price', async () => {
    getProductBySlug.mockResolvedValue({ variants: [{ id: 'v', price: {} }] });
    const answer = await resolveDeterministicAnswer('box_math');
    expect(answer).not.toContain('$');
  });
});
```

This needs the catalog read mocked. Add alongside the file's existing `vi.mock` calls, in the same style (`@/lib/sale/rules` stays real because it is pure — the same reasoning applies to `@/lib/sale/year-supply`, which must NOT be mocked):

```ts
const getProductBySlug = vi.fn();
vi.mock('@/lib/models/mach/products', () => ({
  getProductBySlug: (...args: unknown[]) => getProductBySlug(...args),
}));
```

Reset it in the file's existing `beforeEach` with `getProductBySlug.mockReset()`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/ai/deterministic-answers.test.ts`
Expected: FAIL — `classifyQuery` returns `null` or `minimum_order` for the box-math questions.

- [ ] **Step 3: Add the category, the rule, and the answer**

Add `"box_math"` to the `DeterministicCategory` union.

Insert this rule into `RULES` **immediately before** the `minimum_order` entry:

```ts
  {
    category: "box_math",
    // Answered partly from the catalog (the per-box price), so no sync `answer`.
    //
    // DELIBERATELY NARROW, for the same reason minimum_order is: the subject
    // must be the CONTENTS or DURATION of a box, or how much to buy. A bare
    // /\bhow (long|much)\b/ would swallow shipping times and the rate card,
    // both of which have better answers elsewhere in this table.
    //
    // Placed above minimum_order on purpose. "how many boxes should I buy?"
    // matches minimum_order's obligation shape too, and minimum_order would
    // answer about the enforced floor rather than the question asked.
    patterns: [
      /\bhow (long|many days)\b.{0,20}\b(does|will|do)\b.{0,15}\ba? ?box\b.{0,15}\blast\b/i,
      /\bhow (many|much)\b.{0,20}\b(cups|tea ?bags|bags|servings)\b.{0,20}\b(in|is|per|a|are)\b.{0,10}\bbox\b/i,
      /\bhow (many|much)\b.{0,15}\bshould (i|we) (buy|order|get)\b/i,
      /\bhow many boxes\b.{0,20}\b(is|are|make|makes|for)\b.{0,15}\b(a |one )?year\b/i,
      /\bhow many boxes\b.{0,15}\bshould (i|we) (buy|order|get)\b/i,
    ],
    exclude: [
      // Shelf life once opened is a freshness question, not box arithmetic.
      /\b(once|after) (it'?s? )?open(ed)?\b/i,
      // The customer's own order history.
      /\b(did|have|has) (i|we) (order|buy|bought|purchase|purchased)\b/i,
    ],
  },
```

Add the resolution branch in `resolveDeterministicAnswer`, beside the existing ones:

```ts
  if (category === "box_math") return boxMathAnswer();
```

And the answer function, beside `minimumOrderAnswer`:

```ts
/**
 * Box math, with the per-box price read from the catalog rather than hardcoded.
 *
 * The three blends share one flat rate by construction - scripts/goob-reprice.mjs
 * writes the same `--rate` to every active variant - so a single read gives the
 * current price. It is read rather than baked in because that script is built to
 * run more than once (data/goob/price-baseline.json makes a second markdown
 * safe), and a stale figure quoted by the deterministic layer is exactly the
 * failure this whole module exists to prevent.
 *
 * On a read failure this answers WITHOUT a price rather than guessing one, the
 * same posture refundWindowAnswer takes with the return window.
 */
async function boxMathAnswer(): Promise<string> {
  const base =
    `Each box has ${CUPS_PER_BOX} tea bags, so a box is ${CUPS_PER_BOX} cups, about ten days at a cup a day 💕 ` +
    `Most folks went through 3 boxes a month of their favourite blend, which is why ${YEAR_SUPPLY_BOXES} boxes works out to a year.`;

  try {
    const cents = await blendUnitPriceCents();
    if (cents == null) return base;
    const year = Money.fromMinor(cents * YEAR_SUPPLY_BOXES, "USD").format();
    return `${base} At today's price that is ${year} for the year.`;
  } catch (error) {
    console.error("[chai] blend price lookup failed:", error);
    return base;
  }
}
```

Add `blendUnitPriceCents` in the same file, directly above `boxMathAnswer`:

```ts
/**
 * The current per-box price in cents, or null if it cannot be read.
 *
 * Reads ONE blend because scripts/goob-reprice.mjs writes a single flat
 * `--rate` to every active variant, so any of the three gives the sale price.
 * Morning is the arbitrary-but-stable pick; if it is ever archived this returns
 * null and the answer simply omits the figure, which is the intended posture.
 */
async function blendUnitPriceCents(): Promise<number | null> {
  const product = await getProductBySlug("clearly-calendula-morning");
  if (!product) return null;

  const variant =
    product.variants?.find((v) => v.id === product.default_variant_id) ??
    product.variants?.[0];

  const amount = variant?.price?.amount;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? amount
    : null;
}
```

Add these imports at the top of `lib/ai/deterministic-answers.ts`:

```ts
import { Money } from "@/lib/money";
import { getProductBySlug } from "@/lib/models/mach/products";
import { CUPS_PER_BOX, YEAR_SUPPLY_BOXES } from "@/lib/sale/year-supply";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/lib/ai/deterministic-answers.test.ts`
Expected: PASS, including every pre-existing case in that file. If any previously-passing classification now returns `box_math`, the pattern is too wide — narrow it rather than adding the old case to `exclude`.

- [ ] **Step 5: Lint, full suite, commit**

```bash
npm run lint && npm test
git add lib/ai/deterministic-answers.ts tests/unit/lib/ai/deterministic-answers.test.ts
git commit -m "goob: give Chai the box math, priced from the catalog"
```

---

### Task 8: Documentation corrections

**Files:**
- Modify: `docs/goob-rollout-runbook.md` (Phase 4 step 6)
- Modify: `CLAUDE.md` (the where-non-obvious-logic-lives table)

**Interfaces:** none.

- [ ] **Step 1: Correct the stale-homepage claim**

Phase 4 step 6 of the runbook says the homepage can show pre-sale prices for up to an hour after the reprice, and offers a redeploy as the workaround. That is false: `app/layout.tsx` sets `dynamic = "force-dynamic"`, which overrides the page's `revalidate = 3600`. Confirm before editing:

```bash
curl -s -D - -o /dev/null https://beauteas-dev.justblackmagic.workers.dev/ | grep -i cache-control
```

Expected: `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`.

Replace the step with a statement that the reprice is visible immediately everywhere, and say why (`force-dynamic` on the root layout makes the page-level `revalidate` inert), so the next person does not reintroduce the warning.

- [ ] **Step 2: Add the module to CLAUDE.md**

Add a row to the where-non-obvious-logic-lives table:

```markdown
| `lib/sale/year-supply.ts` | Box math for the closing sale — 10 cups a box, 36 boxes a year, and the stock-aware year-supply offer. Pure, like `lib/sale/rules.ts`, because client bundles import it |
```

- [ ] **Step 3: Commit**

```bash
git add docs/goob-rollout-runbook.md CLAUDE.md
git commit -m "docs: correct the stale-homepage claim and register year-supply"
```

---

## Deployment

All eight tasks land on `goob`. Per the plan recorded in runbook Phase 0.5, this branch is **not merged to `main`** — deploys are manual and the Launch readiness gate must be confirmed green for the exact SHA before `npm run deploy:production`. `0030` applies from the `predeploy` hook on the next deploy of either environment.

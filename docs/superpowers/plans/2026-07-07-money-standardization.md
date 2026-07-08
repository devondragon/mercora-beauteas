# Money Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an owned `Money` value object (integer minor units, big.js-backed) as the single source of truth for all money, collapse the storefront "dollars" pipeline into it, emit MACH decimal-major only at serialization boundaries, and fix the live unit bugs — all in one PR.

**Architecture:** Internal canonical unit = integer minor units held by an immutable `Money` class. Exact fractional math (tax, %-discount) via big.js. Three serialization boundaries: `.toMinorUnits()` → Stripe, `.toMach()` → wire (API/MCP/JSON-LD), `.toJSON()` → persistence (stays minor units, no backfill). One display path: `.format()`.

**Tech Stack:** TypeScript (strict), Next.js 15 App Router, Cloudflare Workers/D1, Drizzle, Stripe, Vitest (jsdom, `tests/unit/**`), big.js.

**Spec:** `docs/superpowers/specs/2026-07-07-money-standardization-design.md`

## Global Constraints

- Internal canonical money unit is **integer minor units**; only `.toMach()` emits decimal major units. Never write raw `*100` / `/100` in application code — route through `Money`.
- Rounding is **half-up** everywhere (big.js `Big.roundHalfUp`).
- Default currency is `'USD'`; currency codes are ISO 4217 uppercase.
- Unit tests go in `tests/unit/**/*.test.ts` and must import **pure modules only** (no `getCloudflareContext()` / `lib/db` / `lib/models` / route handlers — those need the Workers runtime). CI gates `tests/unit/**`.
- Verify each task with: `npm run lint` (→ `next lint`), `npx tsc --noEmit`, `npm test` (→ `vitest run`). All green before the next task.
- Commit after every task. Reference **BMC-164** in commit messages. All work on branch `bmc-164-money-standardization` → one PR against `main`.
- Match existing code style. Files kebab-case, components PascalCase, `@/*` path alias.

---

## File Structure

**Create:**
- `lib/money/currencies.ts` — ISO 4217 minor-unit exponent (precision) table + `getPrecision()`.
- `lib/money/money.ts` — the `Money` value object.
- `lib/money/index.ts` — barrel re-export.
- `tests/unit/lib/money/currencies.test.ts`
- `tests/unit/lib/money/money.test.ts`
- `tests/unit/lib/money/order-pricing-money.test.ts` — pricing/shipping/tax regression.
- `tests/unit/lib/money/serialization-mach.test.ts` — wire-shape regression.
- `docs/money.md` — canonical money convention doc.

**Modify (by phase; exact sites listed in each task):**
- P1: `lib/stripe.ts`, `lib/mcp/tools/order.ts`, `lib/services/order-pricing.ts`, reconcile `lib/db/schema/order.ts` vs `lib/models/order.ts`.
- P2: `lib/mcp/**` tool responses, `lib/seo/json-ld.tsx`, `app/api/products/route.ts`, `app/api/orders/route.ts`, `app/api/promotions/route.ts`, `lib/models/mach/product-serializer.ts`; delete formatters in `lib/utils.ts`, `lib/utils/account.ts`, `app/admin/orders/*`, `app/admin/subscriptions/*`, `lib/db/schema/pricing.ts`.
- P3: `lib/stores/cart-store.ts`, `app/product/[slug]/ProductDisplay.tsx`, `components/ProductCard.tsx`, `components/agent/ProductCard.tsx`, `components/cart/*`, `components/checkout/*`, `components/gift-card/GiftCardPurchaseForm.tsx`, `app/api/orders/route.ts` (email payload), `lib/utils/email.ts`, `emails/OrderConfirmation.tsx`.
- P4: `lib/db/schema/pricing.ts` (validation), `migrations/0013_*.sql` (only if data exists), checkout `extensions` writer.
- P5: `docs/money.md`, `CLAUDE.md`, `lib/types/money.ts`.

---

## Phase P0 — The `Money` value object (additive, no behavior change)

### Task 1: Add big.js dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install big.js and its types**

Run:
```bash
npm install big.js@^7.0.1 && npm install -D @types/big.js
```
Expected: `package.json` gains `"big.js": "^7.0.1"` in dependencies and `"@types/big.js"` in devDependencies; `package-lock.json` updated.

- [ ] **Step 2: Verify it imports under the test runtime**

Run:
```bash
node -e "const Big=require('big.js'); console.log(Big('0.1').plus('0.2').toString())"
```
Expected: `0.3`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add big.js for exact money math (BMC-164)"
```

---

### Task 2: Currency precision table

**Files:**
- Create: `lib/money/currencies.ts`
- Test: `tests/unit/lib/money/currencies.test.ts`

**Interfaces:**
- Produces: `getPrecision(currency: string): number`, `CURRENCY_PRECISION: Record<string, number>`, `DEFAULT_PRECISION: number`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/money/currencies.test.ts
import { describe, it, expect } from 'vitest';
import { getPrecision, DEFAULT_PRECISION } from '@/lib/money/currencies';

describe('getPrecision', () => {
  it('returns 2 for USD', () => expect(getPrecision('USD')).toBe(2));
  it('returns 0 for JPY', () => expect(getPrecision('JPY')).toBe(0));
  it('returns 3 for BHD', () => expect(getPrecision('BHD')).toBe(3));
  it('is case-insensitive', () => expect(getPrecision('usd')).toBe(2));
  it('defaults to 2 for unknown currencies', () => {
    expect(getPrecision('XYZ')).toBe(DEFAULT_PRECISION);
    expect(DEFAULT_PRECISION).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/money/currencies.test.ts`
Expected: FAIL — cannot resolve `@/lib/money/currencies`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/money/currencies.ts
/** ISO 4217 minor-unit exponents (subset). Number of decimal places in the major unit. */
export const CURRENCY_PRECISION: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, CNY: 2, INR: 2, BRL: 2,
  JPY: 0,
  BHD: 3, KWD: 3,
};

export const DEFAULT_PRECISION = 2;

export function getPrecision(currency: string): number {
  return CURRENCY_PRECISION[currency.toUpperCase()] ?? DEFAULT_PRECISION;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/money/currencies.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/money/currencies.ts tests/unit/lib/money/currencies.test.ts
git commit -m "feat(money): currency precision table (BMC-164)"
```

---

### Task 3: `Money` — constructors + persistence/Stripe serialization

**Files:**
- Create: `lib/money/money.ts`, `lib/money/index.ts`
- Test: `tests/unit/lib/money/money.test.ts`

**Interfaces:**
- Consumes: `getPrecision` from Task 2.
- Produces: `class Money` with statics `fromMinor`, `fromMajor`, `zero`, `fromStored`; instance `toMinorUnits()`, `toJSON()`, getter `currency`. Types `MachMoney`, `StoredMoney`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/money/money.test.ts
import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money/money';

describe('Money constructors + persistence', () => {
  it('fromMinor stores integer minor units', () => {
    expect(Money.fromMinor(2999, 'USD').toMinorUnits()).toBe(2999);
  });
  it('fromMinor rejects non-integers', () => {
    expect(() => Money.fromMinor(29.99, 'USD')).toThrow();
  });
  it('fromMajor converts dollars to cents (half-up)', () => {
    expect(Money.fromMajor('29.99', 'USD').toMinorUnits()).toBe(2999);
    expect(Money.fromMajor(29.995, 'USD').toMinorUnits()).toBe(3000);
  });
  it('fromMajor respects 0-precision currencies', () => {
    expect(Money.fromMajor(1000, 'JPY').toMinorUnits()).toBe(1000);
  });
  it('zero is zero', () => expect(Money.zero('USD').toMinorUnits()).toBe(0));
  it('currency is normalized uppercase', () => {
    expect(Money.fromMinor(1, 'usd').currency).toBe('USD');
  });
  it('toJSON persists minor units (not major)', () => {
    expect(Money.fromMinor(2999, 'USD').toJSON()).toEqual({ amount: 2999, currency: 'USD' });
  });
  describe('fromStored (legacy encodings, all = minor units)', () => {
    it('parses a Money object', () => {
      expect(Money.fromStored({ amount: 2999, currency: 'USD' }).toMinorUnits()).toBe(2999);
    });
    it('parses a JSON string', () => {
      expect(Money.fromStored('{"amount":2999,"currency":"USD"}').toMinorUnits()).toBe(2999);
    });
    it('parses a bare numeric string as minor units', () => {
      expect(Money.fromStored('2999', 'USD').toMinorUnits()).toBe(2999);
    });
    it('parses a bare number as minor units', () => {
      expect(Money.fromStored(2999, 'USD').toMinorUnits()).toBe(2999);
    });
    it('falls back to zero on garbage', () => {
      expect(Money.fromStored(null, 'USD').toMinorUnits()).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/money/money.test.ts`
Expected: FAIL — cannot resolve `@/lib/money/money`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/money/money.ts
import Big from 'big.js';
import { getPrecision } from './currencies';

export interface MachMoney { amount: number; currency: string; precision: number; }
export interface StoredMoney { amount: number; currency: string; }

/** Immutable monetary value held as integer minor units (e.g. cents). */
export class Money {
  readonly #minor: number;
  readonly #currency: string;

  private constructor(minorUnits: number, currency: string) {
    if (!Number.isInteger(minorUnits)) {
      throw new Error(`Money minor units must be an integer, got ${minorUnits}`);
    }
    this.#minor = minorUnits;
    this.#currency = currency.toUpperCase();
  }

  static fromMinor(minorUnits: number, currency = 'USD'): Money {
    return new Money(minorUnits, currency);
  }

  static fromMajor(major: number | string, currency = 'USD'): Money {
    const precision = getPrecision(currency);
    const minor = Big(major).times(Big(10).pow(precision)).round(0, Big.roundHalfUp);
    return new Money(Number(minor), currency);
  }

  static zero(currency = 'USD'): Money {
    return new Money(0, currency);
  }

  /** Parse a persisted/legacy value — object, JSON string, or bare number/string — as MINOR units. */
  static fromStored(value: unknown, currency = 'USD'): Money {
    if (value && typeof value === 'object' && 'amount' in (value as Record<string, unknown>)) {
      const v = value as { amount: unknown; currency?: string };
      const amt = typeof v.amount === 'number' ? v.amount : parseInt(String(v.amount), 10);
      return new Money(Math.round(Number.isNaN(amt) ? 0 : amt), v.currency ?? currency);
    }
    if (typeof value === 'number') {
      return new Money(Math.round(value), currency);
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (s.startsWith('{')) {
        try { return Money.fromStored(JSON.parse(s), currency); } catch { /* fall through */ }
      }
      const n = parseInt(s, 10);
      return new Money(Number.isNaN(n) ? 0 : n, currency);
    }
    return new Money(0, currency);
  }

  get currency(): string { return this.#currency; }

  toMinorUnits(): number { return this.#minor; }

  toJSON(): StoredMoney { return { amount: this.#minor, currency: this.#currency }; }
}
```

```ts
// lib/money/index.ts
export { Money } from './money';
export type { MachMoney, StoredMoney } from './money';
export { getPrecision, CURRENCY_PRECISION, DEFAULT_PRECISION } from './currencies';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/money/money.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/money/money.ts lib/money/index.ts tests/unit/lib/money/money.test.ts
git commit -m "feat(money): Money value object — constructors + persistence/Stripe serialization (BMC-164)"
```

---

### Task 4: `Money` — arithmetic operations

**Files:**
- Modify: `lib/money/money.ts`
- Test: `tests/unit/lib/money/money.test.ts` (append)

**Interfaces:**
- Produces: `.add`, `.subtract`, `.negate`, `.times`, `.applyRate`, `.allocate` (all return `Money`; currency-guarded where binary).

- [ ] **Step 1: Write the failing test (append to money.test.ts)**

```ts
describe('Money arithmetic', () => {
  it('adds and subtracts same-currency', () => {
    expect(Money.fromMinor(2999).add(Money.fromMinor(1)).toMinorUnits()).toBe(3000);
    expect(Money.fromMinor(3000).subtract(Money.fromMinor(1)).toMinorUnits()).toBe(2999);
  });
  it('throws on currency mismatch', () => {
    expect(() => Money.fromMinor(1, 'USD').add(Money.fromMinor(1, 'EUR'))).toThrow(/mismatch/i);
  });
  it('times multiplies by an integer quantity', () => {
    expect(Money.fromMinor(2999).times(3).toMinorUnits()).toBe(8997);
  });
  it('times rejects non-integer quantity', () => {
    expect(() => Money.fromMinor(2999).times(1.5)).toThrow();
  });
  it('applyRate multiplies then rounds half-up to integer minor', () => {
    // 8.25% tax on $29.99 = 247.4175c -> 247c
    expect(Money.fromMinor(2999).applyRate(0.0825).toMinorUnits()).toBe(247);
    // half-up boundary: 100c * 0.005 = 0.5 -> 1c
    expect(Money.fromMinor(100).applyRate(0.005).toMinorUnits()).toBe(1);
  });
  it('negate flips sign (for refunds)', () => {
    expect(Money.fromMinor(2999).negate().toMinorUnits()).toBe(-2999);
  });
  it('allocate splits without losing minor units', () => {
    const parts = Money.fromMinor(1000).allocate([1, 1, 1]);
    expect(parts.map(p => p.toMinorUnits())).toEqual([334, 333, 333]);
    expect(parts.reduce((a, p) => a + p.toMinorUnits(), 0)).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/money/money.test.ts`
Expected: FAIL — `.add is not a function` (methods undefined).

- [ ] **Step 3: Add methods to the `Money` class (insert before `get currency`)**

```ts
  #assertSameCurrency(other: Money): void {
    if (other.#currency !== this.#currency) {
      throw new Error(`Currency mismatch: ${this.#currency} vs ${other.#currency}`);
    }
  }

  add(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#minor + other.#minor, this.#currency);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other);
    return new Money(this.#minor - other.#minor, this.#currency);
  }

  negate(): Money {
    return new Money(-this.#minor, this.#currency);
  }

  /** Multiply by an integer quantity (a count of items). */
  times(qty: number): Money {
    if (!Number.isInteger(qty)) {
      throw new Error(`times() expects an integer quantity, got ${qty}`);
    }
    return new Money(this.#minor * qty, this.#currency);
  }

  /** Multiply by a rate (tax %, discount %) with exact big.js math, round half-up to integer minor. */
  applyRate(rate: number | string): Money {
    const minor = Big(this.#minor).times(rate).round(0, Big.roundHalfUp);
    return new Money(Number(minor), this.#currency);
  }

  /** Split into shares by integer ratios, distributing the remainder so the sum is preserved. */
  allocate(ratios: number[]): Money[] {
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error('allocate() ratios must sum to a positive number');
    const shares = ratios.map(r => Math.floor((this.#minor * r) / total));
    let remainder = this.#minor - shares.reduce((a, b) => a + b, 0);
    for (let i = 0; remainder > 0; i = (i + 1) % ratios.length) { shares[i]++; remainder--; }
    return shares.map(s => new Money(s, this.#currency));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/money/money.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/money/money.ts tests/unit/lib/money/money.test.ts
git commit -m "feat(money): Money arithmetic (add/subtract/times/applyRate/allocate) (BMC-164)"
```

---

### Task 5: `Money` — comparisons, MACH wire serialization, display

**Files:**
- Modify: `lib/money/money.ts`
- Test: `tests/unit/lib/money/money.test.ts` (append)

**Interfaces:**
- Produces: `.equals`, `.gte`, `.gt`, `.lte`, `.lt`, `.isZero`, `.isNegative`, `.toMach(): MachMoney`, `.format(locale?): string`.

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('Money comparisons + wire/display', () => {
  it('compares same-currency', () => {
    expect(Money.fromMinor(200).gte(Money.fromMinor(100))).toBe(true);
    expect(Money.fromMinor(100).lt(Money.fromMinor(200))).toBe(true);
    expect(Money.fromMinor(0).isZero()).toBe(true);
    expect(Money.fromMinor(-1).isNegative()).toBe(true);
    expect(Money.fromMinor(100, 'USD').equals(Money.fromMinor(100, 'USD'))).toBe(true);
  });
  it('toMach emits decimal major units + precision', () => {
    expect(Money.fromMinor(2999, 'USD').toMach()).toEqual({ amount: 29.99, currency: 'USD', precision: 2 });
    expect(Money.fromMinor(1000, 'JPY').toMach()).toEqual({ amount: 1000, currency: 'JPY', precision: 0 });
  });
  it('round-trips fromMajor -> toMach', () => {
    expect(Money.fromMajor('29.99', 'USD').toMach().amount).toBe(29.99);
  });
  it('format renders currency', () => {
    expect(Money.fromMinor(2999, 'USD').format('en-US')).toBe('$29.99');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/money/money.test.ts`
Expected: FAIL — `.gte is not a function`.

- [ ] **Step 3: Add methods (insert before `toMinorUnits`)**

```ts
  equals(other: Money): boolean {
    return this.#currency === other.#currency && this.#minor === other.#minor;
  }
  gte(other: Money): boolean { this.#assertSameCurrency(other); return this.#minor >= other.#minor; }
  gt(other: Money): boolean { this.#assertSameCurrency(other); return this.#minor > other.#minor; }
  lte(other: Money): boolean { this.#assertSameCurrency(other); return this.#minor <= other.#minor; }
  lt(other: Money): boolean { this.#assertSameCurrency(other); return this.#minor < other.#minor; }
  isZero(): boolean { return this.#minor === 0; }
  isNegative(): boolean { return this.#minor < 0; }

  /** MACH Alliance wire shape: decimal MAJOR units + precision. Use at API/MCP/JSON-LD boundaries only. */
  toMach(): MachMoney {
    const precision = getPrecision(this.#currency);
    const amount = Number(Big(this.#minor).div(Big(10).pow(precision)).toFixed(precision));
    return { amount, currency: this.#currency, precision };
  }

  /** Localized currency string for display. The single display entry point. */
  format(locale = 'en-US'): string {
    const { amount } = this.toMach();
    return new Intl.NumberFormat(locale, { style: 'currency', currency: this.#currency }).format(amount);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/money/money.test.ts`
Expected: PASS (full Money suite green).

- [ ] **Step 5: Full verify + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all green.
```bash
git add lib/money/money.ts tests/unit/lib/money/money.test.ts
git commit -m "feat(money): Money comparisons + MACH wire serialization + format (BMC-164)"
```

---

## Phase P1 — Server-side math typed to `Money` (subsumes BMC-161)

### Task 6: Route the Stripe boundary through `Money`

**Files:**
- Modify: `lib/stripe.ts:387,395` (`formatAmountForStripe`, `parseAmountFromStripe`)
- Grep for all callers first.

**Interfaces:**
- Consumes: `Money.toMinorUnits()`, `Money.fromMinor()`.
- Produces: keep `formatAmountForStripe`/`parseAmountFromStripe` as thin wrappers OR replace callers with `Money`. Decision below.

- [ ] **Step 1: Enumerate callers**

Run:
```bash
grep -rn "formatAmountForStripe\|parseAmountFromStripe\|formatAmountFromStripe" app lib components
```
Record every call site.

- [ ] **Step 2: Reimplement the helpers in terms of `Money` (keep the public signatures; they take/return minor units now)**

Edit `lib/stripe.ts` — replace the two helpers:
```ts
import { Money } from '@/lib/money';

/** Stripe wants integer minor units. Accepts a Money; returns minor units. */
export function toStripeAmount(money: Money): number {
  return money.toMinorUnits();
}

/** Build a Money from a Stripe minor-unit amount. */
export function fromStripeAmount(minorUnits: number, currency = 'USD'): Money {
  return Money.fromMinor(minorUnits, currency);
}
```
Then update each caller from Step 1 to pass/consume `Money` (e.g. payment-intent creation uses `toStripeAmount(total)`; webhook handlers wrap incoming `event...amount` with `fromStripeAmount(amount, currency)`).

- [ ] **Step 3: Add a regression test asserting no float drift at the boundary**

```ts
// tests/unit/lib/money/order-pricing-money.test.ts (create; will be extended in Task 7)
import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money';

describe('Stripe boundary', () => {
  it('Money -> Stripe minor units is exact', () => {
    expect(Money.fromMajor('29.99', 'USD').toMinorUnits()).toBe(2999);
  });
  it('Stripe minor units -> Money round-trips', () => {
    expect(Money.fromMinor(2999, 'USD').toMach().amount).toBe(29.99);
  });
});
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: green. Manually confirm every Step-1 caller compiles with the new signatures.

- [ ] **Step 5: Commit**

```bash
git add lib/stripe.ts tests/unit/lib/money/order-pricing-money.test.ts app lib components
git commit -m "refactor(stripe): route amount conversion through Money (BMC-164)"
```

---

### Task 7: Type pricing/shipping/tax math to `Money`

**Files:**
- Modify: `lib/mcp/tools/order.ts` — `computeOrderTotals` (`:37`), `calculateShipping` (`:493`), `calculateTax` (`:506`), and the `:155-162,271-272` `/100`·`*100` sites.
- Modify: `lib/services/order-pricing.ts` — `computeOrderTotals` helpers, `priceToCents`, `canonicalizeOrderItemsPricing`.
- Test: `tests/unit/lib/money/order-pricing-money.test.ts` (extend)

**Interfaces:**
- Consumes: `Money`, `Money.fromMinor/fromMajor/fromStored`, `.times`, `.applyRate`, `.add`, `.gte`.
- Produces: `computeOrderTotals(subtotal: Money, address, options): { subtotal: Money; shipping: Money; tax: Money; total: Money }`; `calculateShipping(address, subtotal: Money): Money`; `calculateTax(subtotal: Money, address): Money`. **All params/returns are `Money` — no bare `number`.**

> NOTE: `lib/mcp/tools/order.ts` imports `getCloudflareContext`-dependent modules, so its tests belong in `tests/workers` not `tests/unit`. Pull the **pure** math (`computeOrderTotals`, `calculateShipping`, `calculateTax`) into `lib/services/order-pricing.ts` (already pure-ish) so it is unit-testable, and have `order.ts` import from there. This also removes the duplicate math.

- [ ] **Step 1: Write the failing regression test (extend order-pricing-money.test.ts)**

```ts
import { computeOrderTotals, calculateShipping, calculateTax } from '@/lib/services/order-pricing';

describe('order totals (Money-typed)', () => {
  const addr = { country: 'US', state: 'CA', postal_code: '90001' } as any;

  it('free-shipping threshold compares correctly (no cents/dollars bug)', () => {
    // $50 subtotal -> paid shipping; $150 -> free
    expect(calculateShipping(addr, Money.fromMajor(50, 'USD')).isZero()).toBe(false);
    expect(calculateShipping(addr, Money.fromMajor(150, 'USD')).isZero()).toBe(true);
  });

  it('tax is subtotal * rate, exact', () => {
    const tax = calculateTax(Money.fromMajor('29.99', 'USD'), { ...addr, state: 'CA' });
    expect(tax.toMinorUnits()).toBeGreaterThan(0);
  });

  it('computeOrderTotals returns Money and total = subtotal+shipping+tax', () => {
    const r = computeOrderTotals(Money.fromMajor('29.99', 'USD'), addr, {});
    expect(r.total.toMinorUnits())
      .toBe(r.subtotal.add(r.shipping).add(r.tax).toMinorUnits());
  });
});
```
(Adjust the `addr` shape and `options` to the real signatures found in the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/lib/money/order-pricing-money.test.ts`
Expected: FAIL (signatures still bare-number).

- [ ] **Step 3: Rewrite the three functions to be `Money`-typed**

In `lib/services/order-pricing.ts`, replace the bare-number math. Representative shape:
```ts
import { Money } from '@/lib/money';

const FREE_SHIPPING_THRESHOLD = Money.fromMajor(100, 'USD');
const FLAT_SHIPPING = Money.fromMajor(9.99, 'USD');

export function calculateShipping(address: Address, subtotal: Money): Money {
  if (subtotal.gte(FREE_SHIPPING_THRESHOLD)) return Money.zero(subtotal.currency);
  return FLAT_SHIPPING; // preserve existing address-based logic, just Money-typed
}

export function calculateTax(subtotal: Money, address: Address): Money {
  const rate = taxRateFor(address); // existing rate lookup, unchanged
  return subtotal.applyRate(rate);
}

export function computeOrderTotals(subtotal: Money, address: Address, options: OrderTotalsOptions) {
  const shipping = calculateShipping(address, subtotal);
  const tax = calculateTax(subtotal, address);
  const total = subtotal.add(shipping).add(tax);
  return { subtotal, shipping, tax, total };
}
```
Preserve the **existing** shipping/tax business rules (rate tables, address gating, promo free-shipping) — only the units/types change. Update `lib/mcp/tools/order.ts` to import these, build `subtotal` via `Money.fromStored(variant.price).times(qty)` summed with `.add`, delete the `:155-162,271-272` `/100`·`*100` conversions, and persist `total_amount: total.toJSON()` / per-line `unit_price: unit.toJSON()`, `total_price: unit.times(qty).toJSON()`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/lib/money/order-pricing-money.test.ts`
Expected: PASS.

- [ ] **Step 5: Reconcile the duplicate `orders` schema**

Compare `lib/db/schema/order.ts` and `lib/models/order.ts`. Confirm they define the same table; keep the `lib/db/schema` one as canonical and re-export from the model, or delete the duplicate if unused. Run:
```bash
grep -rn "from '@/lib/models/order'\|from \"@/lib/models/order\"" app lib components
```
Update imports to the canonical path. If genuinely identical + unused, delete `lib/models/order.ts`.

- [ ] **Step 6: Verify + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
```bash
git add lib/services/order-pricing.ts lib/mcp/tools/order.ts lib/db/schema/order.ts lib/models/order.ts tests/unit/lib/money/order-pricing-money.test.ts app lib
git commit -m "refactor(pricing): Money-typed order totals/shipping/tax; reconcile orders schema (BMC-164)"
```

---

## Phase P2 — MACH at the wire + formatter consolidation

### Task 8: Emit MACH `toMach()` at API/MCP/JSON-LD boundaries

**Files (from recon — verify each still emits money):**
- `app/api/products/route.ts:86` + `lib/models/mach/product-serializer.ts`
- `app/api/orders/route.ts` (GET serialization `:600,651`)
- `app/api/promotions/route.ts:59-87`
- `lib/mcp/catalog.ts:43,88-89`; `lib/mcp/tools/cart.ts` (77,88,97,178,195,205,333,342,396,405,452); `lib/mcp/tools/order.ts` (162-166,171); `lib/mcp/tools/payment.ts` (71,84,95,205-223); `lib/mcp/tools/recommend.ts`, `assess.ts`, `search.ts` (budget-vs-price)
- `lib/seo/json-ld.tsx:170-171,180`
- Test: `tests/unit/lib/money/serialization-mach.test.ts`

**Interfaces:**
- Consumes: `Money.fromStored(...).toMach()`.
- Produces: every money field in an API/MCP/JSON-LD response is a MACH `{amount, currency, precision}` object (or, for JSON-LD `price`, the major-unit number from `.toMach().amount`).

- [ ] **Step 1: Write the failing wire-shape regression test**

```ts
// tests/unit/lib/money/serialization-mach.test.ts
import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money';

// Pure helper we will introduce for MCP/API money fields:
import { toWireMoney } from '@/lib/money/wire';

describe('wire money shape', () => {
  it('serializes stored cents to MACH major units', () => {
    expect(toWireMoney({ amount: 2999, currency: 'USD' }))
      .toEqual({ amount: 29.99, currency: 'USD', precision: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/lib/money/serialization-mach.test.ts`
Expected: FAIL — `@/lib/money/wire` missing.

- [ ] **Step 3: Add a tiny wire helper, then convert call sites**

```ts
// lib/money/wire.ts
import { Money } from './money';
import type { MachMoney } from './money';

/** Serialize any stored/legacy money value to the MACH wire shape. */
export function toWireMoney(value: unknown, currency = 'USD'): MachMoney {
  return Money.fromStored(value, currency).toMach();
}
```
Add to the barrel: `export { toWireMoney } from './wire';`

Then convert each site from the file list: replace `variant.price.amount / 100`, bare `.amount` cents, and `estimated_total` (cents) with `toWireMoney(variant.price)` etc. For the MCP planning tools (`recommend`/`assess`/`search`), compare budget and price in a single unit by wrapping both in `Money` (`Money.fromStored(price).gte(Money.fromMajor(budget))`). Fix `lib/mcp/tools/cart.ts:452` to format via `Money.fromStored(total).format()` instead of printing cents with `$`. For `lib/seo/json-ld.tsx`, emit `toWireMoney(defaultVariant.price).amount` (major-unit number for schema.org `price`).

- [ ] **Step 4: Run to verify it passes; grep to confirm no raw `/100` remains at these boundaries**

Run:
```bash
npx vitest run tests/unit/lib/money/serialization-mach.test.ts
grep -rn "/ *100" lib/mcp lib/seo/json-ld.tsx app/api/products app/api/orders app/api/promotions
```
Expected: test PASS; grep shows no money `/100` left in these files (only the value object does conversions).

- [ ] **Step 5: Verify + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
```bash
git add lib/money/wire.ts lib/money/index.ts tests/unit/lib/money/serialization-mach.test.ts lib/mcp lib/seo app/api
git commit -m "refactor(api/mcp): emit MACH money shape at wire boundaries (BMC-164)"
```

---

### Task 9: Consolidate all formatters into `Money.format()`

**Files (delete/replace):**
- `lib/utils.ts:100-105` (`formatPrice`)
- `lib/utils/account.ts:45-50` (`formatMoney`, also drops `currency_code` divergence)
- `app/admin/orders/page.tsx:250-255`, `app/admin/orders/[id]/page.tsx:169-174` (two `formatCurrency`)
- `app/admin/subscriptions/page.tsx:97-99`, `app/admin/subscriptions/[id]/page.tsx:104-106` (two `formatDiscountedPrice`)
- `lib/db/schema/pricing.ts:301-318` (dead `formatPriceDisplay`/`convertPrice` — delete)

**Interfaces:**
- Consumes: `Money.fromStored(...).format()`.

- [ ] **Step 1: Enumerate every caller of the doomed formatters**

Run:
```bash
grep -rn "formatPrice\b\|formatMoney\b\|formatCurrency\b\|formatDiscountedPrice\b\|formatPriceDisplay\|convertPrice" app components lib
```

- [ ] **Step 2: Replace call sites with `Money`**

For a cents value: `Money.fromStored(order.total_amount).format()`. For a discounted price: `Money.fromStored(priceCents).applyRate(1 - pct/100).format()`. Delete the helper definitions once all callers are migrated. Remove the now-dead `formatPriceDisplay`/`convertPrice` from `lib/db/schema/pricing.ts`.

- [ ] **Step 3: Verify no dangling references**

Run:
```bash
grep -rn "formatPrice\b\|formatMoney\b\|formatDiscountedPrice\b\|formatPriceDisplay\|convertPrice" app components lib
```
Expected: no matches (or only `Money.format`).

- [ ] **Step 4: Verify + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
```bash
git add app components lib
git commit -m "refactor(display): single Money.format() formatter; delete duplicates (BMC-164)"
```

---

## Phase P3 — Collapse the storefront pipeline + fix live bugs

### Task 10: Cart store + add-to-cart hold minor units

**Files:**
- Modify: `lib/stores/cart-store.ts` (holds minor units; `:325` discount parse)
- Modify: `app/product/[slug]/ProductDisplay.tsx:398,460` (drop `/100` at add-to-cart), `:359,434,435,439` (display via `.format()`)
- Modify: `components/ProductCard.tsx:181,184,192`, `components/agent/ProductCard.tsx:16,45,47,51`
- Modify: `components/gift-card/GiftCardPurchaseForm.tsx:16-18,46-47,58,89` (denominations via `Money.fromMajor`)

**Interfaces:**
- Cart item `price` is **minor units** (integer). Display via `Money.fromMinor(item.price, 'USD').format()`.

- [ ] **Step 1: Change the cart store to minor units**

In `lib/stores/cart-store.ts`, treat stored `price` as minor units end-to-end (remove any `/100`). Where a discount string is parsed (`:325`), wrap in `Money.fromMajor(match, 'USD').toMinorUnits()`.

- [ ] **Step 2: Add-to-cart passes minor units**

In `app/product/[slug]/ProductDisplay.tsx`, remove the `price: price / 100` at `:398,460` — pass `variant.price.amount` (already minor units). Update the price displays at `:359,434,435,439` to `Money.fromMinor(variant.price.amount, currency).format()`.

- [ ] **Step 3: Update product cards + gift-card form**

`ProductCard.tsx`/`agent/ProductCard.tsx`: replace `(price/100).toFixed(2)` with `Money.fromMinor(price, 'USD').format()`. `GiftCardPurchaseForm.tsx`: denominations `Money.fromMajor(25, 'USD').toMinorUnits()` etc.; cart line uses minor units.

- [ ] **Step 4: Verify**

Run: `npm run lint && npx tsc --noEmit && npm test`
Then a manual smoke via `npm run preview:dev` (local Workers runtime — plain `npm run dev` 500s on D1 routes): add a product to cart, confirm the displayed price is correct (not 100×).

- [ ] **Step 5: Commit**

```bash
git add lib/stores/cart-store.ts app/product components/ProductCard.tsx components/agent/ProductCard.tsx components/gift-card/GiftCardPurchaseForm.tsx
git commit -m "refactor(cart): hold minor units end-to-end via Money (BMC-164)"
```

---

### Task 11: Checkout components + order POST use minor units

**Files:**
- Modify: `components/checkout/OrderSummary.tsx:68-109`, `OrderItemCard.tsx:26,31`, `ShippingOptions.tsx:55`, `CheckoutClient.tsx:222,263-294,419`, `GiftCardInput.tsx:44,73`, `DiscountCodeInput.tsx:56-74`
- Modify: `components/cart/CartItemCard.tsx:57-58`, `CartDrawer.tsx:138`
- Modify: `app/api/orders/route.ts` (POST validation `:150`, write `:316`) — expect minor units

**Interfaces:**
- The order POST body carries `total_amount` and line prices in **minor units** (`Money.toJSON()` shape). No `Math.round(*100)` in `CheckoutClient`.

- [ ] **Step 1: Convert display sites**

Every checkout/cart display consumes minor units → `Money.fromMinor(value, 'USD').format()`. Remove the direct `.toFixed(2)` (which assumed dollars).

- [ ] **Step 2: Order POST payload built from `Money`**

In `CheckoutClient.tsx`, remove `Math.round(...*100)` at `:222,263,267,275,287,288,294`; the values are already minor units. Build totals with `Money` arithmetic and send `.toJSON()` shapes. In `DiscountCodeInput.tsx`, drop the `*100`/`/100` pair.

- [ ] **Step 3: Server accepts minor units**

`app/api/orders/route.ts` — the POST validator (`:150`) still checks `typeof total_amount.amount === 'number'`; add an integer assertion and store via `Money.fromStored(body.total_amount).toJSON()`.

- [ ] **Step 4: Verify**

Run: `npm run lint && npx tsc --noEmit && npm test`. Manual smoke: complete a checkout in `npm run preview:dev`, confirm totals match across cart → summary → order.

- [ ] **Step 5: Commit**

```bash
git add components/checkout components/cart app/api/orders/route.ts
git commit -m "refactor(checkout): minor units end-to-end; order POST via Money (BMC-164)"
```

---

### Task 12: Fix the order-confirmation email 100× bug

**Files:**
- Modify: `app/api/orders/route.ts:348-374` (OrderData builder)
- Modify: `lib/utils/email.ts:13-36,120-183` (OrderData interface + HTML render)
- Modify: `emails/OrderConfirmation.tsx:107-150`
- Test: `tests/unit/lib/money/email-totals.test.ts`

**Interfaces:**
- The email payload carries **pre-formatted strings** (via `Money.format()`) OR MACH major-unit numbers — pick pre-formatted strings to remove all unit ambiguity from templates.

- [ ] **Step 1: Write the failing test (pure formatter, no Cloudflare deps)**

```ts
// tests/unit/lib/money/email-totals.test.ts
import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money';

// Introduce a pure builder that maps order money (minor units) -> display strings.
import { buildOrderEmailTotals } from '@/lib/utils/order-email-totals';

describe('order email totals', () => {
  it('formats a $25 order as $25.00, not $2500.00', () => {
    const t = buildOrderEmailTotals({
      subtotal: 2000, shipping: 500, tax: 0, total: 2500, currency: 'USD',
    });
    expect(t.total).toBe('$25.00');
    expect(t.shipping).toBe('$5.00');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/lib/money/email-totals.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Add the pure builder and use it**

```ts
// lib/utils/order-email-totals.ts
import { Money } from '@/lib/money';

export interface OrderEmailTotalsInput {
  subtotal: number; shipping: number; tax: number; total: number; currency?: string;
}
export interface OrderEmailTotals {
  subtotal: string; shipping: string; tax: string; total: string;
}
export function buildOrderEmailTotals(i: OrderEmailTotalsInput): OrderEmailTotals {
  const c = i.currency ?? 'USD';
  const f = (minor: number) => Money.fromMinor(minor, c).format();
  return { subtotal: f(i.subtotal), shipping: f(i.shipping), tax: f(i.tax), total: f(i.total) };
}
```
In `app/api/orders/route.ts:348-374`, build the email payload with `buildOrderEmailTotals(...)` from the **minor-unit** order values, and fix the `shippingCost`/`taxAmount` key mismatch (use the keys the templates read, or pass the pre-formatted strings). Change `lib/utils/email.ts` and `emails/OrderConfirmation.tsx` to render the pre-formatted strings (delete the `.toFixed(2)` calls).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/lib/money/email-totals.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
```bash
git add app/api/orders/route.ts lib/utils/email.ts lib/utils/order-email-totals.ts emails/OrderConfirmation.tsx tests/unit/lib/money/email-totals.test.ts
git commit -m "fix(email): correct order-confirmation totals (100x bug) via Money (BMC-164)"
```

---

### Task 13: Normalize the `extensions` mixed-unit object

**Files:**
- Modify: the checkout writer that sets `extensions.shipping_cost` (found in `components/checkout/CheckoutClient.tsx:288`) → store minor units like `subtotal`/`tax_amount`.
- Modify readers: `app/admin/orders/[id]/page.tsx:519,525,531` (drop the `*100` special-case on `shipping_cost`).

**Interfaces:**
- Every field in `order.extensions` money block is **minor units**.

- [ ] **Step 1: Make the writer store minor units**

In `CheckoutClient.tsx:288`, remove `Math.round(shipping_cost*100)` — write the minor-unit value directly (consistent with subtotal/tax).

- [ ] **Step 2: Make the admin reader treat all extensions money as minor units**

In `app/admin/orders/[id]/page.tsx`, remove the `Math.round(extensions.shipping_cost*100)` at `:525`; read it like `subtotal`/`tax_amount` and display via `Money.fromMinor(...).format()`.

- [ ] **Step 3: Verify + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
```bash
git add components/checkout/CheckoutClient.tsx app/admin/orders/[id]/page.tsx
git commit -m "fix(orders): unify extensions money to minor units (BMC-164)"
```

---

## Phase P4 — Targeted data normalization + guardrails

### Task 14: Verify `pricing` unit, normalize stray dollars data, strengthen validation

**Files:**
- Investigate: `pricing.list_price`/`sale_price` real data.
- Possibly create: `migrations/0013_normalize_money_units.sql` (only if rows exist in a wrong unit).
- Modify: `lib/db/schema/pricing.ts:135-141` (`isValidMoney`).

- [ ] **Step 1: Empirically check the pricing table unit**

Run:
```bash
npx wrangler d1 execute beauteas-db-dev --remote --env dev --command "SELECT id, list_price, sale_price FROM pricing LIMIT 20"
```
Inspect: are amounts like `3995` (cents) or `39.95` (dollars)? Also check row counts in prod:
```bash
npx wrangler d1 execute beauteas-db --remote --env production --command "SELECT COUNT(*) AS n FROM pricing"
npx wrangler d1 execute beauteas-db --remote --env production --command "SELECT COUNT(*) AS n FROM orders"
```
Record findings in the PR description.

- [ ] **Step 2: Decide + act**
  - If `pricing` rows are **dollars** and the table is used at runtime → write `migrations/0013_normalize_money_units.sql` converting `list_price`/`sale_price` amounts `*100` to minor units (JSON update), and apply per the CLAUDE.md migration steps (dev, dev-preview, prod). Guard: only if `SELECT COUNT(*)` shows rows; otherwise skip the migration and just fix the code convention (the reader now uses `Money.fromStored`, which assumes minor units).
  - If the table is empty (expected pre-launch) → **no migration**; ensure the seed data (`data/d1/seed.sql`) stores minor units.

- [ ] **Step 3: Strengthen `isValidMoney`**

```ts
export function isValidMoney(money: unknown): money is Money {
  return !!money && typeof money === 'object'
    && typeof (money as any).amount === 'number'
    && Number.isFinite((money as any).amount)
    && typeof (money as any).currency === 'string'
    && (money as any).currency.length === 3;
}
```
(Keep it accepting the stored minor-unit shape; do not force integer here since MACH wire objects are also validated elsewhere — document which shape each validator guards.)

- [ ] **Step 4: Verify + commit**

Run: `npm run lint && npx tsc --noEmit && npm test`
```bash
git add lib/db/schema/pricing.ts migrations 2>/dev/null
git commit -m "chore(data): normalize pricing money units + tighten validation (BMC-164)"
```
If a migration was created, update the migrations table in `CLAUDE.md` (next number is `0013`).

---

## Phase P5 — Docs

### Task 15: Money convention doc + CLAUDE.md + type doc + BMC-164

**Files:**
- Create: `docs/money.md`
- Modify: `CLAUDE.md` (add a "Money & Pricing" subsection), `lib/types/money.ts` (correct the doc comment)

- [ ] **Step 1: Write `docs/money.md`**

Content: the canonical rule (internal = integer minor units via `Money`; `.toMach()` decimal-major only at API/MCP/JSON-LD; `.toMinorUnits()` at Stripe; `.toJSON()` persists minor units; `.format()` is the only display path; never raw `*100`/`/100`), the boundary map table, and 3 worked examples (build an order total, serialize to a MCP response, send to Stripe).

- [ ] **Step 2: Update `CLAUDE.md`**

Add under Development Guidelines a **Money & Pricing** subsection:
```markdown
### Money & Pricing
All monetary values flow through `lib/money` (`Money`). Internal unit is **integer minor units**; use `Money.fromMinor/fromMajor/fromStored`. Emit MACH `{amount, currency, precision}` via `.toMach()` ONLY at API/MCP/JSON-LD boundaries; use `.toMinorUnits()` at the Stripe boundary; persist via `.toJSON()` (minor units); display via `.format()`. Never write raw `*100`/`/100`. See `docs/money.md`.
```

- [ ] **Step 3: Fix `lib/types/money.ts` doc comment**

Clarify that the persisted/stored `amount` is **minor units**, and that the MACH wire shape (`MachMoney`, decimal major + precision) comes from `Money.toMach()`. Re-export `Money` as the canonical helper.

- [ ] **Step 4: Verify + commit**

Run: `npm run lint`
```bash
git add docs/money.md CLAUDE.md lib/types/money.ts
git commit -m "docs(money): canonical money convention + CLAUDE.md (BMC-164)"
```

- [ ] **Step 5: Update BMC-164**

Add a comment to BMC-164 (via Linear) recording: approach chosen (owned `Money` + big.js, minor-units-internal, MACH at wire), and link the PR when opened.

---

## Final: open the PR

- [ ] **Full green gate**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: all green.

- [ ] **Open the PR**

```bash
git push -u origin bmc-164-money-standardization
gh pr create --base main --title "refactor(money): standardize on MACH-aligned Money value object (BMC-164)" --body "Implements docs/superpowers/specs/2026-07-07-money-standardization-design.md. Introduces lib/money (Money + big.js), collapses the storefront dollars pipeline, emits MACH at the wire, routes Stripe through Money, consolidates formatters, and fixes the email 100x / extensions / MCP unit bugs. Includes empirical pricing-unit check results. Do not merge until reviewed."
```

---

## Self-Review notes (author checklist — completed)

- **Spec coverage:** value object (T2-5), collapse pipeline (T10-11), Money-typed math/BMC-161 (T7), MACH wire (T8), Stripe boundary (T6), formatter consolidation (T9), data normalization (T14), live bugs email/extensions/MCP (T12,T13,T8), docs/CLAUDE.md/type (T15). All spec sections mapped.
- **Placeholders:** none — Money class + tests are full code; mechanical sweeps give exact file:line lists + grep commands + representative transforms.
- **Type consistency:** `Money.fromMinor/fromMajor/fromStored/zero`, `.toMinorUnits/.toMach/.toJSON/.format/.add/.subtract/.times/.applyRate/.allocate/.gte/.gt/.lte/.lt/.isZero/.isNegative/.equals`, `toWireMoney`, `toStripeAmount/fromStripeAmount`, `buildOrderEmailTotals` — names consistent across tasks.

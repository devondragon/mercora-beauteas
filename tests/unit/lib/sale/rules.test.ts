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
  billableBoxes,
  countBoxes,
  checkMinimumOrder,
  normalizePerBoxCost,
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

  // GOOB shipping-tier review: countBoxes must agree with normalizeQuantity
  // (lib/services/order-pricing.ts) about what an omitted quantity means, or
  // the box count and the priced goods total disagree about the same cart.
  it('counts a line with no quantity key as 1 box, matching normalizeQuantity\'s omitted-quantity default', () => {
    expect(countBoxes([{}])).toBe(1);
  });

  it('counts an explicit null or undefined quantity as 1', () => {
    expect(countBoxes([{ quantity: null }, { quantity: undefined }])).toBe(2);
  });

  it('still coerces a numeric string (existing behavior)', () => {
    expect(countBoxes([{ quantity: '3' }])).toBe(3);
  });

  it('coerces any raw type via Number(), not just strings', () => {
    // Number([5]) === 5, same coercion normalizeQuantity applies.
    expect(countBoxes([{ quantity: [5] }])).toBe(5);
  });

  it('REGRESSION (GOOB): a 100-line cart with every line omitting quantity counts as 100, not 0', () => {
    // The exploit this closes: POST /api/payment-intent or /api/orders with up
    // to MAX_ORDER_LINE_ITEMS lines shaped { product_id, variant_id } and no
    // quantity field. computeCatalogLineCents / normalizeQuantity price every
    // such line as 1 unit (omitted → 1), so the goods subtotal is for 100
    // units — but the old countBoxes treated the same omission as 0 boxes,
    // so resolveShippingTier picked the lowest configured tier instead of the
    // one matching 100 boxes. The quote and the floor agreed with each other
    // on a wrong, too-low tier because they disagreed about the cart.
    const items: Array<{ product_id: string; variant_id: string; quantity?: unknown }> = Array.from(
      { length: 100 },
      () => ({ product_id: 'tea-1', variant_id: 'var-tea-1' })
    );
    expect(countBoxes(items)).toBe(100);
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

  // A 429 from /api/sale-rules returns a JSON error body, so an unchecked
  // read used to land `undefined` here and make `short` NaN — never `=== 0`,
  // which blocked checkout entirely behind "Add NaN more boxes".
  it.each([
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('treats a %s minimum as no minimum rather than blocking', (_label, minimum) => {
    expect(checkMinimumOrder(6, minimum as unknown as number)).toEqual({ ok: true, short: 0 });
  });

  it('never reports a NaN shortfall', () => {
    expect(checkMinimumOrder(NaN, 10).short).not.toBeNaN();
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

  // Regression: with every row bounded, a cart above the largest bound used to
  // resolve to null, and `resolveShippingOptions` reads null as "no tiers" and
  // quotes the flat per-method rate — so a 60-box order was quoted AND charged
  // Standard's $5.99 instead of $14. The charge floor resolves through this
  // same function, so it agreed and nothing caught the undercharge. A
  // configured tier set must price every cart.
  it('charges the top band above the largest bound when no tier is open-ended', () => {
    const capped: ShippingTier[] = [
      { max_boxes: 20, cost: 8 },
      { max_boxes: 40, cost: 14 },
    ];

    expect(resolveShippingTier(capped, 41)).toEqual({ max_boxes: 40, cost: 14 });
    expect(resolveShippingTier(capped, 60)).toEqual({ max_boxes: 40, cost: 14 });
  });

  it('picks the top band by bound, not by storage order, in that fallback', () => {
    const unordered: ShippingTier[] = [
      { max_boxes: 40, cost: 14 },
      { max_boxes: 20, cost: 8 },
    ];

    expect(resolveShippingTier(unordered, 60)).toEqual({ max_boxes: 40, cost: 14 });
  });

  it('still resolves a single bounded tier for a cart above its bound', () => {
    expect(resolveShippingTier([{ max_boxes: 20, cost: 8 }], 500)).toEqual({
      max_boxes: 20,
      cost: 8,
    });
  });

  it('sorts unordered tiers rather than trusting admin input order', () => {
    const unordered: ShippingTier[] = [
      { max_boxes: null, cost: 22 },
      { max_boxes: 40, cost: 14 },
      { max_boxes: 20, cost: 8 },
    ];

    expect(resolveShippingTier(unordered, 15)).toEqual({ max_boxes: 20, cost: 8 });
  });

  // Regression: the sort comparator used to return `1` whenever EITHER side
  // was null, which is not a valid strict-weak-order for a null/null pair.
  // With two open-ended tiers, that made the result depend on which one
  // happened to be first in the input array, so the same cart could silently
  // resolve to two different prices depending on storage order alone. The
  // admin editor makes two null rows reachable in principle (Task 8), so this
  // can't be treated as an input invariant — the resolver itself must be
  // deterministic no matter what array it's handed, and must not just be
  // "stable per-array" but agree across two arrays holding the same tiers in
  // different order.
  it('resolves two open-ended tiers to the same (lower-cost) tier regardless of input order', () => {
    const cheapFirst: ShippingTier[] = [
      { max_boxes: null, cost: 22 },
      { max_boxes: null, cost: 999 },
    ];
    const expensiveFirst: ShippingTier[] = [
      { max_boxes: null, cost: 999 },
      { max_boxes: null, cost: 22 },
    ];

    const expected = { max_boxes: null, cost: 22 };
    expect(resolveShippingTier(cheapFirst, 50)).toEqual(expected);
    expect(resolveShippingTier(expensiveFirst, 50)).toEqual(expected);
  });

  // Same class of bug one line lower: two tiers sharing a numeric bound tied
  // at 0, and `Array.prototype.sort` is stable, so `find` reached whichever
  // the admin happened to save first. `addTierRow` defaults a new row to
  // `max_boxes: 1` when one is already open-ended, so clicking "Add tier"
  // twice reaches this state through the normal editor flow.
  it('resolves two tiers sharing a bound to the same (lower-cost) tier regardless of input order', () => {
    const cheapFirst: ShippingTier[] = [
      { max_boxes: 20, cost: 8 },
      { max_boxes: 20, cost: 999 },
      { max_boxes: null, cost: 22 },
    ];
    const expensiveFirst: ShippingTier[] = [
      { max_boxes: 20, cost: 999 },
      { max_boxes: 20, cost: 8 },
      { max_boxes: null, cost: 22 },
    ];

    const expected = { max_boxes: 20, cost: 8 };
    expect(resolveShippingTier(cheapFirst, 15)).toEqual(expected);
    expect(resolveShippingTier(expensiveFirst, 15)).toEqual(expected);
  });
});

describe('normalizePerBoxCost', () => {
  it('accepts a positive number and a numeric string', () => {
    expect(normalizePerBoxCost(1)).toBe(1);
    expect(normalizePerBoxCost(0.45)).toBe(0.45);
    expect(normalizePerBoxCost('1')).toBe(1);
  });

  it('treats zero and negatives as NOT configured', () => {
    // Zero is how the admin editor and the 0032 seed both express "off", so it
    // has to mean "leave the tiers/flat rates alone" rather than "ship free".
    expect(normalizePerBoxCost(0)).toBeNull();
    expect(normalizePerBoxCost(-1)).toBeNull();
  });

  it('rejects every value that Number() would silently turn into zero', () => {
    // Number(null) === Number('') === Number('  ') === Number([]) === Number(false) === 0.
    // Any of these passing through as a rate would price every order at $0 —
    // the same trap `rateMajor` in deterministic-answers.ts documents.
    for (const raw of [null, undefined, '', '   ', [], false, {}, 'free', NaN, Infinity]) {
      expect(normalizePerBoxCost(raw)).toBeNull();
    }
  });
});

describe('billableBoxes', () => {
  it('bills the real box count', () => {
    expect(billableBoxes(10)).toBe(10);
    expect(billableBoxes(37)).toBe(37);
  });

  it('never bills less than one box', () => {
    // resolveShippingOptions is called with 0 boxes for an UNKNOWN cart (Chai has
    // no cart to read). Zero here would quote and floor at $0 — free shipping
    // invented from a missing argument.
    expect(billableBoxes(0)).toBe(1);
    expect(billableBoxes(-5)).toBe(1);
    expect(billableBoxes(NaN)).toBe(1);
    expect(billableBoxes(Infinity)).toBe(1);
  });

  it('floors a fractional count the way countBoxes does', () => {
    expect(billableBoxes(10.9)).toBe(10);
  });
});

describe('minimumOrderMessage', () => {
  it('uses the singular for one box short', () => {
    expect(minimumOrderMessage(1, 10)).toBe('Add 1 more box to check out. 10 box minimum.');
  });

  it('uses the plural for more than one', () => {
    expect(minimumOrderMessage(4, 10)).toBe('Add 4 more boxes to check out. 10 box minimum.');
  });
});

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
    const items = Array.from({ length: 100 }, () => ({ product_id: 'tea-1', variant_id: 'var-tea-1' }));
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

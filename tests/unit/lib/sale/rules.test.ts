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

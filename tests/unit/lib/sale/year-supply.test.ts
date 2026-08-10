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
  yearSupplyCartItem,
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

describe('yearSupplyCartItem', () => {
  const input = (overrides = {}) => ({
    variant: { id: 'var_morning', price: { amount: 300, currency: 'USD' } },
    productId: 'prod_morning',
    name: 'Clearly Calendula Morning',
    imageUrl: '/morning.jpg',
    boxes: 36,
    ...overrides,
  });

  it('builds the cart line in MINOR units at the offered quantity', () => {
    expect(yearSupplyCartItem(input() as never)).toEqual({
      variantId: 'var_morning',
      productId: 'prod_morning',
      name: 'Clearly Calendula Morning',
      price: 300,
      quantity: 36,
      primaryImageUrl: '/morning.jpg',
    });
  });

  it('carries the remainder quantity through unchanged', () => {
    expect(yearSupplyCartItem(input({ boxes: 24 }) as never)?.quantity).toBe(24);
  });

  it.each([
    ['no price object', { variant: { id: 'v' } }],
    ['no amount', { variant: { id: 'v', price: {} } }],
    ['a non-numeric amount', { variant: { id: 'v', price: { amount: '300' } } }],
    ['a NaN amount', { variant: { id: 'v', price: { amount: Number.NaN } } }],
  ])('returns null when the price is unreadable (%s)', (_label, overrides) => {
    expect(yearSupplyCartItem(input(overrides) as never)).toBeNull();
  });

  it('returns null without a variant id', () => {
    expect(yearSupplyCartItem(input({ variant: { price: { amount: 300 } } }) as never)).toBeNull();
  });

  it('returns null for a non-positive box count', () => {
    expect(yearSupplyCartItem(input({ boxes: 0 }) as never)).toBeNull();
  });
});

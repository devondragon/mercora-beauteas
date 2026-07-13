/**
 * Regression tests for BMC-177 — the charge floor ignored cart discounts, so a
 * valid cart coupon whose discount exceeded shipping + tax + tolerance made the
 * shopper's correctly-discounted charge fall below the floor and get rejected
 * with `amount_below_catalog`.
 *
 * `lib/services/discount-pricing.ts` recomputes the cart discount AUTHORITATIVELY
 * from the coupon (never the client number) so the floor can subtract it. These
 * tests pin that resolution with the two promotion-model reads mocked, so it
 * stays a unit test with no Workers runtime dependency (CI `npm test`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/couponInstance', () => ({
  listCouponInstances: vi.fn(),
}));

vi.mock('@/lib/models/mach/promotions', () => ({
  listPromotions: vi.fn(),
}));

import { resolveCartDiscountCents } from '@/lib/services/discount-pricing';
import { listCouponInstances } from '@/lib/models/mach/couponInstance';
import { listPromotions } from '@/lib/models/mach/promotions';

/** A 25%-off cart promotion (the ticket's acceptance case). */
const PROMO_25_OFF = {
  id: 'promo-25',
  type: 'cart',
  status: 'active',
  rules: { actions: [{ type: 'percentage_discount', value: 25 }] },
};

/** A $10-off cart promotion (fixed, in cents). */
const PROMO_10_FIXED = {
  id: 'promo-10',
  type: 'cart',
  status: 'active',
  rules: { actions: [{ type: 'fixed_discount', value: { amount: 1000, currency: 'USD' } }] },
};

/** A 20%-off cart promotion gated on a $50 minimum subtotal. */
const PROMO_20_MIN50 = {
  id: 'promo-20-min',
  type: 'cart',
  status: 'active',
  rules: {
    conditions: [{ type: 'cart_subtotal', operator: 'gte', value: { amount: 5000, currency: 'USD' } }],
    actions: [{ type: 'percentage_discount', value: 20 }],
  },
};

function coupon(code: string, promotionId: string, status = 'active') {
  return { id: `ci-${code}`, code, promotion_id: promotionId, status };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCouponInstances).mockResolvedValue([] as any);
  vi.mocked(listPromotions).mockResolvedValue([] as any);
});

describe('resolveCartDiscountCents (BMC-177)', () => {
  it('returns 0 when no codes are supplied', async () => {
    expect(await resolveCartDiscountCents(undefined, 10000)).toBe(0);
    expect(await resolveCartDiscountCents([], 10000)).toBe(0);
    expect(await resolveCartDiscountCents('', 10000)).toBe(0);
  });

  it('returns 0 for a zero subtotal without hitting the DB', async () => {
    expect(await resolveCartDiscountCents('SAVE25', 0)).toBe(0);
    expect(listCouponInstances).not.toHaveBeenCalled();
  });

  it('applies a 25%-off cart coupon against the catalog subtotal (acceptance case)', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('SAVE25', 'promo-25')] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_25_OFF] as any);
    // $100.00 subtotal → 25% → $25.00
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(2500);
  });

  it('matches coupon codes case-insensitively', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('SAVE25', 'promo-25')] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_25_OFF] as any);
    expect(await resolveCartDiscountCents('save25', 10000)).toBe(2500);
    expect(await resolveCartDiscountCents('  Save25 ', 10000)).toBe(2500);
  });

  it('applies a fixed cart discount capped at the subtotal', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('TENOFF', 'promo-10')] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_10_FIXED] as any);
    expect(await resolveCartDiscountCents('TENOFF', 10000)).toBe(1000);
    // Never exceeds the subtotal.
    expect(await resolveCartDiscountCents('TENOFF', 600)).toBe(600);
  });

  it('honors a cart_subtotal minimum condition', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('MIN50', 'promo-20-min')] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_20_MIN50] as any);
    // Below the $50 minimum → no discount.
    expect(await resolveCartDiscountCents('MIN50', 4999)).toBe(0);
    // At/above the minimum → 20%.
    expect(await resolveCartDiscountCents('MIN50', 5000)).toBe(1000);
  });

  it('fails closed for an inactive coupon', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('SAVE25', 'promo-25', 'disabled')] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_25_OFF] as any);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('fails closed for an inactive promotion', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('SAVE25', 'promo-25')] as any);
    vi.mocked(listPromotions).mockResolvedValue([{ ...PROMO_25_OFF, status: 'paused' }] as any);
    expect(await resolveCartDiscountCents('SAVE25', 10000)).toBe(0);
  });

  it('ignores non-cart promotions (shipping/product do not reduce the goods floor)', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([
      coupon('FREESHIP', 'promo-ship'),
      coupon('PROD30', 'promo-prod'),
    ] as any);
    vi.mocked(listPromotions).mockResolvedValue([
      { id: 'promo-ship', type: 'shipping', status: 'active', rules: { actions: [{ type: 'shipping_percentage_discount', value: 100 }] } },
      { id: 'promo-prod', type: 'product', status: 'active', rules: { actions: [{ type: 'item_percentage_discount', value: 30 }] } },
    ] as any);
    expect(await resolveCartDiscountCents('FREESHIP', 10000)).toBe(0);
    expect(await resolveCartDiscountCents('PROD30', 10000)).toBe(0);
  });

  it('fails closed for an unverifiable product_category condition on a cart promo', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('CATONLY', 'promo-cat')] as any);
    vi.mocked(listPromotions).mockResolvedValue([
      {
        id: 'promo-cat',
        type: 'cart',
        status: 'active',
        rules: {
          conditions: [{ type: 'product_category', operator: 'in', value: ['CAT-TEA'] }],
          actions: [{ type: 'percentage_discount', value: 25 }],
        },
      },
    ] as any);
    expect(await resolveCartDiscountCents('CATONLY', 10000)).toBe(0);
  });

  it('returns 0 for an unknown code', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('SAVE25', 'promo-25')] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_25_OFF] as any);
    expect(await resolveCartDiscountCents('NOPE', 10000)).toBe(0);
  });

  it('sums multiple valid cart coupons, capped at the subtotal', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([
      coupon('SAVE25', 'promo-25'),
      coupon('TENOFF', 'promo-10'),
    ] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_25_OFF, PROMO_10_FIXED] as any);
    // 25% of $100 ($25) + $10 = $35
    expect(await resolveCartDiscountCents(['SAVE25', 'TENOFF'], 10000)).toBe(3500);
    // Combined discount can never exceed the subtotal.
    expect(await resolveCartDiscountCents(['SAVE25', 'TENOFF'], 1000)).toBe(1000);
  });

  it('de-duplicates repeated codes so a coupon is only counted once', async () => {
    vi.mocked(listCouponInstances).mockResolvedValue([coupon('SAVE25', 'promo-25')] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_25_OFF] as any);
    expect(await resolveCartDiscountCents(['SAVE25', 'save25', ' SAVE25 '], 10000)).toBe(2500);
  });

  it('credits a promotion ONCE even when two distinct codes resolve to it (no double-credit under-pay)', async () => {
    // Two different bulk codes for the SAME 25%-off promotion. The cart store
    // dedups by promotionId, so the shopper's charge only ever reflects 25%.
    // The floor must match — crediting 25% ($25), not 50% ($50) — or a client
    // could stack same-promotion codes to under-pay (BMC-177 review, Finding 1).
    vi.mocked(listCouponInstances).mockResolvedValue([
      coupon('WELCOME25', 'promo-25'),
      coupon('PARTNER25', 'promo-25'),
    ] as any);
    vi.mocked(listPromotions).mockResolvedValue([PROMO_25_OFF] as any);
    expect(await resolveCartDiscountCents(['WELCOME25', 'PARTNER25'], 10000)).toBe(2500);
  });
});

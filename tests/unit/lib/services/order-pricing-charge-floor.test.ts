/**
 * Unit tests for verifyOrderChargeSufficient's tax + shipping floor (BMC-201).
 *
 * verifyOrderChargeSufficient is the single charge gate all three storefront
 * writers share (order creation, the Stripe webhook, and — as a fail-early guard —
 * payment-intent creation). BMC-201 extends its invariant from goods-only to:
 *
 *     paid + giftCardTender + TOLERANCE
 *         >= goods - discount + expectedShipping + expectedTax
 *
 * where expectedShipping / expectedTax are SERVER-computed values passed in. These
 * tests pin that arithmetic directly (the catalog + coupon seams are mocked; the
 * gate itself is real), including that a caller supplying neither keeps the exact
 * pre-BMC-201 goods-only floor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));
vi.mock('@/lib/models/mach/giftCard', () => ({
  getGiftCardByCode: vi.fn(),
}));
// No usable coupon → discount resolves to 0 unless a test wires one up.
vi.mock('@/lib/models/mach/couponInstance', () => ({
  getCouponInstanceByCode: vi.fn().mockResolvedValue(null),
  validateCouponInstance: vi.fn().mockReturnValue({ canBeUsed: false }),
}));
vi.mock('@/lib/models/mach/promotions', () => ({
  getPromotionById: vi.fn().mockResolvedValue(null),
  checkTimeValidity: vi.fn().mockReturnValue(false),
}));

import { verifyOrderChargeSufficient } from '@/lib/services/order-pricing';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };
const items = [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
});

describe('verifyOrderChargeSufficient tax + shipping floor (BMC-201)', () => {
  it('adds expected shipping + tax to the required floor', async () => {
    // goods 2500 + shipping 999 + tax 200 = 3699.
    const res = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 3699,
      expectedShippingCents: 999,
      expectedTaxCents: 200,
    });
    expect(res.ok).toBe(true);
    expect(res.requiredCashCents).toBe(3699);
    expect(res.shippingCents).toBe(999);
    expect(res.taxCents).toBe(200);
  });

  it('rejects a capture that omits the expected tax', async () => {
    const res = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 3499, // goods + shipping only
      expectedShippingCents: 999,
      expectedTaxCents: 200,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/shipping 999c, tax 200c/);
  });

  it('honours the cent tolerance at the tax/shipping-inclusive floor', async () => {
    const res = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 3695, // 4c under 3699, within the 5c tolerance
      expectedShippingCents: 999,
      expectedTaxCents: 200,
    });
    expect(res.ok).toBe(true);
  });

  it('credits a gift-card tender against the tax/shipping-inclusive floor', async () => {
    // floor 3699 - 1000 gift card = 2699 required cash.
    const res = await verifyOrderChargeSufficient({
      items,
      paidAmountCents: 2699,
      giftCardTenderCents: 1000,
      expectedShippingCents: 999,
      expectedTaxCents: 200,
    });
    expect(res.ok).toBe(true);
    expect(res.requiredCashCents).toBe(2699);
  });

  it('back-compat: no expected tax/shipping → the goods-only floor, unchanged', async () => {
    const res = await verifyOrderChargeSufficient({ items, paidAmountCents: 2500 });
    expect(res.ok).toBe(true);
    expect(res.requiredCashCents).toBe(2500);
    expect(res.shippingCents).toBe(0);
    expect(res.taxCents).toBe(0);
  });

  it('reports shipping + tax even when the catalog cannot price a line', async () => {
    const res = await verifyOrderChargeSufficient({
      items: [{ product_id: 'tea-1', variant_id: 'ghost', quantity: 1 }],
      paidAmountCents: 99999,
      expectedShippingCents: 999,
      expectedTaxCents: 200,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/cannot price order from catalog/);
    expect(res.shippingCents).toBe(999);
    expect(res.taxCents).toBe(200);
  });
});

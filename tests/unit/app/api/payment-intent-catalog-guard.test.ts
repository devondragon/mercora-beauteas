/**
 * Regression test for BMC-131 — the fail-early catalog guard in
 * POST /api/payment-intent (and the M6 unbounded-items cap).
 *
 * This route is the non-authoritative "fail fast" gate: it recomputes the goods
 * subtotal from the catalog and refuses to create a PaymentIntent whose `amount`
 * undercuts it, so a bogus charge is never even created. It must also refuse an
 * unreasonably large `items` array before that array drives one catalog lookup
 * per line (M6), which could otherwise exhaust Worker CPU.
 *
 * Pure unit test (CI `npm test`): Stripe + gift-card validation are mocked;
 * order-pricing is left real, with the catalog seam mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn().mockReturnValue(true),
  formatAmountForStripe: vi.fn((a: number) => Math.round(a * 100)),
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_new', client_secret: 'cs_new' }),
}));

vi.mock('@/lib/models/mach/giftCard', () => ({
  validateGiftCardForRedemption: vi.fn(),
  getGiftCardByCode: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

// The cart-discount recompute is exercised in discount-pricing.test.ts; here we
// mock it so we can pin THIS route's own discount-aware floor arithmetic (a
// separate check from verifyOrderChargeSufficient) deterministically.
vi.mock('@/lib/services/discount-pricing', () => ({
  resolveCartDiscountCents: vi.fn(),
  MAX_DISCOUNT_CODES: 25,
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/payment-intent/route';
import { createPaymentIntent } from '@/lib/stripe';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';
import { resolveCartDiscountCents, MAX_DISCOUNT_CODES } from '@/lib/services/discount-pricing';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const shippingAddress = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', recipient: 'A' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
  // Default: no cart discount unless a test opts in.
  vi.mocked(resolveCartDiscountCents).mockResolvedValue(0);
});

describe('POST /api/payment-intent catalog guard (BMC-131)', () => {
  const items = [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1 }];

  it('rejects an amount below the catalog floor with 400 amount_below_catalog', async () => {
    const res = await POST(
      postRequest({ amount: 0.5, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('amount_below_catalog');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('rejects an unpriceable item with 409 catalog_price_unavailable', async () => {
    const res = await POST(
      postRequest({
        amount: 25,
        taxAmount: 0,
        shippingAddress,
        orderId: 'WEB-X-1',
        items: [{ productId: 'tea-1', variantId: 'ghost', quantity: 1 }],
      })
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('catalog_price_unavailable');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('creates the PaymentIntent when the amount covers the catalog goods', async () => {
    const res = await POST(
      postRequest({ amount: 25, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });

  it('back-compat: with no items array it still creates the PaymentIntent', async () => {
    const res = await POST(
      postRequest({ amount: 25, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1' })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });

  it('M6: rejects an unreasonably large items array before pricing it', async () => {
    const many = Array.from({ length: 500 }, () => ({ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1 }));
    const res = await POST(
      postRequest({ amount: 1_000_000, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items: many })
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
    // Must reject WITHOUT doing 500 serial catalog lookups.
    expect(vi.mocked(getProductVariant).mock.calls.length).toBeLessThan(500);
  });

  describe('cart discount floor (BMC-177)', () => {
    it('credits the server-recomputed discount so a discounted amount clears the floor', async () => {
      // $25 goods, $6.25 recomputed discount → floor $18.75. Without the credit
      // this amount would be rejected as amount_below_catalog.
      vi.mocked(resolveCartDiscountCents).mockResolvedValue(625);
      const res = await POST(
        postRequest({ amount: 18.75, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items, discountCodes: ['SAVE25'] })
      );
      expect(res.status).toBe(200);
      expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
      // Recompute is driven by the server subtotal (2500c) + the order items,
      // never a client discount number — guards against a dropped param.
      expect(vi.mocked(resolveCartDiscountCents)).toHaveBeenCalledWith(['SAVE25'], 2500, expect.any(Array));
    });

    it('still rejects an amount below the DISCOUNTED floor', async () => {
      vi.mocked(resolveCartDiscountCents).mockResolvedValue(625);
      const res = await POST(
        postRequest({ amount: 5, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items, discountCodes: ['SAVE25'] })
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code?: string }).code).toBe('amount_below_catalog');
      expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
    });

    it('rejects too many discount codes before resolving any of them', async () => {
      const many = Array.from({ length: MAX_DISCOUNT_CODES + 5 }, (_, i) => `CODE${i}`);
      const res = await POST(
        postRequest({ amount: 25, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items, discountCodes: many })
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code?: string }).code).toBe('too_many_discount_codes');
      expect(vi.mocked(resolveCartDiscountCents)).not.toHaveBeenCalled();
      expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
    });
  });
});

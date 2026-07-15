/**
 * Regression test for BMC-201 — POST /api/payment-intent enforces a charge floor
 * that includes SERVER-computed shipping + tax, not just goods.
 *
 * Before BMC-201 the floor stopped at the catalog goods subtotal, so a client
 * could call this route directly with an `amount` that covered only goods and
 * `taxAmount: 0` and be handed a client secret for a PaymentIntent that later
 * promoted to a paid order with $0 tax collected. The floor now recomputes the
 * expected shipping (deterministic) and tax (via the shared checkout-charges /
 * Stripe-Tax seam) and rejects an amount that omits them — and stamps those
 * server figures on the pending order so finalization re-enforces the same total.
 *
 * Pure unit test (CI `npm test`): Stripe, gift-card, orders/customer models, and
 * Clerk auth are mocked; order-pricing + checkout-charges are left real, with the
 * catalog seam and Stripe Tax mocked. Stripe Tax returns a fixed $2.00 so the
 * arithmetic is deterministic; shipping is the real $9.99 (< $100 subtotal).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn().mockReturnValue(true),
  formatAmountForStripe: vi.fn((a: number) => Math.round(a * 100)),
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_new', client_secret: 'cs_new' }),
  cancelPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_new', status: 'canceled' }),
  // Stripe Tax returns a fixed $2.00 (200c) for a usable address.
  calculateTax: vi.fn().mockResolvedValue({ tax_amount_exclusive: 200 }),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/models/mach/giftCard', () => ({
  validateGiftCardForRedemption: vi.fn(),
  getGiftCardByCode: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  createOrder: vi.fn().mockResolvedValue({ id: 'WEB-X-1' }),
}));

vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn().mockResolvedValue({ id: 'existing' }),
  createCustomer: vi.fn(),
}));

// No cart discount in these tests — pin the resolver so the floor arithmetic is
// purely goods + shipping + tax.
vi.mock('@/lib/services/discount-pricing', () => ({
  resolveCartDiscountCents: vi.fn().mockResolvedValue(0),
  MAX_DISCOUNT_CODES: 25,
  MAX_RAW_DISCOUNT_CODES: 100,
  normalizeDiscountCodes: (codes: unknown) => {
    const raw = codes == null ? [] : Array.isArray(codes) ? codes : [codes];
    const seen = new Set<string>();
    for (const c of raw) {
      if (typeof c === 'string') {
        const n = c.trim().toUpperCase();
        if (n) seen.add(n);
      }
    }
    return [...seen];
  },
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/payment-intent/route';
import { createPaymentIntent } from '@/lib/stripe';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';
import { createOrder } from '@/lib/models/mach/orders';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };
const items = [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1 }];
const shippingAddress = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', recipient: 'A' };

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Order draft so persistence (and its stamped expected_* fields) is exercised. */
function orderDraft() {
  return {
    order_id: 'WEB-X-1',
    items: [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1, unit_price: { amount: 2500, currency: 'USD' }, total_price: { amount: 2500, currency: 'USD' }, product_name: 'Morning' }],
    total_amount: { amount: 3699, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: shippingAddress,
    billing_address: shippingAddress,
    shipping_method: 'standard',
    payment_method: 'stripe',
    extensions: { payment_intent_id: '' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(createOrder).mockResolvedValue({ id: 'WEB-X-1' } as any);
});

describe('POST /api/payment-intent tax/shipping floor (BMC-201)', () => {
  // goods $25.00 + shipping $9.99 + tax $2.00 = $36.99 floor.

  it('THE EXPLOIT: rejects an amount that covers goods + shipping but OMITS tax', async () => {
    // $34.99 = goods + shipping, tax dropped to $0 — the exact under-collection.
    const res = await POST(
      postRequest({ amount: 34.99, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('amount_below_catalog');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('rejects an amount that covers goods + tax but OMITS shipping', async () => {
    // $27.00 = goods + tax, shipping dropped — floor still $36.99.
    const res = await POST(
      postRequest({ amount: 27.0, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('amount_below_catalog');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('creates the PaymentIntent when the amount covers goods + shipping + tax', async () => {
    const res = await POST(
      postRequest({ amount: 36.99, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });

  it('stamps the server-computed expected shipping + tax on the pending order', async () => {
    const res = await POST(
      postRequest({ amount: 36.99, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items, order: orderDraft() })
    );
    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.extensions.expected_shipping_cents).toBe(999);
    expect(persisted.extensions.expected_tax_cents).toBe(200);
  });

  it('enforces the AK/HI shipping surcharge for the destination', async () => {
    // Ship to AK → shipping $19.99, so floor = 2500 + 1999 + 200 = 4699c. An
    // amount that would have cleared the CA floor ($36.99) is now rejected.
    const akAddress = { ...shippingAddress, region: 'AK' };
    const rejected = await POST(
      postRequest({ amount: 36.99, taxAmount: 2, shippingAddress: akAddress, orderId: 'WEB-X-1', items })
    );
    expect(rejected.status).toBe(400);
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();

    const accepted = await POST(
      postRequest({ amount: 46.99, taxAmount: 2, shippingAddress: akAddress, orderId: 'WEB-X-1', items })
    );
    expect(accepted.status).toBe(200);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });
});

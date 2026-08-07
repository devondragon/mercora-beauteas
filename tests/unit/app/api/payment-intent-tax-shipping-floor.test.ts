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
 * catalog seam, settings, and Stripe Tax mocked. Stripe Tax returns a fixed $2.00
 * so the arithmetic is deterministic; shipping is the settings floor $5.99 (cart
 * under the $75 free threshold) — the SAME source /api/shipping-options quotes.
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

// Settings drive the shipping floor → default {} = standard $5.99 cheapest
// method, free ≥ $75. Overridden in the free-shipping test.
vi.mock('@/lib/utils/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

// GOOB: this suite pins the BMC-201 tax/shipping floor arithmetic with
// single-item, single-quantity fixtures — it isn't about the box minimum
// (that has its own dedicated test, sale-minimum-order.test.ts). Pin
// minimumBoxes to 0 so the new gate never trips here.
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: vi.fn().mockResolvedValue({
    minimumBoxes: 0,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [],
  }),
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
import { getSettings } from '@/lib/utils/settings';

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
  vi.mocked(getSettings).mockResolvedValue({});
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue({ id: 'tea-1', type: 'Tea Bags', tax_category: 'food' } as any);
  vi.mocked(createOrder).mockResolvedValue({ id: 'WEB-X-1' } as any);
});

describe('POST /api/payment-intent tax/shipping floor (BMC-201)', () => {
  // goods $25.00 + shipping $5.99 (settings floor) + tax $2.00 = $32.99 floor.

  it('THE EXPLOIT: rejects an amount that covers goods + shipping but OMITS tax', async () => {
    // $30.99 = goods + shipping, tax dropped to $0 — the exact under-collection.
    const res = await POST(
      postRequest({ amount: 30.99, taxAmount: 0, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('amount_below_catalog');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('rejects an amount that covers goods + tax but OMITS shipping', async () => {
    // $27.00 = goods + tax, shipping dropped — floor still $32.99.
    const res = await POST(
      postRequest({ amount: 27.0, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('amount_below_catalog');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('creates the PaymentIntent when the amount covers goods + shipping + tax', async () => {
    const res = await POST(
      postRequest({ amount: 32.99, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });

  it('stamps the server-computed expected shipping + tax on the pending order', async () => {
    const res = await POST(
      postRequest({ amount: 32.99, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items, order: orderDraft() })
    );
    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.extensions.expected_shipping_cents).toBe(599);
    expect(persisted.extensions.expected_tax_cents).toBe(200);
  });

  it('does NOT false-reject when the shipping floor matches the storefront quote ($5.99, not calculateShipping $9.99)', async () => {
    // Regression guard for the BMC-201 review finding: the floor's shipping must
    // come from the SAME settings source /api/shipping-options quotes ($5.99), not
    // the unrelated calculateShipping model ($9.99). A customer paying the real
    // $5.99 standard rate (+ $2 tax) must clear the floor, which $36.99-based
    // calculateShipping would have wrongly rejected.
    const res = await POST(
      postRequest({ amount: 32.99, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items })
    );
    expect(res.status).toBe(200);
  });

  it('drops the shipping term when the cart qualifies for free shipping (≥ $75)', async () => {
    // `free_methods` stated explicitly — the module default is empty now, so
    // nothing is free unless configured. This pins the floor's free-shipping
    // arithmetic, which has to keep working if a store re-enables it.
    vi.mocked(getSettings).mockImplementation(async (category?: string) =>
      (category === 'shipping' ? { 'shipping.free_methods': ['standard'] } : {}) as any
    );

    // 4 × $25 = $100 goods ≥ $75 threshold → standard shipping free → floor shipping 0.
    const fourItems = [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 4 }];
    // Floor = 10000 goods + 0 shipping + 200 tax = 10200c ($102.00).
    const rejected = await POST(
      postRequest({ amount: 101.5, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items: fourItems })
    );
    expect(rejected.status).toBe(400); // below the $102 tax-inclusive floor
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();

    const accepted = await POST(
      postRequest({ amount: 102.0, taxAmount: 2, shippingAddress, orderId: 'WEB-X-1', items: fourItems })
    );
    expect(accepted.status).toBe(200);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });
});

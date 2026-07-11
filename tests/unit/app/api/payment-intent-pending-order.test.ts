/**
 * Regression test for BMC-167 — POST /api/payment-intent persists a server-side
 * PENDING order keyed to the minted PaymentIntent.
 *
 * This is the crux of the fix: an order row must exist BEFORE the shopper can
 * pay, so the Stripe webhook can promote it to paid even if the client-side POST
 * /api/orders never lands (redirect payment method returning in a different
 * browser, cleared localStorage, closed tab). The route only hands back a client
 * secret once the pending order is persisted — it never exposes a payable
 * PaymentIntent that has no order behind it.
 *
 * Pure unit test: Stripe, the orders model, Clerk auth, and gift-card validation
 * are mocked; order-pricing is left real with the catalog seam mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn().mockReturnValue(true),
  formatAmountForStripe: vi.fn((a: number) => Math.round(a * 100)),
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_minted', client_secret: 'pi_minted_secret_abc' }),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
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

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/payment-intent/route';
import { createPaymentIntent } from '@/lib/stripe';
import { getProductVariant } from '@/lib/models/mach/products';
import { createOrder } from '@/lib/models/mach/orders';
import { auth } from '@clerk/nextjs/server';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };
const shippingAddress = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', recipient: 'A' };

/** A minimal order draft as buildCreateOrderBody produces it (no PI id yet). */
function orderDraft(overrides: Record<string, any> = {}) {
  return {
    order_id: 'WEB-X-1',
    items: [
      {
        product_id: 'tea-1',
        variant_id: 'var-tea-1',
        quantity: 1,
        unit_price: { amount: 2500, currency: 'USD' },
        total_price: { amount: 2500, currency: 'USD' },
        product_name: 'Morning',
      },
    ],
    total_amount: { amount: 3499, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: shippingAddress,
    billing_address: shippingAddress,
    shipping_method: 'standard',
    payment_method: 'stripe',
    extensions: { payment_intent_id: '', shipping_cost: 999, tax_amount: 0, subtotal: 2500 },
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, any> = {}) {
  return {
    amount: 34.99,
    taxAmount: 0,
    shippingAddress,
    orderId: 'WEB-X-1',
    items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1 }],
    order: orderDraft(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: null } as any);
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(createOrder).mockResolvedValue({ id: 'WEB-X-1' } as any);
});

describe('POST /api/payment-intent pending-order persistence (BMC-167)', () => {
  it('persists a pending order stamped with the MINTED PaymentIntent id, then returns the client secret', async () => {
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.clientSecret).toBe('pi_minted_secret_abc');
    expect(json.paymentIntentId).toBe('pi_minted');

    expect(vi.mocked(createOrder)).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.id).toBe('WEB-X-1');
    // The server injects the id it minted onto BOTH lookup keys, never trusting
    // the client's (empty) draft value.
    expect(persisted.extensions.payment_intent_id).toBe('pi_minted');
    expect(persisted.external_references.payment_intent_id).toBe('pi_minted');
    // Guest checkout → no customer id bound.
    expect(persisted.customer_id).toBeUndefined();
  });

  it('binds the pending order to the authenticated customer (never the client draft)', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_42' } as any);
    const res = await POST(postRequest(baseBody({ order: orderDraft({ customer_id: 'user_impersonated' }) })));
    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.customer_id).toBe('user_42');
  });

  it('a duplicate pending order (PK collision) is tolerated — still returns the client secret', async () => {
    vi.mocked(createOrder).mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: orders.id'));
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.clientSecret).toBe('pi_minted_secret_abc');
  });

  it('refuses to return a client secret if the pending order cannot be persisted (order-less payment)', async () => {
    vi.mocked(createOrder).mockRejectedValue(new Error('D1_ERROR: network connection lost'));
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(500);
    const json = (await res.json()) as any;
    expect(json.code).toBe('pending_order_persist_failed');
    expect(json.clientSecret).toBeUndefined();
    // The PaymentIntent was minted, but we did NOT expose its secret.
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });

  it('back-compat: an older client that sends no order draft still gets a PaymentIntent (no pending order)', async () => {
    const { order, ...noDraft } = baseBody();
    const res = await POST(postRequest(noDraft));
    expect(res.status).toBe(200);
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });
});

/**
 * Regression test for BMC-131 (webhook enforcement + H1/H2).
 *
 * `payment_intent.succeeded` is the second writer that can flip an order to
 * paid. It must run the SAME catalog sufficiency check as order creation, and
 * it must handle the two failure modes distinctly:
 *
 *  - Underpayment (charge.ok === false) is PERMANENT: skip markOrderPaid, leave
 *    the order pending, and return 200 so the event is recorded processed (no
 *    Stripe retry storm).
 *  - H2: a THROW inside the check (e.g. a transient D1 error reading the
 *    catalog) is TRANSIENT: it must propagate so the route returns 500 and
 *    Stripe redelivers — otherwise a legitimately-paid order is stranded pending
 *    forever with the event marked processed.
 *  - H1: if the order relied on gift-card tender but redemption applied nothing,
 *    the order is reverted from paid back to pending.
 *
 * Pure unit test (CI `npm test`): Stripe, subscriptions, handlers, orders model,
 * gift-card fulfillment and the catalog seams are all mocked; order-pricing is
 * left real so the wiring itself is under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeEvent } = vi.hoisted(() => ({
  fakeEvent: {
    id: 'evt_pi_1',
    type: 'payment_intent.succeeded',
    data: {
      object: { id: 'pi_1', metadata: { orderId: 'WEB-GUEST-1' }, amount_received: 2999 },
    },
  },
}));

vi.mock('@/lib/stripe', () => ({
  verifyWebhookSignature: vi.fn().mockResolvedValue(fakeEvent),
  getWebhookSecret: vi.fn().mockReturnValue('whsec_test'),
}));

vi.mock('@/lib/models/mach/subscriptions', () => ({
  claimWebhookEvent: vi.fn().mockResolvedValue(true),
  releaseWebhookEventClaim: vi.fn().mockResolvedValue(undefined),
  cleanupOldWebhookEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/subscription-handlers', () => ({
  handleSubscriptionCreated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/invoice-handlers', () => ({
  handleInvoicePaymentSucceeded: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue(undefined),
  handleInvoiceUpcoming: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrderById: vi.fn(),
  markOrderPaid: vi.fn().mockResolvedValue({ id: 'WEB-GUEST-1' }),
  markOrderUnpaid: vi.fn().mockResolvedValue({ id: 'WEB-GUEST-1' }),
}));

vi.mock('@/lib/services/gift-card-fulfillment', () => ({
  processGiftCardsForOrder: vi.fn().mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: [] }),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));
vi.mock('@/lib/models/mach/giftCard', () => ({
  getGiftCardByCode: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/stripe/route';
import { getOrderById, markOrderPaid, markOrderUnpaid } from '@/lib/models/mach/orders';
import { processGiftCardsForOrder } from '@/lib/services/gift-card-fulfillment';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';
import { getGiftCardByCode } from '@/lib/models/mach/giftCard';
import { releaseWebhookEventClaim } from '@/lib/models/mach/subscriptions';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };

function order(overrides: Record<string, any> = {}) {
  return {
    id: 'WEB-GUEST-1',
    items: [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }],
    extensions: null,
    ...overrides,
  };
}

function makeRequest() {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: JSON.stringify({ id: fakeEvent.id }),
    headers: { 'stripe-signature': 't=1,v1=test' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeEvent.data.object.amount_received = 2999;
  fakeEvent.data.object.metadata = { orderId: 'WEB-GUEST-1' };
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(getGiftCardByCode).mockResolvedValue(null as any);
  vi.mocked(getOrderById).mockResolvedValue(order() as any);
  vi.mocked(processGiftCardsForOrder).mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: [] });
});

describe('POST /api/webhooks/stripe payment_intent.succeeded charge gate (BMC-131)', () => {
  it('happy path: sufficient capture marks the order paid, returns 200', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vi.mocked(markOrderPaid)).toHaveBeenCalledTimes(1);
  });

  it('THE EXPLOIT: an underpaid ($0.50) succeeded PI is NOT marked paid, returns 200 (no retry)', async () => {
    fakeEvent.data.object.amount_received = 50;
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vi.mocked(markOrderPaid)).not.toHaveBeenCalled();
  });

  it('H2: a transient error while pricing the catalog returns 500 and releases the claim (retryable)', async () => {
    vi.mocked(getProductVariant).mockRejectedValue(new Error('D1 unavailable'));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(vi.mocked(releaseWebhookEventClaim)).toHaveBeenCalledWith(fakeEvent.id);
    expect(vi.mocked(markOrderPaid)).not.toHaveBeenCalled();
  });

  it('H1: gift-card tender counted but not redeemed reverts the order to pending', async () => {
    fakeEvent.data.object.amount_received = 0; // fully covered by gift card... supposedly
    vi.mocked(getOrderById).mockResolvedValue(
      order({ extensions: { gift_card: { code: 'GC-1', amount: 2500 } } }) as any
    );
    vi.mocked(getGiftCardByCode).mockResolvedValue({ code: 'GC-1', status: 'active', balance: 2500 } as any);
    vi.mocked(processGiftCardsForOrder).mockResolvedValue({
      issued: 0,
      redeemed: 0,
      redeemedAmount: 0,
      errors: ['Gift card redemption failed: insufficient balance'],
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vi.mocked(markOrderUnpaid)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markOrderUnpaid).mock.calls[0][0]).toBe('WEB-GUEST-1');
  });
});

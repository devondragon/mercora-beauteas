/**
 * Webhook wiring test for BMC-131 + BMC-167.
 *
 * `payment_intent.succeeded` is the SERVER-SIDE backstop that finalizes a
 * storefront order when the client-side POST /api/orders never lands. Since
 * BMC-167 the order row is pre-persisted (pending) at PaymentIntent creation, so
 * the webhook FINDS it and delegates promotion to the shared `finalizePaidOrder`
 * (whose charge gate / CAS / H1 / H2 internals are unit-tested in
 * tests/unit/lib/services/order-finalization.test.ts). This test pins how the
 * ROUTE reacts to each finalize outcome:
 *
 *  - order not found yet → retryable 500 (Stripe redelivers; the pending order
 *    should exist, but a redelivery may race a slow commit).
 *  - order already paid (client POST won) → skip, 200, no double finalize.
 *  - finalize THROWS (transient, e.g. D1 pricing error) → retryable 500, claim
 *    released so Stripe can retry (H2).
 *  - finalize returns { paid:false, reason } (permanent underpayment) → 200, NO
 *    retry (event recorded processed, order left pending).
 *  - finalize succeeds → 200.
 *
 * Pure unit test: Stripe, subscriptions, handlers, orders model and
 * finalizePaidOrder are mocked.
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
}));

vi.mock('@/lib/services/order-finalization', () => ({
  finalizePaidOrder: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/stripe/route';
import { getOrderById } from '@/lib/models/mach/orders';
import { finalizePaidOrder } from '@/lib/services/order-finalization';
import { releaseWebhookEventClaim } from '@/lib/models/mach/subscriptions';

function order(overrides: Record<string, any> = {}): any {
  return {
    id: 'WEB-GUEST-1',
    status: 'pending',
    payment_status: 'pending',
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
  vi.mocked(getOrderById).mockResolvedValue(order());
  vi.mocked(finalizePaidOrder).mockResolvedValue({ paid: true, promotedByUs: true });
});

describe('POST /api/webhooks/stripe payment_intent.succeeded (BMC-131 + BMC-167)', () => {
  it('BMC-167: promotes the pre-persisted pending order with the CAPTURED amount, 200', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vi.mocked(finalizePaidOrder)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(finalizePaidOrder).mock.calls[0][0];
    expect(arg.paidAmountCents).toBe(2999); // amount_received, never authorized pi.amount
    expect(arg.order.id).toBe('WEB-GUEST-1');
    expect(arg.sendEmail).toBe(true); // webhook path sends the confirmation email
  });

  it('order not found yet → retryable 500 and the claim is released (Stripe redelivers)', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(vi.mocked(releaseWebhookEventClaim)).toHaveBeenCalledWith(fakeEvent.id);
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('order already paid (client POST won the race) → skip finalize, 200 (no duplicate)', async () => {
    vi.mocked(getOrderById).mockResolvedValue(order({ payment_status: 'paid', status: 'processing' }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('H2: finalize THROWS (transient) → retryable 500 and the claim is released', async () => {
    vi.mocked(finalizePaidOrder).mockRejectedValue(new Error('D1 unavailable'));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(vi.mocked(releaseWebhookEventClaim)).toHaveBeenCalledWith(fakeEvent.id);
  });

  it('THE EXPLOIT: permanent underpayment ({ paid:false, reason }) → 200, NO retry', async () => {
    fakeEvent.data.object.amount_received = 50;
    vi.mocked(finalizePaidOrder).mockResolvedValue({ paid: false, promotedByUs: false, reason: 'paid 50c is less than required 2500c' });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vi.mocked(releaseWebhookEventClaim)).not.toHaveBeenCalled(); // permanent → recorded processed
  });

  it('L4: an H1 gift-card revert ({ paid:false, reverted:true, reason }) is handled — 200, NO retry', async () => {
    // finalizePaidOrder promoted then reverted (tender not redeemed); it carries
    // a reason so the webhook's !paid-with-reason branch logs it instead of
    // silently leaving the order pending. This is permanent, not retryable.
    vi.mocked(finalizePaidOrder).mockResolvedValue({
      paid: false,
      promotedByUs: true,
      reverted: true,
      reason: 'gift-card tender (2500c) counted toward payment but redemption applied nothing; reverted to pending',
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vi.mocked(releaseWebhookEventClaim)).not.toHaveBeenCalled();
  });
});

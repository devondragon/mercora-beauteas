/**
 * BMC-172 regression guard, pinned during BMC-212.
 *
 * The refund route reserves a deterministic `Idempotency-Key` in D1 BEFORE
 * calling Stripe, so a duplicate submit (or a retry of an interrupted refund)
 * reuses the original Stripe refund instead of paying the customer twice. The
 * key derivation and ledger reconciliation are unit-tested in
 * tests/unit/lib/payments/**; what is NOT covered anywhere is the last hop —
 * that the reserved key actually REACHES Stripe.
 *
 * BMC-212 deleted the `CloudflareStripe` branch that sent the key as a raw
 * `Idempotency-Key` HTTP header via a private `request()` method. The SDK takes
 * it as a SECOND OPTIONS ARGUMENT instead, which is easy to drop silently: the
 * refund still succeeds, it just stops being idempotent. That failure is
 * invisible until a customer is double-refunded.
 *
 * NOTE: this is a characterization test, not a red-green one. The BMC-212 change
 * removes a dead branch rather than altering behaviour, so it passes both before
 * and after — its job is to make a future regression loud.
 *
 * Pure unit test: every Cloudflare/Stripe/auth seam mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted: vi.mock factories are lifted above module-scope consts.
const { IDEMPOTENCY_KEY, REFUND_AMOUNT, refundsCreate } = vi.hoisted(() => ({
  IDEMPOTENCY_KEY: 'refund:c0ffee0123456789',
  REFUND_AMOUNT: 2500,
  refundsCreate: vi.fn(),
}));

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ success: true }),
  PERMISSIONS: { ORDERS_UPDATE: 'orders:update' },
}));

vi.mock('@/lib/stripe', () => ({
  getStripeClient: vi.fn(() => ({ refunds: { create: refundsCreate } })),
}));

vi.mock('@/lib/payments/refund-ledger', () => ({
  decideRefundLedgerAction: vi.fn().mockResolvedValue({
    action: 'reserve',
    idempotencyKey: IDEMPOTENCY_KEY,
    refundAmount: REFUND_AMOUNT,
    priorRefundCount: 0,
  }),
}));

vi.mock('@/lib/services/inventory-adjustment', () => ({
  restockForOrder: vi.fn().mockResolvedValue(undefined),
  selectRestockLines: vi.fn(() => ({ lines: [], keys: [] })),
}));

vi.mock('@/lib/utils/email', () => ({
  sendOrderStatusUpdateEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/utils/observe', () => ({ logCritical: vi.fn() }));

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

import { NextRequest } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { POST } from '@/app/api/orders/refund/route';

/** An order with a payment intent and an empty refund ledger. */
function makeOrder() {
  return {
    id: 'WEB-USER-1',
    status: 'processing',
    payment_status: 'paid',
    updated_at: '2026-07-30T00:00:00.000Z',
    notes: '',
    items: [],
    total_amount: { amount: 10000, currency: 'USD' },
    extensions: { payment_intent_id: 'pi_test_1' },
  };
}

/** Minimal drizzle-shaped fake: select→[order], update→[row]. */
function makeDb(order: any) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([order]) }) }),
    update: () => ({
      set: (data: any) => ({
        where: () => ({ returning: () => Promise.resolve([{ ...order, ...data }]) }),
      }),
    }),
  };
}

function refundRequest() {
  return new NextRequest('http://localhost/api/orders/refund', {
    method: 'POST',
    body: JSON.stringify({
      orderId: 'WEB-USER-1',
      type: 'full',
      reason: 'requested_by_customer',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  refundsCreate.mockResolvedValue({ id: 're_test_1', status: 'succeeded' });
  vi.mocked(getDbAsync).mockResolvedValue(makeDb(makeOrder()) as any);
});

describe('POST /api/orders/refund — Stripe idempotency (BMC-172)', () => {
  it('passes the reserved idempotency key to Stripe as the SDK options argument', async () => {
    const res = await POST(refundRequest());

    expect(res.status).toBe(200);
    expect(refundsCreate).toHaveBeenCalledTimes(1);

    const [params, options] = refundsCreate.mock.calls[0];
    expect(options).toEqual({ idempotencyKey: IDEMPOTENCY_KEY });
    expect(params).toMatchObject({
      payment_intent: 'pi_test_1',
      amount: REFUND_AMOUNT,
    });
  });

  it('does not smuggle the key into the refund params instead of the options', async () => {
    await POST(refundRequest());

    const [params] = refundsCreate.mock.calls[0];
    expect(params).not.toHaveProperty('idempotencyKey');
    expect(params).not.toHaveProperty('idempotency_key');
  });
});

/**
 * Regression test for BMC-158 — PUT /api/orders hardening (follow-up to
 * BMC-140). Verifies the route wiring of the two guards:
 *
 *  1. Setting status → 'refunded'/'cancelled' via PUT is rejected (422) and no
 *     DB write happens. Those statuses are owned by POST /api/orders/refund.
 *  2. A PUT that overwrites `extensions` cannot rebind (or drop)
 *     `extensions.payment_intent_id` — the refund route trusts it. The stored
 *     value is pinned back into the persisted payload.
 *
 * Mocks every module that would otherwise reach getDbAsync() / Cloudflare /
 * Clerk / Stripe so this stays a pure unit test (mirrors
 * orders-put-payment-status.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth/unified-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/unified-auth')>(
    '@/lib/auth/unified-auth'
  );
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue({
      success: true,
      tokenInfo: { id: 1, tokenName: 'automation-token', permissions: ['orders:update_status'], lastUsedAt: null },
    }),
  };
});

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
}));

vi.mock('@/lib/utils/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue({ success: true, id: 'email_1' }),
  sendOrderStatusUpdateEmail: vi.fn().mockResolvedValue({ success: true, id: 'email_2' }),
}));

vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn(),
  createCustomer: vi.fn(),
}));

vi.mock('@/lib/services/gift-card-fulfillment', () => ({
  processGiftCardsForOrder: vi.fn(),
  orderInvolvesGiftCards: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrdersByCustomer: vi.fn(),
  getOrderById: vi.fn(),
  createOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderShipping: vi.fn(),
}));

vi.mock('@/lib/models/order', () => ({
  getOrdersByCustomerId: vi.fn(),
  insertOrder: vi.fn(),
}));

function makeSelectChain(resolvedRows: any[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolvedRows),
  };
}
function makeUpdateChain(resolvedRows: any[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(resolvedRows),
  };
}

const existingOrderRow = {
  id: 'WEB-TEST-1000',
  customer_id: 'user_1',
  status: 'processing',
  total_amount: { amount: 2500, currency: 'USD' },
  currency_code: 'USD',
  shipping_address: null,
  billing_address: null,
  items: [],
  shipping_method: null,
  payment_method: null,
  payment_status: 'paid',
  tracking_number: null,
  shipped_at: null,
  delivered_at: null,
  notes: null,
  external_references: null,
  extensions: { payment_intent_id: 'pi_real_123', carrier: 'UPS' },
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { PUT } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';

const url = 'http://localhost/api/orders';

function putRequest(body: unknown) {
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/orders refund-owned status guard (BMC-158)', () => {
  it('rejects status:"refunded" with 422 and performs no DB write', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([existingOrderRow]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status: 'refunded' }));

    expect(res.status).toBe(422);
    expect(updateChain.set).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/refund/i);
  });

  it('rejects status:"cancelled" with 422 and performs no DB write', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([existingOrderRow]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status: 'cancelled' }));

    expect(res.status).toBe(422);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('still allows a normal fulfillment status (shipped)', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([{ ...existingOrderRow, status: 'shipped' }]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status: 'shipped' }));

    expect(res.status).toBe(200);
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    expect(updateChain.set.mock.calls[0][0].status).toBe('shipped');
  });
});

describe('PUT /api/orders payment_intent_id protection (BMC-158)', () => {
  it('pins the stored PI id when a PUT extensions overwrite tries to rebind it', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([{ ...existingOrderRow, status: 'shipped' }]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        status: 'shipped',
        extensions: { payment_intent_id: 'pi_attacker', carrier: 'FedEx' },
      })
    );

    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    // The immutable PI binding is restored; the other extensions key applies.
    expect(setArg.extensions.payment_intent_id).toBe('pi_real_123');
    expect(setArg.extensions.carrier).toBe('FedEx');
  });

  it('restores the stored PI id when a PUT extensions overwrite would drop it', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([{ ...existingOrderRow, status: 'shipped' }]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        status: 'shipped',
        extensions: { carrier: 'FedEx' },
      })
    );

    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.extensions.payment_intent_id).toBe('pi_real_123');
  });
});

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

describe('PUT /api/orders refund-owned status guard (BMC-158 → BMC-216F)', () => {
  it('rejects status:"refunded" with 400 and performs no DB write', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([existingOrderRow]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status: 'refunded' }));

    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('POST /api/orders/refund');
  });

  it('rejects status:"cancelled" with 400 and performs no DB write', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([existingOrderRow]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status: 'cancelled' }));

    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('POST /api/orders/refund');
  });

  it('still allows an allowlisted metadata update (notes)', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([{ ...existingOrderRow, notes: 'metadata still updates' }]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', notes: 'metadata still updates' }));

    expect(res.status).toBe(200);
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.notes).toBe('metadata still updates');
    expect(setArg).not.toHaveProperty('status');
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
        extensions: { payment_intent_id: 'pi_attacker', carrier: 'FedEx' },
      })
    );

    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    // The immutable PI binding is restored; the client's carrier is stripped
    // (BMC-216F) so the stored 'UPS' survives.
    expect(setArg.extensions.payment_intent_id).toBe('pi_real_123');
    expect(setArg.extensions.carrier).toBe('UPS');
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
        extensions: { gift_note: 'x' },
      })
    );

    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.extensions.payment_intent_id).toBe('pi_real_123');
  });
});

// An order carrying a stored refunds[] ledger. computeRefundedTotal sums this
// to enforce the over-refund guard, so a PUT must never wipe it via a partial
// `extensions` overwrite (BMC-158 review — double-refund vector).
const orderWithRefunds = {
  ...existingOrderRow,
  extensions: {
    payment_intent_id: 'pi_real_123',
    refunds: [{ amount: 500 }, { amount: 250 }],
    email: 'customer@example.com',
    restockedLineKeys: ['sku-1'],
  },
};

describe('PUT /api/orders extensions merge preserves refunds ledger (BMC-158)', () => {
  it('a partial extensions overwrite ({gift_note}) persists a payload that STILL contains refunds[]', async () => {
    const selectChain = makeSelectChain([orderWithRefunds]);
    const updateChain = makeUpdateChain([orderWithRefunds]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        extensions: { gift_note: 'x' },
      })
    );

    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    // The client's key applies…
    expect(setArg.extensions.gift_note).toBe('x');
    // …and the server-owned refund ledger survives (was NOT wiped).
    expect(setArg.extensions.refunds).toEqual([{ amount: 500 }, { amount: 250 }]);
    expect(setArg.extensions.email).toBe('customer@example.com');
    expect(setArg.extensions.restockedLineKeys).toEqual(['sku-1']);
    expect(setArg.extensions.payment_intent_id).toBe('pi_real_123');
  });

  it('a PUT omitting extensions does not write the extensions column (stored PI + refunds untouched)', async () => {
    const selectChain = makeSelectChain([orderWithRefunds]);
    const updateChain = makeUpdateChain([{ ...orderWithRefunds, notes: 'packed' }]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(
      putRequest({ orderId: 'WEB-TEST-1000', notes: 'packed' })
    );

    expect(res.status).toBe(200);
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.notes).toBe('packed');
    // extensions is not in the update payload at all, so the stored value
    // (including refunds[] + payment_intent_id) is left intact.
    expect(setArg).not.toHaveProperty('extensions');
  });

  it('rejects (422) a PUT when the stored extensions are corrupt, without writing', async () => {
    const corruptOrder = { ...existingOrderRow, extensions: '{ not valid json' };
    const selectChain = makeSelectChain([corruptOrder]);
    const updateChain = makeUpdateChain([corruptOrder]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        extensions: { gift_note: 'x' },
      })
    );

    expect(res.status).toBe(422);
    expect(updateChain.set).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/corrupt/i);
  });
});

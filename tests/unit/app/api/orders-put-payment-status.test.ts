/**
 * Regression test for BMC-140 / H3 — unverified payment_status writes via
 * PUT /api/orders.
 *
 * The PUT handler is gated by ORDERS_UPDATE, a permission scoped for
 * webhooks/automation (not full admin). Before the fix, it wrote any
 * client-supplied `payment_status` straight into the orders table with zero
 * Stripe verification — a caller holding only that scoped credential could
 * flip an unpaid order to 'paid' (or 'refunded') without ever touching
 * Stripe. This reintroduced the unpaid-order bug via the admin PUT path,
 * even though order creation (POST, same file) already verifies payment via
 * retrievePaymentIntent before marking an order paid.
 *
 * The fix drops any client-supplied payment_status on this route entirely:
 * payment_status now has exactly two legitimate writers (order creation and
 * the Stripe webhook's markOrderPaid()), both of which verify against Stripe
 * first, plus the dedicated /api/orders/refund route (which only sets it
 * after actually creating a Stripe refund). This test asserts that an
 * attempted payment_status write is dropped from the DB update payload while
 * a normal fulfillment/status update still goes through untouched.
 *
 * Runs in the jsdom unit env (CI `npm test`). authenticateRequest is mocked
 * to simulate an already-authenticated ORDERS_UPDATE caller (the auth gate
 * itself isn't what's under test here — BMC-128/BMC-130-style tests cover
 * gating elsewhere). Every module that would otherwise reach getDbAsync() /
 * @opennextjs/cloudflare / @clerk/nextjs/server / Stripe is mocked so this
 * stays a pure unit test with no Cloudflare Workers runtime dependency; only
 * lib/db/schema/order.ts (plain Drizzle table definitions) and drizzle-orm's
 * `eq()` are left real, since neither touches any binding.
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

// Chainable fake Drizzle query builder. `.from()`/`.set()`/`.where()` return
// `this` so `db.select().from(orders).where(...).limit(1)` and
// `db.update(orders).set(...).where(...).returning()` both resolve.
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
  extensions: { payment_intent_id: 'pi_real_123' },
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

describe('PUT /api/orders payment_status guard (BMC-140 / H3)', () => {
  it('drops a client-supplied payment_status:"paid" instead of writing it to the order', async () => {
    const selectChain = makeSelectChain([{ ...existingOrderRow, status: 'pending', payment_status: 'pending' }]);
    const updateChain = makeUpdateChain([{ ...existingOrderRow, status: 'processing', payment_status: 'pending' }]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(
      putRequest({ orderId: 'WEB-TEST-1000', status: 'processing', payment_status: 'paid' })
    );

    expect(res.status).toBe(200);

    // The write payload passed to db.update(orders).set(...) must not carry
    // the client-supplied payment_status through — that field has exactly
    // two legitimate writers (verified order creation, Stripe webhook) plus
    // the /refund route, none of which is this handler.
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg).not.toHaveProperty('payment_status');
    // The legitimate part of the same request (status) must still apply.
    expect(setArg.status).toBe('processing');
  });

  it('still applies a normal, non-payment status/tracking update', async () => {
    const selectChain = makeSelectChain([existingOrderRow]);
    const updateChain = makeUpdateChain([{ ...existingOrderRow, status: 'shipped', tracking_number: '1Z999' }]);
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(
      putRequest({ orderId: 'WEB-TEST-1000', status: 'shipped', tracking_number: '1Z999' })
    );

    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.status).toBe('shipped');
    expect(setArg.tracking_number).toBe('1Z999');
    expect(setArg).not.toHaveProperty('payment_status');

    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('shipped');
  });
});

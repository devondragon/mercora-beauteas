/**
 * BMC-216F — PUT /api/orders is reduced to an explicit metadata allowlist.
 * Every lifecycle/fulfillment field is rejected with a 400 naming the correct
 * endpoint; each rejection is the ATTACK (a client trying to set fulfillment
 * state through the legacy generic path). Also pins: no email is ever sent
 * from this route anymore, and the extensions merge protections survive.
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

vi.mock('@/lib/stripe', () => ({ retrievePaymentIntent: vi.fn() }));

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

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

import { NextRequest } from 'next/server';
import { PUT } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';
import { sendOrderStatusUpdateEmail } from '@/lib/utils/email';
import { MAX_CAS_ATTEMPTS } from '@/lib/payments/refund-ledger-store';

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
  extensions: {
    payment_intent_id: 'pi_real_123',
    carrier: 'ups',
    refunds: [{ amount: 500 }],
    email: 'customer@example.com',
  },
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const url = 'http://localhost/api/orders';
function putRequest(body: unknown) {
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function wireDb(rows: any[] = [existingOrderRow], updated: any[] = [existingOrderRow]) {
  const selectChain = makeSelectChain(rows);
  const updateChain = makeUpdateChain(updated);
  vi.mocked(getDbAsync).mockResolvedValue({
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
  } as any);
  return { selectChain, updateChain };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/orders fulfillment-field rejection (BMC-216F)', () => {
  it('rejects a status write with 400 naming the ship endpoint, no DB write, no email', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status: 'shipped' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('POST /api/admin/orders/{id}/ship');
    expect(updateChain.set).not.toHaveBeenCalled();
    expect(sendOrderStatusUpdateEmail).not.toHaveBeenCalled();
  });

  it('rejects a tracking_number write with 400 naming the tracking endpoint', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', tracking_number: '1Z999' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('PATCH /api/admin/orders/{id}/tracking');
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it.each([
    ['shipped_at', '2026-07-30T12:00:00Z'],
    ['delivered_at', '2026-07-30T12:00:00Z'],
    ['shipping_method', 'overnight'],
    ['trackingUrl', 'https://evil.example/x'],
    ['tracking_url', 'https://evil.example/x'],
  ])('rejects client-supplied %s with 400 and no DB write', async (field, value) => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', [field]: value }));
    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('rejects refund-owned statuses with 400 whose message names the refund endpoint', async () => {
    const { updateChain } = wireDb();
    for (const status of ['cancelled', 'refunded']) {
      const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', status }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('POST /api/orders/refund');
    }
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});

describe('PUT /api/orders allowlisted metadata updates (BMC-216F)', () => {
  it('updates notes without sending any email and without touching fulfillment columns', async () => {
    const { updateChain } = wireDb(
      [existingOrderRow],
      [{ ...existingOrderRow, notes: 'leave at side door' }]
    );
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', notes: 'leave at side door' }));
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.notes).toBe('leave at side door');
    expect(setArg).not.toHaveProperty('status');
    expect(setArg).not.toHaveProperty('tracking_number');
    expect(setArg).not.toHaveProperty('shipped_at');
    expect(setArg).not.toHaveProperty('delivered_at');
    expect(setArg).not.toHaveProperty('shipping_method');
    expect(sendOrderStatusUpdateEmail).not.toHaveBeenCalled();
  });

  it('merged extensions keep the refund ledger + PI pin and drop client carrier/trackingUrl', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        extensions: {
          payment_intent_id: 'pi_attacker',
          carrier: 'AttackerExpress',
          trackingUrl: 'https://evil.example/phish',
          gift_note: 'happy birthday',
        },
      })
    );
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.extensions.payment_intent_id).toBe('pi_real_123');
    expect(setArg.extensions.refunds).toEqual([{ amount: 500 }]);
    expect(setArg.extensions.email).toBe('customer@example.com');
    expect(setArg.extensions.carrier).toBe('ups');                       // stored survives
    expect(setArg.extensions).not.toHaveProperty('trackingUrl');         // client value stripped
    expect(setArg.extensions.gift_note).toBe('happy birthday');
  });

  it('still rejects (422) when stored extensions are corrupt (fail-closed preserved)', async () => {
    const { updateChain } = wireDb([{ ...existingOrderRow, extensions: '{ not valid json' }]);
    const res = await PUT(
      putRequest({ orderId: 'WEB-TEST-1000', extensions: { gift_note: 'x' } })
    );
    expect(res.status).toBe(422);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('rejects an empty update (orderId only) with 400', async () => {
    const { updateChain } = wireDb();
    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000' }));
    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('still 404s an unknown order', async () => {
    const { updateChain } = wireDb([]);
    const res = await PUT(putRequest({ orderId: 'NOPE', notes: 'x' }));
    expect(res.status).toBe(404);
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});

/**
 * BMC-213 bypass-surface enumeration (BMC-230 AC): the "no alternate API can
 * set fulfillment fields" regression suite must explicitly consider the
 * `charge.refunded` reconciler, not just the client-facing routes above.
 *
 * The reconciler (app/api/webhooks/stripe/handlers/refund-handlers.ts,
 * dispatched from app/api/webhooks/stripe/route.ts) is NOT reachable by an
 * ORDERS_UPDATE-scoped client at all — the webhook route rejects any request
 * missing a valid `stripe-signature` header (HMAC-verified via
 * verifyWebhookSignature) before any handler runs, so it takes a completely
 * different, unforgeable credential than this route's Bearer token. It locates
 * the order to reconcile via getOrderByPaymentIntentId, which OR-matches
 * `extensions.payment_intent_id` and `external_references.payment_intent_id`
 * with `LIMIT 1` and no `ORDER BY` (lib/models/mach/orders.ts) — so the surface
 * THIS route controls is not "can a client reach the reconciler" (it can't) but
 * "can a client plant a payment_intent_id that redirects a legitimate,
 * signature-verified reconciliation event onto the wrong order." These two
 * assertions pin that: PUT can neither introduce nor rebind the PI id in
 * either JSON column, which is what closes that redirection vector (the pure
 * re-pinning behavior itself is unit-tested exhaustively in
 * tests/unit/lib/utils/order-update-guards.test.ts's
 * "mergeExternalReferences — payment_intent_id pinning (BMC-230)" block).
 */
describe('PUT /api/orders — BMC-213 charge.refunded reconciler bypass surface (BMC-230)', () => {
  it('cannot plant a payment_intent_id into extensions to misdirect reconciliation onto an order that never had one', async () => {
    const { updateChain } = wireDb(
      [{ ...existingOrderRow, extensions: { carrier: 'ups' } }],
      [{ ...existingOrderRow, extensions: { carrier: 'ups' } }]
    );
    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        extensions: { payment_intent_id: 'pi_victim_charge' },
      })
    );
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.extensions).not.toHaveProperty('payment_intent_id');
  });

  it('cannot rebind a stored payment_intent_id via external_references to redirect reconciliation to a different PaymentIntent', async () => {
    const { updateChain } = wireDb(
      [{ ...existingOrderRow, external_references: { payment_intent_id: 'pi_real_123', erp: 'X-1' } }],
      [existingOrderRow]
    );
    const res = await PUT(
      putRequest({
        orderId: 'WEB-TEST-1000',
        external_references: { payment_intent_id: 'pi_victim_charge', erp: 'X-2' },
      })
    );
    expect(res.status).toBe(200);
    const setArg = updateChain.set.mock.calls[0][0];
    // The stored binding survives; the client's rebind attempt never applies.
    expect(setArg.external_references.payment_intent_id).toBe('pi_real_123');
    // Ordinary cross-system metadata alongside it still updates.
    expect(setArg.external_references.erp).toBe('X-2');
  });
});

/**
 * BMC-230 review — mergeExtensions/mergeExternalReferences derive their write
 * from a single stale read. Every OTHER writer of these JSON columns (the
 * refund route, the BMC-213 charge.refunded reconciler) is CAS-guarded on
 * `updated_at` for exactly this reason: an unguarded blind write here could
 * race a concurrent refund settling between this handler's SELECT and its
 * UPDATE and revert the refunds ledger / restock bookkeeping it just
 * committed. These pin the retry-then-409 contract the route now implements.
 */
describe('PUT /api/orders — updated_at CAS guard on the extensions/external_references write', () => {
  it('retries after losing the CAS race, then commits against the fresh read', async () => {
    const firstRead = { ...existingOrderRow, updated_at: '2026-07-01T00:00:00.000Z' };
    const secondRead = { ...existingOrderRow, updated_at: '2026-07-01T00:05:00.000Z' };
    const finalRow = { ...secondRead, notes: 'leave at side door' };

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([firstRead]).mockResolvedValueOnce([secondRead]),
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      // Attempt 1 loses the race (a concurrent writer committed first); attempt 2 wins.
      returning: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([finalRow]),
    };
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', notes: 'leave at side door' }));

    expect(res.status).toBe(200);
    expect(selectChain.limit).toHaveBeenCalledTimes(2);
    expect(updateChain.returning).toHaveBeenCalledTimes(2);
    const body = (await res.json()) as { data: { notes: string } };
    expect(body.data.notes).toBe('leave at side door');
  });

  it('returns 409 after exhausting all CAS attempts under sustained contention', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([existingOrderRow]),
    };
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]), // always loses the race
    };
    vi.mocked(getDbAsync).mockResolvedValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as any);

    const res = await PUT(putRequest({ orderId: 'WEB-TEST-1000', notes: 'x' }));

    expect(res.status).toBe(409);
    expect(updateChain.returning).toHaveBeenCalledTimes(MAX_CAS_ATTEMPTS);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/concurrent/i);
  });
});

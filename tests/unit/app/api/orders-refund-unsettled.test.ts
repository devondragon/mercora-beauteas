/**
 * BMC-224: `POST /api/orders/refund` must mirror Stripe's refund status instead
 * of asserting success.
 *
 * `stripe.refunds.create` returning without throwing means Stripe ACCEPTED the
 * refund, not that the money left. This store runs `automatic_payment_methods`
 * with `allow_redirects: 'always'` (`app/api/payment-intent/route.ts:489`), so
 * Klarna / Cash App Pay / Amazon Pay are live and come back `pending` — and a
 * `pending` refund can still FAIL, at which point Stripe returns the money to the
 * merchant and the customer is never refunded.
 *
 * The route used to record `succeeded` unconditionally and cancel + restock on
 * the spot, so a failed Klarna refund left a cancelled order, returned stock, and
 * a `succeeded` ledger line for money we still hold — with no safe undo. These
 * tests pin the corrected behaviour: the entry reserves the amount as `pending`
 * and the irreversible effects are withheld until `refund.updated` settles it.
 *
 * Pure unit test: every Cloudflare/Stripe/auth seam mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  IDEMPOTENCY_KEY,
  REFUND_AMOUNT,
  refundsCreate,
  selectRestockLines,
  restockForOrder,
  sendOrderStatusUpdateEmail,
  logCritical,
} =
  vi.hoisted(() => ({
    IDEMPOTENCY_KEY: 'refund:c0ffee0123456789',
    REFUND_AMOUNT: 10000,
    refundsCreate: vi.fn(),
    selectRestockLines: vi.fn(),
    restockForOrder: vi.fn(),
    sendOrderStatusUpdateEmail: vi.fn(),
    logCritical: vi.fn(),
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

vi.mock('@/lib/services/inventory-adjustment', () => ({ restockForOrder, selectRestockLines }));
vi.mock('@/lib/utils/email', () => ({ sendOrderStatusUpdateEmail }));
vi.mock('@/lib/utils/observe', () => ({ logCritical }));
vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

import { NextRequest } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { POST } from '@/app/api/orders/refund/route';

/**
 * The order row as it stands after every write the route made.
 *
 * Asserting on final state rather than on an individual `.set()` payload is what
 * this test actually cares about: "did the order end up cancelled and restocked"
 * is the question, and it survives the route being refactored into a different
 * number of writes.
 */
let current: any;

function makeOrder() {
  return {
    id: 'WEB-USER-1',
    status: 'processing',
    payment_status: 'paid',
    currency_code: 'USD',
    updated_at: '2026-07-31T00:00:00.000Z',
    notes: '',
    items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 1 }],
    total_amount: { amount: REFUND_AMOUNT, currency: 'USD' },
    extensions: { payment_intent_id: 'pi_test_1' },
  };
}

/**
 * Minimal drizzle-shaped fake that actually APPLIES writes, so a later phase
 * (the settle, or `confirmRestockedLines`) reads what the previous one wrote.
 * The CAS predicates are no-ops here — they are covered in
 * tests/unit/lib/payments/**.
 */
function makeDb(order: any) {
  current = order;
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([current]) }) }),
    update: () => ({
      set: (data: any) => {
        current = { ...current, ...data };
        return { where: () => ({ returning: () => Promise.resolve([current]) }) };
      },
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

/** The refund this request wrote — the last entry in the order's ledger. */
function ledgerEntry() {
  const refunds = current.extensions.refunds ?? [];
  return refunds[refunds.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  refundsCreate.mockResolvedValue({ id: 're_test_1', status: 'succeeded' });
  sendOrderStatusUpdateEmail.mockResolvedValue({ success: true });
  selectRestockLines.mockReturnValue({
    lines: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 1 }],
    keys: ['prod-1-var-1'],
  });
  restockForOrder.mockResolvedValue({
    restocked: ['var-1'],
    completedKeys: ['prod-1-var-1'],
    failedKeys: [],
  });
  vi.mocked(getDbAsync).mockResolvedValue(makeDb(makeOrder()) as any);
});

describe('POST /api/orders/refund — a refund Stripe SETTLES immediately (cards)', () => {
  it('records succeeded, cancels the order, and restocks — unchanged behaviour', async () => {
    const res = await POST(refundRequest());
    expect(res.status).toBe(200);

    expect(ledgerEntry()).toMatchObject({
      status: 'succeeded',
      stripe_refund_id: 're_test_1',
    });
    expect(current).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
    expect(current.notes).toContain('CANCELLED:');
    expect(restockForOrder).toHaveBeenCalledTimes(1);

    // A card refund settles synchronously, so the email still goes out from the
    // route exactly as before — the deferral is delayed-method-only.
    expect(sendOrderStatusUpdateEmail).toHaveBeenCalledTimes(1);

    expect(await res.json()).toMatchObject({
      success: true,
      refund: { status: 'succeeded', stripe_status: 'succeeded' },
    });
  });
});

describe('POST /api/orders/refund — a refund Stripe has NOT settled (Klarna et al.)', () => {
  it.each(['pending', 'requires_action'])(
    'records the entry as pending and withholds every irreversible effect (%s)',
    async (status) => {
      refundsCreate.mockResolvedValue({ id: 're_klarna_1', status });

      const res = await POST(refundRequest());
      expect(res.status).toBe(200);

      // The amount is still RESERVED against over-refund — it just is not final.
      expect(ledgerEntry()).toMatchObject({
        status: 'pending',
        amount: REFUND_AMOUNT,
        stripe_refund_id: 're_klarna_1',
      });
      // …and carries no processed_at, because it has not been processed.
      expect(ledgerEntry().processed_at).toBeUndefined();

      // The effects that cannot be undone stay withheld: the order is untouched.
      expect(current.status).toBe('processing');
      expect(current.payment_status).toBe('paid');
      expect(current.notes).toBe('');
      expect(selectRestockLines).not.toHaveBeenCalled();
      expect(restockForOrder).not.toHaveBeenCalled();

      // No premature "you have been refunded" — the money is not back yet, and
      // if the refund fails that claim would simply be untrue with no automated
      // correction. The `refund.updated` handler sends it on settlement.
      expect(sendOrderStatusUpdateEmail).not.toHaveBeenCalled();

      // The operator can see it is not done yet.
      expect(await res.json()).toMatchObject({
        refund: { status: 'pending', stripe_status: status },
      });
    }
  );

  it('stamps the Stripe refund id so the webhook matches on id, not on amount', async () => {
    // The amount fallback in findRefundLedgerEntry is a last resort; stamping the
    // id here keeps the lifecycle handler on the exact-match path even when two
    // refunds of equal value are in flight.
    refundsCreate.mockResolvedValue({ id: 're_klarna_1', status: 'pending' });

    await POST(refundRequest());

    expect(ledgerEntry().stripe_refund_id).toBe('re_klarna_1');
  });
});

describe('POST /api/orders/refund — a refund Stripe rejects outright', () => {
  it.each(['failed', 'canceled'])('releases the reservation and 502s (%s)', async (status) => {
    refundsCreate.mockResolvedValue({ id: 're_dead_1', status });

    const res = await POST(refundRequest());

    expect(res.status).toBe(502);
    // Released, not left pending: no money moved, so it must stop counting
    // toward the over-refund guard immediately.
    expect(ledgerEntry()).toMatchObject({ status: 'failed' });
    // The order itself is never touched — no money moved.
    expect(current).toMatchObject({ status: 'processing', payment_status: 'paid' });
    expect(logCritical).toHaveBeenCalledWith(
      'refund',
      'stripe_refund_returned_unsuccessful',
      expect.objectContaining({ status })
    );
    expect(restockForOrder).not.toHaveBeenCalled();
  });
});

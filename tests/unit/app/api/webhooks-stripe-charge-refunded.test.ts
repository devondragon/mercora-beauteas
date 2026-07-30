/**
 * BMC-213: unit coverage for the `charge.refunded` handler — the piece that
 * makes a Stripe Dashboard refund visible to the app.
 *
 * The pure reconciliation arithmetic is covered in
 * tests/unit/lib/payments/external-refund-reconciliation.test.ts. What this file
 * pins down is the HANDLER's behaviour around it, none of which is expressible
 * as a pure decision:
 *   - the order is located by payment intent, and a charge that maps to no order
 *     (a refunded subscription invoice — those orders store no payment_intent_id)
 *     is a quiet no-op, NOT a throw that would make Stripe retry forever;
 *   - the ledger entry it writes is marked as externally sourced and carries the
 *     Stripe refund ids for audit provenance;
 *   - a FULL external refund cancels the order and marks payment refunded, while
 *     a PARTIAL one leaves both columns alone;
 *   - restock is gated on the `refund.restock_on_external_refund` setting AND on
 *     the refund being full — a partial external refund carries no line
 *     attribution, so guessing lines would reintroduce BMC-178's phantom stock;
 *   - a failed ledger write pages and throws, so Stripe redelivers (the decision
 *     is a cumulative delta, so a retry is self-correcting).
 *
 * Every Cloudflare/Stripe/D1 seam is mocked so this runs in the jsdom unit env
 * (`tests/unit/**` is the only suite ci.yml gates).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getOrderByPaymentIntentId,
  mutateRefundLedger,
  refundsList,
  getRefundPolicy,
  restockForOrder,
  selectRestockLines,
  logCritical,
} = vi.hoisted(() => ({
  getOrderByPaymentIntentId: vi.fn(),
  mutateRefundLedger: vi.fn(),
  refundsList: vi.fn(),
  getRefundPolicy: vi.fn(),
  restockForOrder: vi.fn(),
  selectRestockLines: vi.fn(),
  logCritical: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/stripe', () => ({
  getStripeClient: vi.fn(() => ({ refunds: { list: refundsList } })),
}));
vi.mock('@/lib/models/mach/orders', () => ({ getOrderByPaymentIntentId }));
vi.mock('@/lib/utils/settings', () => ({ getRefundPolicy }));
vi.mock('@/lib/services/inventory-adjustment', () => ({ restockForOrder, selectRestockLines }));
vi.mock('@/lib/utils/observe', () => ({ logCritical }));

// Keep the real `parseJson` (a plain helper) but stub the CAS loop, which needs D1.
vi.mock('@/lib/payments/refund-ledger-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments/refund-ledger-store')>();
  return { ...actual, mutateRefundLedger };
});

import { handleChargeRefunded } from '@/app/api/webhooks/stripe/handlers/refund-handlers';

const EVENT_ID = 'evt_charge_refunded_1';
const PI = 'pi_test_123';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'WEB-USER-123456',
    status: 'processing',
    payment_status: 'paid',
    total_amount: { amount: 5000, currency: 'USD' },
    items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 2 }],
    extensions: { payment_intent_id: PI, refunds: [] },
    updated_at: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch_test_123',
    payment_intent: PI,
    amount_refunded: 5000,
    ...overrides,
  } as any;
}

/**
 * Drive the mocked CAS loop once against a given order and return whatever
 * mutation the handler asked for.
 */
function runLedgerOnce(order: ReturnType<typeof makeOrder>) {
  let mutation: any;
  mutateRefundLedger.mockImplementation(async (_db: unknown, _id: string, mutate: any) => {
    mutation = await mutate({
      order,
      extensions: order.extensions,
      refunds: (order.extensions as any).refunds ?? [],
      version: 0,
      nextVersion: 1,
      nowIso: '2026-07-30T12:00:00.000Z',
    });
    if (mutation.action === 'skip') return { ok: true, skipped: true, order };
    return { ok: true, skipped: false, order };
  });
  return () => mutation;
}

beforeEach(() => {
  vi.clearAllMocks();
  refundsList.mockResolvedValue({ data: [{ id: 're_dash_1', amount: 5000, status: 'succeeded' }] });
  getRefundPolicy.mockResolvedValue({ restockOnExternalRefund: true });
  restockForOrder.mockResolvedValue({ restocked: ['var-1'] });
  selectRestockLines.mockReturnValue({
    lines: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 2 }],
    keys: ['prod-1-var-1'],
  });
});

describe('handleChargeRefunded — order resolution', () => {
  it('is a quiet no-op when the charge maps to no order', async () => {
    getOrderByPaymentIntentId.mockResolvedValue(null);

    // Must NOT throw: subscription renewal orders store no payment_intent_id, so
    // a refunded subscription invoice legitimately maps to nothing. Throwing here
    // would return 500 and put Stripe into a permanent retry loop.
    await expect(handleChargeRefunded(makeCharge(), EVENT_ID)).resolves.toBeUndefined();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
    expect(logCritical).not.toHaveBeenCalled();
  });

  it('is a no-op when the charge has no payment intent', async () => {
    await handleChargeRefunded(makeCharge({ payment_intent: null }), EVENT_ID);
    expect(getOrderByPaymentIntentId).not.toHaveBeenCalled();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
  });

  it('accepts an expanded payment_intent object', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ payment_intent: { id: PI } }), EVENT_ID);
    expect(getOrderByPaymentIntentId).toHaveBeenCalledWith(PI);
  });
});

describe('handleChargeRefunded — ledger entry', () => {
  it('appends an externally-sourced entry with provenance ids', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge(), EVENT_ID);

    const written = mutation();
    expect(written.action).toBe('write');
    expect(written.extensions.refunds).toHaveLength(1);
    expect(written.extensions.refunds[0]).toMatchObject({
      id: `ext:${EVENT_ID}`,
      status: 'succeeded',
      amount: 5000,
      type: 'full',
      reason: 'external_refund',
      source: 'stripe_external',
      stripe_charge_id: 'ch_test_123',
      stripe_refund_id: 're_dash_1',
      stripe_refund_ids: ['re_dash_1'],
      reconciled_from_event: EVENT_ID,
    });
    // The entry carries no line attribution — Stripe refunds an amount, not items.
    expect(written.extensions.refunds[0].items).toEqual([]);
    expect(written.extensions.refunds_version).toBe(1);
  });

  it('cancels the order and marks payment refunded on a FULL external refund', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 5000 }), EVENT_ID);

    expect(mutation().columns).toEqual({ status: 'cancelled', payment_status: 'refunded' });
  });

  it('leaves order columns untouched on a PARTIAL external refund', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 2000 }), EVENT_ID);

    const written = mutation();
    expect(written.columns).toEqual({});
    expect(written.extensions.refunds[0]).toMatchObject({ amount: 2000, type: 'partial' });
  });

  it('adds no ledger entry when the ledger already matches Stripe', async () => {
    const order = makeOrder({
      extensions: {
        payment_intent_id: PI,
        refunds: [{ id: 're_app_1', status: 'succeeded', amount: 5000 }],
      },
    });
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge(), EVENT_ID);

    // No new refund entry and no restock — but the observed high-water mark is
    // still persisted (see the floor tests below).
    const written = mutation();
    expect(written.extensions.refunds).toEqual([
      { id: 're_app_1', status: 'succeeded', amount: 5000 },
    ]);
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('reconciles without ids when the refunds list call fails', async () => {
    refundsList.mockRejectedValue(new Error('stripe down'));
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge(), EVENT_ID);

    const written = mutation();
    expect(written.action).toBe('write');
    expect(written.extensions.refunds[0]).toMatchObject({
      amount: 5000,
      stripe_refund_id: null,
      stripe_refund_ids: [],
    });
  });
});

describe('handleChargeRefunded — Stripe refunded high-water mark', () => {
  it('records the floor alongside a new ledger entry', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 2000 }), EVENT_ID);

    expect(mutation().extensions.stripe_amount_refunded).toBe(2000);
  });

  it('records the floor even when the ledger needs no new entry', async () => {
    // THE POINT: a `pending` app reservation counts toward the ledger total, so
    // this event adds nothing. But if that reservation later flips to `failed`
    // for a refund whose money DID leave Stripe, the ledger drops back to 0 and
    // the over-refund guard would wave through a second refund. The remembered
    // floor is what keeps it honest.
    const order = makeOrder({
      extensions: {
        payment_intent_id: PI,
        refunds: [{ id: 'refund:abc', status: 'pending', amount: 5000 }],
      },
    });
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 5000 }), EVENT_ID);

    const written = mutation();
    expect(written.action).toBe('write');
    expect(written.extensions.stripe_amount_refunded).toBe(5000);
    expect(written.extensions.refunds).toHaveLength(1); // unchanged — still just the pending entry
    expect(written.extensions.refunds[0].status).toBe('pending');
  });

  it('skips entirely when the floor is already at or above this event', async () => {
    const order = makeOrder({
      extensions: {
        payment_intent_id: PI,
        refunds: [{ id: 're_app_1', status: 'succeeded', amount: 5000 }],
        stripe_amount_refunded: 5000,
      },
    });
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 5000 }), EVENT_ID);

    expect(mutation()).toEqual({ action: 'skip' });
  });

  it('never lowers the floor on a stale redelivery', async () => {
    const order = makeOrder({
      extensions: {
        payment_intent_id: PI,
        refunds: [{ id: 're_app_1', status: 'succeeded', amount: 5000 }],
        stripe_amount_refunded: 5000,
      },
    });
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 2000 }), EVENT_ID);

    expect(mutation()).toEqual({ action: 'skip' });
  });
});

describe('handleChargeRefunded — restock policy', () => {
  it('restocks a FULL external refund when the setting is on', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 5000 }), EVENT_ID);

    expect(selectRestockLines).toHaveBeenCalledWith(order.items, {
      fullRefund: true,
      refundedItemKeys: [],
      alreadyRestockedKeys: [],
    });
    expect(restockForOrder).toHaveBeenCalledWith([
      { product_id: 'prod-1', variant_id: 'var-1', quantity: 2 },
    ]);
    expect(mutation().extensions.restockedLineKeys).toEqual(['prod-1-var-1']);
  });

  it('does NOT restock when the setting is off', async () => {
    getRefundPolicy.mockResolvedValue({ restockOnExternalRefund: false });
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge(), EVENT_ID);

    expect(selectRestockLines).not.toHaveBeenCalled();
    expect(restockForOrder).not.toHaveBeenCalled();
    // The ledger entry still lands — reconciliation is independent of restock.
    expect(mutation().extensions.refunds).toHaveLength(1);
  });

  it('does NOT restock a PARTIAL external refund even with the setting on', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    runLedgerOnce(order);

    await handleChargeRefunded(makeCharge({ amount_refunded: 2000 }), EVENT_ID);

    // No line attribution exists for a partial external refund; guessing would
    // reintroduce the phantom-stock bug BMC-178 closed.
    expect(selectRestockLines).not.toHaveBeenCalled();
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('excludes lines a prior refund already restocked', async () => {
    const order = makeOrder({
      extensions: { payment_intent_id: PI, refunds: [], restockedLineKeys: ['prod-1-var-1'] },
    });
    getOrderByPaymentIntentId.mockResolvedValue(order);
    selectRestockLines.mockReturnValue({ lines: [], keys: [] });
    const mutation = runLedgerOnce(order);

    await handleChargeRefunded(makeCharge(), EVENT_ID);

    expect(selectRestockLines).toHaveBeenCalledWith(order.items, {
      fullRefund: true,
      refundedItemKeys: [],
      alreadyRestockedKeys: ['prod-1-var-1'],
    });
    expect(restockForOrder).not.toHaveBeenCalled();
    expect(mutation().extensions.restockedLineKeys).toEqual(['prod-1-var-1']);
  });

  it('defaults to restocking when the settings read fails', async () => {
    getRefundPolicy.mockRejectedValue(new Error('d1 down'));
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    runLedgerOnce(order);

    await handleChargeRefunded(makeCharge(), EVENT_ID);

    expect(restockForOrder).toHaveBeenCalled();
  });

  it('never lets a restock failure unwind the committed reconciliation', async () => {
    restockForOrder.mockRejectedValue(new Error('inventory exploded'));
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    runLedgerOnce(order);

    await expect(handleChargeRefunded(makeCharge(), EVENT_ID)).resolves.toBeUndefined();
  });
});

describe('handleChargeRefunded — ledger write failures', () => {
  it.each([
    ['cas_exhausted' as const],
    ['not_found' as const],
  ])('pages and throws so Stripe redelivers when the write fails (%s)', async (reason) => {
    getOrderByPaymentIntentId.mockResolvedValue(makeOrder());
    mutateRefundLedger.mockResolvedValue({ ok: false, reason });

    await expect(handleChargeRefunded(makeCharge(), EVENT_ID)).rejects.toThrow(
      /Failed to reconcile external refund/
    );
    expect(logCritical).toHaveBeenCalledWith(
      'webhook',
      'external_refund_reconcile_failed',
      expect.objectContaining({ orderId: 'WEB-USER-123456', chargeId: 'ch_test_123', reason })
    );
  });
});

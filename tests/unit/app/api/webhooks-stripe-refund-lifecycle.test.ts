/**
 * BMC-224: unit coverage for the `refund.updated` / `refund.failed` handler —
 * the piece that RESUMES what BMC-213 deliberately withheld.
 *
 * `charge.refunded` fires at refund creation and never re-fires, so a Klarna /
 * Cash App Pay / Amazon Pay refund that starts `pending` left the order
 * permanently uncancelled and un-restocked, and one that later failed left a
 * `pending` entry blocking a legitimate re-refund forever.
 *
 * The pure arithmetic is covered in tests/unit/lib/payments/refund-lifecycle.test.ts.
 * What this file pins down is the handler's plumbing around it:
 *   - the order is located by payment intent, with a charge fallback, and a
 *     refund that maps to no order is a quiet no-op rather than a retry storm;
 *   - the over-refund floor is lowered ONLY from a charge read back from Stripe,
 *     and an unreadable charge THROWS so Stripe redelivers instead of the handler
 *     inferring the new total;
 *   - the held cancellation and the two-phase restock claim are applied together
 *     with the ledger flip, and a redelivery writes nothing;
 *   - reversing an already-settled refund pages rather than silently
 *     un-cancelling an order and de-stocking inventory.
 *
 * Every Cloudflare/Stripe/D1 seam is mocked so this runs in the jsdom unit env
 * (`tests/unit/**` is the only suite ci.yml gates).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getOrderByPaymentIntentId,
  mutateRefundLedger,
  confirmRestockedLines,
  chargesRetrieve,
  getRefundPolicy,
  restockForOrder,
  selectRestockLines,
  sendOrderStatusUpdateEmail,
  logCritical,
} = vi.hoisted(() => ({
  getOrderByPaymentIntentId: vi.fn(),
  mutateRefundLedger: vi.fn(),
  confirmRestockedLines: vi.fn().mockResolvedValue(undefined),
  chargesRetrieve: vi.fn(),
  getRefundPolicy: vi.fn(),
  restockForOrder: vi.fn(),
  selectRestockLines: vi.fn(),
  sendOrderStatusUpdateEmail: vi.fn(),
  logCritical: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/stripe', () => ({
  getStripeClient: vi.fn(() => ({
    charges: { retrieve: chargesRetrieve },
    refunds: { list: vi.fn().mockResolvedValue({ data: [] }) },
  })),
}));
vi.mock('@/lib/models/mach/orders', () => ({ getOrderByPaymentIntentId }));
vi.mock('@/lib/utils/settings', () => ({ getRefundPolicy }));
vi.mock('@/lib/services/inventory-adjustment', () => ({ restockForOrder, selectRestockLines }));
vi.mock('@/lib/utils/email', () => ({ sendOrderStatusUpdateEmail }));
vi.mock('@/lib/utils/observe', () => ({ logCritical }));

// Keep the real `parseJson` (a plain helper) but stub the CAS loop, which needs D1.
vi.mock('@/lib/payments/refund-ledger-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments/refund-ledger-store')>();
  return { ...actual, mutateRefundLedger, confirmRestockedLines };
});

import { handleRefundLifecycle } from '@/app/api/webhooks/stripe/handlers/refund-handlers';

const EVENT_ID = 'evt_refund_updated_1';
const PI = 'pi_test_123';
const CHARGE = 'ch_test_123';
const TOTAL = 5000;

/** A `pending` external entry exactly as `charge.refunded` writes it. */
function pendingEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ext:evt_charge_refunded_1',
    status: 'pending',
    amount: TOTAL,
    type: 'full',
    source: 'stripe_external',
    stripe_refund_id: 're_1',
    stripe_refund_ids: ['re_1'],
    ...overrides,
  };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  const { extensions, ...rest } = overrides as any;
  return {
    id: 'WEB-USER-123456',
    status: 'processing',
    payment_status: 'paid',
    total_amount: { amount: TOTAL, currency: 'USD' },
    items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 2 }],
    extensions: {
      payment_intent_id: PI,
      refunds: [pendingEntry()],
      stripe_amount_refunded: TOTAL,
      ...(extensions ?? {}),
    },
    updated_at: '2026-07-31T00:00:00.000Z',
    ...rest,
  };
}

function makeRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 're_1',
    charge: CHARGE,
    payment_intent: PI,
    amount: TOTAL,
    status: 'succeeded',
    ...overrides,
  } as any;
}

/** Drive the mocked CAS loop once and expose the mutation the handler asked for. */
function runLedgerOnce(order: ReturnType<typeof makeOrder>) {
  let mutation: any;
  mutateRefundLedger.mockImplementation(async (_db: unknown, _id: string, mutate: any) => {
    mutation = await mutate({
      order,
      extensions: order.extensions,
      refunds: (order.extensions as any).refunds ?? [],
      version: 0,
      nextVersion: 1,
      nowIso: '2026-07-31T12:00:00.000Z',
    });
    if (mutation.action === 'skip') return { ok: true, skipped: true, order };
    return { ok: true, skipped: false, order };
  });
  return () => mutation;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but NOT implementations, so any mock a
  // test rewires must be restored here or it leaks into the next one.
  getOrderByPaymentIntentId.mockResolvedValue(makeOrder());
  confirmRestockedLines.mockResolvedValue(undefined);
  sendOrderStatusUpdateEmail.mockResolvedValue({ success: true });
  getRefundPolicy.mockResolvedValue({ restockOnExternalRefund: true });
  chargesRetrieve.mockResolvedValue({ id: CHARGE, payment_intent: PI, amount_refunded: 0 });
  restockForOrder.mockResolvedValue({
    restocked: ['var-1'],
    completedKeys: ['prod-1-var-1'],
    failedKeys: [],
  });
  selectRestockLines.mockReturnValue({
    lines: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 2 }],
    keys: ['prod-1-var-1'],
  });
});

describe('handleRefundLifecycle — event filtering and order resolution', () => {
  it('does nothing while the refund is still in flight', async () => {
    for (const status of ['pending', 'requires_action']) {
      await handleRefundLifecycle(makeRefund({ status }), EVENT_ID, 'refund.updated');
    }
    expect(getOrderByPaymentIntentId).not.toHaveBeenCalled();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
  });

  it('is a quiet no-op when the refund maps to no order', async () => {
    // Subscription renewal orders store no payment_intent_id, so this is normal.
    // Throwing would return 500 and put Stripe into a permanent retry loop.
    getOrderByPaymentIntentId.mockResolvedValue(null);

    await expect(
      handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated')
    ).resolves.toBeUndefined();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
    expect(logCritical).not.toHaveBeenCalled();
  });

  it('falls back to the charge when the refund carries no payment intent', async () => {
    const order = makeOrder();
    getOrderByPaymentIntentId.mockResolvedValue(order);
    runLedgerOnce(order);

    await handleRefundLifecycle(
      makeRefund({ payment_intent: null }),
      EVENT_ID,
      'refund.updated'
    );

    expect(chargesRetrieve).toHaveBeenCalledWith(CHARGE);
    expect(getOrderByPaymentIntentId).toHaveBeenCalledWith(PI);
  });

  it('THROWS rather than treating an unreachable Stripe as "no order"', async () => {
    // The event is already claimed in processed_webhook_events, so swallowing a
    // transient blip into a no-op would drop the transition forever and leave the
    // refund stuck — precisely what this handler exists to prevent.
    chargesRetrieve.mockRejectedValue(new Error('Stripe unavailable'));

    await expect(
      handleRefundLifecycle(makeRefund({ payment_intent: null }), EVENT_ID, 'refund.updated')
    ).rejects.toThrow();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
  });

  it('is a quiet no-op when Stripe confirms the charge has no payment intent', async () => {
    chargesRetrieve.mockResolvedValue({ id: CHARGE, payment_intent: null });

    await expect(
      handleRefundLifecycle(makeRefund({ payment_intent: null }), EVENT_ID, 'refund.updated')
    ).resolves.toBeUndefined();
    expect(getOrderByPaymentIntentId).not.toHaveBeenCalled();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
  });

  it('accepts the expanded object form of payment_intent', async () => {
    const order = makeOrder();
    runLedgerOnce(order);

    await handleRefundLifecycle(
      makeRefund({ payment_intent: { id: PI } }),
      EVENT_ID,
      'refund.updated'
    );

    expect(getOrderByPaymentIntentId).toHaveBeenCalledWith(PI);
    expect(chargesRetrieve).not.toHaveBeenCalled();
  });
});

describe('handleRefundLifecycle — a pending refund SUCCEEDS (AC 1, AC 4)', () => {
  it('settles the entry, applies the held cancellation, and restocks once', async () => {
    const order = makeOrder();
    const mutation = runLedgerOnce(order);

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    const written = mutation();
    expect(written.action).toBe('write');
    expect(written.extensions.refunds[0]).toMatchObject({
      status: 'succeeded',
      stripe_refund_id: 're_1',
      stripe_charge_id: CHARGE,
      settled_by_webhook: EVENT_ID,
      processed_at: '2026-07-31T12:00:00.000Z',
    });
    // The effects BMC-213 withheld, now applied.
    expect(written.columns).toEqual({ status: 'cancelled', payment_status: 'refunded' });

    // Restock is CLAIMED in the CAS, then confirmed only for what actually landed.
    expect(written.extensions.restockInflightLineKeys).toEqual(['prod-1-var-1']);
    expect(restockForOrder).toHaveBeenCalledTimes(1);
    expect(confirmRestockedLines).toHaveBeenCalledWith({}, order.id, ['prod-1-var-1']);
  });

  it('cannot double-restock a line a concurrent refund already claimed (AC 4)', async () => {
    // Both the restored and in-flight lists are excluded from selection, so the
    // in-flight claim is what makes a racing app refund safe.
    const order = makeOrder({
      extensions: {
        restockedLineKeys: ['prod-1-var-1'],
        restockInflightLineKeys: ['prod-2-var-2'],
      },
    });
    runLedgerOnce(order);
    selectRestockLines.mockReturnValue({ lines: [], keys: [] });

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    expect(selectRestockLines).toHaveBeenCalledWith(
      order.items,
      expect.objectContaining({
        fullRefund: true,
        alreadyRestockedKeys: ['prod-1-var-1', 'prod-2-var-2'],
      })
    );
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('settles without cancelling or restocking while another refund is pending', async () => {
    const order = makeOrder({
      extensions: {
        refunds: [
          pendingEntry({ amount: 3000, type: 'partial' }),
          { id: 'ext:evt_2', status: 'pending', amount: 2000, stripe_refund_id: 're_2' },
        ],
      },
    });
    const mutation = runLedgerOnce(order);

    await handleRefundLifecycle(makeRefund({ amount: 3000 }), EVENT_ID, 'refund.updated');

    const written = mutation();
    expect(written.extensions.refunds[0].status).toBe('succeeded');
    expect(written.columns).toEqual({});
    expect(written.extensions.restockInflightLineKeys).toBeUndefined();
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('honours the restock-on-external-refund opt-out', async () => {
    const order = makeOrder();
    const mutation = runLedgerOnce(order);
    getRefundPolicy.mockResolvedValue({ restockOnExternalRefund: false });

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    // Money reconciliation still proceeds — only stock is held back.
    expect(mutation().columns).toEqual({ status: 'cancelled', payment_status: 'refunded' });
    expect(mutation().extensions.restockInflightLineKeys).toBeUndefined();
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('fails closed on a settings read error rather than restocking', async () => {
    const order = makeOrder();
    const mutation = runLedgerOnce(order);
    getRefundPolicy.mockRejectedValue(new Error('D1 blip'));

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    expect(mutation().extensions.restockInflightLineKeys).toBeUndefined();
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('writes nothing on a redelivery once the effects have landed', async () => {
    const order = makeOrder({
      status: 'cancelled',
      payment_status: 'refunded',
      extensions: {
        refunds: [pendingEntry({ status: 'succeeded' })],
        restockedLineKeys: ['prod-1-var-1'],
      },
    });
    const mutation = runLedgerOnce(order);
    selectRestockLines.mockReturnValue({ lines: [], keys: [] });

    await handleRefundLifecycle(makeRefund(), 'evt_redelivery', 'refund.updated');

    expect(mutation()).toEqual({ action: 'skip' });
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('restocks a PARTIAL app refund\'s own lines even though the order is not fully covered', async () => {
    // PR #121 review. A partial app refund on a delayed payment method would
    // NEVER restock: the route withholds it (unsettled), and this handler used to
    // restock only on `finalize` — which requires the order to be fully covered,
    // and a partial refund by definition never is. Stock silently vanished.
    const order = makeOrder({
      extensions: {
        refunds: [
          {
            id: 'refund:abc123',
            status: 'pending',
            amount: 2000,
            type: 'partial',
            items: ['prod-1'],
            idempotency_key: 'refund:abc123',
            stripe_refund_id: 're_1',
          },
        ],
      },
    });
    const mutation = runLedgerOnce(order);

    await handleRefundLifecycle(makeRefund({ amount: 2000 }), EVENT_ID, 'refund.updated');

    // Restocks exactly what the refund covered — the same call the route would
    // have made synchronously had the refund settled immediately.
    expect(selectRestockLines).toHaveBeenCalledWith(
      order.items,
      expect.objectContaining({ fullRefund: false, refundedItemKeys: ['prod-1'] })
    );
    expect(mutation().extensions.restockInflightLineKeys).toEqual(['prod-1-var-1']);
    expect(restockForOrder).toHaveBeenCalledTimes(1);
    // …and the order still is NOT cancelled: a partial refund leaves it live.
    expect(mutation().columns).toEqual({});
  });

  it('restocks an app refund even when the EXTERNAL restock setting is off', async () => {
    // PR #121 review. `restock_on_external_refund` is documented as being about
    // refunds issued OUTSIDE the app; an app refund always restocks. Gating the
    // settle path on it let that toggle silently suppress an app refund's stock.
    getRefundPolicy.mockResolvedValue({ restockOnExternalRefund: false });
    const order = makeOrder({
      extensions: {
        refunds: [
          {
            id: 'refund:abc123',
            status: 'pending',
            amount: TOTAL,
            type: 'full',
            items: [],
            idempotency_key: 'refund:abc123',
            stripe_refund_id: 're_1',
          },
        ],
      },
    });
    const mutation = runLedgerOnce(order);

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    expect(mutation().extensions.restockInflightLineKeys).toEqual(['prod-1-var-1']);
    expect(restockForOrder).toHaveBeenCalledTimes(1);
  });

  it('emails the customer when an APP-INITIATED refund finally settles', async () => {
    // `POST /api/orders/refund` DEFERS this message on a refund Stripe has only
    // ACCEPTED, because a delayed refund can still fail and the claim would be
    // untrue. Settling here is the moment it becomes true.
    const order = makeOrder({
      currency_code: 'USD',
      extensions: {
        refunds: [
          {
            id: 'refund:abc123',
            status: 'pending',
            amount: TOTAL,
            type: 'full',
            idempotency_key: 'refund:abc123',
            stripe_refund_id: 're_1',
          },
        ],
      },
    });
    runLedgerOnce(order);

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    expect(sendOrderStatusUpdateEmail).toHaveBeenCalledTimes(1);
    expect(sendOrderStatusUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: order.id,
        status: 'refunded',
        orderCancelled: true, // full refund → "will not be shipped"
        refundAmount: '$50.00',
      })
    );
  });

  it('does NOT email for an externally-reconciled refund', async () => {
    // A Dashboard refund has never emailed the customer. Silently starting to is
    // a store-owner decision, not a bug fix — so the sender is scoped to
    // app-initiated entries rather than firing on every settlement.
    runLedgerOnce(makeOrder());

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    expect(sendOrderStatusUpdateEmail).not.toHaveBeenCalled();
  });

  it('does NOT email twice on a redelivery', async () => {
    // Gated on the flip, which happens exactly once — the entry is already
    // `succeeded` here, so this delivery must stay silent.
    const order = makeOrder({
      status: 'cancelled',
      payment_status: 'refunded',
      currency_code: 'USD',
      extensions: {
        refunds: [
          {
            id: 'refund:abc123',
            status: 'succeeded',
            amount: TOTAL,
            type: 'full',
            idempotency_key: 'refund:abc123',
            stripe_refund_id: 're_1',
          },
        ],
        restockedLineKeys: ['prod-1-var-1'],
      },
    });
    runLedgerOnce(order);
    selectRestockLines.mockReturnValue({ lines: [], keys: [] });

    await handleRefundLifecycle(makeRefund(), 'evt_redelivery', 'refund.updated');

    expect(sendOrderStatusUpdateEmail).not.toHaveBeenCalled();
  });

  it('pages when the settled-refund email fails — nothing else will send it', async () => {
    // The route deliberately did not send this earlier, so a silent failure here
    // means the customer is never told their money came back.
    const order = makeOrder({
      currency_code: 'USD',
      extensions: {
        refunds: [
          {
            id: 'refund:abc123',
            status: 'pending',
            amount: TOTAL,
            type: 'full',
            idempotency_key: 'refund:abc123',
            stripe_refund_id: 're_1',
          },
        ],
      },
    });
    runLedgerOnce(order);
    sendOrderStatusUpdateEmail.mockResolvedValue({ success: false, error: 'Resend down' });

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    expect(logCritical).toHaveBeenCalledWith(
      'webhook',
      'settled_refund_email_failed',
      expect.objectContaining({ orderId: order.id, refundId: 're_1' })
    );
  });

  it('leaves the ledger to charge.refunded when nothing matches the refund', async () => {
    // Appending here would double-count against `charge.refunded`'s cumulative
    // entry, which can legitimately carry no Stripe refund id.
    const order = makeOrder({ extensions: { refunds: [] } });
    const mutation = runLedgerOnce(order);

    await handleRefundLifecycle(makeRefund({ id: 're_unknown' }), EVENT_ID, 'refund.updated');

    expect(mutation()).toEqual({ action: 'skip' });
    expect(logCritical).not.toHaveBeenCalled();
  });
});

describe('handleRefundLifecycle — a pending refund FAILS (AC 2, AC 3)', () => {
  it('releases the entry and lowers the floor to the charge read back from Stripe', async () => {
    const order = makeOrder();
    const mutation = runLedgerOnce(order);
    chargesRetrieve.mockResolvedValue({ id: CHARGE, amount_refunded: 0 });

    await handleRefundLifecycle(
      makeRefund({ status: 'failed', failure_reason: 'expired_or_canceled_card' }),
      EVENT_ID,
      'refund.failed'
    );

    const written = mutation();
    expect(written.action).toBe('write');
    expect(written.extensions.refunds[0]).toMatchObject({
      status: 'failed',
      released_by_webhook: EVENT_ID,
      failure_reason: 'expired_or_canceled_card',
    });
    // The high-water mark falls — the ONLY place it may — so a legitimate
    // re-refund of the same amount is no longer blocked by the 409 floor gate.
    expect(written.extensions.stripe_amount_refunded).toBe(0);
    // No order-level effects were ever applied to this refund, so none are undone.
    expect(written.columns).toBeUndefined();
    expect(restockForOrder).not.toHaveBeenCalled();
  });

  it('treats a canceled refund the same as a failed one', async () => {
    const order = makeOrder();
    const mutation = runLedgerOnce(order);
    chargesRetrieve.mockResolvedValue({ id: CHARGE, amount_refunded: 0 });

    await handleRefundLifecycle(makeRefund({ status: 'canceled' }), EVENT_ID, 'refund.updated');

    expect(mutation().extensions.refunds[0].status).toBe('failed');
  });

  it('THROWS rather than inferring the floor when the charge cannot be read (AC 3)', async () => {
    // Deriving `floor - refund.amount` would lower the over-refund guard on
    // arithmetic instead of verified data. A throw returns 500 and Stripe
    // redelivers; every write here is idempotent, so the retry is safe.
    runLedgerOnce(makeOrder());
    chargesRetrieve.mockRejectedValue(new Error('Stripe unavailable'));

    await expect(
      handleRefundLifecycle(makeRefund({ status: 'failed' }), EVENT_ID, 'refund.failed')
    ).rejects.toThrow();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
  });

  it('THROWS when the charge reports no usable cumulative total', async () => {
    runLedgerOnce(makeOrder());
    chargesRetrieve.mockResolvedValue({ id: CHARGE, amount_refunded: undefined });

    await expect(
      handleRefundLifecycle(makeRefund({ status: 'failed' }), EVENT_ID, 'refund.failed')
    ).rejects.toThrow();
    expect(mutateRefundLedger).not.toHaveBeenCalled();
  });

  it('still releases the entry when there is no charge to ask, leaving the floor alone', async () => {
    const order = makeOrder();
    const mutation = runLedgerOnce(order);

    await handleRefundLifecycle(
      makeRefund({ status: 'failed', charge: null }),
      EVENT_ID,
      'refund.failed'
    );

    const written = mutation();
    expect(written.extensions.refunds[0].status).toBe('failed');
    // A floor that stays high only ever over-blocks — the safe direction.
    expect(written.extensions.stripe_amount_refunded).toBe(TOTAL);
    expect(chargesRetrieve).not.toHaveBeenCalled();
  });

  it('pages when an ALREADY-SETTLED refund reverses, and does not auto-undo', async () => {
    // The app refund route records `succeeded` as soon as Stripe accepts the
    // refund, so the order may already be cancelled and the stock returned on
    // money that has now come back to us. De-stocking is destructive and racy.
    const order = makeOrder({
      status: 'cancelled',
      payment_status: 'refunded',
      extensions: { refunds: [pendingEntry({ status: 'succeeded' })] },
    });
    const mutation = runLedgerOnce(order);
    chargesRetrieve.mockResolvedValue({ id: CHARGE, amount_refunded: 0 });

    await handleRefundLifecycle(
      makeRefund({ status: 'failed' }),
      EVENT_ID,
      'refund.failed'
    );

    expect(mutation().extensions.refunds[0].status).toBe('failed');
    expect(mutation().columns).toBeUndefined();
    expect(logCritical).toHaveBeenCalledWith(
      'webhook',
      'settled_refund_reversed',
      expect.objectContaining({ orderId: order.id, refundId: 're_1', wasSettled: true })
    );
  });

  it('pages when an APP-INITIATED refund reverses — that customer was emailed', async () => {
    // The route emails "you have been refunded" when Stripe ACCEPTS the refund,
    // before it settles. A reversal makes that message wrong, and only a human
    // can put it right.
    const order = makeOrder({
      extensions: {
        refunds: [
          {
            id: 'refund:abc123',
            status: 'pending',
            amount: TOTAL,
            idempotency_key: 'refund:abc123',
            stripe_refund_id: 're_1',
          },
        ],
      },
    });
    runLedgerOnce(order);
    chargesRetrieve.mockResolvedValue({ id: CHARGE, amount_refunded: 0 });

    await handleRefundLifecycle(makeRefund({ status: 'failed' }), EVENT_ID, 'refund.failed');

    expect(logCritical).toHaveBeenCalledWith(
      'webhook',
      'settled_refund_reversed',
      expect.objectContaining({ wasSettled: false, wasAppInitiated: true })
    );
  });

  it('stays quiet on an externally-reconciled reversal', async () => {
    // A Dashboard refund cancelled nothing and emailed nobody — releasing the
    // entry is the whole fix, so paging would be noise.
    const order = makeOrder();
    runLedgerOnce(order);
    chargesRetrieve.mockResolvedValue({ id: CHARGE, amount_refunded: 0 });

    await handleRefundLifecycle(makeRefund({ status: 'failed' }), EVENT_ID, 'refund.failed');

    expect(logCritical).not.toHaveBeenCalled();
  });
});

describe('handleRefundLifecycle — write failures', () => {
  it('pages and throws when the ledger write cannot land, so Stripe redelivers', async () => {
    mutateRefundLedger.mockResolvedValue({ ok: false, reason: 'cas_exhausted' });

    await expect(
      handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated')
    ).rejects.toThrow(/Failed to apply refund.updated/);
    expect(logCritical).toHaveBeenCalledWith(
      'webhook',
      'refund_lifecycle_apply_failed',
      expect.objectContaining({ reason: 'cas_exhausted', transition: 'succeeded' })
    );
  });

  it('does not unwind a committed ledger write when restock confirmation fails', async () => {
    // The money is already refunded and the ledger already committed; a 500 here
    // would make Stripe retry a write that already landed.
    runLedgerOnce(makeOrder());
    confirmRestockedLines.mockRejectedValue(new Error('D1 down'));

    await expect(
      handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated')
    ).resolves.toBeUndefined();
  });

  it('pages when restock is incomplete but leaves the claim standing', async () => {
    runLedgerOnce(makeOrder());
    restockForOrder.mockResolvedValue({
      restocked: [],
      completedKeys: [],
      failedKeys: ['prod-1-var-1'],
    });

    await handleRefundLifecycle(makeRefund(), EVENT_ID, 'refund.updated');

    expect(logCritical).toHaveBeenCalledWith(
      'webhook',
      'refund_lifecycle_restock_incomplete',
      expect.objectContaining({ failedKeys: ['prod-1-var-1'] })
    );
  });
});

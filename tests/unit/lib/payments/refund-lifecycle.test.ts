/**
 * BMC-224: pure decision coverage for refund LIFECYCLE events.
 *
 * `charge.refunded` fires at refund CREATION and never re-fires, so BMC-213's
 * `pending` ledger entry — and the cancellation + restock it withholds — had
 * nothing to resume it. These are the decisions `refund.updated` /
 * `refund.failed` drive. The handler's DB/Stripe plumbing is covered in
 * tests/unit/app/api/webhooks-stripe-refund-lifecycle.test.ts; everything here
 * is pure arithmetic over a ledger array.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRefundTransition,
  decideRefundLifecycle,
  findRefundLedgerEntry,
} from '@/lib/payments/refund-lifecycle';
import { decideRefundLedgerAction } from '@/lib/payments/refund-ledger';

const TOTAL = 5000;

/** An external `pending` entry as `charge.refunded` writes it, ids stamped. */
function pendingExternal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ext:evt_1',
    status: 'pending' as const,
    amount: TOTAL,
    type: 'full',
    source: 'stripe_external',
    stripe_refund_id: 're_1',
    stripe_refund_ids: ['re_1'],
    ...overrides,
  };
}

describe('classifyRefundTransition', () => {
  it('treats only `succeeded` as money having reached the customer', () => {
    expect(classifyRefundTransition('succeeded')).toBe('succeeded');
  });

  it('treats `failed` AND `canceled` as reversed', () => {
    // Both mean Stripe handed the money back to us and the customer was never
    // refunded, so both must stop the ledger entry counting.
    expect(classifyRefundTransition('failed')).toBe('reversed');
    expect(classifyRefundTransition('canceled')).toBe('reversed');
  });

  it('treats in-flight and unknown states as inconclusive', () => {
    expect(classifyRefundTransition('pending')).toBe('inconclusive');
    expect(classifyRefundTransition('requires_action')).toBe('inconclusive');
    expect(classifyRefundTransition(undefined)).toBe('inconclusive');
    expect(classifyRefundTransition(null)).toBe('inconclusive');
    expect(classifyRefundTransition('something_new')).toBe('inconclusive');
  });
});

describe('findRefundLedgerEntry', () => {
  it('matches on the singular stripe_refund_id', () => {
    const refunds = [{ status: 'pending' as const, amount: 100 }, pendingExternal()];
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: TOTAL })).toBe(1);
  });

  it('matches on a member of stripe_refund_ids', () => {
    const refunds = [
      pendingExternal({ stripe_refund_id: 're_other', stripe_refund_ids: ['re_other', 're_1'] }),
    ];
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: TOTAL })).toBe(0);
  });

  it('falls back to an amount-matched, id-less pending entry', () => {
    // This is the app refund route's Phase-1 reservation: written BEFORE the
    // Stripe call, so it cannot possibly carry a refund id yet. It is also what
    // `charge.refunded` writes when its best-effort `refunds.list` provenance
    // call failed.
    const refunds = [{ id: 'key-abc', status: 'pending' as const, amount: TOTAL }];
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: TOTAL })).toBe(0);
  });

  it('never steals an entry that already names a DIFFERENT refund', () => {
    const refunds = [pendingExternal({ stripe_refund_id: 're_other', stripe_refund_ids: ['re_other'] })];
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: TOTAL })).toBe(-1);
  });

  it('does not amount-match a settled entry', () => {
    // A `succeeded` entry with no id belongs to some other, already-final refund;
    // claiming it would release money that really did move.
    const refunds = [{ status: 'succeeded' as const, amount: TOTAL }];
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: TOTAL })).toBe(-1);
  });

  it('does not amount-match when the amount is missing or nonsense', () => {
    const refunds = [{ status: 'pending' as const, amount: TOTAL }];
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1' })).toBe(-1);
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: 0 })).toBe(-1);
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: -5000 })).toBe(-1);
    expect(findRefundLedgerEntry(refunds, { refundId: 're_1', refundAmount: 12.5 })).toBe(-1);
  });
});

describe('decideRefundLifecycle — no-op paths', () => {
  it('decides nothing while the refund is still in flight', () => {
    const decision = decideRefundLifecycle([pendingExternal()], 'inconclusive', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
    });
    expect(decision).toEqual({ action: 'noop', reason: 'inconclusive_status' });
  });

  it('NEVER appends when no ledger entry matches', () => {
    // `charge.refunded` is the authoritative recorder and reconciles against the
    // charge's CUMULATIVE amount_refunded — its entry can legitimately carry no
    // refund id. Appending here would double-count that money in
    // computeRefundedTotal and wrongly block every future refund.
    const decision = decideRefundLifecycle([], 'succeeded', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
    });
    expect(decision).toEqual({ action: 'noop', reason: 'no_matching_entry' });
  });
});

describe('decideRefundLifecycle — a pending refund that SUCCEEDS (AC 1)', () => {
  it('settles the entry and releases the held cancellation on a full refund', () => {
    const decision = decideRefundLifecycle([pendingExternal()], 'succeeded', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({
      action: 'settle',
      entryIndex: 0,
      needsFlip: true,
      reconciledTotal: TOTAL,
      isFullyRefunded: true,
      allSettled: true,
      finalize: true,
    });
  });

  it('holds the effects while ANOTHER refund on the order is still pending', () => {
    // A second in-flight refund can still fail, so cancelling/restocking now
    // would be acting on money that may come back to us.
    const refunds = [
      pendingExternal({ amount: 3000, type: 'partial' }),
      { id: 'ext:evt_2', status: 'pending' as const, amount: 2000, stripe_refund_id: 're_2' },
    ];
    const decision = decideRefundLifecycle(refunds, 'succeeded', {
      refundId: 're_1',
      refundAmount: 3000,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({
      action: 'settle',
      entryIndex: 0,
      isFullyRefunded: true, // 3000 + 2000 covers the order …
      allSettled: false, //    … but re_2 has not settled
      finalize: false, //      … so the effects stay withheld
    });
  });

  it('does not finalize a partial refund that leaves the order uncovered', () => {
    const decision = decideRefundLifecycle([pendingExternal({ amount: 2000, type: 'partial' })], 'succeeded', {
      refundId: 're_1',
      refundAmount: 2000,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({
      action: 'settle',
      isFullyRefunded: false,
      allSettled: true,
      finalize: false,
    });
  });

  it('reports needsFlip=false on a redelivery, but still re-derives finalize', () => {
    // Idempotency: the entry is already settled, so nothing about it changes —
    // yet finalize must still be TRUE so a delivery arriving after a crash that
    // settled the entry without applying the effects can still complete them.
    const decision = decideRefundLifecycle([pendingExternal({ status: 'succeeded' })], 'succeeded', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({ action: 'settle', needsFlip: false, finalize: true });
  });

  it('repairs an entry Stripe now says succeeded but the ledger recorded failed', () => {
    // The route's timeout path releases a reservation to `failed` on the
    // assumption no money moved. When Stripe says otherwise, the webhook is the
    // second witness and wins.
    const decision = decideRefundLifecycle([pendingExternal({ status: 'failed' })], 'succeeded', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({
      action: 'settle',
      needsFlip: true,
      reconciledTotal: TOTAL, // the released entry counts again
      finalize: true,
    });
  });

  it('never finalizes an order with no known total', () => {
    const decision = decideRefundLifecycle([pendingExternal()], 'succeeded', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: 0,
    });
    expect(decision).toMatchObject({ action: 'settle', isFullyRefunded: false, finalize: false });
  });
});

describe('decideRefundLifecycle — a pending refund that FAILS (AC 2, AC 3)', () => {
  it('releases the entry and lowers the floor to Stripe\'s verified cumulative total', () => {
    const decision = decideRefundLifecycle([pendingExternal()], 'reversed', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
      recordedFloor: TOTAL,
      chargeAmountRefunded: 0, // Stripe handed all of it back
    });

    expect(decision).toEqual({
      action: 'release',
      entryIndex: 0,
      needsFlip: true,
      floor: 0,
      wasSettled: false,
    });
  });

  it('lowers the floor only to a partial reversal, not to zero', () => {
    const decision = decideRefundLifecycle(
      [
        { status: 'succeeded' as const, amount: 2000, stripe_refund_id: 're_ok' },
        pendingExternal({ amount: 3000, type: 'partial' }),
      ],
      'reversed',
      {
        refundId: 're_1',
        refundAmount: 3000,
        totalAmount: TOTAL,
        recordedFloor: TOTAL,
        chargeAmountRefunded: 2000, // the 2000 that succeeded remains refunded
      }
    );

    expect(decision).toMatchObject({ action: 'release', entryIndex: 1, floor: 2000 });
  });

  it('does NOT infer the floor when Stripe reported no cumulative total', () => {
    // AC 3: the high-water mark may only fall on verified data. With no observed
    // total the entry is still released (safe — it stops counting) but the floor
    // stands, which only ever over-blocks.
    const decision = decideRefundLifecycle([pendingExternal()], 'reversed', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
      recordedFloor: TOTAL,
    });

    expect(decision).toMatchObject({ action: 'release', needsFlip: true, floor: null });
  });

  it('leaves the floor alone when Stripe agrees with it', () => {
    const decision = decideRefundLifecycle([pendingExternal()], 'reversed', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
      recordedFloor: 2000,
      chargeAmountRefunded: 2000,
    });
    expect(decision).toMatchObject({ action: 'release', floor: null });
  });

  it('ignores a nonsense cumulative total rather than corrupting the guard', () => {
    for (const bogus of [-1, 12.5, Number.NaN]) {
      const decision = decideRefundLifecycle([pendingExternal()], 'reversed', {
        refundId: 're_1',
        refundAmount: TOTAL,
        totalAmount: TOTAL,
        recordedFloor: TOTAL,
        chargeAmountRefunded: bogus,
      });
      expect(decision).toMatchObject({ action: 'release', floor: null });
    }
  });

  it('reports needsFlip=false on a redelivery of the same failure', () => {
    const decision = decideRefundLifecycle([pendingExternal({ status: 'failed' })], 'reversed', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
      recordedFloor: 0,
      chargeAmountRefunded: 0,
    });
    expect(decision).toMatchObject({ action: 'release', needsFlip: false, floor: null });
  });

  it('flags a reversal of an ALREADY-SETTLED entry', () => {
    // The app refund route records `succeeded` as soon as Stripe accepts the
    // refund, without waiting for a delayed payment method to settle — so the
    // order may already be cancelled and restocked on money that just came back.
    // The ledger is corrected; the destructive undo is a human's call.
    const decision = decideRefundLifecycle([pendingExternal({ status: 'succeeded' })], 'reversed', {
      refundId: 're_1',
      refundAmount: TOTAL,
      totalAmount: TOTAL,
      recordedFloor: TOTAL,
      chargeAmountRefunded: 0,
    });

    expect(decision).toMatchObject({ action: 'release', needsFlip: true, wasSettled: true });
  });
});

/**
 * AC 2, end to end: the point of releasing the entry is not the flag itself — it
 * is that a legitimate re-refund of the same amount becomes possible again.
 *
 * This drives the REAL `decideRefundLedgerAction` (the over-refund gate the
 * refund route runs) across the before/after states, so the two halves cannot
 * drift apart: releasing the entry without also lowering the floor still leaves
 * the operator stuck behind the 409, and this test would catch that.
 */
describe('a released refund unblocks the re-refund it was blocking (AC 2)', () => {
  const REQUEST = { orderId: 'WEB-USER-123456', type: 'full' as const, totalAmount: TOTAL };

  it('is BLOCKED while the failed refund is still recorded as pending', async () => {
    const decision = await decideRefundLedgerAction([pendingExternal()], {
      ...REQUEST,
      stripeRefundedFloor: TOTAL,
    });

    // `resolveFullRefundAmount` sees the order as already fully refunded.
    expect(decision.action).toBe('reject');
  });

  it('is ALLOWED once the entry is released and the floor lowered', async () => {
    // Exactly the state `decideRefundLifecycle`'s release branch produces.
    const released = [{ ...pendingExternal(), status: 'failed' as const }];
    const decision = await decideRefundLedgerAction(released, {
      ...REQUEST,
      stripeRefundedFloor: 0,
    });

    expect(decision).toMatchObject({ action: 'reserve', refundAmount: TOTAL });
  });

  it('stays BLOCKED if the entry is released but the floor is left high', async () => {
    // Why the floor must fall too: the ledger no longer counts the refund, but
    // the high-water mark still insists Stripe returned the full order value, so
    // the 409 discrepancy gate fires. Releasing without lowering is not a fix.
    const released = [{ ...pendingExternal(), status: 'failed' as const }];
    const decision = await decideRefundLedgerAction(released, {
      ...REQUEST,
      stripeRefundedFloor: TOTAL,
    });

    expect(decision).toMatchObject({ action: 'reject', status: 409 });
  });
});

/**
 * BMC-213: unit coverage for `decideExternalRefundReconciliation` — the pure
 * decision behind the `charge.refunded` webhook handler.
 *
 * This is the CI-gated coverage for the money-critical part of the fix. The
 * handler itself needs D1/Stripe seams, so the arithmetic that decides how much
 * of Stripe's cumulative refund total the ledger is still blind to is exercised
 * here as a pure unit (`tests/unit/**` is the only suite ci.yml runs).
 *
 * The headline scenario is the over-refund vector the ticket exists to close:
 * a Stripe Dashboard refund lands in the ledger, so a subsequent app refund for
 * the "remaining" balance is rejected by the existing guard instead of returning
 * the money a second time. That end of the chain (`assertRefundWithinRemaining`
 * via `decideRefundLedgerAction`) is asserted directly here too, so the two
 * halves are proven to connect.
 */
import { describe, it, expect } from 'vitest';
import {
  decideExternalRefundReconciliation,
  decideRefundLedgerAction,
} from '@/lib/payments/refund-ledger';
import { computeRefundedTotal, type RefundRecord } from '@/lib/utils/refund-validation';

const ORDER = 'WEB-USER-123456';
const TOTAL = 5000; // $50.00 order

/** A settled app-initiated refund entry, as the refund route writes it. */
function appRefund(amount: number, stripeRefundId = 're_app_1'): RefundRecord {
  return {
    id: stripeRefundId,
    status: 'succeeded',
    amount,
    type: amount >= TOTAL ? 'full' : 'partial',
    reason: 'requested_by_customer',
    stripe_refund_id: stripeRefundId,
  };
}

describe('decideExternalRefundReconciliation — the over-refund vector', () => {
  it('records a Dashboard refund the ledger has never seen', () => {
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
      stripeRefunds: [{ id: 're_dashboard_1', amount: 5000, status: 'succeeded' }],
    });

    expect(decision).toMatchObject({
      action: 'record',
      amount: 5000,
      reconciledTotal: 5000,
      isFullyRefunded: true,
      unattributedRefundIds: ['re_dashboard_1'],
    });
  });

  it('BLOCKS the follow-up app refund once the Dashboard refund is reconciled', async () => {
    // 1. Operator refunds $50 in the Stripe Dashboard. Webhook reconciles it.
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('record');
    if (decision.action !== 'record') throw new Error('unreachable');

    const ledger: RefundRecord[] = [
      { id: 'ext:evt_1', status: 'succeeded', amount: decision.amount, type: 'full' },
    ];
    expect(computeRefundedTotal({ refunds: ledger })).toBe(5000);

    // 2. Operator (or an admin action) tries to refund the "remaining" $50 via
    //    /api/orders/refund. Before BMC-213 the ledger read $0 and this sailed
    //    through, returning $100 on a $50 order.
    const full = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    expect(full).toMatchObject({ action: 'reject', status: 400 });

    // 3. And a partial for any amount is rejected too — nothing is left.
    const partial = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 100,
      items: ['prod-1'],
      totalAmount: TOTAL,
    });
    expect(partial).toMatchObject({ action: 'reject', status: 400 });
  });

  it('leaves the remaining balance refundable after a PARTIAL Dashboard refund', async () => {
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 2000,
      totalAmount: TOTAL,
    });
    expect(decision).toMatchObject({ action: 'record', amount: 2000, isFullyRefunded: false });

    const ledger: RefundRecord[] = [
      { id: 'ext:evt_1', status: 'succeeded', amount: 2000, type: 'partial' },
    ];

    // $30 still refundable — allowed.
    const ok = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 3000,
      items: ['prod-1'],
      totalAmount: TOTAL,
    });
    expect(ok).toMatchObject({ action: 'reserve', refundAmount: 3000 });

    // $30.01 is not — the reconciled $20 is counted against the total.
    const tooMuch = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 3001,
      items: ['prod-1'],
      totalAmount: TOTAL,
    });
    expect(tooMuch).toMatchObject({ action: 'reject', status: 400 });
  });
});

describe('decideExternalRefundReconciliation — no double-counting', () => {
  it('no-ops on the webhook for an app-initiated refund already in the ledger', () => {
    // The app refunded $50 and settled its entry; Stripe now delivers the
    // charge.refunded for that same refund.
    const decision = decideExternalRefundReconciliation([appRefund(5000)], {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
      stripeRefunds: [{ id: 're_app_1', amount: 5000, status: 'succeeded' }],
    });

    expect(decision).toEqual({ action: 'noop', ledgerRefunded: 5000, floorAdvance: 5000, unattributedRefundIds: [] });
  });

  it('no-ops while the app refund is still PENDING (reserved before Stripe)', () => {
    // Write-ordering: the route reserves a pending entry BEFORE calling Stripe,
    // and pending counts toward the refunded total. So the webhook for that very
    // refund must not record it a second time.
    const pending: RefundRecord[] = [
      { id: 'refund:abc', status: 'pending', amount: 5000, type: 'full' },
    ];
    const decision = decideExternalRefundReconciliation(pending, {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
    });

    expect(decision).toEqual({ action: 'noop', ledgerRefunded: 5000, floorAdvance: 5000, unattributedRefundIds: [] });
  });

  it('is idempotent — replaying the same event after it landed is a no-op', () => {
    const first = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 3000,
      totalAmount: TOTAL,
    });
    expect(first).toMatchObject({ action: 'record', amount: 3000 });

    const ledger: RefundRecord[] = [
      { id: 'ext:evt_1', status: 'succeeded', amount: 3000, type: 'partial' },
    ];
    const replay = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 3000,
      totalAmount: TOTAL,
    });
    expect(replay).toEqual({ action: 'noop', ledgerRefunded: 3000, floorAdvance: 3000, unattributedRefundIds: [] });
  });

  it('counts a RELEASED (failed) reservation as unrefunded', () => {
    // A failed reservation moved no money, so it is excluded from the ledger
    // total — a real Dashboard refund of the same size must still be recorded.
    const ledger: RefundRecord[] = [
      { id: 'refund:abc', status: 'failed', amount: 5000, type: 'full' },
    ];
    const decision = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({ action: 'record', amount: 5000, reconciledTotal: 5000 });
  });
});

describe('decideExternalRefundReconciliation — cumulative partials', () => {
  it('records only the DELTA against a cumulative amount_refunded', () => {
    // $20 already reconciled; Stripe now reports $35 cumulative (a second $15
    // Dashboard refund). Only the $15 shortfall is new.
    const ledger: RefundRecord[] = [
      { id: 'ext:evt_1', status: 'succeeded', amount: 2000, type: 'partial' },
    ];
    const decision = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 3500,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({
      action: 'record',
      amount: 1500,
      reconciledTotal: 3500,
      isFullyRefunded: false,
    });
  });

  it('converges when a Dashboard refund interleaves with an app refund', () => {
    // The self-healing property: an app refund of $30 settles, then a Dashboard
    // refund of $20 lands. Whatever order the events arrive in, each delivery
    // closes the gap that remains, and the final ledger equals Stripe's total.
    const ledger: RefundRecord[] = [appRefund(3000)];
    const decision = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({
      action: 'record',
      amount: 2000,
      reconciledTotal: 5000,
      isFullyRefunded: true,
    });
  });

  it('flips to fully refunded exactly when the total is covered', () => {
    const ledger: RefundRecord[] = [{ id: 'ext:e1', status: 'succeeded', amount: 4999 }];
    const under = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 4999,
      totalAmount: TOTAL,
    });
    expect(under).toEqual({ action: 'noop', ledgerRefunded: 4999, floorAdvance: 4999, unattributedRefundIds: [] });

    const exact = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
    });
    expect(exact).toMatchObject({ action: 'record', amount: 1, isFullyRefunded: true });
  });

  it('does NOT clamp a refund that exceeds the recorded order total', () => {
    // If Stripe returned more than D1 thinks the order was worth, the ledger must
    // record the truth so the guard keeps blocking — clamping would understate
    // what was returned and reopen the hole.
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 6000,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({
      action: 'record',
      amount: 6000,
      reconciledTotal: 6000,
      isFullyRefunded: true,
    });
  });
});

describe('stripeRefundedFloor — the guard survives a shrinking ledger', () => {
  it('blocks a second refund after a released reservation whose money DID leave', async () => {
    // The narrow window the floor exists for:
    //  1. The app reserves a `pending` $50 entry, then calls Stripe.
    //  2. A Dashboard refund of $50 fires charge.refunded. The ledger total is
    //     already $50 (pending counts), so no ledger entry is added — but the
    //     floor is recorded.
    const pendingLedger: RefundRecord[] = [
      { id: 'refund:abc', status: 'pending', amount: 5000, type: 'full' },
    ];
    const reconcile = decideExternalRefundReconciliation(pendingLedger, {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
    });
    expect(reconcile).toMatchObject({ action: 'noop', floorAdvance: 5000 });

    //  3. The app's Stripe call errors out, so the route releases the
    //     reservation to `failed` — and the ledger total collapses to $0.
    const releasedLedger: RefundRecord[] = [
      { id: 'refund:abc', status: 'failed', amount: 5000, type: 'full' },
    ];
    expect(computeRefundedTotal({ refunds: releasedLedger })).toBe(0);

    //  4. Without the floor the guard sees $0 refunded and happily issues
    //     ANOTHER $50 — the exact over-refund this ticket closes.
    const unguarded = await decideRefundLedgerAction(releasedLedger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    expect(unguarded).toMatchObject({ action: 'reserve' });

    //  5. With the floor, it is rejected.
    const guarded = await decideRefundLedgerAction(releasedLedger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
      stripeRefundedFloor: 5000,
    });
    // 409, not 400: the request is well-formed — it conflicts with what Stripe
    // demonstrably returned, which is a reconciliation problem for a human.
    expect(guarded).toMatchObject({ action: 'reject', status: 409 });
  });

  it('caps a partial refund at the floor-adjusted remaining balance', async () => {
    const ledger: RefundRecord[] = [];
    const ok = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 2000,
      items: ['prod-1'],
      totalAmount: TOTAL,
      stripeRefundedFloor: 3000,
    });
    expect(ok).toMatchObject({ action: 'reserve', refundAmount: 2000 });

    const tooMuch = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 2001,
      items: ['prod-1'],
      totalAmount: TOTAL,
      stripeRefundedFloor: 3000,
    });
    expect(tooMuch).toMatchObject({ action: 'reject', status: 409 });
  });

  it('is ignored when the ledger already exceeds it', async () => {
    const ledger: RefundRecord[] = [{ id: 'r1', status: 'succeeded', amount: 4000 }];
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 1000,
      items: ['prod-1'],
      totalAmount: TOTAL,
      stripeRefundedFloor: 1000, // lower than the ledger — must not loosen the guard
    });
    expect(decision).toMatchObject({ action: 'reserve', refundAmount: 1000 });
  });

  it('does NOT perturb the idempotency key a retry must reproduce (FULL refund)', async () => {
    // REGRESSION (caught in review): an earlier revision folded the floor into
    // `allRefunded`, which `resolveFullRefundAmount` subtracts to size a full
    // refund — and that size feeds the idempotency key. The reconcile path
    // re-derives the key from the UNFLOORED `totalAmount - baselineRefunded`, so
    // the two diverged and a retry of an interrupted full refund issued a SECOND
    // real Stripe refund. The floor must never change the amount.
    const withoutFloor = await decideRefundLedgerAction([], {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    const withFloor = await decideRefundLedgerAction([], {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
      stripeRefundedFloor: 2000,
    });

    expect(withoutFloor).toMatchObject({ action: 'reserve', refundAmount: TOTAL });
    // A floor above the ledger means our records disagree with Stripe — refuse
    // outright rather than silently refunding a reduced $30.
    expect(withFloor).toMatchObject({ action: 'reject', status: 409 });
    if (withFloor.action === 'reserve') {
      throw new Error('floor must not resize a full refund');
    }
  });

  it('reconciles an interrupted FULL refund even after a floor appears', async () => {
    // The end-to-end shape of the same regression: reserve, then retry while a
    // floor is present. The retry MUST reconcile the existing pending entry
    // (reusing its key so Stripe dedupes) rather than reserving a second one.
    const first = await decideRefundLedgerAction([], {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    if (first.action !== 'reserve') throw new Error('expected a reservation');

    const pendingLedger: RefundRecord[] = [
      {
        id: first.idempotencyKey,
        status: 'pending',
        amount: first.refundAmount,
        type: 'full',
        idempotency_key: first.idempotencyKey,
      },
    ];

    const retry = await decideRefundLedgerAction(pendingLedger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
      stripeRefundedFloor: 5000, // the webhook recorded Stripe's total meanwhile
    });

    expect(retry).toMatchObject({
      action: 'reconcile',
      entryIndex: 0,
      idempotencyKey: first.idempotencyKey,
      refundAmount: first.refundAmount,
    });
  });

  it('does NOT perturb the idempotency key a retry must reproduce (partial)', async () => {
    // Load-bearing: the floor is applied only to the over-refund validation. If
    // it leaked into the key inputs, a reconciling retry would derive a different
    // key, fail to match its own pending entry, and issue a SECOND Stripe refund.
    const pending: RefundRecord[] = [];
    const withoutFloor = await decideRefundLedgerAction(pending, {
      orderId: ORDER,
      type: 'partial',
      amount: 1000,
      items: ['prod-1'],
      totalAmount: TOTAL,
    });
    const withFloor = await decideRefundLedgerAction(pending, {
      orderId: ORDER,
      type: 'partial',
      amount: 1000,
      items: ['prod-1'],
      totalAmount: TOTAL,
      stripeRefundedFloor: 500,
    });

    expect(withoutFloor).toMatchObject({ action: 'reserve' });
    expect(withFloor).toMatchObject({ action: 'reserve' });
    if (withoutFloor.action !== 'reserve' || withFloor.action !== 'reserve') {
      throw new Error('unreachable');
    }
    expect(withFloor.idempotencyKey).toBe(withoutFloor.idempotencyKey);
    expect(withFloor.priorRefundCount).toBe(withoutFloor.priorRefundCount);
  });
});

describe('shadowing — an in-flight reservation masking a real external refund', () => {
  it('surfaces the unattributed id when a pending entry hides a Dashboard refund', () => {
    // Review finding. Order $50, nothing refunded. Operator refunds $20 in the
    // Dashboard; before that webhook commits, an admin reserves a full $50 app
    // refund. The pending $50 counts, so delta = 20 - 50 <= 0 and NO ledger entry
    // is written for the $20. The ids make that visible to the caller.
    const pendingLedger: RefundRecord[] = [
      { id: 'refund:abc', status: 'pending', amount: 5000, type: 'full' },
    ];
    const decision = decideExternalRefundReconciliation(pendingLedger, {
      chargeAmountRefunded: 2000,
      totalAmount: TOTAL,
      stripeRefunds: [{ id: 're_dashboard_1', amount: 2000, status: 'succeeded' }],
    });

    expect(decision).toEqual({
      action: 'noop',
      ledgerRefunded: 5000,
      floorAdvance: 2000,
      unattributedRefundIds: ['re_dashboard_1'],
    });
  });

  it('reports nothing unattributed once the app refund has stamped its id', () => {
    // The benign steady state — no false alarm.
    const decision = decideExternalRefundReconciliation([appRefund(5000, 're_app_1')], {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
      stripeRefunds: [{ id: 're_app_1', amount: 5000, status: 'succeeded' }],
    });

    expect(decision).toMatchObject({ action: 'noop', unattributedRefundIds: [] });
  });

  it('OUR guard — not just Stripe — still blocks the follow-up refund', async () => {
    // The review addendum claimed Stripe's own per-charge limit is the only thing
    // preventing a double refund in this interleaving. It is not: the floor
    // recorded during the shadowed no-op rejects the retry on our side first.
    //
    // Continue the scenario: the app's $50 refund is rejected by Stripe (only $30
    // was refundable), so the route releases its reservation to `failed` and the
    // ledger total collapses to 0 — while $20 really did leave.
    const releasedLedger: RefundRecord[] = [
      { id: 'refund:abc', status: 'failed', amount: 5000, type: 'full' },
    ];
    expect(computeRefundedTotal({ refunds: releasedLedger })).toBe(0);

    const retry = await decideRefundLedgerAction(releasedLedger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
      stripeRefundedFloor: 2000, // recorded by the shadowed no-op
    });
    expect(retry).toMatchObject({ action: 'reject', status: 409 });

    // A partial beyond the true remaining balance is refused too.
    const tooMuch = await decideRefundLedgerAction(releasedLedger, {
      orderId: ORDER,
      type: 'partial',
      amount: 3001,
      items: ['prod-1'],
      totalAmount: TOTAL,
      stripeRefundedFloor: 2000,
    });
    expect(tooMuch).toMatchObject({ action: 'reject', status: 409 });

    // ...but the genuinely-remaining $30 is still refundable, so the operator is
    // not locked out of legitimate work.
    const remaining = await decideRefundLedgerAction(releasedLedger, {
      orderId: ORDER,
      type: 'partial',
      amount: 3000,
      items: ['prod-1'],
      totalAmount: TOTAL,
      stripeRefundedFloor: 2000,
    });
    expect(remaining).toMatchObject({ action: 'reserve', refundAmount: 3000 });
  });

  it('self-heals when the concurrent app refund SUCCEEDS', async () => {
    // The addendum's second variant. If the app's $30 refund succeeds, its own
    // charge.refunded fires with the cumulative $50 — which reconciles the $20
    // the shadowed event never recorded. Only the failure branch leaks.
    const ledger: RefundRecord[] = [appRefund(3000, 're_app_1')];
    const decision = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
      stripeRefunds: [
        { id: 're_dashboard_1', amount: 2000, status: 'succeeded' },
        { id: 're_app_1', amount: 3000, status: 'succeeded' },
      ],
    });

    expect(decision).toMatchObject({
      action: 'record',
      amount: 2000,
      reconciledTotal: 5000,
      unattributedRefundIds: ['re_dashboard_1'],
    });
  });
});

describe('decideExternalRefundReconciliation — provenance ids', () => {
  it('reports only Stripe refund ids no ledger entry already references', () => {
    const ledger: RefundRecord[] = [appRefund(3000, 're_app_1')];
    const decision = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 5000,
      totalAmount: TOTAL,
      stripeRefunds: [
        { id: 're_app_1', amount: 3000, status: 'succeeded' },
        { id: 're_dashboard_1', amount: 2000, status: 'succeeded' },
      ],
    });

    expect(decision).toMatchObject({ action: 'record', unattributedRefundIds: ['re_dashboard_1'] });
  });

  it('honours ids recorded on a prior reconciliation entry', () => {
    const ledger: RefundRecord[] = [
      {
        id: 'ext:evt_1',
        status: 'succeeded',
        amount: 2000,
        stripe_refund_ids: ['re_dashboard_1'],
      },
    ];
    const decision = decideExternalRefundReconciliation(ledger, {
      chargeAmountRefunded: 3500,
      totalAmount: TOTAL,
      stripeRefunds: [
        { id: 're_dashboard_1', amount: 2000, status: 'succeeded' },
        { id: 're_dashboard_2', amount: 1500, status: 'succeeded' },
      ],
    });

    expect(decision).toMatchObject({ unattributedRefundIds: ['re_dashboard_2'] });
  });

  it('excludes failed and canceled Stripe refunds from provenance', () => {
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 2000,
      totalAmount: TOTAL,
      stripeRefunds: [
        { id: 're_ok', amount: 2000, status: 'succeeded' },
        { id: 're_bad', amount: 1000, status: 'failed' },
        { id: 're_gone', amount: 1000, status: 'canceled' },
      ],
    });

    expect(decision).toMatchObject({ unattributedRefundIds: ['re_ok'] });
  });

  it('still reconciles when the refunds list could not be fetched', () => {
    // The list call is best-effort provenance; money correctness must not depend
    // on it, so an empty list still records the shortfall.
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 2000,
      totalAmount: TOTAL,
    });

    expect(decision).toMatchObject({ action: 'record', amount: 2000, unattributedRefundIds: [] });
  });
});

describe('decideExternalRefundReconciliation — defensive input handling', () => {
  it.each([0, -100, 1.5, NaN])('treats %p as nothing refunded', (value) => {
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: value as number,
      totalAmount: TOTAL,
    });
    expect(decision).toEqual({ action: 'noop', ledgerRefunded: 0, floorAdvance: null, unattributedRefundIds: [] });
  });

  it('never reports fully refunded when the order total is unknown', () => {
    const decision = decideExternalRefundReconciliation([], {
      chargeAmountRefunded: 2000,
      totalAmount: 0,
    });
    expect(decision).toMatchObject({ action: 'record', amount: 2000, isFullyRefunded: false });
  });
});

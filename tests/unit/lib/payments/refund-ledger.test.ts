/**
 * BMC-193 review: unit coverage for the PURE refund-ledger decision helper
 * (`decideRefundLedgerAction`) extracted from app/api/orders/refund/route.ts.
 *
 * This is the CI-gated coverage for the reconcile-vs-reserve logic — the route
 * itself needs the Workers runtime (D1/Stripe) and its integration test is NOT
 * run in CI here, so the money-critical decision must be exercised as a pure
 * unit. Scenarios mirror the review findings:
 *   (a) a retry after a failed D1 write reconciles the SAME pending entry (no
 *       new entry, key reused) — Finding 1 exact-key reconciliation;
 *   (b) two distinct partial refunds both reserve DISTINCT entries (no clobber /
 *       no false collapse);
 *   (c) a `failed` entry is excluded from the remaining-amount math;
 *   plus: a genuinely-new identical refund after a prior SETTLED one reserves a
 *   distinct key (does not collapse into anything), and full-refund resolution.
 *
 * The helper is pure (only Web Crypto via sha256Hex through
 * deriveRefundIdempotencyKey), so it runs directly in the jsdom unit env.
 */
import { describe, it, expect } from 'vitest';
import { decideRefundLedgerAction } from '@/lib/payments/refund-ledger';
import { deriveRefundIdempotencyKey } from '@/lib/payments/refund-idempotency';
import { computeRefundedTotal, type RefundRecord } from '@/lib/utils/refund-validation';

const ORDER = 'WEB-USER-123456';
const TOTAL = 10000;

/** Build the deterministic key a fresh reservation would produce. */
function keyFor(params: {
  type: 'full' | 'partial';
  refundAmount: number;
  priorRefundCount: number;
  items?: string[];
}) {
  return deriveRefundIdempotencyKey({ orderId: ORDER, ...params });
}

describe('decideRefundLedgerAction — reserve (new refund)', () => {
  it('reserves a partial refund against an empty ledger', async () => {
    const decision = await decideRefundLedgerAction([], {
      orderId: ORDER,
      type: 'partial',
      amount: 2500,
      items: ['sku-a'],
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('reserve');
    if (decision.action !== 'reserve') return;
    expect(decision.refundAmount).toBe(2500);
    expect(decision.priorRefundCount).toBe(0);
    expect(decision.idempotencyKey).toBe(
      await keyFor({ type: 'partial', refundAmount: 2500, priorRefundCount: 0, items: ['sku-a'] })
    );
  });

  it('reserves a full refund for the whole outstanding total', async () => {
    const decision = await decideRefundLedgerAction([], {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('reserve');
    if (decision.action !== 'reserve') return;
    expect(decision.refundAmount).toBe(TOTAL);
  });

  it('resolves a full refund to only the OUTSTANDING balance after a prior settled partial', async () => {
    const ledger: RefundRecord[] = [
      { amount: 4000, status: 'succeeded', type: 'partial', items: ['sku-a'], idempotency_key: 'refund:prior' },
    ];
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('reserve');
    if (decision.action !== 'reserve') return;
    expect(decision.refundAmount).toBe(6000); // 10000 - 4000
    expect(decision.priorRefundCount).toBe(1);
  });
});

describe('decideRefundLedgerAction — reject (over-refund guards preserved)', () => {
  it('rejects a partial refund that exceeds the remaining balance', async () => {
    const ledger: RefundRecord[] = [{ amount: 7000, status: 'succeeded' }];
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 4000, // 7000 + 4000 > 10000
      items: ['sku-a'],
      totalAmount: TOTAL,
    });
    expect(decision).toMatchObject({ action: 'reject', status: 400 });
  });

  it('rejects a full refund once the order is already fully refunded', async () => {
    const ledger: RefundRecord[] = [
      { amount: 6000, status: 'succeeded' },
      { amount: 4000, status: 'succeeded' },
    ];
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    expect(decision).toMatchObject({ action: 'reject', status: 400 });
  });

  it('counts an in-flight `pending` reservation against a concurrent new partial (no over-refund)', async () => {
    // A pending partial of 9000 is in flight; a new partial of 2000 would push
    // the total to 11000 > 10000 and must be rejected.
    const pendingKey = await keyFor({ type: 'partial', refundAmount: 9000, priorRefundCount: 0, items: ['sku-x'] });
    const ledger: RefundRecord[] = [
      { amount: 9000, status: 'pending', type: 'partial', items: ['sku-x'], idempotency_key: pendingKey },
    ];
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 2000,
      items: ['sku-y'],
      totalAmount: TOTAL,
    });
    expect(decision).toMatchObject({ action: 'reject', status: 400 });
  });
});

describe('decideRefundLedgerAction — reconcile (Finding 1: exact-key match)', () => {
  it('(a) a retry after a failed ledger flip reconciles the SAME pending entry and REUSES its key', async () => {
    // Original attempt reserved this pending entry against an empty settled
    // baseline (priorRefundCount 0). Its Stripe call went through but the ledger
    // flip failed, leaving the entry `pending`.
    const reservedKey = await keyFor({ type: 'partial', refundAmount: 1500, priorRefundCount: 0, items: ['sku-a'] });
    const ledger: RefundRecord[] = [
      {
        id: reservedKey,
        idempotency_key: reservedKey,
        amount: 1500,
        status: 'pending',
        type: 'partial',
        items: ['sku-a'],
      },
    ];

    // The admin retries the identical refund.
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 1500,
      items: ['sku-a'],
      totalAmount: TOTAL,
    });

    expect(decision.action).toBe('reconcile');
    if (decision.action !== 'reconcile') return;
    expect(decision.entryIndex).toBe(0);
    expect(decision.idempotencyKey).toBe(reservedKey); // byte-for-byte reused
    expect(decision.refundAmount).toBe(1500); // already-counted reservation
  });

  it('reconciles a stuck pending FULL refund by exact key (settled baseline unchanged)', async () => {
    // A prior partial of 4000 settled; the full refund then reserved the 6000
    // outstanding but its flip failed → stuck pending.
    const fullKey = await keyFor({ type: 'full', refundAmount: 6000, priorRefundCount: 1 });
    const ledger: RefundRecord[] = [
      { amount: 4000, status: 'succeeded', type: 'partial', items: ['sku-a'], idempotency_key: 'refund:prior' },
      { id: fullKey, idempotency_key: fullKey, amount: 6000, status: 'pending', type: 'full', items: [] },
    ];
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('reconcile');
    if (decision.action !== 'reconcile') return;
    expect(decision.entryIndex).toBe(1);
    expect(decision.idempotencyKey).toBe(fullKey);
    expect(decision.refundAmount).toBe(6000);
  });
});

describe('decideRefundLedgerAction — no false collapse (Finding 1)', () => {
  it('(b) two distinct partial refunds both RESERVE distinct entries (no clobber)', async () => {
    // First distinct refund on an empty ledger.
    const first = await decideRefundLedgerAction([], {
      orderId: ORDER,
      type: 'partial',
      amount: 1000,
      items: ['sku-a'],
      totalAmount: TOTAL,
    });
    expect(first.action).toBe('reserve');
    if (first.action !== 'reserve') return;

    // Its pending reservation is now on the ledger; a genuinely-DIFFERENT
    // partial (distinct amount/items) must reserve its own entry, not reconcile
    // into the first.
    const ledger: RefundRecord[] = [
      {
        id: first.idempotencyKey,
        idempotency_key: first.idempotencyKey,
        amount: 1000,
        status: 'pending',
        type: 'partial',
        items: ['sku-a'],
      },
    ];
    const second = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 2000,
      items: ['sku-b'],
      totalAmount: TOTAL,
    });
    expect(second.action).toBe('reserve');
    if (second.action !== 'reserve') return;
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.refundAmount).toBe(2000);
  });

  it('a genuinely-new identical refund after a prior SETTLED one does NOT collapse into it', async () => {
    // A first partial of 1500 settled (priorRefundCount was 0 → its key).
    const settledKey = await keyFor({ type: 'partial', refundAmount: 1500, priorRefundCount: 0, items: ['sku-a'] });
    const ledger: RefundRecord[] = [
      { id: 'rf_1', idempotency_key: settledKey, amount: 1500, status: 'succeeded', type: 'partial', items: ['sku-a'] },
    ];
    // A second, genuinely-new refund with IDENTICAL type/amount/items. Because a
    // prior refund settled, priorRefundCount is now 1 → a DIFFERENT key. The old
    // heuristic (type+amount+items) would have mis-collapsed; exact-key matching
    // reserves a fresh entry.
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 1500,
      items: ['sku-a'],
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('reserve');
    if (decision.action !== 'reserve') return;
    expect(decision.idempotencyKey).not.toBe(settledKey);
    expect(decision.priorRefundCount).toBe(1);
  });
});

describe('decideRefundLedgerAction — failed entries (Finding 3c)', () => {
  it('(c) excludes a `failed` reservation from the remaining-amount math', async () => {
    // A failed reservation of 8000 must NOT reduce the remaining balance: a new
    // partial of 6000 should still be allowed (failed money never moved).
    const ledger: RefundRecord[] = [
      { amount: 8000, status: 'failed', type: 'partial', items: ['sku-z'], idempotency_key: 'refund:failed' },
    ];
    // Sanity: the shared total helper also excludes it.
    expect(computeRefundedTotal({ refunds: ledger })).toBe(0);

    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'partial',
      amount: 6000,
      items: ['sku-a'],
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('reserve');
    if (decision.action !== 'reserve') return;
    expect(decision.refundAmount).toBe(6000);
    // A failed entry is still a settled (non-pending) entry, so it counts toward
    // priorRefundCount — the retry-key derivation stays consistent.
    expect(decision.priorRefundCount).toBe(1);
  });

  it('a full refund ignores a failed reservation and refunds the full total', async () => {
    const ledger: RefundRecord[] = [{ amount: 9000, status: 'failed' }];
    const decision = await decideRefundLedgerAction(ledger, {
      orderId: ORDER,
      type: 'full',
      totalAmount: TOTAL,
    });
    expect(decision.action).toBe('reserve');
    if (decision.action !== 'reserve') return;
    expect(decision.refundAmount).toBe(TOTAL);
  });
});

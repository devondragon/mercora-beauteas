/**
 * Pure decision logic for the refund ledger (BMC-193 review).
 *
 * The refund route (`app/api/orders/refund/route.ts`) does a guarded
 * read-modify-write of the `orders.extensions.refunds[]` JSON ledger. The DB
 * plumbing (D1 reads, optimistic-concurrency CAS, Stripe call) has to live in
 * the route, but the DECISION — given the ledger we just read and this request,
 * do we reconcile an existing `pending` entry (a retry of an interrupted
 * refund) or reserve a brand-new one? — is pure and is extracted here so it can
 * be unit-tested directly under `tests/unit/**` (the only suite CI gates).
 *
 * === Exact-key reconciliation (Finding 1) ===
 * A retry of an interrupted refund (Stripe succeeded, the ledger flip failed)
 * must reconcile the SAME `pending` entry and REUSE its Stripe idempotency key,
 * so Stripe returns the original refund instead of moving money twice. The old
 * code located that entry with a loose `type + amount + items` heuristic, which
 * could collapse a genuinely-NEW identical refund into an unrelated stuck
 * `pending` entry. Instead we derive the idempotency key this request WOULD
 * have produced at its original reservation and reconcile the `pending` entry
 * whose stored `idempotency_key` equals it byte-for-byte:
 *   - a retry re-derives the SAME key (the settled baseline it hashes over is
 *     unchanged — the entry it is reconciling is `pending`, which the baseline
 *     excludes), so it matches and reconciles;
 *   - a genuinely-new refund hashes over a different settled baseline (a prior
 *     refund settled → higher `priorRefundCount`) and so derives a DIFFERENT
 *     key, matches nothing, and reserves a new entry.
 *
 * `priorRefundCount` and the reconciliation "detect amount" are BOTH computed
 * from the SETTLED (non-`pending`) baseline precisely so a retry reproduces the
 * key its own reservation used — adding the `pending` entry must not shift
 * either input.
 */

import {
  computeRefundedTotal,
  assertRefundWithinRemaining,
  resolveFullRefundAmount,
  type RefundRecord,
} from '@/lib/utils/refund-validation';
import { deriveRefundIdempotencyKey } from '@/lib/payments/refund-idempotency';

export interface RefundLedgerRequest {
  orderId: string;
  type: 'full' | 'partial';
  /** Requested amount in minor units (cents) — required for partial refunds. */
  amount?: number;
  /** Product ids covered by this refund; order-independent. */
  items?: string[];
  /** Order total in minor units (cents). */
  totalAmount: number;
}

export type RefundLedgerDecision =
  | {
      /** A `pending` entry for this exact refund already exists — finish it. */
      action: 'reconcile';
      /** Index of the `pending` entry in the ledger to settle. */
      entryIndex: number;
      /** Reuse the pending entry's Stripe idempotency key (Stripe dedupes). */
      idempotencyKey: string;
      /** The reserved amount, already counted in the refunded total. */
      refundAmount: number;
    }
  | {
      /** No matching `pending` entry — reserve a new one. */
      action: 'reserve';
      idempotencyKey: string;
      refundAmount: number;
      /** Count of settled (non-`pending`) entries — the key's count input. */
      priorRefundCount: number;
    }
  | {
      /** Request is invalid against the current ledger — reject with `status`. */
      action: 'reject';
      status: number;
      error: string;
    };

/** True for a ledger entry currently reserved but not yet settled. */
function isPending(entry: RefundRecord | undefined): boolean {
  return entry?.status === 'pending';
}

/**
 * Decide whether this refund request reconciles an existing `pending` entry or
 * reserves a new one, given the ledger array just read from the order.
 *
 * Pure and async only because the idempotency key is a SHA-256 digest (Web
 * Crypto). Does not mutate `refunds`.
 */
export async function decideRefundLedgerAction(
  refunds: RefundRecord[],
  req: RefundLedgerRequest
): Promise<RefundLedgerDecision> {
  const { orderId, type, amount, items, totalAmount } = req;

  // Settled baseline = every entry EXCEPT in-flight `pending` reservations.
  // `priorRefundCount` and the detect amount hash over this baseline so a retry
  // (whose own entry is `pending`, hence excluded) reproduces its original key.
  const settled = refunds.filter((r) => !isPending(r));
  const priorRefundCount = settled.length;
  const baselineRefunded = computeRefundedTotal({ refunds: settled });
  // Full ledger total (INCLUDES pending) — used to validate a genuinely-new
  // refund so a concurrent in-flight reservation can't be over-refunded.
  const allRefunded = computeRefundedTotal({ refunds });

  // The amount this request would have reserved at its ORIGINAL attempt, from
  // the settled baseline — reproduces the key a retry needs to match a pending.
  const detectAmount = type === 'full' ? totalAmount - baselineRefunded : amount ?? 0;

  // ── Reconcile: does a `pending` entry carry the key this request derives? ──
  if (detectAmount > 0) {
    const candidateKey = await deriveRefundIdempotencyKey({
      orderId,
      type,
      refundAmount: detectAmount,
      priorRefundCount,
      items,
    });
    const idx = refunds.findIndex(
      (r) => isPending(r) && r?.idempotency_key === candidateKey
    );
    if (idx >= 0) {
      const entry = refunds[idx];
      return {
        action: 'reconcile',
        entryIndex: idx,
        idempotencyKey: (entry.idempotency_key as string) ?? candidateKey,
        refundAmount: typeof entry.amount === 'number' ? entry.amount : detectAmount,
      };
    }
  }

  // ── Reserve: a genuinely-new refund. Validate against the FULL ledger. ──
  let refundAmount: number;
  if (type === 'full') {
    const resolution = resolveFullRefundAmount(totalAmount, allRefunded);
    if (!resolution.ok) {
      return { action: 'reject', status: 400, error: resolution.error };
    }
    refundAmount = resolution.amount;
  } else {
    if (typeof amount !== 'number') {
      return { action: 'reject', status: 400, error: 'Partial refunds require amount and items' };
    }
    const check = assertRefundWithinRemaining(totalAmount, allRefunded, amount);
    if (!check.ok) {
      return { action: 'reject', status: 400, error: check.error };
    }
    refundAmount = amount;
  }

  const idempotencyKey = await deriveRefundIdempotencyKey({
    orderId,
    type,
    refundAmount,
    priorRefundCount,
    items,
  });
  return { action: 'reserve', idempotencyKey, refundAmount, priorRefundCount };
}

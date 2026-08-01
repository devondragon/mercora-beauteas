/**
 * Pure decision logic for refund LIFECYCLE events (BMC-224).
 *
 * === Why this exists ===
 * `charge.refunded` fires when a refund is CREATED, not when it settles. BMC-213
 * made that reconciler fail safe: when Stripe has not confirmed every refund on
 * the charge as `succeeded`, the ledger entry is written `pending` and the
 * irreversible effects — cancelling the order and restocking — are WITHHELD.
 *
 * Nothing resumed them. `charge.refunded` does not re-fire when an existing
 * refund transitions, so a Klarna / Cash App Pay / Amazon Pay refund that starts
 * `pending` and later succeeds left the order permanently uncancelled and
 * un-restocked, and one that later FAILED left a `pending` entry counting toward
 * the over-refund guard forever — blocking a legitimate re-refund of the same
 * amount. This store has `automatic_payment_methods` with
 * `allow_redirects: 'always'`, so those are live payment methods, not theory.
 *
 * `refund.updated` / `refund.failed` are the events that DO fire on a
 * transition. This module decides what such an event means for the ledger; the
 * handler owns the Stripe calls, the CAS write and the restock.
 *
 * === Never appends ===
 * A lifecycle event whose refund matches no ledger entry is a NO-OP, never an
 * append. `charge.refunded` is the authoritative recorder and reconciles against
 * the charge's CUMULATIVE `amount_refunded`; its entry may legitimately carry no
 * Stripe refund id at all (the provenance `refunds.list` call is best-effort and
 * degrades to an id-less entry). Appending here would double-count that money in
 * `computeRefundedTotal` and wrongly block future refunds.
 *
 * Pure and synchronous. Does not mutate `refunds`.
 */

import { computeRefundedTotal, type RefundRecord } from '@/lib/utils/refund-validation';

/**
 * What a Stripe `Refund.status` means for the ledger.
 *
 * - `succeeded` — the money reached the customer; held effects may now run.
 * - `reversed`  — `failed` OR `canceled`. Both mean Stripe handed the money back
 *   to the merchant and the customer was never refunded, so the ledger entry must
 *   stop counting. `computeRefundedTotal` excludes only `'failed'`, so both map
 *   onto that one ledger status.
 * - `inconclusive` — `pending` / `requires_action` / anything unrecognised. The
 *   refund is still in flight; nothing has changed and nothing may be decided.
 */
export type RefundTransition = 'succeeded' | 'reversed' | 'inconclusive';

export function classifyRefundTransition(
  status: string | null | undefined
): RefundTransition {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'reversed';
  return 'inconclusive';
}

export interface RefundLifecycleRequest {
  /** The Stripe refund id from the signature-verified event. */
  refundId: string;
  /** `Refund.amount` in minor units — the fallback match key. */
  refundAmount?: number | null;
  /** Order total in minor units; decides full vs partial coverage. */
  totalAmount: number;
  /**
   * Cumulative `charge.amount_refunded` read back from Stripe. REQUIRED on the
   * `reversed` path and ignored otherwise — see `floor` below.
   */
  chargeAmountRefunded?: number;
  /** Current `extensions.stripe_amount_refunded` high-water mark, if any. */
  recordedFloor?: number;
}

export type RefundLifecycleDecision =
  | {
      /** Nothing to do. `reason` is for the log line only. */
      action: 'noop';
      reason: 'no_matching_entry' | 'inconclusive_status';
    }
  | {
      /** Stripe confirms the money left — mark the entry settled. */
      action: 'settle';
      entryIndex: number;
      /** False when the entry is ALREADY `succeeded` (a redelivery). */
      needsFlip: boolean;
      /** Refunded total once this entry is settled. */
      reconciledTotal: number;
      /** True when that total covers the order. */
      isFullyRefunded: boolean;
      /** True when no OTHER ledger entry is still `pending`. */
      allSettled: boolean;
      /**
       * `isFullyRefunded && allSettled` — the gate BMC-213 withheld the order
       * cancellation and restock behind. Only now may they run.
       */
      finalize: boolean;
    }
  | {
      /** Stripe returned the money to us — release the entry. */
      action: 'release';
      entryIndex: number;
      /** False when the entry is ALREADY `failed` (a redelivery). */
      needsFlip: boolean;
      /**
       * New `extensions.stripe_amount_refunded`, or null when unchanged.
       *
       * This is the ONE place the high-water mark may legitimately go DOWN. The
       * floor exists because the ledger can shrink on a released reservation
       * while the money actually left Stripe; a floor that never falls would then
       * block a legitimate re-refund of the failed amount forever. It is set from
       * the charge's cumulative `amount_refunded` READ BACK FROM STRIPE on a
       * signature-verified event — never inferred by subtracting the refund
       * amount, which would let a stale or racing view lower the guard on nothing
       * but arithmetic.
       */
      floor: number | null;
      /**
       * True when the released entry was already `succeeded`, meaning the order
       * may ALREADY have been cancelled and restocked on this refund. The app
       * refund route records `succeeded` as soon as Stripe accepts the refund,
       * without waiting for a delayed payment method to settle, so this is
       * reachable. Callers must escalate: the ledger is corrected here, but
       * un-cancelling an order and de-stocking inventory are destructive,
       * racy operations that need a human.
       */
      wasSettled: boolean;
    };

/**
 * Locate the ledger entry a lifecycle event refers to.
 *
 * Two match strategies, in order:
 *
 *  1. **Exact Stripe refund id** — `stripe_refund_id` or a member of
 *     `stripe_refund_ids`. The `charge.refunded` reconciler stamps these when it
 *     could list the charge's refunds, and the app refund route stamps
 *     `stripe_refund_id` when it settles.
 *
 *  2. **Amount-matched, id-less `pending` entry** — the fallback for the two
 *     entries that legitimately carry no Stripe id yet: an app refund's Phase-1
 *     reservation (written BEFORE the Stripe call, so it cannot know the id), and
 *     an external entry written while the best-effort `refunds.list` provenance
 *     call was failing. Restricted to `pending` and to entries with no id at all
 *     so it can never steal an entry that belongs to a different refund.
 *
 * Mis-pairing two equal-amount id-less `pending` entries is possible and
 * accepted: they are interchangeable by construction — same amount, same
 * unsettled state — so either choice produces identical ledger arithmetic. This
 * mirrors the amount-matched settlement `decideExternalRefundReconciliation`
 * already performs.
 *
 * Returns -1 when nothing matches.
 */
export function findRefundLedgerEntry(
  refunds: RefundRecord[],
  req: { refundId: string; refundAmount?: number | null }
): number {
  const byId = refunds.findIndex((r) => referencesRefundId(r, req.refundId));
  if (byId >= 0) return byId;

  const amount = req.refundAmount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return -1;
  }

  return refunds.findIndex(
    (r) => r?.status === 'pending' && r.amount === amount && !hasStripeRefundId(r)
  );
}

/** Does this ledger entry already name `refundId` (singular or list form)? */
function referencesRefundId(entry: RefundRecord | undefined, refundId: string): boolean {
  if (!entry) return false;
  if (entry.stripe_refund_id === refundId) return true;
  const list = entry.stripe_refund_ids;
  return Array.isArray(list) && list.includes(refundId);
}

/** Does this entry carry ANY Stripe refund id? */
function hasStripeRefundId(entry: RefundRecord | undefined): boolean {
  if (!entry) return false;
  if (typeof entry.stripe_refund_id === 'string' && entry.stripe_refund_id) return true;
  const list = entry.stripe_refund_ids;
  return Array.isArray(list) && list.some((v) => typeof v === 'string' && v);
}

/**
 * Decide what a `refund.updated` / `refund.failed` event does to the ledger.
 *
 * Idempotent by construction: `needsFlip` is false on a redelivery whose entry
 * already carries the target status, and `finalize` is recomputed from the
 * ledger every time rather than remembered — so a redelivery that arrives after
 * the effects landed simply re-derives the same answer and the caller's
 * restock-key bookkeeping makes it a no-op.
 */
export function decideRefundLifecycle(
  refunds: RefundRecord[],
  transition: RefundTransition,
  req: RefundLifecycleRequest
): RefundLifecycleDecision {
  if (transition === 'inconclusive') {
    return { action: 'noop', reason: 'inconclusive_status' };
  }

  const entryIndex = findRefundLedgerEntry(refunds, req);
  if (entryIndex < 0) {
    return { action: 'noop', reason: 'no_matching_entry' };
  }

  const entry = refunds[entryIndex];

  if (transition === 'succeeded') {
    // Flipping `pending` → `succeeded` does not move the TOTAL (both statuses
    // count toward it) — only its finality. Compute it from the projected array
    // anyway so the rule lives in one place if that ever changes.
    const projected = refunds.map((r, i) =>
      i === entryIndex ? { ...r, status: 'succeeded' as const } : r
    );
    const reconciledTotal = computeRefundedTotal({ refunds: projected });
    const isFullyRefunded = req.totalAmount > 0 && reconciledTotal >= req.totalAmount;
    // Any OTHER entry still in flight means a refund on this order can yet fail,
    // so the irreversible effects stay withheld — the same gate BMC-213 applied.
    const allSettled = projected.every((r) => r?.status !== 'pending');

    return {
      action: 'settle',
      entryIndex,
      needsFlip: entry?.status !== 'succeeded',
      reconciledTotal,
      isFullyRefunded,
      allSettled,
      finalize: isFullyRefunded && allSettled,
    };
  }

  // ── reversed: Stripe gave the money back to us ──────────────────────────────
  const priorFloor =
    typeof req.recordedFloor === 'number' && Number.isFinite(req.recordedFloor)
      ? req.recordedFloor
      : 0;
  const observed = req.chargeAmountRefunded;
  // Written in BOTH directions when it differs: this value is a verified read of
  // Stripe's cumulative total, so it is authoritative whether it is lower than
  // the recorded floor (this refund reversed) or higher (another refund landed
  // between the event and the read).
  const floor =
    typeof observed === 'number' && Number.isInteger(observed) && observed >= 0 && observed !== priorFloor
      ? observed
      : null;

  return {
    action: 'release',
    entryIndex,
    needsFlip: entry?.status !== 'failed',
    floor,
    wasSettled: entry?.status === 'succeeded',
  };
}

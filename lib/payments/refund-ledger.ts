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

/**
 * A refund Stripe knows about that the ledger may not (BMC-213). Only the id and
 * amount matter for reconciliation; the rest of the Refund object is ignored.
 */
export interface StripeRefundSummary {
  id: string;
  /** Amount in minor units (cents). */
  amount?: number | null;
  /** Stripe refund lifecycle; only 'failed'/'canceled' are excluded. */
  status?: string | null;
}

export interface ExternalRefundReconciliationRequest {
  /** Cumulative `charge.amount_refunded` from the signature-verified event. */
  chargeAmountRefunded: number;
  /** Order total in minor units (cents) — decides full vs partial. */
  totalAmount: number;
  /**
   * Current `extensions.stripe_amount_refunded` high-water mark, if any. Used
   * only to decide whether this event ADVANCES it (Stripe's cumulative total
   * never shrinks, so a redelivery carrying a lower value must not lower it).
   */
  recordedFloor?: number;
  /**
   * Refunds Stripe reports for this charge, if they could be fetched. Used ONLY
   * for audit provenance (which Stripe refund ids this entry covers) — never for
   * the amount math, which is cumulative. Empty/omitted is fine.
   */
  stripeRefunds?: StripeRefundSummary[];
}

/** A `pending` ledger entry Stripe confirms has actually succeeded. */
export interface PendingSettlement {
  /** Index of the `pending` entry in the ledger array. */
  entryIndex: number;
  /** The Stripe refund it corresponds to (matched on exact amount). */
  stripeRefundId: string;
}

/** Fields both branches carry (see the individual doc comments below). */
interface ExternalRefundCommon {
  /**
   * `pending` entries Stripe reports as SUCCEEDED — flip these to `succeeded`.
   * Repairs the timeout race where the route never got to settle its own
   * reservation and then released it to `failed`.
   */
  settlements: PendingSettlement[];
  /**
   * True only when Stripe reports EVERY live refund on this charge as
   * `succeeded`. A `pending`/`requires_action` refund can still fail — Stripe
   * returns that money to the merchant and the customer is never refunded — so
   * irreversible effects (cancel the order, restock) must be gated on this.
   * Also false when no status information could be fetched at all.
   */
  allSettled: boolean;
  /** True when the refunded total covers the order. Gate effects on BOTH this and `allSettled`. */
  isFullyRefunded: boolean;
}

export type ExternalRefundReconciliation =
  | (ExternalRefundCommon & {
      /** Ledger already accounts for every cent Stripe reports — nothing to do. */
      action: 'noop';
      ledgerRefunded: number;
      /**
       * New value for `extensions.stripe_amount_refunded` when this event raises
       * the high-water mark, else null. Non-null means the caller should still
       * write — see the `stripeRefundedFloor` doc on RefundLedgerRequest for why
       * the floor must be recorded even when no ledger entry is needed.
       */
      floorAdvance: number | null;
      /**
       * Stripe refund ids no ledger entry references. On the `noop` path a
       * NON-EMPTY value means an external refund was SHADOWED by an unrelated
       * in-flight `pending` reservation: the money is still guarded by the floor,
       * but that refund has no audit line and the event will not be redelivered.
       *
       * Expect transient false positives — an app refund's own webhook can beat
       * its Phase 3 settle, so its id looks unattributed while its entry is still
       * `pending`. Callers should only escalate when nothing is pending.
       */
      unattributedRefundIds: string[];
    })
  | (ExternalRefundCommon & {
      /** Stripe has refunded more than the ledger knows — record the shortfall. */
      action: 'record';
      /** The unaccounted-for amount, in minor units. Always > 0. */
      amount: number;
      /** Refunded total AFTER this entry lands. */
      reconciledTotal: number;
      /** Stripe refund ids not already referenced by a ledger entry (provenance). */
      unattributedRefundIds: string[];
      /** New `extensions.stripe_amount_refunded` high-water mark, or null. */
      floorAdvance: number | null;
      /**
       * Status for the appended entry. `pending` when Stripe has not confirmed
       * every refund succeeded — it still counts toward the over-refund guard,
       * but stays reversible and must not trigger cancel/restock.
       */
      entryStatus: 'succeeded' | 'pending';
    });

/**
 * Decide how a `charge.refunded` event reconciles into the ledger (BMC-213).
 *
 * === Why cumulative delta, not per-refund id matching ===
 * The ticket proposed matching `charge.refunds.data[].id` against the ledger.
 * That field is NOT in the payload: Stripe's 2022-11-15 change ("deprecates
 * charges auto-expand") stopped auto-expanding `charge.refunds`, and this app
 * pins `2026-06-24.dahlia`. What IS always present is `amount_refunded` — the
 * CUMULATIVE total refunded against the charge.
 *
 * So the amount math is a pure delta against the ledger:
 *
 *     delta = charge.amount_refunded − computeRefundedTotal(ledger)
 *
 * This is strictly stronger than id matching:
 *   - **No double-counting.** An app-initiated refund's own `charge.refunded`
 *     arrives with its `pending`/`succeeded` entry already in the ledger and
 *     already counted, so delta is 0 and we no-op. No id lookup needed.
 *   - **Partials fall out for free.** Reconciling against a cumulative total
 *     rather than per-event deltas means out-of-order or redelivered events all
 *     converge on the same answer instead of stacking.
 *   - **Self-healing under interleaving.** A Dashboard refund racing an app
 *     refund can leave a transient shortfall; every refund emits its own
 *     `charge.refunded`, and each delivery closes whatever gap still remains.
 *   - **Idempotent by construction.** Replaying the same event after it landed
 *     yields delta 0.
 *
 * `stripeRefunds` (fetched separately via `stripe.refunds.list`) is used only to
 * stamp provenance ids on the entry. Reconciliation stays correct without it, so
 * a failed list call degrades to an id-less entry rather than skipping the write
 * — money correctness must never depend on a best-effort side call.
 *
 * NOTE: the delta is deliberately NOT clamped to the order total. If Stripe has
 * refunded more than D1 believes the order was worth, the ledger should record
 * the truth so the over-refund guard blocks further app refunds — clamping would
 * understate what was returned and reopen the very hole this closes.
 *
 * Pure and synchronous. Does not mutate `refunds`.
 */
export function decideExternalRefundReconciliation(
  refunds: RefundRecord[],
  req: ExternalRefundReconciliationRequest
): ExternalRefundReconciliation {
  const { chargeAmountRefunded, totalAmount, stripeRefunds = [], recordedFloor } = req;

  const ledgerRefunded = computeRefundedTotal({ refunds });
  // A non-finite/negative `amount_refunded` should never reach us (it comes from
  // a signature-verified Stripe event), but fail closed rather than recording a
  // nonsense entry that would corrupt every later refund decision.
  const stripeRefunded =
    Number.isInteger(chargeAmountRefunded) && chargeAmountRefunded > 0
      ? chargeAmountRefunded
      : 0;

  // Stripe's cumulative total only ever grows, so the high-water mark advances
  // only when THIS event reports more than we have ever seen. A redelivery
  // carrying a stale, lower value must never lower it.
  const priorFloor =
    typeof recordedFloor === 'number' && Number.isFinite(recordedFloor) ? recordedFloor : 0;
  const floorAdvance = stripeRefunded > priorFloor ? stripeRefunded : null;

  // Provenance: ids Stripe reports that no ledger entry already references.
  // 'failed'/'canceled' Stripe refunds moved no money and are excluded, matching
  // how computeRefundedTotal drops 'failed' ledger entries.
  //
  // Computed BEFORE the delta check (review finding) because it matters on the
  // `noop` path too: an in-flight `pending` reservation for a DIFFERENT refund
  // inflates the ledger total enough to mask a real external refund, so the
  // delta reads <= 0 and no entry is written. The aggregate floor still guards
  // the money, but that refund's own audit line is lost — and since the event is
  // marked processed, it never gets a second chance. Surfacing the unattributed
  // ids here lets the caller SEE that shadowing happened.
  const known = new Set(
    refunds.flatMap((r) => {
      const ids: string[] = [];
      if (typeof r?.stripe_refund_id === 'string') ids.push(r.stripe_refund_id);
      const list = r?.stripe_refund_ids;
      if (Array.isArray(list)) ids.push(...list.filter((v): v is string => typeof v === 'string'));
      return ids;
    })
  );
  const live = stripeRefunds.filter(
    (r) => r?.id && r.status !== 'failed' && r.status !== 'canceled'
  );
  const unattributedRefundIds = live.map((r) => r.id).filter((id) => !known.has(id));

  // ── Settle pending reservations Stripe has already confirmed (P1 review) ──
  // A refund can succeed at Stripe while the route's own settle never lands (its
  // request timed out), after which the route flips the reservation to `failed`
  // — leaving a REAL refund recorded as failed, the order uncancelled and stock
  // un-restored. The webhook is the second witness: when Stripe reports a
  // SUCCEEDED refund that no ledger entry claims, and a `pending` reservation of
  // exactly that amount is waiting, that reservation is what the refund belongs
  // to. Settling it here makes the webhook authoritative for state the route may
  // never get to write.
  //
  // Matched on exact amount, each Stripe refund consumed at most once. Amount is
  // the only link available — a pending entry has no Stripe id yet, which is
  // precisely why it needs settling. A mis-pairing between two equal-amount
  // pending entries is cosmetic: both represent money Stripe says has left.
  const settlements: PendingSettlement[] = [];
  const claimedIds = new Set<string>();
  for (const [entryIndex, entry] of refunds.entries()) {
    if (!isPending(entry)) continue;
    const match = live.find(
      (r) =>
        r.status === 'succeeded' &&
        !claimedIds.has(r.id) &&
        !known.has(r.id) &&
        typeof r.amount === 'number' &&
        r.amount === entry.amount
    );
    if (match) {
      claimedIds.add(match.id);
      settlements.push({ entryIndex, stripeRefundId: match.id });
    }
  }

  // Money Stripe reports that no ledger entry accounts for. Settlements do not
  // change the TOTAL (a `pending` entry already counts) — only its finality.
  const delta = stripeRefunded - ledgerRefunded;

  // Is every refund backing this charge actually final? A `pending` /
  // `requires_action` Stripe refund can still FAIL, and Stripe returns that money
  // to the merchant — the customer is not refunded. Irreversible effects
  // (cancelling the order, restocking) must not run on that evidence.
  // No status information at all (the list call failed) counts as NOT settled:
  // the guard still works from the amount, but we refuse to take irreversible
  // action on unverified data.
  const allSettled = live.length > 0 && live.every((r) => r.status === 'succeeded');

  if (delta <= 0) {
    // Still report a floor advance: the ledger can legitimately SHRINK later
    // (a `pending` reservation flipping to `failed`), and if that reservation's
    // money actually did leave Stripe, the remembered floor is the only thing
    // that keeps the over-refund guard honest. See `stripeRefundedFloor`.
    return {
      action: 'noop',
      ledgerRefunded,
      floorAdvance,
      unattributedRefundIds,
      settlements,
      allSettled,
      isFullyRefunded: totalAmount > 0 && ledgerRefunded >= totalAmount,
    };
  }

  const reconciledTotal = ledgerRefunded + delta;
  return {
    action: 'record',
    amount: delta,
    reconciledTotal,
    isFullyRefunded: totalAmount > 0 && reconciledTotal >= totalAmount,
    unattributedRefundIds,
    floorAdvance,
    settlements,
    allSettled,
    // The appended entry is only terminal when Stripe says every refund on this
    // charge has actually succeeded; otherwise it reserves the amount against
    // over-refund while staying reversible.
    entryStatus: allSettled ? 'succeeded' : 'pending',
  };
}

export interface RefundLedgerRequest {
  orderId: string;
  type: 'full' | 'partial';
  /** Requested amount in minor units (cents) — required for partial refunds. */
  amount?: number;
  /** Product ids covered by this refund; order-independent. */
  items?: string[];
  /** Order total in minor units (cents). */
  totalAmount: number;
  /**
   * Highest cumulative `charge.amount_refunded` ever observed from a Stripe
   * `charge.refunded` event (`extensions.stripe_amount_refunded`, BMC-213).
   *
   * A pure REJECT gate, never an input to any amount. It exists because the
   * ledger can legitimately shrink: a reservation that flips `pending` →
   * `failed` (the route's Stripe-error path) leaves the total, on the assumption
   * no money moved. If Stripe actually DID process that refund — a timeout where
   * the request landed — the ledger under-reports and the guard would wave
   * through a second refund. Stripe's cumulative total only ever grows, so the
   * high-water mark keeps the guard honest even when the ledger disagrees.
   *
   * ⚠️ It must NEVER size a refund. An earlier revision folded it into
   * `allRefunded`, which shrank a full refund's `refundAmount` — and that value
   * feeds `deriveRefundIdempotencyKey`, while the reconcile path re-derives the
   * key from the UNFLOORED `totalAmount - baselineRefunded`. The two diverged, so
   * a retry of an interrupted full refund failed to match its own `pending` entry
   * and issued a SECOND real Stripe refund (a BMC-172 regression). Enforced as a
   * reject-only check after `refundAmount` is fixed; see the regression test
   * `does NOT perturb the idempotency key … (FULL refund)`.
   */
  stripeRefundedFloor?: number;
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
  const { orderId, type, amount, items, totalAmount, stripeRefundedFloor } = req;

  // Settled baseline = every entry EXCEPT in-flight `pending` reservations.
  // `priorRefundCount` and the detect amount hash over this baseline so a retry
  // (whose own entry is `pending`, hence excluded) reproduces its original key.
  const settled = refunds.filter((r) => !isPending(r));
  const priorRefundCount = settled.length;
  const baselineRefunded = computeRefundedTotal({ refunds: settled });
  // Full ledger total (INCLUDES pending) — used to validate a genuinely-new
  // refund so a concurrent in-flight reservation can't be over-refunded.
  //
  // NOTE (BMC-213): this stays LEDGER-ONLY on purpose. Every amount derived from
  // it — most importantly a full refund's `refundAmount` — feeds
  // `deriveRefundIdempotencyKey`, and the reconcile path re-derives that key from
  // `totalAmount - baselineRefunded`. If Stripe's floor were folded in here, the
  // two would diverge: a reservation made under a floor would hash a REDUCED
  // amount, while its own retry re-derives the unreduced one, fail to match its
  // `pending` entry, and issue a SECOND real Stripe refund — reintroducing
  // BMC-172. The floor is enforced separately, as a pure reject gate, below.
  const allRefunded = computeRefundedTotal({ refunds });

  // Stripe's observed high-water mark (`extensions.stripe_amount_refunded`),
  // when it exceeds what the ledger believes. Used ONLY to reject — never to
  // size a refund — so it cannot perturb any idempotency-key input.
  const effectiveRefunded =
    typeof stripeRefundedFloor === 'number' && Number.isFinite(stripeRefundedFloor)
      ? Math.max(allRefunded, stripeRefundedFloor)
      : allRefunded;

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

  // ── Floor gate (BMC-213): reject only, never resize ──────────────────────
  // Runs AFTER `refundAmount` is settled from the ledger, so the amount — and
  // therefore the idempotency key below — is identical whether or not a floor is
  // present. If Stripe has demonstrably returned more than the ledger records,
  // refuse rather than quietly refunding a reduced amount: the discrepancy means
  // our ledger is wrong, and guessing a smaller refund would both mask that and
  // shift the key a retry must reproduce.
  if (effectiveRefunded > allRefunded && refundAmount + effectiveRefunded > totalAmount) {
    return {
      action: 'reject',
      status: 409,
      error:
        'Stripe reports more refunded on this order than our records show ' +
        `(${effectiveRefunded} vs ${allRefunded} minor units). Refusing to refund ` +
        'further until the discrepancy is reconciled.',
    };
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

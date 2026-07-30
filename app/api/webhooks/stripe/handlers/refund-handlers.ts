/**
 * === `charge.refunded` reconciliation (BMC-213) ===
 *
 * Before this handler existed, the ONLY refund path that touched the app was
 * `POST /api/orders/refund`. A refund issued from the **Stripe Dashboard** — the
 * natural thing for a store owner to do — was completely invisible, and that was
 * a money-loss path, not just a reporting gap:
 *
 *   1. Operator refunds $50 in the Dashboard. Money leaves. App state unchanged.
 *   2. Operator later refunds $50 again via `/api/orders/refund`.
 *   3. The over-refund guard sums `extensions.refunds[]`, which never saw step 1,
 *      reads `$0` already refunded, passes, and Stripe returns ANOTHER $50.
 *
 * BMC-172's idempotency key does not help — those are two genuinely distinct
 * refunds, so every existing guard correctly lets them through. The only fix is
 * to get the Dashboard refund INTO the ledger, which is what this does.
 *
 * === Why the cumulative delta, not per-refund id matching ===
 * See `decideExternalRefundReconciliation` in `lib/payments/refund-ledger.ts`
 * for the full rationale. Short version: `charge.refunds.data[]` is NOT in the
 * webhook payload (Stripe's 2022-11-15 "deprecates charges auto-expand" change;
 * this app pins `2026-06-24.dahlia`), but `amount_refunded` — the cumulative
 * total — always is. Reconciling against that cumulative total is idempotent,
 * handles partial refunds by construction, and cannot double-count an
 * app-initiated refund whose own `charge.refunded` webhook arrives later.
 *
 * The individual refund ids are fetched separately, purely for audit provenance.
 * That call is best-effort: reconciliation stays correct without it, so a failure
 * degrades to an id-less ledger entry rather than skipping the write.
 */

import type Stripe from 'stripe';
import { getDbAsync } from '@/lib/db';
import { getStripeClient } from '@/lib/stripe';
import { getOrderByPaymentIntentId } from '@/lib/models/mach/orders';
import {
  decideExternalRefundReconciliation,
  type StripeRefundSummary,
} from '@/lib/payments/refund-ledger';
import {
  confirmRestockedLines,
  mutateRefundLedger,
  parseJson,
  readInflightRestockKeys,
  readUnavailableRestockKeys,
} from '@/lib/payments/refund-ledger-store';
import { restockForOrder, selectRestockLines } from '@/lib/services/inventory-adjustment';
import { getRefundPolicy } from '@/lib/utils/settings';
import { logCritical } from '@/lib/utils/observe';

/**
 * Should an externally-initiated refund restore stock? Defaults to TRUE (parity
 * with an app refund, which always restocks) but is an admin setting because it
 * is a genuine business decision: a Dashboard refund may be a goodwill gesture
 * where the goods were never returned, and restocking those would inflate
 * on-hand above what was actually sold.
 *
 * On a settings-READ ERROR we fail CLOSED (no restock) — note this differs from
 * the setting being ABSENT, which means "never configured" and defaults to true.
 * A transient D1 blip must not override an operator's explicit opt-out, and the
 * two directions are not symmetric (review finding): failing to restock
 * understates inventory, which is visible and recoverable by hand, while
 * restocking goods that were never returned overstates it and oversells to real
 * customers. Money reconciliation proceeds either way — only stock is held back.
 */
async function shouldRestockOnExternalRefund(): Promise<boolean> {
  try {
    // Read through getRefundPolicy() rather than getSettings() directly so the
    // default lives in exactly one place — duplicating the `!== false` fallback
    // here would let the two drift silently.
    const policy = await getRefundPolicy();
    return policy.restockOnExternalRefund;
  } catch (error) {
    console.error(
      '[webhook] Could not read refund settings; skipping restock (fail closed):',
      error
    );
    return false;
  }
}

/**
 * Fetch the charge's refunds for provenance only. Best-effort by design — see
 * the module header. Returns [] on any failure.
 */
async function listChargeRefunds(chargeId: string): Promise<StripeRefundSummary[]> {
  try {
    const stripe = getStripeClient();
    const list = await stripe.refunds.list({ charge: chargeId, limit: 100 });
    return (list?.data ?? []).map((r) => ({ id: r.id, amount: r.amount, status: r.status }));
  } catch (error) {
    console.error(`[webhook] Could not list refunds for charge ${chargeId}:`, error);
    return [];
  }
}

/**
 * Choose the lines this reconciliation should restore, and CLAIM them.
 *
 * Restock happens only on a FULL, fully-settled reconciliation. A partial
 * external refund carries no line attribution (Stripe refunds an amount, not
 * items), and guessing which lines came back would reintroduce exactly the
 * phantom-stock bug BMC-178 closed.
 *
 * Lines are claimed into `restockInflightLineKeys`, NOT marked restored — the
 * inventory write happens after this CAS commits, so only what actually lands is
 * promoted (see `confirmRestockedLines`). Both the restored and in-flight lists
 * are excluded from selection so no line is ever restocked twice.
 */
function planRestock(
  ctx: { extensions: any; order: { items?: unknown } },
  opts: { enabled: boolean; finalize: boolean }
): { lines: any[]; keys: string[]; extensions: Record<string, unknown> } {
  if (!opts.enabled || !opts.finalize) {
    return { lines: [], keys: [], extensions: {} };
  }

  const rawItems = ctx.order.items ? parseJson(ctx.order.items) : [];
  const orderItems: any[] = Array.isArray(rawItems) ? rawItems : [];
  const selected = selectRestockLines(orderItems, {
    fullRefund: true,
    refundedItemKeys: [],
    alreadyRestockedKeys: readUnavailableRestockKeys(ctx.extensions),
  });

  if (!selected.keys.length) {
    return { lines: [], keys: [], extensions: {} };
  }

  return {
    lines: selected.lines,
    keys: selected.keys,
    extensions: {
      restockInflightLineKeys: Array.from(
        new Set([...readInflightRestockKeys(ctx.extensions), ...selected.keys])
      ),
    },
  };
}

/** `charge.payment_intent` is `string | PaymentIntent | null` depending on expansion. */
function paymentIntentIdOf(charge: Stripe.Charge): string | null {
  const pi = charge.payment_intent;
  if (typeof pi === 'string') return pi;
  if (pi && typeof pi === 'object' && typeof pi.id === 'string') return pi.id;
  return null;
}

/**
 * Reconcile a `charge.refunded` event into the order's refund ledger.
 *
 * Idempotent: the decision is a delta against the cumulative Stripe total, so a
 * redelivery (or the app's own refund webhook) computes 0 and no-ops.
 */
export async function handleChargeRefunded(charge: Stripe.Charge, eventId: string): Promise<void> {
  const paymentIntentId = paymentIntentIdOf(charge);
  if (!paymentIntentId) {
    console.warn(`[webhook] charge.refunded ${charge.id} has no payment_intent; nothing to reconcile`);
    return;
  }

  const order = await getOrderByPaymentIntentId(paymentIntentId);
  if (!order) {
    // EXPECTED for charges that aren't storefront orders — subscription renewal
    // orders are keyed by invoice/subscription id and store no
    // `payment_intent_id` (see handlers/subscription-order.ts). Log and stop:
    // throwing a retryable error here would be a permanent retry storm on every
    // refunded subscription invoice.
    console.warn(
      `[webhook] charge.refunded ${charge.id}: no order for payment intent ${paymentIntentId}; skipping`
    );
    return;
  }

  // The MACH Order type carries `id` as optional; a row without one can't be
  // targeted by the CAS, so bail loudly rather than reconciling into nothing.
  const orderId = order.id;
  if (!orderId) {
    console.error(`[webhook] charge.refunded ${charge.id}: matched an order with no id; skipping`);
    logCritical('webhook', 'external_refund_order_missing_id', { chargeId: charge.id });
    return;
  }

  const stripeRefunds = await listChargeRefunds(charge.id);
  const db = await getDbAsync();
  const restockEnabled = await shouldRestockOnExternalRefund();

  let recorded: { amount: number; isFullyRefunded: boolean; refundIds: string[] } | null = null;
  let settledCount = 0;
  let unsettled: string[] | null = null;
  let shadowed: { ids: string[]; hasPending: boolean } | null = null;
  let restockLines: any[] = [];

  const result = await mutateRefundLedger(db, orderId, (ctx) => {
    // Reset per attempt — the CAS loop may re-run this callback.
    recorded = null;
    settledCount = 0;
    unsettled = null;
    shadowed = null;
    restockLines = [];

    const totalAmount = ctx.order.total_amount
      ? (parseJson(ctx.order.total_amount) ?? { amount: 0 })
      : { amount: 0 };

    const decision = decideExternalRefundReconciliation(ctx.refunds, {
      chargeAmountRefunded: charge.amount_refunded ?? 0,
      totalAmount: totalAmount.amount ?? 0,
      stripeRefunds,
      recordedFloor: ctx.extensions.stripe_amount_refunded,
    });

    // ── Settle `pending` reservations Stripe confirms succeeded ──────────────
    // Repairs the timeout race: the route's own settle never landed (or is about
    // to flip the entry to `failed`), but Stripe says the money left. Applied on
    // BOTH branches — the common case is delta 0, where settling is the only
    // thing this event does.
    let nextRefunds = ctx.refunds;
    if (decision.settlements.length > 0) {
      const bySlot = new Map(decision.settlements.map((s) => [s.entryIndex, s.stripeRefundId]));
      nextRefunds = ctx.refunds.map((r: any, i: number) => {
        const stripeRefundId = bySlot.get(i);
        if (!stripeRefundId) return r;
        return {
          ...r,
          status: 'succeeded',
          stripe_refund_id: stripeRefundId,
          stripe_charge_id: charge.id,
          settled_by_webhook: eventId,
          processed_at: r?.processed_at ?? ctx.nowIso,
        };
      });
      settledCount = decision.settlements.length;
    }

    // Irreversible effects require BOTH a covered total and Stripe confirming
    // every refund actually succeeded. A `pending`/`requires_action` refund can
    // still fail — Stripe hands that money back to us and the customer is left
    // un-refunded, so cancelling and restocking on it would be wrong and is not
    // reversed by anything (no refund.failed handler yet).
    const finalize = decision.isFullyRefunded && decision.allSettled;
    if (decision.isFullyRefunded && !decision.allSettled) {
      unsettled = decision.unattributedRefundIds;
    }

    if (decision.action === 'noop') {
      // Record whether this event's refund got SHADOWED by an unrelated in-flight
      // reservation (see `unattributedRefundIds`). Captured here, escalated after
      // the CAS loop so a retry can't emit it twice. Settled entries are no longer
      // shadowing anything, so only report what settlement did not explain.
      const stillUnexplained = decision.unattributedRefundIds.filter(
        (id) => !decision.settlements.some((s) => s.stripeRefundId === id)
      );
      shadowed =
        stillUnexplained.length > 0
          ? {
              ids: stillUnexplained,
              // A `pending` entry explains the mismatch benignly: an app refund's
              // own webhook can beat its Phase 3 settle, so its Stripe id is not
              // on the ledger YET. With nothing pending there is no such
              // explanation — a real refund has gone unrecorded.
              hasPending: ctx.refunds.some((r: any) => r?.status === 'pending'),
            }
          : null;

      const restock = planRestock(ctx, { enabled: restockEnabled, finalize });
      restockLines = restock.lines;

      // Nothing new to append — but a settlement, a floor advance, or a restock
      // claim each still needs persisting. The floor is what keeps the
      // over-refund guard correct if the ledger later shrinks.
      if (settledCount === 0 && decision.floorAdvance === null && restock.keys.length === 0) {
        return { action: 'skip' };
      }
      return {
        action: 'write',
        extensions: {
          ...ctx.extensions,
          ...(settledCount > 0 ? { refunds: nextRefunds } : {}),
          ...(decision.floorAdvance !== null
            ? { stripe_amount_refunded: decision.floorAdvance }
            : {}),
          ...restock.extensions,
          refunds_version: ctx.nextVersion,
        },
        // A settlement can be what finally makes the order fully refunded.
        columns: finalize ? { status: 'cancelled', payment_status: 'refunded' } : {},
      };
    }

    const entry = {
      // Prefix the id so an externally-reconciled entry is visibly distinct from
      // an app refund (whose id is the Stripe refund id or idempotency key).
      id: `ext:${eventId}`,
      // `pending` when Stripe has not confirmed every refund succeeded: it still
      // counts toward the over-refund guard, but stays reversible.
      status: decision.entryStatus,
      amount: decision.amount,
      type: decision.isFullyRefunded ? ('full' as const) : ('partial' as const),
      reason: 'external_refund',
      // Externally-initiated refunds carry no line attribution — see the restock
      // note below. Kept empty rather than guessed.
      items: [] as string[],
      notes: 'Reconciled from a refund issued outside the app (e.g. Stripe Dashboard)',
      source: 'stripe_external',
      stripe_charge_id: charge.id,
      stripe_refund_id: decision.unattributedRefundIds[0] ?? null,
      stripe_refund_ids: decision.unattributedRefundIds,
      reconciled_from_event: eventId,
      ...(decision.entryStatus === 'succeeded' ? { processed_at: ctx.nowIso } : {}),
    };

    const restock = planRestock(ctx, { enabled: restockEnabled, finalize });
    restockLines = restock.lines;

    recorded = {
      amount: decision.amount,
      isFullyRefunded: decision.isFullyRefunded,
      refundIds: decision.unattributedRefundIds,
    };

    return {
      action: 'write',
      extensions: {
        ...ctx.extensions,
        refunds: [...nextRefunds, entry],
        ...restock.extensions,
        // Remember Stripe's cumulative total as a floor for the over-refund guard.
        ...(decision.floorAdvance !== null
          ? { stripe_amount_refunded: decision.floorAdvance }
          : {}),
        refunds_version: ctx.nextVersion,
      },
      // Mirror the app refund path's order-level effects: a FULL refund cancels
      // the order and marks payment refunded; a PARTIAL leaves the order active
      // and still 'paid' (money did come back, but the order stands).
      columns: finalize ? { status: 'cancelled', payment_status: 'refunded' } : {},
    };
  });

  if (!result.ok) {
    // Money HAS left Stripe and we could not record it — the over-refund guard is
    // still blind, which is the exact failure this ticket exists to close. Page.
    const reason =
      result.reason === 'not_found'
        ? `order ${order.id} disappeared while reconciling`
        : `CAS exhausted writing the ledger for order ${order.id}`;
    console.error(`[webhook] charge.refunded ${charge.id}: ${reason}`);
    logCritical('webhook', 'external_refund_reconcile_failed', {
      orderId: order.id,
      chargeId: charge.id,
      reason: result.reason,
    });
    // Throw so the route returns 500 and Stripe redelivers — the decision is a
    // cumulative delta, so a retry is safe and self-correcting.
    throw new Error(`Failed to reconcile external refund for order ${order.id}: ${reason}`);
  }

  // Emitted once, after the CAS settles, so a retried attempt can't double-report.
  const shadow = shadowed as { ids: string[]; hasPending: boolean } | null;
  if (shadow) {
    const detail = `order ${order.id}, charge ${charge.id}, stripe refunds ${shadow.ids.join(',')}`;
    if (shadow.hasPending) {
      // Benign and self-resolving: an in-flight app refund simply hasn't stamped
      // its Stripe id onto its ledger entry yet.
      console.log(
        `[webhook] charge.refunded: refund id(s) not yet attributed while a reservation is in flight (${detail})`
      );
    } else {
      // No in-flight reservation to explain it — a real refund that Stripe
      // performed has no ledger line, and this event will not be redelivered.
      // The floor still guards the money; the AUDIT TRAIL is what is lost.
      console.error(
        `[webhook] charge.refunded: external refund left unrecorded in the ledger (${detail})`
      );
      logCritical('webhook', 'external_refund_unrecorded', {
        orderId: order.id,
        chargeId: charge.id,
        stripeRefundIds: shadow.ids,
        amountRefunded: charge.amount_refunded ?? 0,
      });
    }
  }

  if (settledCount > 0) {
    console.log(
      `[webhook] charge.refunded ${charge.id}: settled ${settledCount} pending reservation(s) ` +
        `on order ${order.id} that Stripe confirms succeeded`
    );
  }

  // The order is fully covered but Stripe has not confirmed every refund final.
  // Deliberately NOT cancelled or restocked: a `pending`/`requires_action` refund
  // can still fail, and there is no refund.failed handler to undo those effects.
  const pendingIds = unsettled as string[] | null;
  if (pendingIds) {
    console.warn(
      `[webhook] charge.refunded ${charge.id}: order ${order.id} is fully covered but Stripe has ` +
        `unsettled refund(s) — holding cancellation and restock until they succeed` +
        (pendingIds.length ? ` (${pendingIds.join(',')})` : '')
    );
  }

  const recordedEntry = recorded as {
    amount: number;
    isFullyRefunded: boolean;
    refundIds: string[];
  } | null;

  if (recordedEntry) {
    const { amount, isFullyRefunded, refundIds } = recordedEntry;
    console.log(
      `[webhook] Reconciled external refund on order ${order.id}: ${amount} minor units` +
        ` (${isFullyRefunded ? 'full' : 'partial'}${refundIds.length ? `, stripe refunds ${refundIds.join(',')}` : ''})`
    );
  } else if (result.skipped) {
    console.log(
      `[webhook] charge.refunded ${charge.id}: ledger already matches Stripe for order ${order.id}; no-op`
    );
  }

  // ── Phase two of the restock commit ──────────────────────────────────────
  // The lines were CLAIMED in the ledger CAS above (restockInflightLineKeys) but
  // are not yet marked restored. Only what actually lands is promoted; a line
  // that fails stays in-flight as a durable record that stock is still owed,
  // instead of the old behaviour where it was marked restored and silently lost.
  //
  // Best-effort: the money is already refunded and the ledger already committed,
  // so an inventory hiccup must never unwind the reconciliation or turn into a
  // 500 that makes Stripe retry a write that already landed.
  if (restockLines.length > 0) {
    try {
      const { restocked, completedKeys, failedKeys } = await restockForOrder(restockLines);
      await confirmRestockedLines(db, orderId, completedKeys);
      if (restocked.length) {
        console.log(
          `[webhook] Restocked ${restocked.length} variant(s) for external refund on order ${order.id}`
        );
      }
      if (failedKeys.length) {
        console.error(
          `[webhook] Restock incomplete on order ${order.id}; still owed: ${failedKeys.join(',')}`
        );
        logCritical('webhook', 'external_refund_restock_incomplete', {
          orderId: order.id,
          chargeId: charge.id,
          failedKeys,
        });
      }
    } catch (restockError) {
      // restockForOrder does not throw, so this is confirmRestockedLines or a
      // binding failure — the claim stands, which is the safe direction.
      console.error(
        `[webhook] Failed to restock inventory for external refund on order ${order.id}:`,
        restockError
      );
    }
  } else if (recordedEntry && !recordedEntry.isFullyRefunded && restockEnabled) {
    console.log(
      `[webhook] Partial external refund on order ${order.id}: stock left unchanged (no line attribution available)`
    );
  }
}

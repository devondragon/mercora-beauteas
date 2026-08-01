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
  classifyRefundTransition,
  decideRefundLifecycle,
} from '@/lib/payments/refund-lifecycle';
import {
  confirmRestockedLines,
  mutateRefundLedger,
  parseJson,
  readInflightRestockKeys,
  readUnavailableRestockKeys,
} from '@/lib/payments/refund-ledger-store';
import { buildRefundStatusEmail } from '@/lib/payments/refund-email';
import { restockForOrder, selectRestockLines } from '@/lib/services/inventory-adjustment';
import { sendOrderStatusUpdateEmail } from '@/lib/utils/email';
import { Money } from '@/lib/money';
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
 * Choose the lines a refund should restore, and CLAIM them.
 *
 * `enabled` is the caller's whole decision about WHETHER to restock; this only
 * decides WHICH lines. The two callers differ, and the difference is load-bearing
 * (PR #121 review):
 *
 *  - **Externally-initiated** (`charge.refunded`, or an `ext:` entry settling):
 *    restock only on a FULL, fully-settled reconciliation, with no line
 *    attribution — Stripe refunds an amount, not items, and guessing which lines
 *    came back would reintroduce exactly the phantom-stock bug BMC-178 closed.
 *    Also gated on the `restock_on_external_refund` setting.
 *  - **App-initiated** (an entry from `POST /api/orders/refund` settling late):
 *    restock the lines THAT refund covers, exactly as the route would have done
 *    synchronously — a partial refund restores its own `items`, a full one
 *    restores everything outstanding. Never gated on the external setting, which
 *    is explicitly about refunds issued outside the app.
 *
 * Lines are claimed into `restockInflightLineKeys`, NOT marked restored — the
 * inventory write happens after this CAS commits, so only what actually lands is
 * promoted (see `confirmRestockedLines`). Both the restored and in-flight lists
 * are excluded from selection so no line is ever restocked twice.
 */
function planRestock(
  ctx: { extensions: any; order: { items?: unknown } },
  opts: { enabled: boolean; fullRefund: boolean; refundedItemKeys?: string[] }
): { lines: any[]; keys: string[]; extensions: Record<string, unknown> } {
  if (!opts.enabled) {
    return { lines: [], keys: [], extensions: {} };
  }

  const rawItems = ctx.order.items ? parseJson(ctx.order.items) : [];
  const orderItems: any[] = Array.isArray(rawItems) ? rawItems : [];
  const selected = selectRestockLines(orderItems, {
    fullRefund: opts.fullRefund,
    refundedItemKeys: opts.refundedItemKeys ?? [],
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
    // un-refunded, so cancelling and restocking on it would be wrong. What is
    // withheld here is resumed by `handleRefundLifecycle` below when the refund
    // finally transitions (BMC-224); before that handler existed, nothing did.
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

      const restock = planRestock(ctx, {
        enabled: restockEnabled && finalize,
        fullRefund: true,
      });
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

    const restock = planRestock(ctx, {
      enabled: restockEnabled && finalize,
      fullRefund: true,
    });
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
  // can still fail, and those effects have no safe undo. `handleRefundLifecycle`
  // applies them when `refund.updated` reports the refund succeeded (BMC-224).
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

/* ────────────────────────────────────────────────────────────────────────────
 * === Refund lifecycle: `refund.updated` / `refund.failed` (BMC-224) ===
 *
 * `charge.refunded` above fires once, at refund CREATION, and never re-fires
 * when that refund later transitions. For a delayed payment method — Klarna,
 * Cash App Pay, Amazon Pay, all live here via `automatic_payment_methods` with
 * `allow_redirects: 'always'` — creation is not settlement, so BMC-213 withheld
 * cancellation and restock behind a `pending` ledger entry. These events are what
 * resume (or release) that entry.
 *
 * ⚠️ Subscribe `refund.updated` AND `refund.failed` on the Stripe endpoint. The
 * legacy `charge.refund.updated` event — the one this endpoint has had all along
 * — fires only "on selected payment methods" per Stripe's own SDK docs, so it is
 * NOT a substitute. It is routed here too, since it carries the same Refund
 * object and costs nothing to accept, but it cannot be relied on alone.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `Refund.charge` / `Refund.payment_intent` are `string | object | null`. */
function idOf(value: string | { id?: string } | null | undefined): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

/**
 * Resolve the PaymentIntent a refund belongs to, which is how orders are keyed.
 *
 * `Refund.payment_intent` is populated for anything created against a
 * PaymentIntent, which is every storefront order. The charge fallback covers a
 * refund raised directly against a charge (possible from the Dashboard).
 *
 * Returns null ONLY when Stripe is reachable and genuinely reports no payment
 * intent — a normal no-op, same as a charge that maps to no order. A retrieve
 * ERROR is deliberately NOT swallowed into that same null: this event is already
 * claimed in `processed_webhook_events`, so treating a transient Stripe blip as
 * "no order" would silently drop the transition forever and leave the refund
 * stuck — the exact failure mode this handler exists to close. Throwing returns
 * 500 and Stripe redelivers.
 */
async function resolvePaymentIntentId(refund: Stripe.Refund): Promise<string | null> {
  const direct = idOf(refund.payment_intent);
  if (direct) return direct;

  const chargeId = idOf(refund.charge);
  if (!chargeId) return null;

  const charge = await getStripeClient().charges.retrieve(chargeId);
  return idOf(charge?.payment_intent);
}

/**
 * Read back the charge's CUMULATIVE `amount_refunded` after a reversal.
 *
 * The Refund object carries only its own amount, and the floor
 * (`extensions.stripe_amount_refunded`) is a cumulative figure — so lowering it
 * requires asking Stripe what the new cumulative total is. Deliberately NOT
 * derived as `floor - refund.amount`: that arithmetic would lower the
 * over-refund guard on inference rather than on verified data, and a stale or
 * concurrent view would silently open the exact hole BMC-213 closed.
 *
 * Throws on failure so the route returns 500 and Stripe redelivers. Every write
 * below is idempotent, so a retry is safe and self-correcting.
 */
async function fetchChargeAmountRefunded(chargeId: string): Promise<number> {
  const charge = await getStripeClient().charges.retrieve(chargeId);
  const amount = charge?.amount_refunded;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
    throw new Error(`Charge ${chargeId} returned no usable amount_refunded`);
  }
  return amount;
}

/**
 * Apply a `refund.updated` / `refund.failed` / `charge.refund.updated` event to
 * the order's refund ledger.
 *
 * Idempotent: the decision is re-derived from ledger state every delivery, so a
 * redelivery whose entry already carries the target status writes nothing, and
 * the two-phase restock claim makes a repeated finalize a no-op.
 */
export async function handleRefundLifecycle(
  refund: Stripe.Refund,
  eventId: string,
  eventType: string
): Promise<void> {
  const transition = classifyRefundTransition(refund.status);
  if (transition === 'inconclusive') {
    // `pending` / `requires_action` — the refund is still in flight. Stripe emits
    // an update on entering those states too; there is simply nothing to decide.
    console.log(
      `[webhook] ${eventType} ${refund.id}: status '${refund.status}' is not terminal; nothing to apply`
    );
    return;
  }

  const paymentIntentId = await resolvePaymentIntentId(refund);
  if (!paymentIntentId) {
    console.warn(`[webhook] ${eventType} ${refund.id} has no payment intent; nothing to apply`);
    return;
  }

  const order = await getOrderByPaymentIntentId(paymentIntentId);
  if (!order) {
    // EXPECTED — same as `charge.refunded`: subscription renewal orders are keyed
    // by invoice/subscription id and store no `payment_intent_id`.
    console.warn(
      `[webhook] ${eventType} ${refund.id}: no order for payment intent ${paymentIntentId}; skipping`
    );
    return;
  }

  const orderId = order.id;
  if (!orderId) {
    console.error(`[webhook] ${eventType} ${refund.id}: matched an order with no id; skipping`);
    logCritical('webhook', 'refund_lifecycle_order_missing_id', { refundId: refund.id });
    return;
  }

  const chargeId = idOf(refund.charge);

  // On a reversal the floor must come from a verified read, so fetch it BEFORE
  // the CAS — a throw here is a clean retry rather than a half-applied write.
  let chargeAmountRefunded: number | undefined;
  if (transition === 'reversed') {
    if (chargeId) {
      chargeAmountRefunded = await fetchChargeAmountRefunded(chargeId);
    } else {
      // No charge to ask, so the floor cannot be lowered on verified data. The
      // entry is still released; the floor simply stays high, which only ever
      // over-blocks (the safe direction) and is visible in this log.
      console.warn(
        `[webhook] ${eventType} ${refund.id}: no charge id; releasing the ledger entry but ` +
          `leaving stripe_amount_refunded unchanged`
      );
    }
  }

  const db = await getDbAsync();
  const restockEnabled = transition === 'succeeded' ? await shouldRestockOnExternalRefund() : false;

  let applied: { action: 'settle'; finalize: boolean; emailCustomer: boolean; amount: number | null; isFullRefund: boolean } | { action: 'release'; floor: number | null; wasSettled: boolean; wasAppInitiated: boolean } | null = null;
  let noopReason: string | null = null;
  let restockLines: any[] = [];

  const result = await mutateRefundLedger(db, orderId, (ctx) => {
    // Reset per attempt — the CAS loop may re-run this callback.
    applied = null;
    noopReason = null;
    restockLines = [];

    const totalAmount = ctx.order.total_amount
      ? (parseJson(ctx.order.total_amount) ?? { amount: 0 })
      : { amount: 0 };

    const decision = decideRefundLifecycle(ctx.refunds, transition, {
      refundId: refund.id,
      refundAmount: refund.amount,
      totalAmount: totalAmount.amount ?? 0,
      chargeAmountRefunded,
      recordedFloor: ctx.extensions.stripe_amount_refunded,
    });

    if (decision.action === 'noop') {
      noopReason = decision.reason;
      return { action: 'skip' };
    }

    if (decision.action === 'settle') {
      const nextRefunds = decision.needsFlip
        ? ctx.refunds.map((r: any, i: number) =>
            i === decision.entryIndex
              ? {
                  ...r,
                  status: 'succeeded',
                  // Stamp provenance so a later delivery matches on id rather
                  // than falling back to the amount heuristic.
                  stripe_refund_id: r?.stripe_refund_id ?? refund.id,
                  ...(chargeId ? { stripe_charge_id: r?.stripe_charge_id ?? chargeId } : {}),
                  settled_by_webhook: eventId,
                  processed_at: r?.processed_at ?? ctx.nowIso,
                }
              : r
          )
        : ctx.refunds;

      // Two different restock rules, because the two kinds of refund are
      // genuinely different (PR #121 review):
      //
      //  - APP-INITIATED: reproduce exactly what `POST /api/orders/refund` would
      //    have done synchronously had this refund not been delayed — restore the
      //    lines THIS refund covers, on the settle itself. Gating it on
      //    `finalize` would silently never restock a PARTIAL app refund on a
      //    delayed payment method (the order is never fully covered, so finalize
      //    stays false), and gating it on the external setting would let a toggle
      //    documented as "external refunds only" suppress an app refund's stock.
      //  - EXTERNAL: unchanged BMC-213 behaviour — full-and-settled only, no line
      //    attribution, and honouring the external-refund setting.
      const restock = planRestock(
        ctx,
        decision.wasAppInitiated
          ? {
              enabled: decision.needsFlip,
              fullRefund: decision.isFullRefund,
              refundedItemKeys: decision.items,
            }
          : { enabled: restockEnabled && decision.finalize, fullRefund: true }
      );
      restockLines = restock.lines;

      // A redelivery that changes nothing must not burn a version bump.
      const alreadyFinal =
        ctx.order.status === 'cancelled' && ctx.order.payment_status === 'refunded';
      if (
        !decision.needsFlip &&
        restock.keys.length === 0 &&
        (!decision.finalize || alreadyFinal)
      ) {
        return { action: 'skip' };
      }

      applied = {
        action: 'settle',
        finalize: decision.finalize,
        // Gated on needsFlip so the email fires exactly once: only the delivery
        // that actually moves the entry to `succeeded` sends it, and a
        // redelivery (needsFlip false) cannot repeat it.
        emailCustomer: decision.needsFlip && decision.wasAppInitiated,
        amount: decision.amount,
        isFullRefund: decision.isFullRefund,
      };
      return {
        action: 'write',
        extensions: {
          ...ctx.extensions,
          refunds: nextRefunds,
          ...restock.extensions,
          refunds_version: ctx.nextVersion,
        },
        // The effects BMC-213 withheld, applied now that Stripe confirms the
        // money reached the customer and no other refund on this order is still
        // in flight.
        columns: decision.finalize ? { status: 'cancelled', payment_status: 'refunded' } : {},
      };
    }

    // ── release ───────────────────────────────────────────────────────────────
    if (!decision.needsFlip && decision.floor === null) {
      return { action: 'skip' };
    }

    const nextRefunds = decision.needsFlip
      ? ctx.refunds.map((r: any, i: number) =>
          i === decision.entryIndex
            ? {
                ...r,
                // `failed` is what `computeRefundedTotal` excludes, so this is
                // what stops the entry counting against the over-refund guard and
                // unblocks a legitimate re-refund of the same amount.
                status: 'failed',
                stripe_refund_id: r?.stripe_refund_id ?? refund.id,
                ...(chargeId ? { stripe_charge_id: r?.stripe_charge_id ?? chargeId } : {}),
                released_by_webhook: eventId,
                ...(refund.failure_reason ? { failure_reason: refund.failure_reason } : {}),
              }
            : r
        )
      : ctx.refunds;

    applied = {
      action: 'release',
      floor: decision.floor,
      wasSettled: decision.wasSettled,
      wasAppInitiated: decision.wasAppInitiated,
    };
    return {
      action: 'write',
      extensions: {
        ...ctx.extensions,
        refunds: nextRefunds,
        ...(decision.floor !== null ? { stripe_amount_refunded: decision.floor } : {}),
        refunds_version: ctx.nextVersion,
      },
    };
  });

  if (!result.ok) {
    const reason =
      result.reason === 'not_found'
        ? `order ${orderId} disappeared while applying the transition`
        : `CAS exhausted writing the ledger for order ${orderId}`;
    console.error(`[webhook] ${eventType} ${refund.id}: ${reason}`);
    logCritical('webhook', 'refund_lifecycle_apply_failed', {
      orderId,
      refundId: refund.id,
      eventType,
      transition,
      reason: result.reason,
    });
    // Retryable and self-correcting — the decision is re-derived from fresh
    // ledger state on every delivery.
    throw new Error(`Failed to apply ${eventType} for order ${orderId}: ${reason}`);
  }

  const outcome = applied as
    | { action: 'settle'; finalize: boolean; emailCustomer: boolean; amount: number | null; isFullRefund: boolean }
    | { action: 'release'; floor: number | null; wasSettled: boolean; wasAppInitiated: boolean }
    | null;

  if (!outcome) {
    if (noopReason === 'no_matching_entry') {
      // Not an error: `charge.refunded` is the authoritative recorder and its
      // entry may carry no Stripe refund id (the provenance list call is
      // best-effort), so a match can legitimately fail. Appending here would
      // double-count that money — see the module doc on refund-lifecycle.ts.
      console.warn(
        `[webhook] ${eventType} ${refund.id}: no ledger entry on order ${orderId} matches this ` +
          `refund; leaving the ledger to charge.refunded`
      );
    } else {
      console.log(
        `[webhook] ${eventType} ${refund.id}: ledger already reflects this transition on order ${orderId}; no-op`
      );
    }
    return;
  }

  if (outcome.action === 'release') {
    console.log(
      `[webhook] ${eventType} ${refund.id}: released the ledger entry on order ${orderId}` +
        (outcome.floor !== null ? ` and set stripe_amount_refunded to ${outcome.floor}` : '') +
        (refund.failure_reason ? ` (${refund.failure_reason})` : '')
    );
    // Two situations the ledger correction above cannot put right on its own:
    //
    //  - `wasSettled` — the entry was already `succeeded`, so the order may
    //    ALREADY be cancelled and the stock already returned on money that has
    //    now come back to us. Un-cancelling and de-stocking are destructive and
    //    racy, so they are NOT automated.
    //  - `wasAppInitiated` — `POST /api/orders/refund` emails the customer as
    //    soon as Stripe ACCEPTS a refund, so someone has been told they were
    //    refunded and was not. No automated message can undo that.
    //
    // Either way a human has to look, so page rather than only logging.
    if (outcome.wasSettled || outcome.wasAppInitiated) {
      const why = [
        outcome.wasSettled && 'order status and inventory may need review',
        outcome.wasAppInitiated && 'the customer was already emailed that they were refunded',
      ]
        .filter(Boolean)
        .join('; ');
      console.error(
        `[webhook] ${eventType} ${refund.id}: refund reversed on order ${orderId} — ${why}`
      );
      logCritical('webhook', 'settled_refund_reversed', {
        orderId,
        refundId: refund.id,
        chargeId,
        amount: refund.amount,
        wasSettled: outcome.wasSettled,
        wasAppInitiated: outcome.wasAppInitiated,
        failureReason: refund.failure_reason ?? null,
      });
    }
    return;
  }

  console.log(
    `[webhook] ${eventType} ${refund.id}: settled the ledger entry on order ${orderId}` +
      (outcome.finalize ? ' and applied the held cancellation' : ' (effects still held)')
  );

  // ── The customer's "you have been refunded" email ────────────────────────
  // `POST /api/orders/refund` DEFERS this message when Stripe has only ACCEPTED
  // the refund, because a delayed payment method can still fail and the claim
  // would have been untrue with no automated correction. Settling here is the
  // moment it becomes true, so this is where it gets sent.
  //
  // Scoped to app-initiated refunds (`wasAppInitiated`) so this does not become
  // a NEW email surface: an externally-reconciled Dashboard refund has never
  // emailed the customer, and silently starting to would be a store-owner
  // decision, not a bug fix. Best-effort — the money and the ledger are already
  // committed, so a mail failure must never 500 and make Stripe retry a write
  // that landed.
  if (outcome.emailCustomer) {
    try {
      const refundAmountFormatted = Money.fromMinor(
        outcome.amount ?? 0,
        result.order.currency_code
      ).format();
      const emailResult = await sendOrderStatusUpdateEmail(
        buildRefundStatusEmail(result.order, {
          isFullRefund: outcome.isFullRefund,
          refundAmount: refundAmountFormatted,
        })
      );
      if (emailResult.success) {
        console.log(
          `[webhook] Refund status email sent for order ${orderId} once refund ${refund.id} settled (${refundAmountFormatted})`
        );
      } else {
        // The customer was never told their money came back, and the route
        // deliberately did not send it earlier — so nothing else will.
        console.error(
          `[webhook] Failed to send settled-refund email for order ${orderId}: ${emailResult.error}`
        );
        logCritical('webhook', 'settled_refund_email_failed', {
          orderId,
          refundId: refund.id,
          error: emailResult.error ?? null,
        });
      }
    } catch (emailError) {
      console.error(
        `[webhook] Failed to send settled-refund email for order ${orderId}:`,
        emailError
      );
      logCritical('webhook', 'settled_refund_email_failed', { orderId, refundId: refund.id }, emailError);
    }
  }

  // ── Phase two of the restock commit (same contract as `charge.refunded`) ────
  // Lines were CLAIMED inside the CAS; only what actually lands is promoted. A
  // failed line stays in-flight as a durable record that stock is still owed.
  if (restockLines.length > 0) {
    try {
      const { restocked, completedKeys, failedKeys } = await restockForOrder(restockLines);
      // Report what inventory actually did BEFORE promoting the claim: the
      // promotion can itself fail, and a stock shortfall must still page when it
      // does rather than being swallowed by the catch below.
      if (restocked.length) {
        console.log(
          `[webhook] Restocked ${restocked.length} variant(s) on order ${orderId} after refund ${refund.id} settled`
        );
      }
      if (failedKeys.length) {
        console.error(
          `[webhook] Restock incomplete on order ${orderId}; still owed: ${failedKeys.join(',')}`
        );
        logCritical('webhook', 'refund_lifecycle_restock_incomplete', {
          orderId,
          refundId: refund.id,
          failedKeys,
        });
      }
      await confirmRestockedLines(db, orderId, completedKeys);
    } catch (restockError) {
      // restockForOrder does not throw, so this is confirmRestockedLines or a
      // binding failure — the claim stands, which is the safe direction.
      console.error(
        `[webhook] Failed to restock inventory for refund ${refund.id} on order ${orderId}:`,
        restockError
      );
    }
  }
}

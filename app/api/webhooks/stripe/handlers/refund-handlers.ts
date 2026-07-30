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
import { mutateRefundLedger, parseJson } from '@/lib/payments/refund-ledger-store';
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
 * Fails to the default on any settings-read error — an inventory preference must
 * never be the reason a money-reconciliation webhook fails.
 */
async function shouldRestockOnExternalRefund(): Promise<boolean> {
  try {
    // Read through getRefundPolicy() rather than getSettings() directly so the
    // default lives in exactly one place — duplicating the `!== false` fallback
    // here would let the two drift silently.
    const policy = await getRefundPolicy();
    return policy.restockOnExternalRefund;
  } catch (error) {
    console.error('[webhook] Could not read refund settings; defaulting to restock:', error);
    return true;
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
  let restockLines: any[] = [];

  const result = await mutateRefundLedger(db, orderId, (ctx) => {
    // Reset per attempt — the CAS loop may re-run this callback.
    recorded = null;
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

    if (decision.action === 'noop') {
      // Nothing to add to the ledger — but if this event raises Stripe's
      // observed high-water mark, persist that alone. It is what keeps the
      // over-refund guard correct if the ledger later shrinks (a `pending`
      // reservation flipping to `failed` for a refund whose money DID leave).
      if (decision.floorAdvance === null) {
        return { action: 'skip' };
      }
      return {
        action: 'write',
        extensions: {
          ...ctx.extensions,
          stripe_amount_refunded: decision.floorAdvance,
          refunds_version: ctx.nextVersion,
        },
      };
    }

    const entry = {
      // Prefix the id so an externally-reconciled entry is visibly distinct from
      // an app refund (whose id is the Stripe refund id or idempotency key).
      id: `ext:${eventId}`,
      status: 'succeeded' as const,
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
      processed_at: ctx.nowIso,
    };

    // Restock ONLY on a full reconciliation. A partial external refund carries no
    // line attribution (Stripe refunds an amount, not items), and guessing which
    // lines came back would reintroduce exactly the phantom-stock bug BMC-178
    // closed. `selectRestockLines` still excludes anything a prior refund already
    // restocked, so a Dashboard refund following an app partial refund restores
    // only the remainder.
    const priorRestockedKeys: string[] = Array.isArray(ctx.extensions.restockedLineKeys)
      ? ctx.extensions.restockedLineKeys
      : [];
    let newlyRestockedKeys: string[] = [];
    if (restockEnabled && decision.isFullyRefunded) {
      const rawItems = ctx.order.items ? parseJson(ctx.order.items) : [];
      const orderItems: any[] = Array.isArray(rawItems) ? rawItems : [];
      const selected = selectRestockLines(orderItems, {
        fullRefund: true,
        refundedItemKeys: [],
        alreadyRestockedKeys: priorRestockedKeys,
      });
      restockLines = selected.lines;
      newlyRestockedKeys = selected.keys;
    }

    recorded = {
      amount: decision.amount,
      isFullyRefunded: decision.isFullyRefunded,
      refundIds: decision.unattributedRefundIds,
    };

    return {
      action: 'write',
      extensions: {
        ...ctx.extensions,
        refunds: [...ctx.refunds, entry],
        restockedLineKeys: Array.from(new Set([...priorRestockedKeys, ...newlyRestockedKeys])),
        // Remember Stripe's cumulative total as a floor for the over-refund guard.
        ...(decision.floorAdvance !== null
          ? { stripe_amount_refunded: decision.floorAdvance }
          : {}),
        refunds_version: ctx.nextVersion,
      },
      // Mirror the app refund path's order-level effects: a FULL refund cancels
      // the order and marks payment refunded; a PARTIAL leaves the order active
      // and still 'paid' (money did come back, but the order stands).
      columns: decision.isFullyRefunded
        ? { status: 'cancelled', payment_status: 'refunded' }
        : {},
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

  if (result.skipped || !recorded) {
    console.log(
      `[webhook] charge.refunded ${charge.id}: ledger already matches Stripe for order ${order.id}; no-op`
    );
    return;
  }

  const { amount, isFullyRefunded, refundIds } = recorded as {
    amount: number;
    isFullyRefunded: boolean;
    refundIds: string[];
  };
  console.log(
    `[webhook] Reconciled external refund on order ${order.id}: ${amount} minor units` +
      ` (${isFullyRefunded ? 'full' : 'partial'}${refundIds.length ? `, stripe refunds ${refundIds.join(',')}` : ''})`
  );

  // Best-effort, mirroring the refund route: the ledger (including the
  // restockedLineKeys record) is already committed, so an inventory hiccup must
  // never unwind the reconciliation or turn into a 500 that makes Stripe retry a
  // write that already landed.
  try {
    if (restockLines.length > 0) {
      const { restocked } = await restockForOrder(restockLines);
      if (restocked.length) {
        console.log(
          `[webhook] Restocked ${restocked.length} variant(s) for external refund on order ${order.id}`
        );
      }
    } else if (!isFullyRefunded && restockEnabled) {
      console.log(
        `[webhook] Partial external refund on order ${order.id}: stock left unchanged (no line attribution available)`
      );
    }
  } catch (restockError) {
    console.error(
      `[webhook] Failed to restock inventory for external refund on order ${order.id}:`,
      restockError
    );
  }
}

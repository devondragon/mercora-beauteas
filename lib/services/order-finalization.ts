/**
 * Paid-Order Finalization (BMC-167)
 *
 * The single, shared "promote a pending order to paid" routine, called by the
 * two writers that can finalize a storefront order against a captured Stripe
 * payment:
 *
 *   - POST /api/orders  — the client fast-path (inline card, or the redirect
 *     return page re-posting its snapshot), and
 *   - the Stripe `payment_intent.succeeded` webhook — the server-side backstop
 *     that finalizes the order when the client POST never lands.
 *
 * Both may fire, in either order, and Stripe may redeliver the webhook. This
 * routine guarantees they converge on EXACTLY ONE paid order with no duplicate
 * side effects:
 *
 *   1. Re-verify the captured cash covers the CATALOG value of the goods
 *      (never client-supplied prices) — the BMC-131 charge gate, run by every
 *      writer that can mark an order paid.
 *   2. Flip pending → paid with a guarded compare-and-swap (`promoteOrderToPaid`).
 *      D1 has no transactions, so this conditional UPDATE is what makes "at most
 *      one writer wins" atomic. Only the winner runs the one-time side effects.
 *   3. On a win: fulfill gift cards (idempotent, order-keyed) and — if the tender
 *      that the charge gate counted on was not actually redeemed — revert the
 *      order to pending (H1). Then send the confirmation email.
 *
 * Precondition: the caller has already established that the PaymentIntent
 * SUCCEEDED and is BOUND to `order.id` (the order route checks
 * `pi.metadata.orderId`; the webhook looks the order up BY `pi.metadata.orderId`).
 * `paidAmountCents` MUST be the server-verified captured amount
 * (`pi.amount_received`), never the authorized `pi.amount`.
 *
 * Error semantics: a permanent underpayment returns `{ paid: false, reason }`
 * (the caller leaves the order pending; the webhook records the event processed
 * with no retry). A TRANSIENT failure (e.g. a D1 error while pricing the
 * catalog) THROWS — the order route fails closed to pending, the webhook turns
 * it into a Stripe retry. This routine therefore never catches the charge-check
 * throw; it only swallows best-effort side effects (gift cards, email).
 */

import type { Order } from '@/lib/types/order';
import {
  promoteOrderToPaid,
  markOrderUnpaid,
  updateOrderNotes,
} from '@/lib/models/mach/orders';
import {
  resolveGiftCardTenderCents,
  verifyOrderChargeSufficient,
} from '@/lib/services/order-pricing';
import {
  processGiftCardsForOrder,
  retryUndeliveredGiftCards,
} from '@/lib/services/gift-card-fulfillment';
import { sendOrderConfirmationForOrder } from '@/lib/services/order-confirmation';
import { decrementStockForOrder, flagOversoldForReview } from '@/lib/services/inventory-adjustment';
import { redeemCoupon } from '@/lib/models/mach/couponInstance';
import { Money } from '@/lib/money';
import { logCritical } from '@/lib/utils/observe';

export interface FinalizePaidOrderResult {
  /** The order is paid after this call (this writer promoted it, or another already had). */
  paid: boolean;
  /** This call won the pending → paid CAS and ran the one-time side effects. */
  promotedByUs: boolean;
  /** Why the order could NOT be marked paid (permanent underpayment / unpriceable catalog). */
  reason?: string;
  /** True when an H1 gift-card-tender revert brought a just-promoted order back to pending. */
  reverted?: boolean;
}

export interface FinalizePaidOrderArgs {
  /** The hydrated pending order to finalize. */
  order: Order;
  /** Server-verified captured amount (`pi.amount_received`), in cents. */
  paidAmountCents: number;
  /** Send the confirmation email when this call wins the promotion. */
  sendEmail: boolean;
  /** Notes to stamp on the order when it is promoted. */
  paidNotes?: string;
  /** Display name for the confirmation email (Clerk profile on the client path). */
  customerName?: string;
}

/**
 * Coerce a persisted expected-charge field (`extensions.expected_*_cents`) to a
 * non-negative integer number of cents, or 0 when missing/malformed. Persisted as
 * a plain number by `/api/payment-intent`, but a legacy order won't have it and a
 * hand-edited row could carry anything — fail to 0 (goods-only floor) rather than
 * NaN (which would silently pass every comparison) or a negative (which would
 * lower the floor).
 */
function toNonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export async function finalizePaidOrder(args: FinalizePaidOrderArgs): Promise<FinalizePaidOrderResult> {
  const { order, paidAmountCents, sendEmail, paidNotes, customerName } = args;
  const orderId = order.id!;

  // (1) Charge gate — re-price the goods from the catalog and confirm the cash
  // collected (plus any DB-resolved gift-card tender, minus any authoritatively
  // recomputed cart discount) covers them. A THROW here (transient catalog read)
  // propagates to the caller by design.
  const giftCardTenderCents = await resolveGiftCardTenderCents(order.extensions);
  // The applied cart-discount code(s) were persisted on the order (BMC-177); the
  // gate recomputes the discount from the coupon itself, so a stale/tampered
  // client amount is never trusted. Non-array/legacy orders → no discount.
  const rawDiscountCodes = order.extensions?.discount_codes;
  const discountCodes = Array.isArray(rawDiscountCodes)
    ? rawDiscountCodes.filter((c: unknown): c is string => typeof c === 'string')
    : undefined;
  // BMC-201: the expected shipping + tax were computed server-side and persisted
  // on the order at PaymentIntent creation. Re-enforce the SAME figures here (both
  // writers — client POST /api/orders and the Stripe webhook — go through this
  // finalizer), so a PaymentIntent whose captured amount omitted tax/shipping is
  // rejected. Coerce to a non-negative integer; a legacy/pre-BMC-201 order without
  // these keys → 0, i.e. the goods-only floor, unchanged.
  const expectedShippingCents = toNonNegativeInt(order.extensions?.expected_shipping_cents);
  const expectedTaxCents = toNonNegativeInt(order.extensions?.expected_tax_cents);
  const charge = await verifyOrderChargeSufficient({
    items: order.items as any,
    paidAmountCents,
    giftCardTenderCents,
    discountCodes,
    expectedShippingCents,
    expectedTaxCents,
  });

  if (!charge.ok) {
    // Real money captured but re-verification failed — a legit customer stuck,
    // not an underpayment attack — so flag it for manual review (best-effort)
    // rather than leaving a silently-pending order with money captured. Two cases:
    //   - the catalog can't price the order (e.g. a variant was discontinued
    //     between capture and finalization) — M4 / BMC-131; or
    //   - the order carried a cart-discount code whose promotion changed state
    //     (paused, or its window elapsed) between charge and finalization, so the
    //     discount correctly recomputes lower and the (correctly discounted)
    //     captured amount now reads as underpaying — BMC-177 review. Without this,
    //     a customer who paid exactly what they were quoted is left silently
    //     pending with money captured.
    const catalogUnpriceable = charge.reason?.startsWith('cannot price order from catalog');
    const hadDiscountCodes = !!discountCodes?.length;
    if (paidAmountCents > 0 && (catalogUnpriceable || hadDiscountCodes)) {
      try {
        await updateOrderNotes(
          orderId,
          `NEEDS REVIEW: captured ${paidAmountCents}c but charge re-verification failed: ${charge.reason}`
        );
      } catch (noteError) {
        console.error(`[finalize] Order ${orderId}: failed to record review note`, noteError);
      }
    }
    return { paid: false, promotedByUs: false, reason: charge.reason };
  }

  // (2) Guarded CAS: flip pending → paid. Exactly one concurrent writer wins.
  const { promoted, order: promotedOrder } = await promoteOrderToPaid(orderId, {
    status: 'processing',
    notes: paidNotes,
  });

  if (!promoted) {
    // Another writer already promoted this order (or it vanished). Idempotent —
    // do NOT re-run the one-time side effects. `paid` reflects current state.
    const alreadyPaid = promotedOrder?.payment_status === 'paid';
    // BMC-186: this branch is the convergence LOSER (the second of the
    // client-POST / webhook pair). The winner already ran full gift-card
    // fulfillment; if a card's delivery email failed there, re-drive it now — a
    // genuine second attempt at a later moment. This re-sends ONLY for
    // already-issued (already-paid-for) cards, so it needs no payment context
    // and never mints or redeems. Guarded so it can't throw out of finalization.
    if (alreadyPaid) {
      try {
        const retry = await retryUndeliveredGiftCards(promotedOrder ?? order);
        if (retry.retried) {
          console.log(
            `[finalize] Re-drove ${retry.retried} undelivered gift-card email(s) for ${orderId}`
          );
        }
        if (retry.errors.length) {
          console.error(
            `[finalize] Gift-card delivery retry errors for ${orderId}:`,
            retry.errors
          );
        }
      } catch (retryError) {
        console.error(
          `[finalize] Gift-card delivery retry failed for ${orderId}:`,
          retryError
        );
      }
    }
    return { paid: alreadyPaid, promotedByUs: false };
  }

  const finalOrder = promotedOrder ?? order;

  // (3) One-time side effects — this call owns them.
  // Gift-card fulfillment is idempotent and order-keyed; guard it so a failure
  // never throws out of finalization (payment is already captured + recorded).
  let redeemed = 0;
  try {
    const gc = await processGiftCardsForOrder(finalOrder, { paidAmountCents });
    redeemed = gc.redeemed;
    if (gc.issued || gc.redeemed) {
      console.log(
        `[finalize] Gift cards for ${orderId}: issued=${gc.issued} redeemed=${gc.redeemed}`
      );
    }
    if (gc.errors.length) {
      // Full detail (incl. gift-card codes) goes to Workers Logs only. Do NOT
      // pass gc.errors to logCritical — those strings embed redeemable codes and
      // the alert is emailed to a third party (BMC-168 security review).
      console.error(`[finalize] Gift card fulfillment errors for ${orderId}:`, gc.errors);
      logCritical('giftcard', 'fulfillment_errors', { orderId, count: gc.errors.length });
    }
  } catch (gcError) {
    console.error(`[finalize] Gift card fulfillment failed for ${orderId}:`, gcError);
    logCritical('giftcard', 'fulfillment_threw', { orderId }, gcError);
  }

  // H1: the charge gate credited an UNRESERVED gift-card balance as tender. If
  // redemption then applied nothing (e.g. a lost balance race), the tender never
  // materialized — the cash collected does NOT cover the goods. Revert to pending
  // rather than fulfilling goods that were only partially paid for.
  const appliedGiftCardCode = (order.extensions as any)?.gift_card?.code;
  if (appliedGiftCardCode && giftCardTenderCents > 0 && redeemed === 0) {
    console.error(
      `[finalize] Order ${orderId}: gift-card tender (${giftCardTenderCents}c) was counted toward payment ` +
        `but redemption applied nothing; reverting order to pending`
    );
    // The order is already CAS-promoted to PAID here. If markOrderUnpaid throws,
    // we must NOT let it propagate: the caller (webhook) would 500 and retry
    // forever, and the client POST would surface an error — all while the order
    // stays stranded PAID with under-collected goods. Instead, log LOUDLY and
    // return a review-flagged signal (BMC-167 review). Either way this is a
    // permanent, non-retryable outcome the caller records via `reason`.
    try {
      await markOrderUnpaid(orderId, {
        notes: `Reverted to pending: gift-card tender not redeemed`,
      });
      // L4 (BMC-167 review): surface a reason so the webhook's
      // `if (!result.paid && result.reason)` branch logs the revert instead of
      // silently leaving the order pending with no trace (mirrors the
      // catalog-unpriceable case).
      return {
        paid: false,
        promotedByUs: true,
        reverted: true,
        reason: `gift-card tender (${giftCardTenderCents}c) counted toward payment but redemption applied nothing; reverted to pending`,
      };
    } catch (revertError) {
      console.error(
        `[finalize] Order ${orderId}: CRITICAL — gift-card tender (${giftCardTenderCents}c) not redeemed AND ` +
          `the revert to pending FAILED; the order is stranded PAID with under-collected goods — MANUAL REVIEW REQUIRED`,
        revertError
      );
      logCritical(
        'giftcard',
        'tender_not_redeemed_revert_failed',
        { orderId, giftCardTenderCents },
        revertError
      );
      // reverted:false signals the revert did NOT succeed. paid:false + reason
      // still routes it through the caller's not-paid-with-reason branch (logged,
      // 200/no-retry) so it is surfaced for manual review rather than thrown.
      return {
        paid: false,
        promotedByUs: true,
        reverted: false,
        reason:
          `MANUAL REVIEW REQUIRED: gift-card tender (${giftCardTenderCents}c) not redeemed and the revert to ` +
          `pending FAILED; order left PAID with under-collected goods`,
      };
    }
  }

  // Inventory decrement (BMC-178) — the CAS winner owns this one-time effect, and
  // we run it only AFTER the H1 gift-card revert block above (which `return`s on
  // revert), so an order that just bounced back to pending never loses stock.
  // Tracked, non-backorderable lines use a guarded decrement that can't oversell;
  // a capture-time race that leaves too little on hand yields `oversold` lines,
  // which we flag for manual review WITHOUT reverting payment (the cash is
  // captured and the goods may still be fulfillable after a restock). Wrapped so
  // an inventory failure can never throw out of finalization — payment is already
  // recorded, and the confirmation email must still send.
  try {
    const { oversold } = await decrementStockForOrder(finalOrder.items as any);
    // Preserve the paid notes just stamped by the CAS, then append the oversold
    // flag (updateOrderNotes overwrites, so flagOversoldForReview rebuilds from
    // the current value). No-op when nothing oversold.
    await flagOversoldForReview({
      orderId,
      currentNotes: finalOrder.notes,
      oversold,
      logPrefix: '[finalize]',
    });
  } catch (invError) {
    // A throw here means the oversold-review flag may not have been written AND
    // stock wasn't decremented on a PAID order — silently regressing the BMC-178
    // manual-review guarantee. Alert (sibling catches in this fn already do).
    console.error(`[finalize] Inventory decrement failed for ${orderId}:`, invError);
    logCritical('inventory', 'decrement_failed', { orderId }, invError);
  }

  // Coupon redemption (BMC-197) — record each applied cart-discount code's usage
  // exactly once per order. This runs ONLY here, on the pending→paid CAS winner
  // (and AFTER the H1 revert block, which `return`s), so webhook redelivery /
  // client+webhook double-fire can't double-count — the same once-per-order
  // idempotency the inventory decrement above relies on. `redeemCoupon` is a
  // guarded atomic CAS: an already-spent code (single_use, or one at its
  // usage_limit) matches nothing and is a silent no-op, so a code that no longer
  // resolves to a usable coupon never blocks finalization. Best-effort: payment is
  // already captured + recorded, so a redemption failure must never throw out of
  // finalization (worst case an under-counted coupon, not a stuck/duplicated
  // order). The codes were persisted on the order at PaymentIntent creation.
  if (discountCodes?.length) {
    const redeemCustomerId = finalOrder.customer_id || order.customer_id || 'guest';
    // Record the discount on the usage audit trail. `charge.discountCents` is the
    // TOTAL cart discount the floor recomputed across ALL codes (deduped by
    // promotion), so it maps cleanly to a single code but would over-report if
    // split across several. Attribute it only when exactly one code was applied;
    // with multiple, leave discount_amount unset rather than misattribute.
    const discountAmount =
      discountCodes.length === 1 && charge.discountCents > 0
        ? Money.fromMinor(charge.discountCents, finalOrder.currency_code || 'USD').toMach()
        : undefined;
    for (const code of discountCodes) {
      try {
        const result = await redeemCoupon(code, { orderId, customerId: redeemCustomerId, channel: 'web', discountAmount });
        if (result.redeemed) {
          console.log(
            `[finalize] Redeemed coupon ${code} for ${orderId} (usage_count=${result.usageCount}, status=${result.status})`
          );
        }
      } catch (redeemError) {
        console.error(`[finalize] Coupon redemption failed for ${code} on ${orderId}:`, redeemError);
        logCritical('promotion', 'coupon_redeem_failed', { orderId }, redeemError);
      }
    }
  }

  // Confirmation email — only the CAS winner sends it, so it fires exactly once
  // regardless of whether the client POST or the webhook got here first.
  if (sendEmail) {
    await sendOrderConfirmationForOrder(finalOrder, { customerName, giftCardTenderCents });
  }

  return { paid: true, promotedByUs: true };
}

/**
 * Gift Card Fulfillment Service
 *
 * Single entry point for everything that must happen to gift cards once an
 * order is paid:
 *   1. Issuance — for every gift-card line item, generate a card and email the
 *      recipient.
 *   2. Redemption — if a gift card was applied at checkout, atomically deduct
 *      its balance against this order.
 *
 * Designed to be called from BOTH the Stripe `payment_intent.succeeded` webhook
 * (the primary trigger) and the order-creation path (a safety net for the
 * client/webhook race). Every step is idempotent and keyed on the order, so it
 * is safe to run more than once and at most issues/redeems exactly once.
 */

import type { Order } from '@/lib/types/order';
import {
  createGiftCard,
  getGiftCardsByOrderId,
  redeemGiftCard,
  markGiftCardDelivered,
  normalizeCode,
} from '@/lib/models/mach/giftCard';
import { sendGiftCardDeliveryEmail } from '@/lib/utils/email';
import { BASE_URL } from '@/lib/seo/metadata';

export const GIFT_CARD_PRODUCT_ID = 'gift-card';

export interface GiftCardFulfillmentResult {
  issued: number;
  redeemed: number;
  redeemedAmount: number; // cents
  errors: string[];
}

// Allow a few cents of slack for cent/dollar rounding across the checkout math.
const AMOUNT_TOLERANCE_CENTS = 5;

/** Is this order line a gift card that needs a card issued? */
function isGiftCardLine(item: any): boolean {
  return Boolean(item?.gift_card) || item?.product_id === GIFT_CARD_PRODUCT_ID;
}

/** Does this order buy or redeem any gift card (i.e. is fulfillment relevant)? */
export function orderInvolvesGiftCards(order: Order): boolean {
  return (
    (order.items || []).some(isGiftCardLine) ||
    Boolean((order.extensions || {}).gift_card)
  );
}

/**
 * Verify that the real money received (from the verified Stripe PaymentIntent),
 * plus any server-redeemed gift card tender, actually covers the order's goods.
 * This is what stops a tampered client from issuing gift cards worth more than
 * was paid, or redeeming against an unpaid/underpaid order.
 */
function verifyPaymentSufficient(
  order: Order,
  paidAmountCents: number
): { ok: boolean; reason?: string } {
  const goodsCents = (order.items || []).reduce(
    (sum, item) => sum + (item.total_price?.amount ?? 0),
    0
  );
  const declaredTotalCents = order.total_amount?.amount ?? goodsCents;
  const giftCardCents = (order.extensions || {}).gift_card?.amount ?? 0;

  // The declared order total must not understate the actual line items.
  if (declaredTotalCents + AMOUNT_TOLERANCE_CENTS < goodsCents) {
    return { ok: false, reason: 'order total is below the sum of line items' };
  }

  // Cash that should have been charged after the gift card tender.
  const expectedChargeCents = Math.max(0, declaredTotalCents - giftCardCents);
  if (paidAmountCents + AMOUNT_TOLERANCE_CENTS < expectedChargeCents) {
    return {
      ok: false,
      reason: `paid ${paidAmountCents}c is less than expected charge ${expectedChargeCents}c`,
    };
  }

  return { ok: true };
}

function purchaserEmailFromOrder(order: Order): string | undefined {
  const ext = order.extensions || {};
  return ext.email || order.shipping_address?.email || order.billing_address?.email || undefined;
}

function purchaserNameFromOrder(order: Order): string | undefined {
  return (
    order.shipping_address?.recipient ||
    order.billing_address?.recipient ||
    undefined
  );
}

/**
 * Issue + email a gift card for every gift-card line item on the order.
 * Idempotent: skips any (order, line, unit) that already has a card.
 */
async function issueGiftCardsForOrder(order: Order): Promise<{ issued: number; errors: string[] }> {
  const errors: string[] = [];
  let issued = 0;

  const orderId = order.id;
  if (!orderId) return { issued, errors: ['Order has no id'] };

  const giftLines = (order.items || []).filter(isGiftCardLine);
  if (giftLines.length === 0) return { issued, errors };

  // Idempotency: which (line) cards already exist for this order?
  const existing = await getGiftCardsByOrderId(orderId);
  const existingLineIds = new Set(existing.map((c) => c.order_line_id).filter(Boolean) as string[]);

  const purchaserEmail = purchaserEmailFromOrder(order);
  const purchaserName = purchaserNameFromOrder(order);

  for (let i = 0; i < (order.items || []).length; i++) {
    const item = order.items[i];
    if (!isGiftCardLine(item)) continue;

    const unitAmount = item.unit_price?.amount ?? 0;
    if (unitAmount <= 0) {
      errors.push(`Gift card line ${i} has no unit price`);
      continue;
    }

    const recipientEmail = item.gift_card?.recipientEmail || purchaserEmail;
    if (!recipientEmail) {
      errors.push(`Gift card line ${i} has no recipient email`);
      continue;
    }

    const quantity = Math.max(1, item.quantity || 1);
    for (let unit = 0; unit < quantity; unit++) {
      const orderLineId = `${orderId}#${i}#${unit}`;
      if (existingLineIds.has(orderLineId)) continue; // already issued

      try {
        const card = await createGiftCard({
          amount: unitAmount,
          currency: item.unit_price?.currency || order.currency_code || 'USD',
          purchaserCustomerId: order.customer_id ?? null,
          purchaserEmail: purchaserEmail ?? null,
          recipientEmail,
          recipientName: item.gift_card?.recipientName ?? null,
          giftMessage: item.gift_card?.message ?? null,
          orderId,
          orderLineId,
        });
        issued++;

        const emailResult = await sendGiftCardDeliveryEmail({
          recipientEmail,
          recipientName: item.gift_card?.recipientName,
          purchaserName,
          code: card.code,
          amount: card.balance,
          currency: card.currency,
          giftMessage: item.gift_card?.message,
          redeemUrl: BASE_URL,
        });
        if (emailResult.success) {
          await markGiftCardDelivered(card.id);
        } else {
          errors.push(`Gift card ${card.code} issued but email failed: ${emailResult.error}`);
        }
      } catch (err) {
        errors.push(
          `Failed to issue gift card for line ${i} unit ${unit}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`
        );
      }
    }
  }

  return { issued, errors };
}

/**
 * Redeem an applied gift card against this order, if one was applied at
 * checkout. Idempotent per (card, order) via the model.
 */
async function redeemAppliedGiftCard(
  order: Order
): Promise<{ redeemed: number; redeemedAmount: number; errors: string[] }> {
  const ext = order.extensions || {};
  const applied = ext.gift_card as { code?: string; amount?: number } | undefined;

  if (!applied?.code || !applied.amount || applied.amount <= 0) {
    return { redeemed: 0, redeemedAmount: 0, errors: [] };
  }
  if (!order.id) {
    return { redeemed: 0, redeemedAmount: 0, errors: ['Order has no id'] };
  }

  try {
    const result = await redeemGiftCard({
      code: normalizeCode(applied.code),
      amount: applied.amount,
      orderId: order.id,
      customerId: order.customer_id ?? null,
    });
    if (!result.success) {
      return { redeemed: 0, redeemedAmount: 0, errors: [`Gift card redemption failed: ${result.error}`] };
    }
    return { redeemed: 1, redeemedAmount: result.applied, errors: [] };
  } catch (err) {
    return {
      redeemed: 0,
      redeemedAmount: 0,
      errors: [`Gift card redemption error: ${err instanceof Error ? err.message : 'unknown error'}`],
    };
  }
}

export interface ProcessGiftCardsOptions {
  /**
   * Cash actually received, taken from a SERVER-VERIFIED Stripe PaymentIntent
   * (never a client-supplied field). Required — without a verified amount we
   * refuse to issue or redeem, so a tampered/unauthenticated request can't mint
   * or drain stored value.
   */
  paidAmountCents?: number;
}

/**
 * Run issuance + redemption for a paid order. Never throws — collects errors so
 * the caller (webhook / order route) can log without failing the request.
 *
 * Security: callers MUST pass `paidAmountCents` derived from a verified Stripe
 * PaymentIntent. Fulfillment is skipped unless the verified payment (plus the
 * gift card tender) covers the order.
 */
export async function processGiftCardsForOrder(
  order: Order,
  opts: ProcessGiftCardsOptions = {}
): Promise<GiftCardFulfillmentResult> {
  const result: GiftCardFulfillmentResult = { issued: 0, redeemed: 0, redeemedAmount: 0, errors: [] };

  if (opts.paidAmountCents == null) {
    result.errors.push('No verified payment amount supplied; skipping gift card fulfillment');
    return result;
  }

  const verification = verifyPaymentSufficient(order, opts.paidAmountCents);
  if (!verification.ok) {
    result.errors.push(`Payment verification failed: ${verification.reason}`);
    return result;
  }

  const issuance = await issueGiftCardsForOrder(order);
  result.issued = issuance.issued;
  result.errors.push(...issuance.errors);

  const redemption = await redeemAppliedGiftCard(order);
  result.redeemed = redemption.redeemed;
  result.redeemedAmount = redemption.redeemedAmount;
  result.errors.push(...redemption.errors);

  return result;
}

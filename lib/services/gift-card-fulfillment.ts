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
  getGiftCardByCode,
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

// Canonical gift-card denominations (cents). The face value of an issued card
// MUST be one of these — never a client-supplied price — so a tampered order
// can't mint an arbitrarily large card.
export const GIFT_CARD_DENOMINATIONS_CENTS = new Set([2500, 5000, 10000]);

/** Strip control characters and clamp length for stored/emailed free text. */
function sanitizeText(value: string | undefined | null, maxLen: number): string | undefined {
  if (!value) return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, maxLen);
  return cleaned || undefined;
}

/** Is this order line a gift card that needs a card issued? */
function isGiftCardLine(item: any): boolean {
  return Boolean(item?.gift_card) || item?.product_id === GIFT_CARD_PRODUCT_ID;
}

/**
 * Validate a gift-card line against server-side truth: the unit price must be a
 * known denomination and total_price must equal unit_price * quantity (so the
 * two client fields can't be desynced to bypass the payment-sufficiency check).
 */
function validateGiftCardLine(item: any, index: number): { ok: boolean; reason?: string } {
  const unitAmount = item.unit_price?.amount ?? 0;
  const quantity = Math.max(1, item.quantity || 1);
  const lineTotal = item.total_price?.amount ?? 0;

  if (!GIFT_CARD_DENOMINATIONS_CENTS.has(unitAmount)) {
    return { ok: false, reason: `gift card line ${index} has invalid denomination ${unitAmount}` };
  }
  if (lineTotal !== unitAmount * quantity) {
    return { ok: false, reason: `gift card line ${index} unit/total price mismatch` };
  }
  return { ok: true };
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
 *
 * Security: the gift card tender is resolved from the DB (actual card balance),
 * NOT from the client-supplied `order.extensions.gift_card.amount`. A tampered
 * client can't overstate the tender to make the sufficiency check a no-op.
 */
async function verifyPaymentSufficient(
  order: Order,
  paidAmountCents: number
): Promise<{ ok: boolean; reason?: string }> {
  // Reject any tampered gift-card line up front, so a desynced unit/total price
  // can't slip past the goods/charge accounting below.
  for (let i = 0; i < (order.items || []).length; i++) {
    const item = order.items[i];
    if (!isGiftCardLine(item)) continue;
    const lineCheck = validateGiftCardLine(item, i);
    if (!lineCheck.ok) {
      return { ok: false, reason: lineCheck.reason };
    }
  }

  const goodsCents = (order.items || []).reduce(
    (sum, item) => sum + (item.total_price?.amount ?? 0),
    0
  );
  const declaredTotalCents = order.total_amount?.amount ?? goodsCents;

  // The declared order total must not understate the actual line items.
  if (declaredTotalCents + AMOUNT_TOLERANCE_CENTS < goodsCents) {
    return { ok: false, reason: 'order total is below the sum of line items' };
  }

  // Resolve the gift card tender from the DB — never from the client payload.
  // A tampered client could overstate extensions.gift_card.amount to inflate
  // the tender and reduce expectedChargeCents to near-zero.
  let serverGiftCardCents = 0;
  const ext = (order.extensions || {}) as Record<string, any>;
  const appliedGiftCard = ext.gift_card as { code?: string; amount?: number } | undefined;
  if (appliedGiftCard?.code) {
    const card = await getGiftCardByCode(appliedGiftCard.code);
    if (card && card.status === 'active') {
      // The server-side tender is min(what the client requested, actual balance, order total).
      // This is what can realistically reduce the charge — no more.
      const clientRequested = appliedGiftCard.amount ?? 0;
      serverGiftCardCents = Math.min(clientRequested, card.balance, declaredTotalCents);
    }
  }

  // Cash that should have been charged after the gift card tender.
  const expectedChargeCents = Math.max(0, declaredTotalCents - serverGiftCardCents);
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

    // Defense-in-depth: only issue cards for valid, server-known denominations.
    const lineCheck = validateGiftCardLine(item, i);
    if (!lineCheck.ok) {
      errors.push(lineCheck.reason!);
      continue;
    }
    const unitAmount = item.unit_price!.amount;

    const recipientEmail = item.gift_card?.recipientEmail || purchaserEmail;
    if (!recipientEmail) {
      errors.push(`Gift card line ${i} has no recipient email`);
      continue;
    }

    // Sanitize free-text fields server-side (don't trust client length limits):
    // strip control chars and clamp to a sane length before storing/emailing.
    const recipientName = sanitizeText(item.gift_card?.recipientName, 120);
    const giftMessage = sanitizeText(item.gift_card?.message, 500);

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
          recipientName: recipientName ?? null,
          giftMessage: giftMessage ?? null,
          orderId,
          orderLineId,
        });
        issued++;

        const emailResult = await sendGiftCardDeliveryEmail({
          recipientEmail,
          recipientName: recipientName ?? undefined,
          purchaserName,
          code: card.code,
          amount: card.balance,
          currency: card.currency,
          giftMessage: giftMessage ?? undefined,
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

  const verification = await verifyPaymentSufficient(order, opts.paidAmountCents);
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

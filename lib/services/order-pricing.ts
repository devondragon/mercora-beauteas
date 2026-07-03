/**
 * Server-side Order Pricing / Charge Verification (BMC-131)
 *
 * The charged amount used to be entirely client-supplied: `/api/payment-intent`
 * took `amount` from the request body, and `/api/orders` stored the client's
 * `total_amount` / `unit_price` verbatim and marked the order paid whenever the
 * bound PaymentIntent had merely *succeeded* — never checking that the money
 * actually collected matched real catalog prices. That let a shopper pay a
 * $0.50 PaymentIntent and then submit an order for expensive goods.
 *
 * This module is the single source of truth for "did the customer actually pay
 * enough?". It recomputes the goods subtotal from the D1 catalog
 * (`product_variants.price`) — never from any client-supplied price — and
 * verifies the SERVER-VERIFIED cash received (plus any DB-resolved gift-card
 * tender) covers it. It mirrors the gift-card fulfillment guard
 * (`verifyPaymentSufficient`) and is called from every writer that can mark an
 * order paid: order creation, the Stripe webhook, and (as a fail-early guard)
 * payment-intent creation.
 *
 * Scope note: we enforce the *goods* subtotal, which is the exploitable surface.
 * Tax and shipping are additive-only (they can only increase what is owed) and
 * tax in particular is computed by Stripe Tax at checkout time; re-deriving it
 * here would risk drifting from what was actually charged and false-rejecting
 * legitimate orders. So the invariant enforced is:
 *
 *     paidCents + giftCardTenderCents + TOLERANCE >= catalogGoodsSubtotalCents
 */

import type { OrderItem } from '@/lib/types/order';
import type { Money } from '@/lib/types';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';
import { getGiftCardByCode } from '@/lib/models/mach/giftCard';

// A few cents of slack for cent/dollar rounding across the checkout math. Kept
// in sync with the gift-card fulfillment tolerance.
export const AMOUNT_TOLERANCE_CENTS = 5;

/**
 * Coerce a stored `Money`-ish price field to an integer number of cents.
 *
 * Variant prices are stored as a JSON `Money` (`{ amount, currency }`) where
 * `amount` is already cents, but historical rows may hold a JSON string or a
 * bare numeric string, so we parse defensively (mirroring `getProduct`).
 * Returns null when the value can't be interpreted as a non-negative amount.
 */
function priceToCents(field: unknown): number | null {
  if (field == null) return null;
  let money: any = field;
  if (typeof field === 'string') {
    if (field.startsWith('{')) {
      try {
        money = JSON.parse(field);
      } catch {
        return null;
      }
    } else {
      const n = Number(field);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }
  }
  if (typeof money === 'number') {
    return Number.isFinite(money) && money >= 0 ? Math.round(money) : null;
  }
  const amount = (money as Money)?.amount;
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
    ? Math.round(amount)
    : null;
}

/**
 * Resolve the authoritative catalog unit price (cents) for an order line.
 *
 * Price is keyed on `variant_id` (the canonical price carrier in MACH), falling
 * back to the product's default variant when a line omits it. The resolved
 * variant MUST belong to the claimed `product_id` — otherwise a caller could
 * pair a cheap variant's id with an expensive product to be charged the cheap
 * price while ordering the expensive goods. Returns null when no trustworthy
 * price can be established (unknown product/variant, cross-product mismatch, or
 * unparseable price), which the caller treats as a verification failure.
 */
async function catalogUnitPriceCents(item: {
  product_id?: string;
  variant_id?: string;
}): Promise<number | null> {
  let variant = item.variant_id ? await getProductVariant(item.variant_id) : null;

  if (!variant && item.product_id) {
    const product = await getProduct(item.product_id);
    if (product) {
      variant =
        product.variants?.find((v) => v.id === product.default_variant_id) ||
        product.variants?.[0] ||
        null;
    }
  }

  if (!variant) return null;

  // Bind the priced variant to the claimed product so a cheaper variant can't be
  // smuggled in under an expensive product id.
  if (
    item.product_id &&
    variant.product_id &&
    variant.product_id !== item.product_id
  ) {
    return null;
  }

  return priceToCents((variant as any).price);
}

export interface CatalogSubtotalResult {
  /** Sum of catalog unit price × quantity, in cents. */
  subtotalCents: number;
  /** Human-readable reasons any line could not be priced from the catalog. */
  errors: string[];
}

/**
 * Recompute an order's goods subtotal (cents) from the live catalog. Any line
 * that can't be priced authoritatively is reported in `errors`; callers MUST
 * treat a non-empty `errors` as "cannot verify → fail closed" rather than
 * silently undercounting the goods.
 */
export async function computeCatalogSubtotalCents(
  items: Array<{ product_id?: string; variant_id?: string; quantity?: number }>
): Promise<CatalogSubtotalResult> {
  const errors: string[] = [];
  let subtotalCents = 0;

  for (let i = 0; i < (items || []).length; i++) {
    const item = items[i];
    const quantity = Math.max(1, Math.floor(item?.quantity || 1));
    const unitCents = await catalogUnitPriceCents(item);

    if (unitCents == null) {
      errors.push(
        `line ${i} (product=${item?.product_id ?? 'none'}, variant=${
          item?.variant_id ?? 'none'
        }) has no catalog price`
      );
      continue;
    }

    subtotalCents += unitCents * quantity;
  }

  return { subtotalCents, errors };
}

/**
 * Resolve the gift-card tender (cents) actually creditable to an order, from
 * the DB — never from the client-supplied `extensions.gift_card.amount`. The
 * tender is capped at the card's current live balance so a tampered client
 * can't overstate it to make the sufficiency check a no-op.
 */
export async function resolveGiftCardTenderCents(
  extensions: Record<string, any> | null | undefined
): Promise<number> {
  const applied = extensions?.gift_card as { code?: string; amount?: number } | undefined;
  if (!applied?.code) return 0;

  const requestedCents = Math.max(0, Math.round(applied.amount ?? 0));
  if (requestedCents === 0) return 0;

  const card = await getGiftCardByCode(applied.code);
  if (!card || card.status !== 'active') return 0;

  return Math.min(requestedCents, card.balance);
}

export interface ChargeVerification {
  ok: boolean;
  reason?: string;
  /** Catalog-recomputed goods subtotal (cents). */
  goodsCents: number;
  /** Minimum cash that had to be collected after gift-card tender (cents). */
  requiredCashCents: number;
}

export interface VerifyChargeInput {
  items: Array<{ product_id?: string; variant_id?: string; quantity?: number }>;
  /** Cash received, from a SERVER-VERIFIED Stripe PaymentIntent (`amount_received`). */
  paidAmountCents: number;
  /** Gift-card tender creditable to this order (cents), DB-resolved. */
  giftCardTenderCents?: number;
}

/**
 * Verify that the money actually collected covers the catalog value of the
 * goods. This is the guard that stops a client from paying a token amount for
 * expensive goods. Fails closed: any line without a trustworthy catalog price
 * makes the whole order unverifiable.
 */
export async function verifyOrderChargeSufficient(
  input: VerifyChargeInput
): Promise<ChargeVerification> {
  const { subtotalCents: goodsCents, errors } = await computeCatalogSubtotalCents(
    input.items
  );

  if (errors.length) {
    return {
      ok: false,
      reason: `cannot price order from catalog: ${errors.join('; ')}`,
      goodsCents,
      requiredCashCents: goodsCents,
    };
  }

  const giftCardTenderCents = Math.max(0, Math.round(input.giftCardTenderCents ?? 0));
  const requiredCashCents = Math.max(0, goodsCents - giftCardTenderCents);
  const paidAmountCents = Math.max(0, Math.round(input.paidAmountCents));

  if (paidAmountCents + AMOUNT_TOLERANCE_CENTS < requiredCashCents) {
    return {
      ok: false,
      reason: `paid ${paidAmountCents}c is less than required ${requiredCashCents}c (catalog goods ${goodsCents}c, gift card tender ${giftCardTenderCents}c)`,
      goodsCents,
      requiredCashCents,
    };
  }

  return { ok: true, goodsCents, requiredCashCents };
}

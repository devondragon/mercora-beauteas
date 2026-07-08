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

import type { Money as StoredMoney } from '@/lib/types';
import { Money } from '@/lib/money';
import type { MACHAddress as Address } from '@/lib/types/mach/Address';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';
import { getGiftCardByCode } from '@/lib/models/mach/giftCard';

// A few cents of slack for cent/dollar rounding across the checkout math. This
// is the single source of truth for the tolerance; the gift-card fulfillment
// guard imports it rather than keeping its own copy (M3).
export const AMOUNT_TOLERANCE_CENTS = 5;

/**
 * Upper bound on distinct line items in a single checkout request. Pricing does
 * one catalog read per line, so an unbounded array is a cheap way to force
 * hundreds of DB round-trips and exhaust Worker CPU (M6). Real BeauTeas carts
 * hold a handful of SKUs; 100 is comfortably above any legitimate order.
 */
export const MAX_ORDER_LINE_ITEMS = 100;

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
  const amount = (money as StoredMoney)?.amount;
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
    ? Math.round(amount)
    : null;
}

/**
 * Coerce a client-supplied `quantity` to a positive integer, or null when it
 * can't be trusted.
 *
 * Security (BMC-131 / C2): the old code did `Math.max(1, Math.floor(q || 1))`,
 * which for a truthy NON-numeric quantity (e.g. `"x"`, `[1,2]`) produced `NaN`.
 * A `NaN` unit count poisons the whole subtotal to `NaN`, and every relational
 * comparison against `NaN` is `false`, so the sufficiency gate silently PASSES
 * — reopening the exact "pay $0.50 for anything" exploit. We now fail closed:
 * a non-finite or non-positive quantity yields null and the caller records an
 * error. An omitted quantity keeps the historical default of 1.
 */
function normalizeQuantity(raw: unknown): number | null {
  if (raw == null) return 1; // omitted → default to a single unit
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.floor(n));
}

type LinePrice = { cents: number } | { reason: string };

/**
 * Resolve the authoritative catalog unit price (cents) for an order line.
 *
 * Price is keyed on `variant_id` (the canonical price carrier in MACH). A
 * SUPPLIED `variant_id` MUST resolve and MUST belong to the claimed
 * `product_id`; we NEVER fall back to a different variant when a supplied id
 * fails to resolve. Security (BMC-131 / C3): the old code fell back to the
 * product's default variant whenever `variant` was null — regardless of why —
 * so a bogus `variant_id` paired with a real (expensive) product was charged
 * the product's default (often cheaper) price. The default-variant fallback now
 * applies ONLY when the line legitimately omitted a `variant_id`. Returns a
 * `reason` (not a bare null) so the caller can report WHY a line is unpriceable.
 */
async function catalogUnitPriceCents(item: {
  product_id?: string;
  variant_id?: string;
}): Promise<LinePrice> {
  // A supplied variant_id must resolve to that exact variant — no fallback.
  if (item.variant_id) {
    const variant = await getProductVariant(item.variant_id);
    if (!variant) {
      return { reason: `variant ${item.variant_id} has no catalog price` };
    }
    // Bind the priced variant to the claimed product so a cheaper variant can't
    // be smuggled in under an expensive product id.
    if (item.product_id && variant.product_id && variant.product_id !== item.product_id) {
      return { reason: `variant ${item.variant_id} does not belong to product ${item.product_id}` };
    }
    const cents = priceToCents((variant as any).price);
    return cents == null
      ? { reason: `variant ${item.variant_id} has no catalog price` }
      : { cents };
  }

  // No variant_id supplied: resolve the product's default (or first) variant.
  if (item.product_id) {
    const product = await getProduct(item.product_id);
    const variant =
      product?.variants?.find((v) => v.id === product.default_variant_id) ||
      product?.variants?.[0] ||
      null;
    if (!variant) {
      return { reason: `product ${item.product_id} has no catalog price` };
    }
    const cents = priceToCents((variant as any).price);
    return cents == null
      ? { reason: `product ${item.product_id} has no catalog price` }
      : { cents };
  }

  return { reason: 'line has neither a product_id nor a variant_id' };
}

export interface CatalogSubtotalResult {
  /** Sum of catalog unit price × quantity, in cents. */
  subtotalCents: number;
  /** Human-readable reasons any line could not be priced from the catalog. */
  errors: string[];
}

/**
 * Recompute an order's goods subtotal (cents) from the live catalog. Any line
 * that can't be priced authoritatively — malformed item, untrusted quantity,
 * unknown/mismatched/unpriceable variant — is reported in `errors`; callers
 * MUST treat a non-empty `errors` as "cannot verify → fail closed" rather than
 * silently undercounting the goods.
 *
 * Lines are priced concurrently (L1): each line is an independent catalog read,
 * so `Promise.all` overlaps the round-trips instead of serializing them. The
 * per-line work is wrapped so a single malformed line (e.g. `null`) fails that
 * line closed rather than throwing out of the whole computation (C1).
 */
export async function computeCatalogSubtotalCents(
  items: Array<{ product_id?: string; variant_id?: string; quantity?: number }>
): Promise<CatalogSubtotalResult> {
  const list = Array.isArray(items) ? items : [];

  const perLine = await Promise.all(
    list.map(async (item, i): Promise<{ cents: number } | { error: string }> => {
      // C1: a non-object line (null, string, number) must fail closed, never
      // throw — an uncaught throw here used to bubble up to the order route's
      // outer catch and leave paymentConfirmed=true.
      if (item == null || typeof item !== 'object') {
        return { error: `line ${i} is not a valid item object` };
      }

      const quantity = normalizeQuantity((item as { quantity?: unknown }).quantity);
      if (quantity == null) {
        return { error: `line ${i} has an invalid quantity` };
      }

      const priced = await catalogUnitPriceCents(item);
      if ('reason' in priced) {
        return {
          error: `line ${i} (product=${item.product_id ?? 'none'}, variant=${
            item.variant_id ?? 'none'
          }) ${priced.reason}`,
        };
      }

      return { cents: priced.cents * quantity };
    })
  );

  const errors: string[] = [];
  let subtotalCents = 0;
  for (const r of perLine) {
    if ('error' in r) errors.push(r.error);
    else subtotalCents += r.cents;
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

// The server-known gift-card product id. Duplicated as a bare literal (rather
// than imported from gift-card-fulfillment) to avoid an import cycle — that
// module imports AMOUNT_TOLERANCE_CENTS from here.
const GIFT_CARD_PRODUCT_ID = 'gift-card';

/** Coerce a catalog product name (string or i18n map) to a display string. */
function coerceProductName(name: unknown): string | null {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const map = name as Record<string, unknown>;
    const pick = map.en ?? Object.values(map)[0];
    return typeof pick === 'string' ? pick : null;
  }
  return null;
}

/**
 * Overwrite each order line's DISPLAY fields (`product_name`, `imageUrl`) with
 * catalog truth before the order is persisted (BMC-131 / M1).
 *
 * The charge check already stops a client from being *charged* less than the
 * catalog price, but the persisted `product_name`/`imageUrl` were still whatever
 * the client sent — and the admin fulfillment UI + confirmation email render
 * those verbatim. A shopper could therefore pay for a cheap variant while making
 * the packing slip and email describe an expensive product. Re-deriving the
 * display fields from the catalog closes that: for an honest order the catalog
 * name IS what the shopper picked (no visible change); for a spoofed one it is
 * corrected. Gift-card lines (validated separately) and lines whose product
 * can't be resolved are passed through untouched — an unresolved line already
 * forces the order to 'pending' via the charge check.
 */
export async function canonicalizeOrderItemsDisplay<T extends { product_id?: string; product_name?: string; imageUrl?: string }>(
  items: T[]
): Promise<T[]> {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(
    list.map(async (item) => {
      if (!item || typeof item !== 'object') return item;
      if (!item.product_id || item.product_id === GIFT_CARD_PRODUCT_ID) return item;

      const product = await getProduct(item.product_id);
      if (!product) return item;

      const name = coerceProductName((product as any).name);
      const image = typeof (product as any).primary_image === 'string' ? (product as any).primary_image : undefined;
      return {
        ...item,
        ...(name ? { product_name: name } : {}),
        ...(image ? { imageUrl: image } : {}),
      };
    })
  );
}

/**
 * Overwrite each order line's PRICE fields (`unit_price`, `total_price`) with
 * catalog truth before the order is persisted (BMC-161 follow-up).
 *
 * BMC-161 canonicalized the display fields (`product_name`/`imageUrl`) and the
 * order-level `total_amount`, but each LINE's `unit_price`/`total_price` were
 * still whatever the session/client supplied. A malicious MCP agent could
 * therefore persist attacker-chosen per-line prices (e.g. a $0.01 unit price)
 * onto an otherwise-valid paid order — corrupting the admin/fulfillment view,
 * refunds, analytics, and any downstream that trusts the stored line price, even
 * though the CHARGE gate (`verifyOrderChargeSufficient`) already stopped them
 * being UNDER-charged.
 *
 * For each line we resolve the authoritative catalog unit price (cents) via the
 * SAME variant/product resolution the charge gate uses (`catalogUnitPriceCents`),
 * then set:
 *   unit_price  = { amount: catalogCents,            currency }
 *   total_price = { amount: catalogCents * quantity, currency }
 * Amounts are CENTS, matching the `Money` convention used across the order record
 * (and identical to how `total_amount` is derived from `goodsCents`).
 *
 * Fails soft PER LINE: a line whose catalog price can't be resolved (unknown/
 * mismatched/unpriceable variant, untrusted quantity, gift card, or a catalog
 * read that throws) keeps its session-supplied price rather than blocking a
 * legitimately-paid order — mirroring `canonicalizeOrderItemsDisplay`. An
 * unresolved *goods* line already forces a pre-persist failure via the charge
 * gate, so in practice this only preserves legitimately un-catalogable lines
 * (e.g. gift cards, priced/validated separately).
 */
export async function canonicalizeOrderItemsPricing<
  T extends {
    product_id?: string;
    variant_id?: string;
    quantity?: number;
    unit_price?: StoredMoney;
    total_price?: StoredMoney;
  }
>(items: T[]): Promise<T[]> {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(
    list.map(async (item) => {
      try {
        if (!item || typeof item !== 'object') return item;
        // Gift-card lines are validated/priced separately — never re-price here.
        if (item.product_id === GIFT_CARD_PRODUCT_ID) return item;

        const quantity = normalizeQuantity(item.quantity);
        if (quantity == null) return item; // untrusted qty → keep session price

        const priced = await catalogUnitPriceCents(item);
        if ('reason' in priced) return item; // unresolved → fail soft to session

        const currency = item.unit_price?.currency ?? item.total_price?.currency ?? 'USD';
        return {
          ...item,
          unit_price: { amount: priced.cents, currency },
          total_price: { amount: priced.cents * quantity, currency },
        };
      } catch {
        // A catalog read that throws must never block a paid order — keep the
        // session-supplied price for this line (same fail-soft contract as
        // canonicalizeOrderItemsDisplay).
        return item;
      }
    })
  );
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

/**
 * Order shipping/tax/total math (Task 7 / BMC-164).
 *
 * Moved here from `lib/mcp/tools/order.ts` so it is pure (no Cloudflare/DB
 * imports) and unit-testable from `tests/unit/**`, and typed entirely in
 * `Money` so the cents/dollars mismatch BMC-161 had to point-fix (the
 * free-shipping threshold silently compared a CENTS subtotal against a
 * DOLLARS `100` literal) is now impossible at the type level — `Money.gte`
 * only compares against another `Money` of the same currency, and
 * `Money.applyRate` does the tax multiply with exact big.js math. `order.ts`
 * re-exports `computeOrderTotals` for its existing callers (`payment.ts`,
 * MCP route handlers).
 */

/** Forward-compatible bag for future per-order pricing options (e.g. promo
 * free-shipping). Unused today — the MCP order path has no promo/options
 * input — but keeps the signature stable for callers that pass one. */
export type OrderTotalsOptions = Record<string, unknown>;

const STANDARD_SHIPPING_MAJOR = 9.99;
const AK_HI_SHIPPING_MAJOR = 19.99;
const FREE_SHIPPING_THRESHOLD_MAJOR = 100;

// Simple tax calculation - in production, use proper tax service
const TAX_RATES: Record<string, number> = {
  CA: 0.0875, // California
  NY: 0.08,   // New York
  TX: 0.0625, // Texas
  FL: 0.06,   // Florida
};
const DEFAULT_TAX_RATE = 0.05;

/**
 * Shipping for a goods subtotal + destination. `subtotal` is a `Money`, so the
 * free-shipping threshold compares like-for-like (both minor units of the same
 * currency) rather than a bare number that could be either cents or dollars
 * depending on the caller (BMC-161).
 */
export function calculateShipping(address: Address, subtotal: Money): Money {
  // Free shipping over $100
  if (subtotal.gte(Money.fromMajor(FREE_SHIPPING_THRESHOLD_MAJOR, subtotal.currency))) {
    return Money.zero(subtotal.currency);
  }

  // Alaska/Hawaii surcharge
  if (address?.region === 'AK' || address?.region === 'HI') {
    return Money.fromMajor(AK_HI_SHIPPING_MAJOR, subtotal.currency);
  }

  // Standard shipping
  return Money.fromMajor(STANDARD_SHIPPING_MAJOR, subtotal.currency);
}

/** Tax for a goods subtotal + destination, computed as an exact `Money.applyRate`. */
export function calculateTax(subtotal: Money, address: Address): Money {
  const rate = TAX_RATES[address?.region || ''] ?? DEFAULT_TAX_RATE;
  return subtotal.applyRate(rate);
}

/**
 * Compute shipping/tax/total for an order from a goods subtotal and a
 * destination address, using the same rules the MCP order path applies.
 * Shared so create_payment_intent charges exactly what place_order will
 * expect (BMC-132).
 */
export function computeOrderTotals(
  subtotal: Money,
  address: Address,
  _options: OrderTotalsOptions = {}
): { subtotal: Money; shipping: Money; tax: Money; total: Money } {
  const shipping = calculateShipping(address, subtotal);
  const tax = calculateTax(subtotal, address);
  const total = subtotal.add(shipping).add(tax);
  return { subtotal, shipping, tax, total };
}

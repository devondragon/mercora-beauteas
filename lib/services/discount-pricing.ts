/**
 * Server-side cart-discount recompute for the charge floor (BMC-177).
 *
 * The storefront charge floor (`lib/services/order-pricing.ts` +
 * `/api/payment-intent`) enforces that the cash collected covers the CATALOG
 * value of the goods. It historically ignored discounts entirely, so a valid
 * `cart`-type coupon whose discount exceeds shipping + tax + tolerance made the
 * shopper's (correctly discounted) charge fall below the floor and get rejected
 * with `amount_below_catalog` — blocking exactly the promo checkouts a launch
 * wants to convert.
 *
 * This module recomputes the cart discount AUTHORITATIVELY from the coupon —
 * never from the client-supplied discount number — so the floor can subtract it.
 * Only `cart`-type promotions reduce the goods subtotal the floor enforces
 * (shipping/product promotions don't touch it), so this resolves cart promotions
 * only; anything else contributes 0. The cart-discount math mirrors the cart
 * branches of `/api/validate-discount`'s `calculateDiscountAmount` (percentage /
 * fixed against the subtotal) so the amount shown at checkout and the amount
 * credited at the floor can't drift — but it computes against the SERVER catalog
 * subtotal, never a client-supplied one.
 *
 * Coupon/promotion resolution goes through the SAME canonical gates the
 * storefront uses — `validateCouponInstance().canBeUsed` (active + within the
 * coupon's validity window + under its usage limit) and the promotion's
 * `checkTimeValidity()` (within the promotion's own window) + active + `cart`
 * type — via INDEXED lookups (`getCouponInstanceByCode` on the unique code
 * index + `getPromotionById` on the PK), never a full-table scan. Gating the
 * floor identically to `/api/validate-discount` is load-bearing: a floor that
 * credited LESS than the storefront showed would false-reject a legitimately
 * discounted checkout (the BMC-177 symptom), and one that credited MORE would
 * let a client under-pay.
 *
 * Fails CLOSED: an unknown/expired/exhausted/non-cart code, or a cart promotion
 * whose conditions aren't met (subtotal minimum, or a `product_category` the
 * cart's CATALOG-derived items don't satisfy), resolves to 0 — the floor then
 * demands full payment rather than crediting a discount that isn't actually
 * valid. Never inflate the discount: that would let a shopper under-pay.
 */

import type { Promotion } from '@/lib/types';
import { getCouponInstanceByCode, validateCouponInstance } from '@/lib/models/mach/couponInstance';
import { getPromotionById, checkTimeValidity } from '@/lib/models/mach/promotions';
import { getProduct } from '@/lib/models/mach/products';

/**
 * Upper bound on distinct coupon codes resolved per checkout. Each survivor of
 * `normalizeCodes` drives an indexed coupon + promotion lookup, and this route is
 * reachable pre-auth (guest checkout), so an unbounded array of distinct bogus
 * codes could force a burst of concurrent D1 lookups per request. Real carts hold
 * a code or two (discounts dedup by promotion); 25 is comfortably above any
 * legitimate checkout. Mirrors the `MAX_ORDER_LINE_ITEMS` cap in the same floor.
 */
export const MAX_DISCOUNT_CODES = 25;

/**
 * Upper bound on the RAW (pre-dedup) discount-codes array a route will accept.
 * Checked before the normalize/dedup pass so a pathological input (thousands of
 * junk strings) can't drive that loop — mirroring how `items.length` is capped
 * before per-item work. Generous relative to `MAX_DISCOUNT_CODES` so ordinary
 * duplicate / case-variant codes still collapse and pass rather than 400.
 */
export const MAX_RAW_DISCOUNT_CODES = 100;

/** Order/cart line shape the resolver needs to derive catalog categories. */
export interface DiscountCartLine {
  product_id?: string;
  variant_id?: string;
  quantity?: number;
}

/**
 * Coerce a promotion rule value (a bare number or a MACH `Money`-ish
 * `{ amount }`) to a plain integer amount. Promotion rule amounts are stored in
 * the same MINOR units (cents) the charge floor works in — matching how
 * `/api/validate-discount` interprets them at runtime. Returns null when the
 * value can't be read as a finite number.
 */
function ruleAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') {
    const amount = (value as { amount?: unknown }).amount;
    return typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
  }
  return null;
}

/**
 * Normalize a codes input to a de-duplicated list of trimmed, upper-cased codes.
 * Exported so routes cap the DEDUPED count (a cart that repeats the same code /
 * case-variants shouldn't trip the `MAX_DISCOUNT_CODES` gate) using the exact
 * same normalization the resolver applies.
 */
export function normalizeDiscountCodes(codes: string[] | string | null | undefined): string[] {
  const raw = codes == null ? [] : Array.isArray(codes) ? codes : [codes];
  const seen = new Set<string>();
  for (const c of raw) {
    if (typeof c !== 'string') continue;
    const norm = c.trim().toUpperCase();
    if (norm) seen.add(norm);
  }
  return [...seen];
}

/**
 * Union of the catalog categories for the cart's products, resolved SERVER-SIDE
 * from the catalog (`getProduct().categories`) — never from client-supplied
 * categories, which the charge floor must not trust. One `getProduct` per
 * distinct product id, run concurrently. Only called when a resolved promotion
 * actually gates on `product_category`, so ordinary discounted checkouts pay no
 * extra catalog reads.
 */
async function collectCatalogCategories(items: DiscountCartLine[]): Promise<Set<string>> {
  const productIds = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
  const categories = new Set<string>();
  await Promise.all(
    productIds.map(async (id) => {
      const product = await getProduct(id);
      for (const c of product?.categories ?? []) {
        if (typeof c === 'string') categories.add(c);
      }
    })
  );
  return categories;
}

/**
 * Whether a cart promotion's conditions are satisfied. Mirrors
 * `/api/validate-discount`'s `validatePromotionConditions`: a `cart_subtotal >= X`
 * minimum is checked against the (server) subtotal; a `product_category in [...]`
 * requirement is checked against the cart's CATALOG-derived categories (via
 * `getCartCategories`, resolved server-side, never trusting the client). If those
 * categories can't be determined (no items supplied), the condition fails closed
 * rather than crediting an unverifiable discount. Unknown condition types pass,
 * matching validate-discount.
 */
async function cartConditionsMet(
  promotion: Promotion,
  subtotalCents: number,
  getCartCategories: () => Promise<Set<string> | null>
): Promise<boolean> {
  const conditions = promotion.rules?.conditions;
  if (!conditions || conditions.length === 0) return true;

  for (const condition of conditions) {
    switch (condition.type) {
      case 'cart_subtotal':
        if (condition.operator === 'gte') {
          const min = ruleAmount(condition.value) ?? 0;
          if (subtotalCents < min) return false;
        }
        break;
      case 'product_category':
        if (condition.operator === 'in') {
          const required = Array.isArray(condition.value) ? condition.value : [condition.value];
          const cats = await getCartCategories();
          // Categories unknown (no items to price) → can't verify → fail closed.
          if (!cats) return false;
          if (!required.some((c) => typeof c === 'string' && cats.has(c))) return false;
        }
        break;
      default:
        break;
    }
  }
  return true;
}

/**
 * The cart-level discount (cents) a promotion grants against a goods subtotal.
 * Mirrors the cart branches of `/api/validate-discount`'s `calculateDiscountAmount`:
 * `percentage_discount` is a percentage of the subtotal; `fixed_discount` is a
 * flat amount capped at the subtotal. Actions that don't reduce the cart goods
 * total (item/shipping/tiered/etc.) contribute 0.
 */
function cartDiscountAmountCents(promotion: Promotion, subtotalCents: number): number {
  const action = promotion.rules?.actions?.[0];
  if (!action) return 0;

  switch (action.type) {
    case 'percentage_discount': {
      const pct = typeof action.value === 'number' ? action.value : 0;
      if (!(pct > 0)) return 0;
      return Math.round(subtotalCents * (pct / 100));
    }
    case 'fixed_discount': {
      const fixed = ruleAmount(action.value) ?? 0;
      return Math.max(0, Math.min(fixed, subtotalCents));
    }
    default:
      return 0;
  }
}

/**
 * Resolve one coupon code to its currently-usable parent CART promotion, or null.
 * Indexed lookups only (unique code index + promotion PK). The coupon must pass
 * `validateCouponInstance().canBeUsed` (active + within its validity window +
 * under its usage limit) and its promotion must be active, in its own validity
 * window (`checkTimeValidity`), and `cart`-typed — the same gates
 * `/api/validate-discount` applies, so the floor never diverges from the
 * storefront. `code` is already normalized (trimmed, upper-cased); coupon codes
 * are stored upper-case (unique index; generation/validation enforce it).
 */
async function resolveUsableCartPromotion(code: string): Promise<Promotion | null> {
  const coupon = await getCouponInstanceByCode(code);
  if (!coupon || !validateCouponInstance(coupon).canBeUsed) {
    console.warn(`[discount-pricing] code ${code} skipped: no usable coupon`);
    return null;
  }

  const promotion = await getPromotionById(coupon.promotion_id);
  if (!promotion || promotion.status !== 'active' || !checkTimeValidity(promotion) || promotion.type !== 'cart') {
    console.warn(`[discount-pricing] code ${code} skipped: no active in-window cart promotion`);
    return null;
  }

  return promotion;
}

/**
 * Resolve the authoritative CART-level discount (cents) for a set of coupon codes
 * against a server-computed goods subtotal (BMC-177). Only currently-usable
 * `cart`-type promotions whose conditions the subtotal (and, for category-gated
 * promotions, the cart's CATALOG-derived categories) satisfy contribute; the
 * summed discount is capped at the subtotal and floored at 0. Returns 0 for no
 * codes, a zero subtotal, or codes that don't resolve to a valid cart promotion.
 *
 * `items` are the order lines (product ids); they're only read to verify a
 * `product_category` condition, and only then — so ordinary discounted checkouts
 * pay no extra catalog reads. Omit them and any category-gated promotion fails
 * closed. The code list is capped at `MAX_DISCOUNT_CODES` as a defensive backstop
 * (callers should reject earlier for a clean error).
 */
export async function resolveCartDiscountCents(
  codes: string[] | string | null | undefined,
  subtotalCents: number,
  items?: DiscountCartLine[]
): Promise<number> {
  const codeList = normalizeDiscountCodes(codes).slice(0, MAX_DISCOUNT_CODES);
  if (codeList.length === 0) return 0;

  const subtotal = Math.max(0, Math.round(subtotalCents));
  if (subtotal === 0) return 0;

  // Resolve each code independently via indexed lookups (no full-table scan);
  // Promise.all preserves order so the dedup below is deterministic.
  const resolved = await Promise.all(codeList.map(resolveUsableCartPromotion));

  // Derive the cart's catalog categories at most once, and only if some resolved
  // promotion actually gates on product_category — memoized so a second gated
  // promotion reuses the result rather than re-reading the catalog.
  let cartCategories: Set<string> | null = null;
  let categoriesResolved = false;
  const getCartCategories = async (): Promise<Set<string> | null> => {
    if (!categoriesResolved) {
      categoriesResolved = true;
      cartCategories = items && items.length ? await collectCatalogCategories(items) : null;
    }
    return cartCategories;
  };

  let totalDiscount = 0;
  // Dedup by PROMOTION, mirroring the cart store's dedup-by-promotionId
  // (lib/stores/cart-store.ts `applyDiscount`): a promotion's discount is applied
  // AT MOST ONCE even if several distinct coupon codes resolve to it. The client
  // controls both `discountCodes` and the paid `amount`, so without this a shopper
  // could stack multiple bulk codes for one promotion to inflate the credited
  // discount past what their charge reflected and under-pay — defeating the floor.
  const countedPromotionIds = new Set<string>();
  for (const promotion of resolved) {
    if (!promotion) continue;

    // Same promotion already counted via another code → don't credit it twice.
    if (countedPromotionIds.has(promotion.id)) continue;

    if (!(await cartConditionsMet(promotion, subtotal, getCartCategories))) {
      console.warn(
        `[discount-pricing] promotion ${promotion.id} skipped: cart conditions not met at subtotal ${subtotal}c`
      );
      continue;
    }

    countedPromotionIds.add(promotion.id);
    totalDiscount += cartDiscountAmountCents(promotion, subtotal);
  }

  return Math.max(0, Math.min(subtotal, Math.round(totalDiscount)));
}

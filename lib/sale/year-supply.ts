/**
 * === Year-supply box math (pure) ===
 *
 * The SINGLE source for how boxes translate into time and into a one-click
 * offer. A box is 10 tea bags, so 36 boxes is a year at a cup a day - which is
 * not an invented round number, it is the cadence the store's own subscriptions
 * ran at (3 boxes a month of a single blend).
 *
 * PURE ON PURPOSE - do not add a runtime import here, for the same reason
 * `lib/sale/rules.ts` carries the same warning: the PDP and catalog cards pull
 * this into a client bundle, and a `lib/db` import drags getCloudflareContext
 * and the whole Drizzle schema barrel in with it.
 *
 * No money lives in this module. Every dollar figure is formatted by the
 * caller from the live variant price, because `scripts/goob-reprice.mjs` is
 * built to run more than once (data/goob/price-baseline.json makes a second
 * markdown safe) and a constant here would outlive the price it described.
 */

import type { CartItem } from '@/lib/types/cartitem';

/** Tea bags in a box, and therefore cups. */
export const CUPS_PER_BOX = 10;

/** Boxes in a year at a cup a day: 3 a month, the old subscription cadence. */
export const YEAR_SUPPLY_BOXES = 36;

/** The inventory shape this module reads. Structural, so any variant fits. */
export interface StockVariant {
  inventory?: {
    quantity?: unknown;
    track_inventory?: unknown;
    allow_backorder?: unknown;
  } | null;
}

/**
 * Boxes on hand, or `null` meaning "no count to show".
 *
 * `null` covers every case where a number would be misleading rather than
 * merely absent: no inventory record, `track_inventory === false`, or
 * `allow_backorder` - all of which mean unlimited to the two readers that
 * already exist (`isVariantAvailable` in lib/db/schema/products.ts,
 * `hasAvailableStock` in lib/recommendations/blend.ts). Rendering "0 boxes
 * left" for an untracked variant would be worse than rendering nothing.
 *
 * A negative quantity (reachable through the backorder path in
 * lib/services/inventory-adjustment.ts) clamps to 0 rather than displaying.
 */
export function boxesLeft(variant: StockVariant | null | undefined): number | null {
  const inventory = variant?.inventory;
  if (!inventory) return null;
  if (inventory.track_inventory === false) return null;
  if (inventory.allow_backorder === true) return null;

  const quantity = inventory.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return null;

  return Math.max(0, Math.floor(quantity));
}

/**
 * The product shape the box-unit predicate reads. Structural and `unknown`-typed
 * so any product object fits without importing the MACH types (this module is
 * pure and must stay import-light for the client bundle).
 */
export interface BoxUnitProduct {
  type?: unknown;
  extensions?: unknown;
}

/**
 * Catalog `type` values whose unit of inventory is ONE BOX of tea.
 *
 * Compared normalized (lowercased, non-alphanumerics stripped), the same way
 * `isGiftCardPurchaseProduct` normalizes `type` in lib/config/commerce.ts.
 * The catalog's `type` values are 'Tea Bags', 'Drinkware', 'Mugs' and
 * 'Gift Card'; only the first is counted in boxes.
 */
const BOX_UNIT_PRODUCT_TYPES = new Set(['teabags']);

/**
 * Whether "N boxes left" is a TRUE sentence about this product.
 *
 * The closing sale counts stock in boxes, but only the three Clearly Calendula
 * blends are actually stocked one box to a unit. The rest of the catalog is
 * drinkware, mugs and gift cards, where a unit is a mug or a card - a card
 * reading "25 boxes left" is a unit lie, not merely an odd word. Callers that
 * render a box count must ask this first and fall back to the plain
 * In Stock / Sold out treatment when it is false.
 *
 * Two signals, both structural fields already in the catalog rather than a
 * name match or a slug list:
 *
 *  1. POSITIVE - the product `type` is the tea type. Drinkware, Mugs and
 *     Gift Card are distinct `type` values, so this alone separates tea from
 *     everything else.
 *  2. NEGATIVE - `extensions.contents` is absent. That field is defined in
 *     ProductDisplay's `ProductExtensions` as "what's in the box for
 *     MULTI-BOX packs" and exists only on the two archived bundles
 *     (`clearly-calendula-sample-pack`, 3 boxes; `clearly-calendula-full-package`,
 *     9 boxes). A bundle unit is several boxes, so its inventory count is not
 *     a box count either - and the bundles can still reach a card through the
 *     recommendation pool.
 *
 * Both directions fail toward showing LESS: an unreadable or unexpected type,
 * or a stray `contents` value on a blend, drops the box count and leaves the
 * plain stock label, which is the error-handling rule the rest of this feature
 * follows. It never invents a box count for something that is not a box.
 */
export function isSoldByTheBox(product: BoxUnitProduct | null | undefined): boolean {
  if (!product) return false;

  const type =
    typeof product.type === 'string'
      ? product.type.toLowerCase().replace(/[^a-z0-9]/g, '')
      : '';
  if (!BOX_UNIT_PRODUCT_TYPES.has(type)) return false;

  const extensions = product.extensions;
  const contents =
    extensions && typeof extensions === 'object'
      ? (extensions as Record<string, unknown>).contents
      : undefined;

  return !(typeof contents === 'string' && contents.trim() !== '');
}

export type YearSupplyOffer = { boxes: number; kind: 'year' | 'rest' };

/**
 * What the "Make it a year" button should offer, or `null` for "do not render".
 *
 * `alreadyInCart` is subtracted first. Without it a second click queues 72
 * boxes against 40 in stock; `/api/payment-intent`'s availability gate catches
 * that, but at checkout, which is a bad place to discover it.
 */
export function yearSupplyOffer(
  left: number | null,
  alreadyInCart: number
): YearSupplyOffer | null {
  if (left === null) return null;

  const inCart = Number.isFinite(alreadyInCart) ? Math.max(0, alreadyInCart) : 0;
  const available = left - inCart;
  if (available <= 0) return null;

  return available >= YEAR_SUPPLY_BOXES
    ? { boxes: YEAR_SUPPLY_BOXES, kind: 'year' }
    : { boxes: available, kind: 'rest' };
}

/**
 * === PDP quantity picker ===
 *
 * The picker next to Add to Cart is a box picker on the blends, so its bounds
 * are box math and belong here rather than in the component: the same rules
 * decide the number it opens on, and `yearSupplyOffer` above already owns the
 * other side of the same question ("how many boxes may this customer take").
 */

/**
 * The largest quantity the picker may reach: what is on hand when stock is
 * counted, `null` (unbounded) when `boxesLeft` had no count to give. Zero
 * stock returns 0, but no picker renders there - the CTA is gone by then.
 */
export function maxPurchaseQuantity(left: number | null): number | null {
  return left;
}

/**
 * A quantity forced into range: a whole number, at least 1, and never above
 * `max` when one is known. Non-numeric input (a cleared field) reads as 1,
 * because the picker must always resolve to something addable.
 */
export function clampQuantity(value: unknown, max: number | null): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  const floored = Number.isFinite(numeric) ? Math.floor(numeric) : 1;
  const upper = max === null ? Infinity : Math.max(1, max);
  return Math.min(Math.max(floored, 1), upper);
}

/**
 * The quantity the picker opens on.
 *
 * Box-stocked blends open at the cart minimum (`sale.minimum_boxes`, 10),
 * since that is what the order needs to check out anyway and starting at 1
 * only defers the correction to the cart drawer. Everything else on this PDP -
 * drinkware, mugs, gift cards - opens at 1: ten mugs is not a sensible default,
 * and `isSoldByTheBox` is the same predicate that keeps a box COUNT off those
 * products.
 *
 * Clamped to stock, so a blend with 4 boxes left opens at 4 rather than
 * offering 10 that cannot ship.
 */
export function startingQuantity(input: {
  soldByTheBox: boolean;
  minimumBoxes: number;
  left: number | null;
}): number {
  if (!input.soldByTheBox) return 1;
  return clampQuantity(input.minimumBoxes, maxPurchaseQuantity(input.left));
}

export interface YearSupplyCartInput {
  variant: { id?: unknown; price?: { amount?: unknown; currency?: unknown } | null };
  productId: string;
  name: string;
  imageUrl: string;
  boxes: number;
}

/**
 * The cart line for an accepted offer, or null if it cannot be built safely.
 *
 * Lives here rather than inside the button so the payload can be asserted
 * exactly without a DOM testing library (this repo has none). `price` is the
 * variant's MINOR-unit amount, unchanged - the cart store, the drawer total,
 * and the charge floor all work in minor units, and converting here would be
 * the raw-arithmetic mistake CLAUDE.md forbids.
 */
export function yearSupplyCartItem(input: YearSupplyCartInput): CartItem | null {
  const id = input?.variant?.id;
  const amount = input?.variant?.price?.amount;
  const boxes = input?.boxes;

  if (typeof id !== 'string' || id === '') return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  if (typeof boxes !== 'number' || !Number.isFinite(boxes) || boxes <= 0) return null;

  return {
    variantId: id,
    productId: input.productId,
    name: input.name,
    price: amount,
    quantity: Math.floor(boxes),
    primaryImageUrl: input.imageUrl,
  };
}

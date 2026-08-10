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

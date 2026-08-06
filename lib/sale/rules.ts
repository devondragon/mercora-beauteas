/**
 * === Going-out-of-business sale rules (pure) ===
 *
 * The SINGLE source for the sale's purchase rules: the box minimum, the
 * quantity-tiered shipping bands, and whether the store is in final-sale mode.
 *
 * Every consumer resolves through here — the cart drawer and checkout page (the
 * customer-facing prompt), `/api/payment-intent` and `/api/orders` (the
 * authoritative gates), `resolveShippingOptions` (the quote and the charge
 * floor), and `lib/ai/deterministic-answers.ts` (what Chai tells people). That
 * is the same discipline `lib/services/shipping-options.ts` enforces for rates,
 * and for the same reason: a number stated in five places drifts.
 *
 * Every remaining SKU is a single box, so a cart's box count is its quantity
 * total. The bundle SKUs that were not one box are withdrawn (see
 * `isPubliclyPurchasableProduct`).
 *
 * PURE ON PURPOSE — do not add a runtime import here. The cart drawer and
 * checkout page import this module into a client bundle, and the settings read
 * reaches lib/db → getCloudflareContext plus the whole Drizzle schema barrel.
 * The settings read lives in `lib/sale/settings.ts` for exactly that reason,
 * mirroring why `resolveShippingOptions` was split out of `checkout-charges.ts`
 * to keep the Stripe SDK off the chat route (BMC-242).
 */

/** A shipping band. `cost` is MAJOR units (dollars), matching `shipping.methods[].cost`. */
export interface ShippingTier {
  /** Inclusive upper bound in boxes. `null` means "everything above the previous tier". */
  max_boxes: number | null;
  cost: number;
}

export interface SaleRules {
  minimumBoxes: number;
  finalSale: boolean;
  subscriptionsEnabled: boolean;
  tiers: ShippingTier[];
}

export const DEFAULT_MINIMUM_BOXES = 10;

/**
 * Total boxes in a cart. Coercion MIRRORS `normalizeQuantity` in
 * `lib/services/order-pricing.ts` line for line, because this count and the
 * goods subtotal that `computeCatalogLineCents` derives from that function
 * must agree on what each line's quantity is — otherwise the box count and
 * the priced goods can disagree about the very same cart (the omitted-
 * quantity gap that made `resolveShippingTier` pick the wrong tier while the
 * catalog priced every line as quantity 1; see GOOB shipping-tier review).
 * An omitted (`null`/`undefined`) quantity defaults to 1, matching the
 * historical "omitted means a single unit" default; any other raw value is
 * coerced with `Number(raw)`, not just strings. A line with an unusable
 * quantity (non-finite or `<= 0`) contributes 0 — the catalog pricing path
 * independently fails that same line closed, so the cart is rejected
 * regardless, and this must never produce NaN.
 */
export function countBoxes(items: Array<{ quantity?: unknown }>): number {
  if (!Array.isArray(items)) return 0;

  return items.reduce<number>((total, item) => {
    const raw = item?.quantity;
    if (raw == null) return total + 1; // omitted → default to a single unit
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return total;
    return total + Math.max(1, Math.floor(n));
  }, 0);
}

export function checkMinimumOrder(
  boxes: number,
  minimumBoxes: number
): { ok: boolean; short: number } {
  const short = Math.max(0, minimumBoxes - boxes);
  return { ok: short === 0, short };
}

/**
 * The band a box count falls into. Bounds are INCLUSIVE, and the tiers are
 * sorted here rather than trusting the order an admin saved them in — the
 * settings editor lets rows be reordered.
 */
export function resolveShippingTier(tiers: ShippingTier[], boxes: number): ShippingTier | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;

  const sorted = [...tiers].sort((a, b) => {
    // Two open-ended tiers used to both compare as "greater than" the other
    // (`1` in both directions), which is not a valid strict-weak-order — the
    // tier that won depended on Array.prototype.sort's internal tie-breaking
    // for an inconsistent comparator, which is order-of-input-dependent, not
    // just engine-dependent. Break the tie on COST instead of position, so
    // the same set of tiers resolves to the same tier regardless of the
    // order they happen to be stored in. Lower cost wins: this mirrors the
    // "unknown box count resolves to the lowest tier" bias below and in
    // resolveShippingOptions — ambiguous data should never invent a higher
    // charge. The admin editor now also prevents saving more than one
    // open-ended row (app/admin/settings/page.tsx), but this resolver can't
    // assume every caller enforces that.
    if (a.max_boxes === null && b.max_boxes === null) return a.cost - b.cost;
    if (a.max_boxes === null) return 1;
    if (b.max_boxes === null) return -1;
    return a.max_boxes - b.max_boxes;
  });

  return sorted.find((tier) => tier.max_boxes === null || boxes <= tier.max_boxes) ?? null;
}

export function minimumOrderMessage(short: number, minimumBoxes: number): string {
  const boxes = short === 1 ? 'box' : 'boxes';
  return `Add ${short} more ${boxes} to check out. ${minimumBoxes} box minimum.`;
}

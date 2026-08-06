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
 * Total boxes in a cart. A line with an unusable quantity contributes 0 — the
 * catalog pricing path fails that same line closed, so the cart is rejected
 * regardless, and this must never produce NaN.
 */
export function countBoxes(items: Array<{ quantity?: unknown }>): number {
  if (!Array.isArray(items)) return 0;

  return items.reduce<number>((total, item) => {
    const raw = item?.quantity;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return total;
    return total + Math.floor(n);
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
    if (a.max_boxes === null) return 1;
    if (b.max_boxes === null) return -1;
    return a.max_boxes - b.max_boxes;
  });

  return sorted.find((tier) => tier.max_boxes === null || boxes <= tier.max_boxes) ?? null;
}

export function minimumOrderMessage(short: number, minimumBoxes: number): string {
  const boxes = short === 1 ? 'box' : 'boxes';
  return `Add ${short} more ${boxes} to check out — ${minimumBoxes} box minimum.`;
}

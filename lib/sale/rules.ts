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
  /**
   * `shipping.per_box_cost` in MAJOR units, or `null` when not configured.
   *
   * OPTIONAL on the type, always set by `getSaleRules`. Absent therefore means
   * the same thing a `null` does — no per-box rate, leave the tiers and flat
   * rates in force — so a consumer reading an older shape (or a test fixture
   * written before this existed) degrades to the pre-existing pricing rather
   * than to free shipping. Consumers must resolve it through
   * `normalizePerBoxCost` rather than testing it directly, since `undefined`
   * is not `null`.
   */
  perBoxCost?: number | null;
}

/**
 * Per-box shipping (`shipping.per_box_cost`): the cart is charged this many
 * DOLLARS for every box in it. When configured it prices the whole cart,
 * ahead of both `shipping.tiers` and the flat `shipping.methods` rates — see
 * `resolveShippingOptions`, which owns the multiplication so the quote, the
 * charge floor, and Chai can't diverge.
 *
 * Why a flat per-box rate rather than another band: the sale's real postage is
 * about $10 for 10 boxes and about $9 for 20 (they ship as separate parcels
 * above that), so $1 a box tracks cost closely while staying a single number a
 * customer can hold in their head. Banded pricing put a cliff at each boundary
 * — a 20th box cost $10 of shipping while the 19th cost nothing — which is
 * both a sticker shock and a reason to stop at 19.
 *
 * NOT configured is `null`, and every unusable value lands there: zero,
 * negative, non-finite, and non-numeric all mean "no per-box rate", which
 * leaves whatever the tiers or flat rates already said in force. That is the
 * same posture `shipping.tiers` takes with an empty array, and for the same
 * reason — a half-configured rate must never silently become the price.
 * A blank string coerces to `0` under `Number`, so it is rejected here rather
 * than shipping every order free.
 */
export function normalizePerBoxCost(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Boxes to bill per-box shipping for. Never less than one: `resolveShippingOptions`
 * is also called with an UNKNOWN box count (Chai has no cart, so it passes 0),
 * and a zero there would quote and floor at $0 — free shipping invented from a
 * missing argument. One box is the lowest charge the rate can produce, which
 * matches the existing "unknown box count resolves to the lowest tier" bias:
 * ambiguous input must not invent a higher charge, but it must not invent a
 * free one either. Fractional and non-finite counts floor the same way
 * `countBoxes` does.
 */
export function billableBoxes(boxes: number): number {
  if (!Number.isFinite(boxes)) return 1;
  return Math.max(1, Math.floor(boxes));
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

/**
 * How many more boxes a cart needs. Both arguments are treated as untrusted:
 * `minimumBoxes` reaches the client surfaces from `/api/sale-rules`, and a
 * non-finite value there used to make `short` NaN — which is never `=== 0`, so
 * the checkout page blocked every customer behind "Add NaN more boxes" with no
 * way to pay. An unusable minimum now means "no minimum known", which is the
 * safe direction: this function drives COPY, while `/api/payment-intent`,
 * `/api/orders`, and the MCP order tools are what actually enforce the gate.
 */
export function checkMinimumOrder(
  boxes: number,
  minimumBoxes: number
): { ok: boolean; short: number } {
  if (!Number.isFinite(minimumBoxes) || !Number.isFinite(boxes)) {
    return { ok: true, short: 0 };
  }
  const short = Math.max(0, minimumBoxes - boxes);
  return { ok: short === 0, short };
}

/**
 * The band a box count falls into. Bounds are INCLUSIVE, and the tiers are
 * sorted here rather than trusting the order an admin saved them in — the
 * settings editor lets rows be reordered.
 *
 * `null` means ONLY "not configured" (an empty/invalid set). A configured set
 * always resolves to a band — see the fallback at the end.
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
    // Two tiers with the SAME bound tie at 0, and `sort` is stable — so which
    // one `find` reached first was decided by storage order, the same class of
    // bug as the two-open-ended case above. `addTierRow` defaults a new row to
    // `max_boxes: 1` whenever one is already open-ended, so clicking "Add tier"
    // twice produces duplicate bounds through the normal editor flow. Break on
    // cost, biased low, for the same reason.
    return (a.max_boxes - b.max_boxes) || (a.cost - b.cost);
  });

  // A CONFIGURED tier set prices the whole cart, so a box count above every
  // bounded band falls into the TOP band rather than falling through to null.
  // Returning null here handed `resolveShippingOptions` nothing, and it
  // silently reverted to the flat per-method rate for the LARGEST orders:
  // against tiers of 20/$8 and 40/$14 with no open-ended row, a 60-box cart
  // both quoted and charged Standard's $5.99. The charge floor resolves
  // through this same function, so the floor agreed and nothing caught the
  // undercharge. `sorted` puts the open-ended row last when one exists, in
  // which case `find` always matches and this fallback is unreachable; the
  // editor warns when there is no open-ended row (lib/sale/tier-editor.ts),
  // but this resolver can't assume every caller enforces that — the same
  // reason the comparator above tie-breaks explicitly.
  return (
    sorted.find((tier) => tier.max_boxes === null || boxes <= tier.max_boxes) ??
    sorted[sorted.length - 1]
  );
}

export function minimumOrderMessage(short: number, minimumBoxes: number): string {
  const boxes = short === 1 ? 'box' : 'boxes';
  return `Add ${short} more ${boxes} to check out. ${minimumBoxes} box minimum.`;
}

/**
 * Stated once so the surfaces that refuse to start recurring billing cannot
 * drift. Lives in `rules.ts` (pure) so client components can render the same
 * string without pulling the settings read into a browser bundle.
 */
export const SUBSCRIPTIONS_DISABLED_MESSAGE =
  'Subscriptions are not available. BeauTeas is closing and we are no longer starting recurring deliveries.';

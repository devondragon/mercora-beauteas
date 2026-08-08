/**
 * === Admin shipping-tier editor helpers (pure) ===
 *
 * Small pure helpers for the tier-row editor in `app/admin/settings/page.tsx`
 * (the Shipping tab). Split out of that client component so they're testable
 * without pulling in its full import graph (lucide-react icons, `ui/*`
 * components, etc.) — this module has no React/UI dependency at all.
 *
 * `hasZeroCostTier` exists because of a specific failure mode: migration 0025
 * seeds `shipping.tiers` EMPTY on purpose, because an empty array means "not
 * configured" and leaves the flat `shipping.methods` rates in force, while ANY
 * non-empty array takes over pricing completely (see
 * `lib/services/shipping-options.ts`). A tier saved with `cost: 0` therefore
 * ships that entire band free — not a validation error, just silently free —
 * so the editor surfaces it as a warning rather than letting it pass unnoticed.
 * This is a warning, not a block: a deliberate $0 promotional tier is a
 * legitimate choice, just one the admin should make on purpose.
 *
 * `setOpenEndedTier` and the `addTierRow` invariant below exist because
 * `resolveShippingTier` (lib/sale/rules.ts) can only be handed one tier per
 * box count. More than one `max_boxes: null` row makes which tier wins
 * ambiguous — the resolver now tie-breaks deterministically on cost so it
 * can never diverge by storage order, but the editor should not let an admin
 * create that ambiguous state in the first place: fewer moving parts than
 * relying on the resolver's tie-break alone.
 *
 * `hasNoOpenEndedTier` covers the opposite end of that same invariant — ZERO
 * open-ended rows, which the editor can reach and which leaves the largest
 * carts covered only by the resolver's top-band fallback.
 */
import type { ShippingTier } from '@/lib/sale/rules';

/**
 * A fresh row for "Add tier" — zero cost until the admin fills it in. Open-
 * ended only if nothing else already is, so this can never create a second
 * `max_boxes: null` row.
 */
export function addTierRow(tiers: ShippingTier[]): ShippingTier[] {
  const alreadyOpenEnded = tiers.some((t) => t.max_boxes === null);
  return [...tiers, { max_boxes: alreadyOpenEnded ? 1 : null, cost: 0 }];
}

export function removeTierRow(tiers: ShippingTier[], index: number): ShippingTier[] {
  return tiers.filter((_, i) => i !== index);
}

/**
 * Toggle the "No upper bound" checkbox for the row at `index`. Checking it
 * clears `max_boxes` on any OTHER row that was also open-ended (back to `1`,
 * the same fallback `addTierRow` and the numeric input use) — so at most one
 * tier can be open-ended at a time. Unchecking just makes this row numeric.
 */
export function setOpenEndedTier(tiers: ShippingTier[], index: number, openEnded: boolean): ShippingTier[] {
  return tiers.map((tier, i) => {
    if (i === index) return { ...tier, max_boxes: openEnded ? null : 1 };
    if (openEnded && tier.max_boxes === null) return { ...tier, max_boxes: 1 };
    return tier;
  });
}

/**
 * True when a CONFIGURED tier set (non-empty) contains a $0 band. An empty
 * array is "not configured" and never risky — that's the safe default, not
 * the state this warns about.
 */
export function hasZeroCostTier(tiers: ShippingTier[]): boolean {
  return tiers.length > 0 && tiers.some((t) => t.cost === 0);
}

/**
 * True when a CONFIGURED tier set has no open-ended row, so nothing explicitly
 * covers carts above the largest bound. `addTierRow` only guards against a
 * SECOND open-ended row; nothing stops an admin reaching ZERO of them, either
 * by unchecking "No upper bound" on the only one or by deleting that row.
 *
 * `resolveShippingTier` charges such a cart the TOP band, which is defined and
 * safe — it used to fall through to the flat per-method rate and undercharge
 * the largest orders. That still isn't necessarily the price the admin meant,
 * so surface it. A warning, not a block, for the same reason as
 * `hasZeroCostTier`: capping the bands is a legitimate choice when the top
 * band is the intended price for everything above it.
 */
export function hasNoOpenEndedTier(tiers: ShippingTier[]): boolean {
  return tiers.length > 0 && !tiers.some((t) => t.max_boxes === null);
}

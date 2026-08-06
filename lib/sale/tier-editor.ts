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
 */
import type { ShippingTier } from '@/lib/sale/rules';

/** A fresh row for "Add tier" — open-ended and zero cost until the admin fills it in. */
export function addTierRow(tiers: ShippingTier[]): ShippingTier[] {
  return [...tiers, { max_boxes: null, cost: 0 }];
}

export function removeTierRow(tiers: ShippingTier[], index: number): ShippingTier[] {
  return tiers.filter((_, i) => i !== index);
}

/**
 * True when a CONFIGURED tier set (non-empty) contains a $0 band. An empty
 * array is "not configured" and never risky — that's the safe default, not
 * the state this warns about.
 */
export function hasZeroCostTier(tiers: ShippingTier[]): boolean {
  return tiers.length > 0 && tiers.some((t) => t.cost === 0);
}

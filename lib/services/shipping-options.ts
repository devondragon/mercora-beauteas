/**
 * === Storefront shipping options (extracted from checkout-charges, BMC-242) ===
 *
 * The SINGLE source of the storefront shipping model: the flat methods, their
 * costs, and the free-shipping threshold. Every consumer resolves through
 * `resolveShippingOptions` so the rate a customer is quoted, the rate the charge
 * floor enforces, and the rate Chai states can never diverge:
 *
 * | Consumer                              | Why it needs this            |
 * | ------------------------------------- | ---------------------------- |
 * | `/api/shipping-options`               | the checkout quote           |
 * | `computeShippingFloorCents` (BMC-201) | the enforced charge floor    |
 * | `lib/ai/deterministic-answers.ts`     | Chai's shipping answer       |
 *
 * GOOB: the sale prices shipping by box-count tier (`shipping.tiers`, from
 * `@/lib/sale/rules`) rather than a flat per-method rate — see the tier logic
 * below. All three consumers above still resolve through this one function, so
 * the tiered rate can't drift between the quote, the floor, and Chai either.
 *
 * WHY IT LIVES HERE rather than in `checkout-charges.ts` (its original home):
 * `checkout-charges` imports `@/lib/stripe`, which instantiates the Stripe server
 * SDK and a SubtleCrypto provider at module load. The chat route has no business
 * paying for that just to read three flat rates, so the shipping model was split
 * out into this module — which depends only on settings and `Money` —
 * and `checkout-charges` re-exports it. Nothing about the model changed in the
 * move; the alternative (copying the rates into the AI layer) is the exact drift
 * BMC-215 exists to stop.
 */

import type { ShippingOption } from '@/lib/types/shipping';
import { Money } from '@/lib/money';
import { getSettings } from '@/lib/utils/settings';
import { resolveShippingTier, type ShippingTier } from '@/lib/sale/rules';

// The storefront's shipping methods when `shipping.methods` isn't configured —
// IDENTICAL to the `/api/shipping-options` default (kept in lockstep because both
// that route and the charge floor resolve options through `resolveShippingOptions`).
// Costs are MAJOR units (dollars), matching how admin settings store them.
const DEFAULT_SHIPPING_METHODS = [
  { id: 'standard', label: 'Standard (5–7 days)', cost: 5.99, estimatedDays: 5, enabled: true },
  { id: 'express', label: 'Express (2–3 days)', cost: 9.99, estimatedDays: 2, enabled: true },
  { id: 'overnight', label: 'Overnight', cost: 19.99, estimatedDays: 1, enabled: true },
];
const DEFAULT_FREE_SHIPPING_THRESHOLD_MAJOR = 75;
const DEFAULT_FREE_SHIPPING_METHODS = ['standard'];

export interface ResolvedShippingOptions {
  /** Enabled methods with free-shipping already applied. `cost` is MAJOR units. */
  options: ShippingOption[];
  /** Whether THIS subtotal cleared the threshold (drives the zeroed costs above). */
  qualifiesForFreeShipping: boolean;
  /**
   * The configured free-shipping threshold in MAJOR units — returned so a caller
   * can state the policy without re-reading settings or hardcoding $75 (BMC-242).
   */
  freeShippingThresholdMajor: number;
  /** Method ids the threshold makes free (`shipping.free_methods`). */
  freeMethodIds: string[];
}

/**
 * Resolve the storefront's shipping options for a catalog goods subtotal, from
 * admin settings (BMC-201).
 *
 * Free shipping (`store.free_shipping_threshold`, default $75) zeroes the cost of
 * the configured free methods (`shipping.free_methods`, default `['standard']`)
 * once the goods subtotal clears the threshold. `goodsCents` must be the SERVER
 * catalog subtotal (never a client price); pass `qualifiesForFreeShipping: false`
 * when the cart couldn't be priced authoritatively so the perk fails closed.
 */
export async function resolveShippingOptions(
  goodsCents: number,
  opts: { subtotalPriceable?: boolean; boxes?: number } = {}
): Promise<ResolvedShippingOptions> {
  const [shippingSettings, storeSettings] = await Promise.all([
    getSettings('shipping'),
    getSettings('store'),
  ]);

  const methods = shippingSettings['shipping.methods'] || DEFAULT_SHIPPING_METHODS;
  const enabled = methods.filter((m: any) => m.enabled);

  const threshold = storeSettings['store.free_shipping_threshold'] || DEFAULT_FREE_SHIPPING_THRESHOLD_MAJOR;
  const qualifiesForFreeShipping =
    opts.subtotalPriceable !== false &&
    Money.fromMinor(Math.max(0, Math.round(goodsCents))).gte(Money.fromMajor(threshold));
  const freeMethods = shippingSettings['shipping.free_methods'] || DEFAULT_FREE_SHIPPING_METHODS;

  // GOOB: when tiers are configured they REPLACE the per-method cost — the sale
  // ships a single Standard method priced by quantity, so a method's own `cost`
  // is no longer the rate anyone pays. Absent tiers, the flat per-method model
  // is untouched.
  //
  // An unknown box count resolves to the LOWEST tier on purpose. This function
  // also produces the charge floor, which is a minimum the collected amount must
  // clear; inventing a higher tier would reject honest orders. Callers that can
  // price a cart always know its box count.
  const tiers = (shippingSettings['shipping.tiers'] as ShippingTier[] | undefined) ?? [];
  const tier = tiers.length > 0 ? resolveShippingTier(tiers, opts.boxes ?? 0) : null;

  const options: ShippingOption[] = enabled.map((m: any) => ({
    id: m.id,
    label: m.label,
    cost:
      qualifiesForFreeShipping && freeMethods.includes(m.id)
        ? 0
        : tier
          ? tier.cost
          : m.cost,
    estimatedDays: m.estimatedDays,
  }));

  return {
    options,
    qualifiesForFreeShipping,
    freeShippingThresholdMajor: Number(threshold),
    freeMethodIds: freeMethods,
  };
}

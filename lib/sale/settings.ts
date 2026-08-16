/**
 * The one settings read behind the sale.
 *
 * Separate from `lib/sale/rules.ts` so the pure rules stay importable from
 * client components — `getSettings` reaches lib/db → getCloudflareContext and
 * the Drizzle schema barrel, none of which belongs in a browser bundle.
 */

import { getSettings } from '@/lib/utils/settings';
import {
  DEFAULT_MINIMUM_BOXES,
  normalizePerBoxCost,
  type SaleRules,
  type ShippingTier,
} from '@/lib/sale/rules';

/** Settings values arrive JSON-parsed, but a quoted number stays a string. */
function toPositiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export async function getSaleRules(): Promise<SaleRules> {
  const [sale, shipping] = await Promise.all([getSettings('sale'), getSettings('shipping')]);

  return {
    minimumBoxes: toPositiveInt(sale['sale.minimum_boxes'], DEFAULT_MINIMUM_BOXES),
    // Both booleans default to the SALE posture, not the pre-sale one: if the
    // settings read comes back empty the store must behave as closing, never as
    // if returns were still accepted or subscriptions still sold.
    finalSale: sale['sale.final_sale'] !== false,
    subscriptionsEnabled: sale['sale.subscriptions_enabled'] === true,
    tiers: Array.isArray(shipping['shipping.tiers'])
      ? (shipping['shipping.tiers'] as ShippingTier[])
      : [],
    perBoxCost: normalizePerBoxCost(shipping['shipping.per_box_cost']),
  };
}

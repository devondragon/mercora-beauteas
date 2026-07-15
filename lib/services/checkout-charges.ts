/**
 * Server-authoritative checkout tax + shipping (BMC-201).
 *
 * The storefront charge floor (`lib/services/order-pricing.ts`) enforces that
 * the cash collected covers the CATALOG value of the goods. Until BMC-201 that
 * floor stopped at the goods subtotal: tax and shipping were "additive-only,
 * not enforced", so a client could call `/api/payment-intent` directly with an
 * `amount` that just covered goods and `taxAmount: 0` and later be promoted to a
 * paid order with $0 tax / $0 shipping collected. `/api/tax` had been made
 * server-authoritative (BMC-200), but the tax it returns is advisory — nothing
 * on the actual charge/capture path enforced it.
 *
 * This module is that missing seam: it computes the SERVER's expected tax and
 * shipping (cents) for a cart + destination, using the SAME Stripe-Tax path
 * `/api/tax` quotes the shopper. `/api/tax` and `/api/payment-intent` both call
 * it, so the amount shown at checkout and the amount enforced at the floor are
 * computed identically and can't drift — the exact drift the `order-pricing.ts`
 * header used to cite as the reason NOT to re-derive tax at the floor. Because
 * the tax comes from Stripe Tax (not a re-derived flat table), an honest
 * shopper who paid what `/api/tax` quoted always clears the floor within
 * `AMOUNT_TOLERANCE_CENTS`; only a fabricated (tax-omitting) amount is rejected.
 *
 * Shipping is deterministic (`calculateShipping`) so it needs no external call.
 * Tax degrades to a flat `FALLBACK_TAX_RATE` on the same conditions `/api/tax`
 * does (no usable address / Stripe Tax error / Stripe unconfigured) so both
 * paths agree in the degraded case too. The expected numbers are computed once
 * at PaymentIntent creation and PERSISTED on the pending order, so finalization
 * and the Stripe webhook enforce the identical figure with no second Stripe call.
 */

import type { Address } from '@/lib/types';
import type { ShippingOption } from '@/lib/types/shipping';
import { Money } from '@/lib/money';
import {
  calculateTax as stripeCalculateTax,
  formatAmountForStripe,
  isStripeConfigured,
} from '@/lib/stripe';
import { computeCatalogLineCents } from '@/lib/services/order-pricing';
import { getSettings } from '@/lib/utils/settings';

/**
 * Fallback flat tax rate, applied whenever Stripe Tax can't be used (no usable
 * address, a Stripe Tax error, or Stripe unconfigured). Kept in lockstep with
 * the `/api/tax` fallback so the quote and the floor agree in the degraded path
 * (BMC-187 taxes the same base; BMC-201 shares the same rate here). At scale a
 * flat rate mischarges — the production intent is that this path is never hit
 * (Stripe Tax enabled with nexus configured before go-live, per the cutover
 * runbook). A config miss is logged loudly at `/api/tax`.
 */
export const FALLBACK_TAX_RATE = 0.07;

/** Why the tax computation fell back to the flat rate (drives `/api/tax` messaging). */
export type TaxFallbackReason = 'no_address' | 'stripe_error' | 'not_configured';

export interface ExpectedTaxResult {
  /** Expected tax for this cart + destination, in integer cents. */
  taxCents: number;
  /** 'stripe' when Stripe Tax computed it; 'fallback' when the flat rate was used. */
  calculatedBy: 'stripe' | 'fallback';
  /** Set only when `calculatedBy === 'fallback'`: which condition forced it. */
  fallbackReason?: TaxFallbackReason;
}

/** Whether an address carries enough to key an accurate tax jurisdiction. */
function hasUsableTaxAddress(address?: Address | null): boolean {
  return !!(address && address.region && address.postal_code);
}

/** Flat fallback tax (cents) on a taxable base already expressed in cents. */
function fallbackTaxCents(taxableCents: number): number {
  return Math.max(0, Math.round(taxableCents * FALLBACK_TAX_RATE));
}

// The storefront's shipping methods when `shipping.methods` isn't configured —
// IDENTICAL to the `/api/shipping-options` default (kept in lockstep because both
// this seam and that route resolve options through `resolveShippingOptions`). Costs
// are MAJOR units (dollars), matching how admin settings store them.
const DEFAULT_SHIPPING_METHODS = [
  { id: 'standard', label: 'Standard (5–7 days)', cost: 5.99, estimatedDays: 5, enabled: true },
  { id: 'express', label: 'Express (2–3 days)', cost: 9.99, estimatedDays: 2, enabled: true },
  { id: 'overnight', label: 'Overnight', cost: 19.99, estimatedDays: 1, enabled: true },
];
const DEFAULT_FREE_SHIPPING_THRESHOLD_MAJOR = 75;
const DEFAULT_FREE_SHIPPING_METHODS = ['standard'];

/**
 * Resolve the storefront's shipping options for a catalog goods subtotal, from
 * admin settings (BMC-201). This is the SINGLE source of the storefront shipping
 * model — `/api/shipping-options` (the customer-facing quote) and the charge floor
 * (`computeShippingFloorCents`) both call it, so the shipping a customer is quoted
 * and the shipping the floor enforces can never diverge.
 *
 * Free shipping (`store.free_shipping_threshold`, default $75) zeroes the cost of
 * the configured free methods (`shipping.free_methods`, default `['standard']`)
 * once the goods subtotal clears the threshold. `goodsCents` must be the SERVER
 * catalog subtotal (never a client price); pass `qualifiesForFreeShipping: false`
 * when the cart couldn't be priced authoritatively so the perk fails closed.
 */
export async function resolveShippingOptions(
  goodsCents: number,
  opts: { subtotalPriceable?: boolean } = {}
): Promise<{ options: ShippingOption[]; qualifiesForFreeShipping: boolean }> {
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

  const options: ShippingOption[] = enabled.map((m: any) => ({
    id: m.id,
    label: m.label,
    cost: qualifiesForFreeShipping && freeMethods.includes(m.id) ? 0 : m.cost,
    estimatedDays: m.estimatedDays,
  }));

  return { options, qualifiesForFreeShipping };
}

/**
 * The shipping (cents) the charge floor enforces: the MINIMUM cost among the
 * storefront's enabled shipping options for this subtotal (0 when the cheapest
 * option is free-shipping-eligible). The customer picks ONE method at checkout and
 * pays that method's cost, which is always >= this minimum — so an honest order
 * clears the floor regardless of which method they chose, while a client that
 * omitted shipping (paid $0 when not free-eligible) is caught. Uses the SAME
 * settings-based options `/api/shipping-options` quotes, so the floor can't drift
 * from what the customer was actually charged (BMC-201). No enabled method → 0.
 */
export async function computeShippingFloorCents(goodsCents: number): Promise<number> {
  const { options } = await resolveShippingOptions(goodsCents);
  if (options.length === 0) return 0;
  // `option.cost` is major-unit dollars; convert to cents for the floor.
  const costsCents = options.map((o) => formatAmountForStripe(o.cost));
  return Math.max(0, Math.min(...costsCents));
}

/**
 * Expected tax (cents) for catalog-priced lines + destination, via the SAME
 * Stripe-Tax-with-fallback seam `/api/tax` uses. `lineCents` are the per-line
 * catalog taxable amounts (cents) that drive Stripe Tax `line_items`;
 * `shippingCents` is the authoritative shipping added to the taxable base
 * (matching `/api/tax`, which taxes `subtotal + shipping`). Falls back to the
 * flat rate — never throws — so a Stripe outage can't wedge the charge floor;
 * the caller decides how loudly to surface a fallback.
 */
export async function computeExpectedTaxCents(args: {
  lineCents: number[];
  shippingAddress?: Address | null;
  shippingCents: number;
  /** Optional Stripe Tax line references (defaults to positional `item_<i>`). */
  itemReferences?: string[];
}): Promise<ExpectedTaxResult> {
  const lineCents = args.lineCents.map((c) => Math.max(0, Math.round(c)));
  const shippingCents = Math.max(0, Math.round(args.shippingCents));
  const goodsCents = lineCents.reduce((sum, c) => sum + c, 0);

  // No usable address → can't key a jurisdiction. Tax the same base the real
  // path taxes (goods + shipping) at the flat rate, matching `/api/tax`.
  if (!hasUsableTaxAddress(args.shippingAddress)) {
    return { taxCents: fallbackTaxCents(goodsCents + shippingCents), calculatedBy: 'fallback', fallbackReason: 'no_address' };
  }

  // Stripe unconfigured in this runtime → the fallback IS the behavior, but it
  // means every order mischarges; surface it as a distinct reason so `/api/tax`
  // can log/flag it loudly (mirrors its existing not-configured branch).
  if (!isStripeConfigured()) {
    return { taxCents: fallbackTaxCents(goodsCents + shippingCents), calculatedBy: 'fallback', fallbackReason: 'not_configured' };
  }

  const address = args.shippingAddress as Address;
  try {
    const calculationParams: any = {
      currency: 'usd',
      // Amounts are already cents (Stripe's smallest unit) — no dollar conversion.
      line_items: lineCents.map((amount, i) => ({
        amount,
        reference: args.itemReferences?.[i] ?? `item_${i}`,
        tax_code: 'txcd_99999999', // General - Tangible Goods
      })),
      customer_details: {
        address: {
          line1: String(address.line1),
          city: String(address.city),
          state: String(address.region),
          postal_code: String(address.postal_code),
          country: 'US',
        },
        address_source: 'shipping',
      },
      expand: ['line_items.data.tax_breakdown'],
    };
    if (shippingCents > 0) {
      calculationParams.shipping_cost = {
        amount: shippingCents,
        tax_code: 'txcd_92010001', // Shipping
      };
    }

    const calculation = await stripeCalculateTax(calculationParams);
    // `tax_amount_exclusive` is already in cents.
    const taxCents = Math.max(0, Math.round((calculation as any).tax_amount_exclusive || 0));
    return { taxCents, calculatedBy: 'stripe' };
  } catch (err) {
    // Transient Stripe Tax failure — degrade to the flat rate rather than wedge
    // checkout. Log the underlying error here (both callers share this seam) so
    // it stays diagnosable from `wrangler tail`.
    console.error('[checkout-charges] Stripe Tax calculation failed; using fallback rate:', err);
    return { taxCents: fallbackTaxCents(goodsCents + shippingCents), calculatedBy: 'fallback', fallbackReason: 'stripe_error' };
  }
}

export interface ExpectedChargeExtras {
  /** Catalog goods subtotal (cents). */
  goodsCents: number;
  /** Expected shipping (cents) for the destination. */
  shippingCents: number;
  /** Expected tax (cents) for the destination. */
  taxCents: number;
  /** How the tax was computed. */
  taxCalculatedBy: 'stripe' | 'fallback';
  /**
   * False when at least one line could not be priced from the catalog — the
   * goods/tax figures are then not authoritative and the caller must treat the
   * cart as unpriceable (fail closed), exactly as the goods-only floor does.
   */
  priceable: boolean;
}

/**
 * One-shot server-authoritative `{ goods, shipping, tax }` (cents) for a cart +
 * destination. Prices every line from the live catalog (never client prices),
 * derives deterministic shipping, and computes Stripe Tax on goods + shipping.
 * Shared by `/api/payment-intent` (fold into the floor, then persist) and the
 * pending-order persistence fallback so both agree on one set of figures.
 */
export async function computeExpectedChargeExtras(
  items: Array<{ product_id?: string; variant_id?: string; quantity?: number }>,
  shippingAddress?: Address | null
): Promise<ExpectedChargeExtras> {
  const lines = await computeCatalogLineCents(items);
  const priceable = lines.every((l) => 'cents' in l);
  const lineCents = lines.map((l) => ('cents' in l ? l.cents : 0));
  const goodsCents = lineCents.reduce((sum, c) => sum + c, 0);

  // An unpriceable cart has no authoritative goods base; don't spend a Stripe
  // Tax call on figures the caller will reject anyway.
  if (!priceable) {
    return { goodsCents, shippingCents: 0, taxCents: 0, taxCalculatedBy: 'fallback', priceable: false };
  }

  // Shipping floor = the cheapest enabled storefront method (settings-based, same
  // seam `/api/shipping-options` quotes) so the floor matches what the customer
  // was actually charged; tax is computed on goods + that minimum shipping so the
  // tax floor never exceeds what an honest customer paid (BMC-201).
  const shippingCents = await computeShippingFloorCents(goodsCents);
  const tax = await computeExpectedTaxCents({ lineCents, shippingAddress, shippingCents });
  return {
    goodsCents,
    shippingCents,
    taxCents: tax.taxCents,
    taxCalculatedBy: tax.calculatedBy,
    priceable: true,
  };
}

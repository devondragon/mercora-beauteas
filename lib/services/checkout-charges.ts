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
 * Shipping is deterministic (settings-driven, `lib/services/shipping-options.ts`)
 * so it needs no external call.
 * Tax degrades to the launch fallback policy on the same conditions `/api/tax`
 * does: 3.25% of discounted merchandise for Colorado and 0% elsewhere, with
 * shipping excluded. The expected numbers are computed once
 * at PaymentIntent creation and PERSISTED on the pending order, so finalization
 * and the Stripe webhook enforce the identical figure with no second Stripe call.
 */

import type { Address } from '@/lib/types';
import {
  calculateTax as stripeCalculateTax,
  formatAmountForStripe,
  isStripeConfigured,
} from '@/lib/stripe';
import { computeCatalogLineCents } from '@/lib/services/order-pricing';
import { resolveShippingOptions } from '@/lib/services/shipping-options';
import { resolveCartDiscountCents, normalizeDiscountCodes } from '@/lib/services/discount-pricing';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';
import { normalizeUsRegion } from '@/lib/utils/address';

/**
 * The storefront shipping model now lives in `lib/services/shipping-options.ts`
 * so the Chai assistant can read the same rates without importing the Stripe SDK
 * (BMC-242). Re-exported here because this module was its original home and
 * `/api/shipping-options` still imports it from this path.
 */
export { resolveShippingOptions };
export type { ResolvedShippingOptions } from '@/lib/services/shipping-options';

/**
 * Colorado fallback tax rate, applied whenever Stripe Tax can't be used (no
 * usable address, a Stripe Tax error, or Stripe unconfigured). Kept in lockstep with
 * the `/api/tax` fallback so the quote and the floor agree in the degraded path
 * (BMC-187 taxes the same base; BMC-201 shares the same rate here). At scale a
 * flat rate mischarges — the production intent is that this path is never hit
 * (Stripe Tax enabled with nexus configured before go-live, per the cutover
 * runbook). Shipping is deliberately excluded; all non-Colorado regions use
 * zero. A config miss is logged loudly at `/api/tax`.
 */
export const COLORADO_FALLBACK_TAX_RATE = 0.0325;
export const TEA_TAX_CODE = 'txcd_41050008';
const SHIPPING_TAX_CODE = 'txcd_92010001';
const STRIPE_TAX_CODE = /^txcd_\d{8}$/;

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
function fallbackTaxCents(taxableGoodsCents: number, region: unknown): number {
  return normalizeUsRegion(region) === 'CO'
    ? Math.max(0, Math.round(taxableGoodsCents * COLORADO_FALLBACK_TAX_RATE))
    : 0;
}

function logTaxFallback(reason: TaxFallbackReason, address: Address | null | undefined, orderId?: string): void {
  console.error('[checkout-charges] Stripe Tax fallback', {
    reason,
    destinationState: normalizeUsRegion(address?.region) ?? 'unknown',
    orderId: orderId || 'unassigned',
  });
}

/** Allocate an integer discount proportionally with a deterministic largest-remainder pass. */
export function allocateDiscountAcrossLines(lineCents: number[], rawDiscountCents: number): number[] {
  const lines = lineCents.map((c) => Math.max(0, Math.round(c)));
  const subtotal = lines.reduce((sum, cents) => sum + cents, 0);
  const discount = Math.min(subtotal, Math.max(0, Math.round(rawDiscountCents)));
  if (subtotal === 0 || discount === 0) return lines;

  const allocations = lines.map((cents) => Math.floor((cents * discount) / subtotal));
  let remaining = discount - allocations.reduce((sum, cents) => sum + cents, 0);
  const order = lines
    .map((cents, index) => ({ index, remainder: (cents * discount) % subtotal }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; remaining > 0; i++, remaining--) allocations[order[i].index]++;
  return lines.map((cents, index) => cents - allocations[index]);
}

async function catalogTaxCode(item: { product_id?: string; variant_id?: string }): Promise<string | null> {
  let productId = item.product_id;
  let variantTaxCategory: string | undefined;
  if (item.variant_id) {
    const variant = await getProductVariant(item.variant_id);
    productId ||= variant?.product_id;
    variantTaxCategory = variant?.tax_category;
  }
  const product = productId ? await getProduct(productId) : null;
  const type = typeof product?.type === 'string' ? product.type.toLowerCase() : '';

  // Catalog tea records historically say "food". Normalize every tea SKU to
  // Stripe's dedicated tea code instead of treating it as generic merchandise.
  if (type.includes('tea')) return TEA_TAX_CODE;

  // Future non-tea merchandise must carry an explicit Stripe code. Never
  // silently fall through to general tangible goods.
  const explicit = variantTaxCategory || product?.tax_category;
  return typeof explicit === 'string' && STRIPE_TAX_CODE.test(explicit) ? explicit : null;
}

export interface DiscountedCatalogTaxLines {
  priceable: boolean;
  grossGoodsCents: number;
  netGoodsCents: number;
  discountCents: number;
  lineCents: number[];
  taxCodes: string[];
  errors: string[];
}

/** Build the one authoritative set of discounted, catalog-priced Stripe Tax lines. */
export async function computeDiscountedCatalogTaxLines(
  items: Array<{ product_id?: string; variant_id?: string; quantity?: number }>,
  discountCodes?: string[]
): Promise<DiscountedCatalogTaxLines> {
  const catalogLines = await computeCatalogLineCents(items);
  const errors = catalogLines.flatMap((line) => ('error' in line ? [line.error] : []));
  const grossLineCents = catalogLines.map((line) => ('cents' in line ? line.cents : 0));
  const grossGoodsCents = grossLineCents.reduce((sum, cents) => sum + cents, 0);
  if (errors.length) {
    return { priceable: false, grossGoodsCents, netGoodsCents: 0, discountCents: 0, lineCents: [], taxCodes: [], errors };
  }

  const normalizedCodes = normalizeDiscountCodes(discountCodes);
  const discountCents = await resolveCartDiscountCents(normalizedCodes, grossGoodsCents, items);
  const lineCents = allocateDiscountAcrossLines(grossLineCents, discountCents);
  const taxCodes = await Promise.all(items.map(catalogTaxCode));
  taxCodes.forEach((code, index) => {
    if (!code) errors.push(`line ${index} has no valid Stripe tax code`);
  });
  return {
    priceable: errors.length === 0,
    grossGoodsCents,
    netGoodsCents: lineCents.reduce((sum, cents) => sum + cents, 0),
    discountCents,
    lineCents,
    taxCodes: taxCodes.filter((code): code is string => Boolean(code)),
    errors,
  };
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
 * discounted catalog taxable amounts (cents) that drive Stripe Tax `line_items`;
 * `shippingCents` is sent to Stripe with its dedicated shipping tax code.
 * Falls back to the launch policy — never throws — so a Stripe outage can't wedge the charge floor;
 * the caller decides how loudly to surface a fallback.
 */
export async function computeExpectedTaxCents(args: {
  lineCents: number[];
  taxCodes: string[];
  shippingAddress?: Address | null;
  shippingCents: number;
  /** Optional Stripe Tax line references (defaults to positional `item_<i>`). */
  itemReferences?: string[];
  orderId?: string;
}): Promise<ExpectedTaxResult> {
  const lineCents = args.lineCents.map((c) => Math.max(0, Math.round(c)));
  const shippingCents = Math.max(0, Math.round(args.shippingCents));
  const goodsCents = lineCents.reduce((sum, c) => sum + c, 0);
  if (args.taxCodes.length !== lineCents.length || args.taxCodes.some((code) => !STRIPE_TAX_CODE.test(code))) {
    throw new Error('Every checkout line must have an explicit valid Stripe tax code');
  }

  // No usable address → can't key a jurisdiction. Apply the launch fallback
  // policy to discounted goods only (shipping is excluded).
  if (!hasUsableTaxAddress(args.shippingAddress)) {
    logTaxFallback('no_address', args.shippingAddress, args.orderId);
    return { taxCents: fallbackTaxCents(goodsCents, args.shippingAddress?.region), calculatedBy: 'fallback', fallbackReason: 'no_address' };
  }

  // Stripe unconfigured in this runtime → the fallback IS the behavior, but it
  // means every order mischarges; surface it as a distinct reason so `/api/tax`
  // can log/flag it loudly (mirrors its existing not-configured branch).
  if (!isStripeConfigured()) {
    logTaxFallback('not_configured', args.shippingAddress, args.orderId);
    return { taxCents: fallbackTaxCents(goodsCents, args.shippingAddress?.region), calculatedBy: 'fallback', fallbackReason: 'not_configured' };
  }

  const address = args.shippingAddress as Address;
  try {
    const calculationParams: any = {
      currency: 'usd',
      // Amounts are already cents (Stripe's smallest unit) — no dollar conversion.
      line_items: lineCents.map((amount, i) => ({
        amount,
        reference: args.itemReferences?.[i] ?? `item_${i}`,
        tax_code: args.taxCodes[i],
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
        tax_code: SHIPPING_TAX_CODE,
      };
    }

    const calculation = await stripeCalculateTax(calculationParams);
    // `tax_amount_exclusive` is already in cents.
    const taxCents = Math.max(0, Math.round((calculation as any).tax_amount_exclusive || 0));
    return { taxCents, calculatedBy: 'stripe' };
  } catch {
    // Transient Stripe Tax failure — degrade to the flat rate rather than wedge
    // checkout. Log the underlying error here (both callers share this seam) so
    // it stays diagnosable from `wrangler tail`.
    logTaxFallback('stripe_error', args.shippingAddress, args.orderId);
    return { taxCents: fallbackTaxCents(goodsCents, args.shippingAddress?.region), calculatedBy: 'fallback', fallbackReason: 'stripe_error' };
  }
}

export interface ExpectedChargeExtras {
  /** Catalog goods subtotal (cents). */
  goodsCents: number;
  /** Server-resolved discount allocated across tax lines (cents). */
  discountCents: number;
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
 * derives deterministic shipping, and computes Stripe Tax with explicit tax codes.
 * Shared by `/api/payment-intent` (fold into the floor, then persist) and the
 * pending-order persistence fallback so both agree on one set of figures.
 */
export async function computeExpectedChargeExtras(
  items: Array<{ product_id?: string; variant_id?: string; quantity?: number }>,
  shippingAddress?: Address | null,
  discountCodes?: string[],
  orderId?: string
): Promise<ExpectedChargeExtras> {
  const taxLines = await computeDiscountedCatalogTaxLines(items, discountCodes);
  const { priceable, lineCents } = taxLines;
  const goodsCents = taxLines.grossGoodsCents;

  // An unpriceable cart has no authoritative goods base; don't spend a Stripe
  // Tax call on figures the caller will reject anyway.
  if (!priceable) {
    return { goodsCents, discountCents: 0, shippingCents: 0, taxCents: 0, taxCalculatedBy: 'fallback', priceable: false };
  }

  // Shipping floor = the cheapest enabled storefront method (settings-based, same
  // seam `/api/shipping-options` quotes) so the floor matches what the customer
  // was actually charged; tax is computed on goods + that minimum shipping so the
  // tax floor never exceeds what an honest customer paid (BMC-201).
  const shippingCents = await computeShippingFloorCents(goodsCents);
  const tax = await computeExpectedTaxCents({ lineCents, taxCodes: taxLines.taxCodes, shippingAddress, shippingCents, orderId });
  return {
    goodsCents,
    discountCents: taxLines.discountCents,
    shippingCents,
    taxCents: tax.taxCents,
    taxCalculatedBy: tax.calculatedBy,
    priceable: true,
  };
}

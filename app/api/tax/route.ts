/**
 * === Tax Calculation API ===
 *
 * Real-time tax calculation using Stripe Tax for accurate US sales tax
 * computation based on customer location and product types.
 *
 * === Features ===
 * - **Stripe Tax Integration**: Accurate tax rates for all US jurisdictions
 * - **Real-time Calculation**: Live tax computation during checkout
 * - **Product Tax Codes**: Support for different product tax classifications
 * - **Address Validation**: Location-based tax determination
 * - **Fallback Handling**: Graceful degradation if Stripe Tax fails
 *
 * === Request Format ===
 * ```json
 * {
 *   "items": [CartItem[]],
 *   "shippingAddress": Address,
 *   "shippingCost": number
 * }
 * ```
 *
 * === Response Format ===
 * ```json
 * {
 *   "amount": number,
 *   "breakdown": TaxBreakdown,
 *   "calculated_by": "stripe" | "fallback"
 * }
 * ```
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { CartItem } from "@/lib/types/cartitem";
import type { Address } from "@/lib/types";
import { calculateTax, formatAmountForStripe, formatAmountFromStripe, isStripeConfigured } from "@/lib/stripe";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { computeCatalogLineCents } from "@/lib/services/order-pricing";

// Fallback tax rate applied when Stripe Tax cannot be used (BMC-187).
//
// This flat rate is a DEGRADED path, not the intended behavior. It is applied
// whenever: (a) no usable shipping address is present, (b) the Stripe Tax call
// errors, or (c) Stripe is not configured in this runtime. It taxes the same
// base as the real Stripe path — `subtotal + shippingCost` — so the two paths
// agree on what is taxable; only the rate differs.
//
// At scale a flat rate mischarges every order (it ignores nexus, jurisdiction,
// and product tax codes). The correct state for production is that this path is
// NEVER hit: Stripe Tax must be enabled with registrations/nexus configured in
// the LIVE Stripe account before go-live. That is an explicit cutover step —
// see PRODUCTION-CUTOVER-RUNBOOK.md §1 (Stripe Tax). A config miss is logged
// loudly below (not silent) precisely because it means all orders mischarge.
const FALLBACK_TAX_RATE = 0.07;

// Upper bound on cart line items per request. This endpoint is public and each
// call can hit the billable Stripe Tax API, so cap the work an anonymous caller
// can request (BMC-180). A real cart never approaches this.
const MAX_TAX_LINE_ITEMS = 100;

/**
 * Fallback tax on a taxable base (dollars), rounded to whole cents so the
 * response never carries >2 decimals of float drift. The Stripe path already
 * returns cent-clean dollars via `formatAmountFromStripe`; computing the
 * fallback the same way (dollars → cents → round → dollars) keeps the two paths
 * consistent and makes `total = subtotal + shipping + tax` exact (BMC-187).
 */
function fallbackTaxAmount(taxableAmount: number): number {
  const taxCents = Math.round(formatAmountForStripe(taxableAmount) * FALLBACK_TAX_RATE);
  return formatAmountFromStripe(taxCents);
}

interface TaxRequest {
  items: CartItem[];
  shippingAddress?: Address;
  shippingCost?: number;
}

interface TaxBreakdown {
  subtotal: number;
  shippingCost: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
}

export async function POST(req: NextRequest) {
  try {
    // Public + billable (Stripe Tax). Throttle per IP before doing any work.
    const limited = await enforceRateLimit("PUBLIC_RATE_LIMITER", `tax:${getClientIp(req)}`);
    if (limited) return limited;

    const { items, shippingAddress, shippingCost: rawShippingCost }: TaxRequest = await req.json();

    // `shippingCost` is client-supplied and gets ADDED into the taxable base, so
    // a negative or non-finite value could zero out (or invert) the tax — the
    // same "don't trust client tax inputs" hole BMC-200 closes for `item.price`,
    // via a sibling parameter. Clamp to a finite, non-negative amount. (Shipping
    // shown here is an estimate; the authoritative charge floor lives at
    // payment-intent / order creation.)
    const shippingCost =
      typeof rawShippingCost === "number" && Number.isFinite(rawShippingCost) && rawShippingCost > 0
        ? rawShippingCost
        : 0;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items in cart" }, { status: 400 });
    }

    if (items.length > MAX_TAX_LINE_ITEMS) {
      return NextResponse.json(
        { error: `Too many line items (max ${MAX_TAX_LINE_ITEMS})` },
        { status: 400 }
      );
    }

    // Derive the taxable goods base from the D1 catalog (`product_variants.price`),
    // NEVER the client-supplied `item.price` (BMC-200). The old code summed
    // `item.price * item.quantity` from the request body in both paths, so a
    // tampered price could under-report the taxable amount and under-collect
    // sales tax. We recompute each line's amount from the catalog (cents) using
    // the same seam the charge gate / free-shipping check use. Any unpriceable
    // line means we cannot compute an authoritative base, so we FAIL CLOSED with
    // an error rather than tax a client-controlled (or silently undercounted)
    // amount — the same cart is rejected downstream by the charge gate anyway.
    let catalogLines;
    try {
      catalogLines = await computeCatalogLineCents(
        items.map((item) => ({
          product_id: item.productId,
          variant_id: item.variantId,
          quantity: item.quantity,
        }))
      );
    } catch (pricingErr) {
      // A THROWN catalog read (e.g. a transient D1 error/timeout) is an infra
      // failure, not a malformed request — without this it would fall through to
      // the outer catch and be mislabelled `400 "Invalid request body"`, which
      // is wrong for monitoring and useless to the shopper (retrying with a
      // "fixed" body won't help). Fail closed with a distinct 503 they can retry.
      // (Unpriceable/tampered lines return `{error}` instead — handled as 422
      // just below — so this branch is only reached for genuine read failures.)
      console.error("[tax] catalog pricing read failed:", pricingErr);
      return NextResponse.json(
        { error: "Unable to price cart for tax calculation, please try again" },
        { status: 503 }
      );
    }
    const pricingErrors = catalogLines.flatMap((line) =>
      "error" in line ? [line.error] : []
    );
    if (pricingErrors.length) {
      console.warn(`[tax] catalog pricing errors — ${pricingErrors.join("; ")}`);
      return NextResponse.json(
        { error: "Unable to price cart from catalog for tax calculation" },
        { status: 422 }
      );
    }

    // Per-line taxable amounts in cents (catalog truth), and the goods subtotal
    // in dollars for the response contract (`/api/tax` speaks major-unit dollars
    // to the client — see CheckoutClient's `cartItemsToMajorUnits` bridge).
    const lineCents = catalogLines.map((line) => ("cents" in line ? line.cents : 0));
    const subtotalCents = lineCents.reduce((sum, cents) => sum + cents, 0);
    const subtotal = formatAmountFromStripe(subtotalCents);

    // If no shipping address provided, use fallback calculation. Tax the same
    // base the Stripe path taxes (`subtotal + shippingCost`) so the fallback and
    // real paths stay consistent (BMC-187).
    if (!shippingAddress || !shippingAddress.region || !shippingAddress.postal_code) {
      const taxableAmount = subtotal + shippingCost;
      const amount = fallbackTaxAmount(taxableAmount);
      const breakdown: TaxBreakdown = {
        subtotal,
        shippingCost,
        taxableAmount,
        taxAmount: amount,
        total: subtotal + shippingCost + amount,
      };

      return NextResponse.json({ 
        amount, 
        breakdown,
        calculated_by: "fallback",
        message: "Using fallback tax rate - provide shipping address for accurate calculation"
      });
    }

    try {
      // Use Stripe Tax for accurate calculation. Line amounts come from the
      // catalog (`lineCents`), not `item.price` (BMC-200).
      const taxAmount = await calculateStripeToleratedTax(
        items.map((item, index) => ({
          amountCents: lineCents[index],
          reference: `item_${index}_${item.productId}`,
        })),
        shippingAddress,
        shippingCost
      );
      
      const breakdown: TaxBreakdown = {
        subtotal,
        shippingCost,
        taxableAmount: subtotal + shippingCost,
        taxAmount,
        total: subtotal + shippingCost + taxAmount,
      };

      return NextResponse.json({ 
        amount: taxAmount, 
        breakdown,
        calculated_by: "stripe"
      });

    } catch (stripeError) {
      // Distinguish a *configuration* problem (no secret key in this runtime)
      // from a transient Stripe outage. The fallback rate is a reasonable
      // degradation for an outage, but a missing key means EVERY order is
      // charged a flat FALLBACK_TAX_RATE with no accurate tax — that must be
      // loud, not silent (it's what masked the checkout payment-intent failure).
      if (!isStripeConfigured()) {
        console.error(
          "[tax] STRIPE_SECRET_KEY not configured — charging flat fallback tax " +
            `rate (${FALLBACK_TAX_RATE * 100}%) for ALL orders. Set it in ` +
            "`.dev.vars` for `wrangler dev`, or `wrangler secret put " +
            "STRIPE_SECRET_KEY --env <env>` for deployed envs."
        );
      } else {
        console.error("Stripe Tax calculation failed (using fallback rate):", stripeError);
      }

      // Fall back to simple calculation. Tax `subtotal + shippingCost` to match
      // the Stripe path's taxable base (BMC-187).
      const taxableAmount = subtotal + shippingCost;
      const amount = fallbackTaxAmount(taxableAmount);
      const breakdown: TaxBreakdown = {
        subtotal,
        shippingCost,
        taxableAmount,
        taxAmount: amount,
        total: subtotal + shippingCost + amount,
      };

      return NextResponse.json({
        amount,
        breakdown,
        calculated_by: "fallback",
        // Flag config problems distinctly so the client/monitoring can tell a
        // "Stripe is down" fallback from a "Stripe was never wired up" one.
        error: isStripeConfigured()
          ? "Stripe Tax unavailable, using fallback rate"
          : "Stripe Tax not configured, using fallback rate",
      });
    }

  } catch (err) {
    console.error("Tax calculation error:", err);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

/**
 * Calculate tax using Stripe Tax API
 * Provides accurate tax calculation based on customer location.
 *
 * Line amounts are the catalog-derived taxable amounts (cents), passed in by the
 * caller — never `item.price` from the request body (BMC-200).
 */
async function calculateStripeToleratedTax(
  lines: Array<{ amountCents: number; reference: string }>,
  shippingAddress: Address,
  shippingCost: number
): Promise<number> {
  // Build line items for Stripe Tax calculation (products only). Amounts are
  // already in cents (Stripe's smallest currency unit), so no dollar conversion.
  const lineItems = lines.map((line) => ({
    amount: line.amountCents,
    reference: line.reference,
    tax_code: 'txcd_99999999', // General - Tangible Goods
  }));

  // Build the calculation parameters
  const calculationParams: any = {
    currency: 'usd',
    line_items: lineItems,
    customer_details: {
      address: {
        line1: String(shippingAddress.line1),
        city: String(shippingAddress.city),
        state: String(shippingAddress.region),
        postal_code: String(shippingAddress.postal_code),
        country: 'US',
      },
      address_source: 'shipping',
    },
    expand: ['line_items.data.tax_breakdown'],
  };

  // Add shipping cost as a parameter (not as a line item)
  if (shippingCost > 0) {
    calculationParams.shipping_cost = {
      amount: formatAmountForStripe(shippingCost),
      tax_code: 'txcd_92010001', // Shipping tax code
    };
  }

  // Create tax calculation with Stripe
  const calculation = await calculateTax(calculationParams);

  // Sum up all tax amounts
  const totalTaxAmount = (calculation as any).tax_amount_exclusive || 0;
  
  return formatAmountFromStripe(totalTaxAmount);
}

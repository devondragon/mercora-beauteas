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
import { formatAmountForStripe, formatAmountFromStripe } from "@/lib/stripe";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { computeCatalogLineCents } from "@/lib/services/order-pricing";
import { computeExpectedTaxCents, FALLBACK_TAX_RATE } from "@/lib/services/checkout-charges";

// The Stripe-Tax-vs-fallback decision and the flat FALLBACK_TAX_RATE now live in
// the shared `checkout-charges` seam (BMC-201) so the tax quoted here and the tax
// ENFORCED at the charge floor are computed by one function — see its header for
// why the flat fallback is a degraded, cutover-blocking path. This route only
// imports the rate for its loud "not configured" log below.

// Upper bound on cart line items per request. This endpoint is public and each
// call can hit the billable Stripe Tax API, so cap the work an anonymous caller
// can request (BMC-180). A real cart never approaches this.
const MAX_TAX_LINE_ITEMS = 100;

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

    // Delegate the tax NUMBER to the shared checkout-charges seam (BMC-201), the
    // SAME function `/api/payment-intent` uses to compute the enforced floor — so
    // the tax quoted here and the tax enforced at capture are computed identically
    // and can't drift. It handles the Stripe-Tax-vs-fallback decision internally
    // (no usable address / Stripe error / Stripe unconfigured → flat rate) on the
    // same `subtotal + shippingCost` base (BMC-187/BMC-200). This route keeps its
    // own catalog pricing above for the distinct 422/503 semantics and speaks
    // major-unit dollars to the client, so it converts cents at the boundary.
    const taxResult = await computeExpectedTaxCents({
      lineCents,
      shippingAddress,
      // `/api/tax` taxes the CLIENT's shipping estimate (dollars → cents); the
      // authoritative floor recomputes shipping server-side. Same seam, different
      // shipping input — an understated shipping estimate is caught at the floor.
      shippingCents: formatAmountForStripe(shippingCost),
    });
    const taxAmount = formatAmountFromStripe(taxResult.taxCents);
    const taxableAmount = subtotal + shippingCost;
    const breakdown: TaxBreakdown = {
      subtotal,
      shippingCost,
      taxableAmount,
      taxAmount,
      total: subtotal + shippingCost + taxAmount,
    };

    if (taxResult.calculatedBy === "stripe") {
      return NextResponse.json({ amount: taxAmount, breakdown, calculated_by: "stripe" });
    }

    // No usable shipping address → tell the shopper accurate tax needs one.
    if (taxResult.fallbackReason === "no_address") {
      return NextResponse.json({
        amount: taxAmount,
        breakdown,
        calculated_by: "fallback",
        message: "Using fallback tax rate - provide shipping address for accurate calculation",
      });
    }

    // Stripe Tax unavailable. A missing secret key means EVERY order is charged a
    // flat FALLBACK_TAX_RATE with no accurate tax — that must be loud, not silent.
    if (taxResult.fallbackReason === "not_configured") {
      console.error(
        "[tax] STRIPE_SECRET_KEY not configured — charging flat fallback tax " +
          `rate (${FALLBACK_TAX_RATE * 100}%) for ALL orders. Set it in ` +
          "`.dev.vars` for `wrangler dev`, or `wrangler secret put " +
          "STRIPE_SECRET_KEY --env <env>` for deployed envs."
      );
    }
    return NextResponse.json({
      amount: taxAmount,
      breakdown,
      calculated_by: "fallback",
      // Flag config problems distinctly so the client/monitoring can tell a
      // "Stripe is down" fallback from a "Stripe was never wired up" one.
      error:
        taxResult.fallbackReason === "not_configured"
          ? "Stripe Tax not configured, using fallback rate"
          : "Stripe Tax unavailable, using fallback rate",
    });
  } catch (err) {
    console.error("Tax calculation error:", err);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

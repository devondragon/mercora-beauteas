import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Address } from "@/lib/types";
import type { CartItem } from "@/lib/types/cartitem";
import { computeCatalogSubtotalCents, MAX_ORDER_LINE_ITEMS } from "@/lib/services/order-pricing";
import { resolveShippingOptions } from "@/lib/services/checkout-charges";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Public and now catalog-backed: the free-shipping check below does one D1
    // read per cart line, so throttle per IP before doing any work — same guard
    // the tax / payment-intent endpoints use (BMC-180). Fails open when the
    // binding is absent (plain `next dev`).
    const limited = await enforceRateLimit("PUBLIC_RATE_LIMITER", `shipping-options:${getClientIp(req)}`);
    if (limited) return limited;

    const { address, items }: { address: Address; items: CartItem[] } =
      await req.json();

    if (!address || !address.postal_code) {
      return NextResponse.json(
        { error: "Missing address data" },
        { status: 400 }
      );
    }

    if (address.country !== "US") {
      return NextResponse.json(
        { error: "Shipping options only available for US addresses" },
        { status: 400 }
      );
    }

    const lineItems = Array.isArray(items) ? items : [];

    // One catalog read per line drives the free-shipping check below, so cap the
    // line count an anonymous caller can request (mirrors the payment-intent /
    // tax endpoints — a real cart never approaches this).
    if (lineItems.length > MAX_ORDER_LINE_ITEMS) {
      return NextResponse.json(
        { error: `Too many line items (max ${MAX_ORDER_LINE_ITEMS})` },
        { status: 400 }
      );
    }

    // Recompute the catalog subtotal (free-shipping eligibility, BMC-187): the
    // subtotal is derived from the D1 catalog (`product_variants.price`), NEVER the
    // client-supplied `item.price` — the old code trusted `item.price`, so a
    // tampered cart could inflate its total past the threshold and get free
    // shipping it hadn't paid for. A non-empty `errors` means at least one line
    // couldn't be priced authoritatively, so we fail CLOSED (no free shipping).
    const { subtotalCents, errors } = await computeCatalogSubtotalCents(
      lineItems.map((item) => ({
        product_id: item?.productId,
        variant_id: item?.variantId,
        quantity: item?.quantity,
      }))
    );
    if (errors.length) {
      console.warn(`[shipping-options] catalog pricing errors — ${errors.join('; ')}`);
    }

    // Resolve options through the SHARED settings-based seam (BMC-201) — the SAME
    // function the charge floor (`computeShippingFloorCents`) uses, so the quote a
    // customer sees here can never diverge from what the floor enforces. Flat-rate,
    // weight-agnostic shipping remains an intentional launch decision (BMC-187):
    // rates come from admin-configured flat methods and don't factor in weight.
    const { options } = await resolveShippingOptions(subtotalCents, {
      subtotalPriceable: errors.length === 0,
    });

    return NextResponse.json({ options });

  } catch (error) {
    console.error('Error fetching shipping options:', error);
    return NextResponse.json(
      { error: "Failed to load shipping options" },
      { status: 500 }
    );
  }
}

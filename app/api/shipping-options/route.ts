import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Address } from "@/lib/types";
import type { ShippingOption } from "@/lib/types/shipping";
import type { CartItem } from "@/lib/types/cartitem";
import { getSettings } from "@/lib/utils/settings";
import { computeCatalogSubtotalCents, MAX_ORDER_LINE_ITEMS } from "@/lib/services/order-pricing";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { Money } from "@/lib/money";

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

    // Load shipping settings and recompute the catalog subtotal concurrently —
    // they have no data dependency, and this route now does a D1 read per cart
    // line, so overlapping them shaves latency off a heavier public endpoint.
    // Free-shipping eligibility (BMC-187): the subtotal is derived from the D1
    // catalog (`product_variants.price`), NEVER the client-supplied `item.price`.
    // The old code trusted `item.price`, so a tampered cart could inflate its
    // total past the threshold and get free shipping it hadn't paid for. A
    // non-empty `errors` means at least one line couldn't be priced
    // authoritatively, so we fail CLOSED (no free shipping) rather than grant the
    // perk on an unverifiable cart. Shipping shown here is an estimate; the
    // authoritative charge gate still lives in payment-intent / order creation.
    const [shippingSettings, storeSettings, { subtotalCents, errors }] = await Promise.all([
      getSettings('shipping'),
      getSettings('store'),
      computeCatalogSubtotalCents(
        lineItems.map((item) => ({
          product_id: item?.productId,
          variant_id: item?.variantId,
          quantity: item?.quantity,
        }))
      ),
    ]);
    if (errors.length) {
      console.warn(`[shipping-options] catalog pricing errors — ${errors.join('; ')}`);
    }

    // Get configured shipping methods.
    //
    // Flat-rate, weight-agnostic shipping is an INTENTIONAL launch decision
    // (BMC-187): rates come from admin-configured flat methods and do not factor
    // in item weight. BeauTeas ships light, low-variance tea/skincare SKUs, so
    // per-weight rating adds carrier-integration complexity for negligible margin
    // benefit at this catalog. Revisit if the catalog gains heavy or bulky items.
    let shippingMethods = shippingSettings['shipping.methods'] || [
      { id: 'standard', label: 'Standard (5–7 days)', cost: 5.99, estimatedDays: 5, enabled: true },
      { id: 'express', label: 'Express (2–3 days)', cost: 9.99, estimatedDays: 2, enabled: true },
      { id: 'overnight', label: 'Overnight', cost: 19.99, estimatedDays: 1, enabled: true }
    ];

    // Filter to only enabled methods
    const enabledMethods = shippingMethods.filter((method: any) => method.enabled);

    const freeShippingThreshold = storeSettings['store.free_shipping_threshold'] || 75;
    // Compare like-for-like via Money (threshold is stored in major units / dollars,
    // the catalog subtotal in minor units / cents) rather than a raw *100 — see
    // CLAUDE.md Money & Pricing.
    const qualifiesForFreeShipping =
      errors.length === 0 &&
      Money.fromMinor(subtotalCents).gte(Money.fromMajor(freeShippingThreshold));
    const freeShippingMethods = shippingSettings['shipping.free_methods'] || ['standard'];

    // Apply free shipping logic if order meets threshold
    const shippingOptions: ShippingOption[] = enabledMethods.map((method: any) => ({
      id: method.id,
      label: method.label,
      cost: (qualifiesForFreeShipping && freeShippingMethods.includes(method.id))
        ? 0
        : method.cost,
      estimatedDays: method.estimatedDays,
    }));

    return NextResponse.json({ options: shippingOptions });

  } catch (error) {
    console.error('Error fetching shipping options:', error);
    return NextResponse.json(
      { error: "Failed to load shipping options" },
      { status: 500 }
    );
  }
}

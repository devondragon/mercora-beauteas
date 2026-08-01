/**
 * === Guest order-status projection (BMC-216E) ===
 *
 * THE ALLOWLIST for what a `/order-status/<id>?token=…` bearer token exposes.
 * The guest page renders from this object and nothing else, so "could a guest
 * link leak the shipping address?" is a property of this pure function — see
 * tests/unit/lib/order-status/guest-projection.test.ts, which asserts the
 * forbidden fields are structurally absent rather than merely unrendered.
 *
 * Deliberately excluded (spec "Customer Order Status → Guest Customers"):
 * totals/Money, shipping + billing address, payment method / PaymentIntent id,
 * internal notes, extensions, admin audit history, refund ledger.
 *
 * Shipment fields come from the shared buildShipmentView helper
 * (lib/fulfillment/shipment-view.ts), which reads the `orders.shipping_carrier`
 * COLUMN only — see that module for why `extensions.carrier` /
 * `extensions.trackingUrl` are never consulted.
 * Pure module — no D1/Next/Clerk/Resend imports.
 */
import { buildShipmentView } from "@/lib/fulfillment/shipment-view";
import type { Carrier } from "@/lib/fulfillment/types";

export interface GuestOrderProjectionItem {
  name: string;
  quantity: number;
}

export interface GuestOrderProjection {
  orderNumber: string;
  placedAt: string | null;
  status: string;
  shippedAt: string | null;
  carrier: Carrier | null;
  carrierLabel: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  items: GuestOrderProjectionItem[];
}

/**
 * Structural input shape — an `Order` satisfies it, but typing the parameter
 * structurally keeps this module free of the model layer AND makes the test
 * fixtures honest (they can carry every forbidden field an Order carries).
 *
 * Deliberately NO `[key: string]: unknown` index signature: `Order` is an
 * interface, and TypeScript grants an implicit index signature only to types
 * originating in object literals — so an index signature here would make the
 * real call site (`buildGuestOrderProjection(order)` in the guest page) fail to
 * compile. Extra fields on the row are ignored by construction instead: the
 * body reads only the named fields below and builds a fresh object, so a
 * forbidden field cannot reach the output even by accident.
 */
export interface GuestProjectionOrder {
  id?: string | null;
  created_at?: string | null;
  status: string;
  shipped_at?: string | null;
  shipping_carrier?: string | null;
  tracking_number?: string | null;
  items?: Array<{ product_name?: string; quantity?: number }> | null;
}

export function buildGuestOrderProjection(order: GuestProjectionOrder): GuestOrderProjection {
  // Shared derivation (BMC-240): normalization, label lookup, tracking-number
  // sanitization and URL construction all live in buildShipmentView — see its
  // module docs for why sanitization is non-negotiable on this bearer-token
  // page a stranger with the link can load.
  const shipment = buildShipmentView(order);
  const items = Array.isArray(order.items) ? order.items : [];

  return {
    orderNumber: order.id ?? "",
    placedAt: order.created_at ?? null,
    status: order.status,
    shippedAt: order.shipped_at ?? null,
    carrier: shipment.carrier,
    carrierLabel: shipment.carrierLabel,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    items: items.map((item) => ({
      name: typeof item?.product_name === "string" ? item.product_name : "Item",
      quantity: typeof item?.quantity === "number" ? item.quantity : 1,
    })),
  };
}

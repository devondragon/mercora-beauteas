// lib/fulfillment/shipment-view.ts
//
// Shared customer-facing shipment derivation (BMC-240). Pure — imports nothing
// from D1/Next/Clerk/Resend, so it runs in the plain Vitest pool and in every
// runtime. Both the guest order-status projection and the account order page
// previously inlined this exact four-step pipeline with duplicated comments;
// it now lives once, here.
//
// Carrier is read from the `orders.shipping_carrier` COLUMN only — migration
// 0022 backfilled it. Consumers never read extensions.carrier /
// extensions.trackingUrl: a stored, client-supplied URL is an open-redirect
// vector, so the link is always DERIVED from (carrier, trackingNumber) via
// buildTrackingUrl. normalizeLegacyCarrier is defensive for any row that
// escaped the backfill.

import { buildTrackingUrl, normalizeLegacyCarrier, sanitizeTrackingNumber } from "./tracking";
import { CARRIER_LABELS, type Carrier } from "./types";

export interface ShipmentView {
  carrier: Carrier | null;
  carrierLabel: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

/**
 * Derive the customer-facing shipment fields from an order row's raw columns.
 *
 * The tracking number is sanitized before both rendering and URL-building:
 * only the new fulfillment write path enforces sanitizeTrackingNumber, so a
 * legacy row can still carry bidi/invisible characters — these render on
 * customer-facing pages (including the bearer-token guest page a stranger
 * with the link can load), so an unsanitized value must never escape.
 * Over-length input nulls out rather than truncating (see
 * sanitizeTrackingNumber), and an unlinkable carrier ("other"/null) yields a
 * null trackingUrl while keeping the number for display.
 */
export function buildShipmentView(order: {
  shipping_carrier?: string | null;
  tracking_number?: string | null;
}): ShipmentView {
  const carrier = normalizeLegacyCarrier(order.shipping_carrier ?? null);
  const trackingNumber = sanitizeTrackingNumber(order.tracking_number ?? null);
  return {
    carrier,
    carrierLabel: carrier ? CARRIER_LABELS[carrier] : null,
    trackingNumber,
    trackingUrl: buildTrackingUrl(carrier, trackingNumber),
  };
}

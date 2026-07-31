// lib/fulfillment/transitions.ts
//
// The fulfillment transition matrix (BMC-216), kept pure so it is unit-testable
// without D1/Next/Clerk/Resend. The service layer (ticket B) performs the
// guarded D1 write; this module decides what the write SHOULD be and what a
// zero-row CAS means after a re-read.

import { CARRIERS, type ShipmentInput } from "./types";
import {
  MAX_TRACKING_LENGTH,
  normalizeCarrier,
  normalizeLegacyCarrier,
  sanitizeTrackingNumber,
} from "./tracking";

/** The only order fields the transition rules are allowed to look at. */
export interface OrderFulfillmentSnapshot {
  status: string;
  payment_status: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
}

/** A key counts as "supplied" only when it is present and not null/empty. */
function isSupplied(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

/**
 * Parse and validate a request body into a ShipmentInput. Carrier and tracking
 * are optional as a PAIR: both absent is a valid untracked shipment, but one
 * without the other is invalid. Unknown keys (status, shipped_at, trackingUrl)
 * are ignored — those are server-owned.
 */
export function parseShipmentInput(
  body: unknown,
): { ok: true; input: ShipmentInput } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const raw = body as Record<string, unknown>;
  const hasCarrier = isSupplied(raw.carrier);
  const hasTracking = isSupplied(raw.trackingNumber);

  if (!hasCarrier && !hasTracking) {
    return { ok: true, input: { carrier: null, trackingNumber: null } };
  }
  if (!hasCarrier) {
    return { ok: false, error: "trackingNumber requires a carrier" };
  }
  if (!hasTracking) {
    return { ok: false, error: "carrier requires a trackingNumber" };
  }

  const carrier = normalizeCarrier(raw.carrier);
  if (!carrier) {
    // Derived from CARRIERS so adding a carrier cannot leave this message stale.
    return { ok: false, error: `Unknown carrier; expected one of: ${CARRIERS.join(", ")}` };
  }

  const trackingNumber = sanitizeTrackingNumber(raw.trackingNumber);
  if (!trackingNumber) {
    return {
      ok: false,
      error: `Invalid trackingNumber (must be 1-${MAX_TRACKING_LENGTH} alphanumeric/hyphen characters after stripping non-allowlist characters)`,
    };
  }

  return { ok: true, input: { carrier, trackingNumber } };
}

/** Carrier compared exactly; tracking number compared case-insensitively. */
export function shipmentDataEqual(a: ShipmentInput, b: ShipmentInput): boolean {
  if (a.carrier !== b.carrier) return false;
  const at = a.trackingNumber === null ? null : a.trackingNumber.toUpperCase();
  const bt = b.trackingNumber === null ? null : b.trackingNumber.toUpperCase();
  return at === bt;
}

export type ShipDecision =
  | { kind: "ship" }
  | { kind: "idempotent" }
  | { kind: "conflict" }
  | { kind: "not_fulfillable"; status: string; paymentStatus: string | null };

/**
 * processing + paid  -> ship
 * shipped            -> idempotent (identical data) or conflict
 * everything else    -> not_fulfillable (status/paymentStatus returned so the
 *                       admin UI can say WHY rather than "409")
 *
 * The stored carrier is run through normalizeLegacyCarrier so a pre-migration
 * value like "UPS Ground" compares equal to a fresh "ups" retry.
 */
export function decideShipment(
  order: OrderFulfillmentSnapshot,
  input: ShipmentInput,
): ShipDecision {
  if (order.status === "shipped") {
    const stored: ShipmentInput = {
      carrier: normalizeLegacyCarrier(order.shipping_carrier),
      trackingNumber: sanitizeTrackingNumber(order.tracking_number),
    };
    return shipmentDataEqual(stored, input) ? { kind: "idempotent" } : { kind: "conflict" };
  }

  if (order.status === "processing" && order.payment_status === "paid") {
    return { kind: "ship" };
  }

  return {
    kind: "not_fulfillable",
    status: order.status,
    paymentStatus: order.payment_status,
  };
}

/** Tracking correction is allowed only on an already-shipped order. */
export function canEditTracking(order: OrderFulfillmentSnapshot): boolean {
  return order.status === "shipped";
}

// lib/fulfillment/types.ts
//
// Shared fulfillment vocabulary (BMC-216). Pure declarations — no D1, Next,
// Clerk, or Resend imports, so every other fulfillment module (including the
// migration-mirroring tracking rules) can depend on this from any runtime.

/**
 * Application-level carrier values. `other` means "we recorded a carrier we
 * cannot deep-link" — it renders as a bare tracking number with no link.
 */
export const CARRIERS = ["ups", "fedex", "other"] as const;
export type Carrier = (typeof CARRIERS)[number];

/** Fulfillment audit event types written to `order_events`. */
export const ORDER_EVENT_TYPES = [
  "shipment_created",
  "tracking_updated",
  "shipping_email_sent",
  "shipping_email_failed",
  "shipping_email_resent",
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export type ActorType = "admin" | "service" | "system";

export interface Actor {
  type: ActorType;
  /** Clerk user ID, "api-token" for ADMIN_VECTORIZE_TOKEN, null for system. */
  id: string | null;
}

/** Normalized, already-validated shipment payload. */
export interface ShipmentInput {
  carrier: Carrier | null;
  /** Sanitized tracking number; null means an untracked shipment. */
  trackingNumber: string | null;
}

// lib/fulfillment/shipping-email.ts
//
// The B↔C seam (BMC-216). Ticket B ships the stub so the ship route compiles
// and returns a truthful `email` result with no email infrastructure wired up;
// ticket C replaces THIS BODY with the real send.

import type { Order } from "@/lib/types/order";
import type { Actor } from "./types";

export interface InitialShippingEmailResult {
  attempted: boolean;
  success: boolean;
  error?: string;
  eventId?: string; // shipping_email_sent / shipping_email_failed event
}

/**
 * STUB — BMC-216B ships this seam so the ship route compiles and returns a
 * truthful `email` result. Ticket BMC-216C replaces THIS BODY (the signature is
 * pinned by the interface contract) with the real build-data + Resend send +
 * recordEmailEvent audit write.
 *
 * Contract: never throws — an email failure must never look like a shipment
 * failure, because the shipment is already committed by the time this runs.
 */
export async function sendInitialShippingEmail(
  _order: Order,
  _actor: Actor,
): Promise<InitialShippingEmailResult> {
  return { attempted: false, success: false };
}

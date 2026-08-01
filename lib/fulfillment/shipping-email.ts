/**
 * Shipping-email orchestration (BMC-216C).
 *
 * Sits between the fulfillment service (which owns order state) and the email
 * transformer in lib/utils/email.ts (which owns rendering). Its whole job is
 * to turn a shipped Order into a ShippingConfirmationData, send it under a
 * deterministic idempotency key, and append the resulting audit event.
 *
 * CONTRACT: this is a BEST-EFFORT SIDE EFFECT called AFTER the shipment has
 * already committed. It never throws and never writes order state — an email
 * failure must leave the order shipped, visible, and retryable, not roll a
 * customer's fulfilled order backwards.
 */

import type { Order } from "@/lib/types/order";
import type { Actor } from "./types";
import { normalizeCarrier, buildTrackingUrl, sanitizeTrackingNumber } from "./tracking";
import { recordEmailEvent } from "./service";
import { getOrderCustomerEmail } from "@/lib/orders/customer-email";
import { createOrderStatusToken, isOrderStatusTokenConfigured } from "@/lib/order-status/token";
import { sendShippingConfirmationEmail, type ShippingConfirmationData } from "@/lib/utils/email";
import { BASE_URL } from "@/lib/seo/metadata";
import { logCritical } from "@/lib/utils/observe";

export interface InitialShippingEmailResult {
  attempted: boolean;
  success: boolean;
  error?: string;
  eventId?: string; // shipping_email_sent / shipping_email_failed event
}

/** Matches the template's own cap; keeps the payload a preview, not a manifest. */
const MAX_PREVIEW_ITEMS = 5;

/**
 * Build the customer-facing shipping payload from a persisted order.
 *
 * Returns null when no customer email resolves — with nobody to send to there
 * is nothing to attempt, and (per BMC-216A) a guest status token bound to an
 * empty address would verify for any email-less order.
 *
 * Exported because the admin retry/resend route builds the identical payload;
 * duplicating this derivation is how a resent email drifts from the original.
 */
export async function buildShippingConfirmationData(
  order: Order,
): Promise<ShippingConfirmationData | null> {
  const customerEmail = getOrderCustomerEmail(order);
  if (!customerEmail) return null;

  const orderId = order.id || "";

  // shipping_carrier is the server-owned column (migration 0022). Stored values
  // are already normalized, so the STRICT normalizer is correct here: anything
  // unrecognized is treated as no carrier rather than silently downgraded.
  const carrier = normalizeCarrier(order.shipping_carrier ?? null);

  // sanitizeTrackingNumber, not a bare trim: BMC-230 closed the legacy
  // PUT /api/orders writer, but rows it wrote before that still carry
  // unsanitized values, so this remains the sink its own docstring names for
  // bidi/zero-width characters and unbounded length before the value reaches a
  // customer email.
  const trackingNumber = sanitizeTrackingNumber(order.tracking_number);
  // Derived at the boundary — never read a stored customer-facing URL.
  const trackingUrl = buildTrackingUrl(carrier, trackingNumber);

  let orderStatusUrl: string | null = null;
  if (order.customer_id) {
    orderStatusUrl = `${BASE_URL}/account/orders/${encodeURIComponent(orderId)}`;
  } else if (isOrderStatusTokenConfigured()) {
    const token = await createOrderStatusToken(orderId, customerEmail);
    orderStatusUrl = token
      ? `${BASE_URL}/order-status/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`
      : null;
  }

  const shippingAddress = order.shipping_address as { recipient?: unknown } | undefined;
  const recipient =
    typeof shippingAddress?.recipient === "string" && shippingAddress.recipient.trim()
      ? shippingAddress.recipient.trim()
      : null;

  return {
    orderNumber: orderId,
    customerName: recipient,
    customerEmail,
    items: (order.items ?? []).slice(0, MAX_PREVIEW_ITEMS).map((item) => ({
      name: item.product_name,
      quantity: item.quantity,
    })),
    carrier,
    trackingNumber,
    trackingUrl,
    orderStatusUrl,
  };
}

/**
 * Short, non-cryptographic fingerprint of the exact payload about to be sent.
 * Not for security — only to distinguish "same email, retried" from "the
 * order changed since the last attempt" (see initialShippingEmailKey).
 */
async function digestPayload(data: ShippingConfirmationData): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return Array.from(new Uint8Array(bytes).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Idempotency key for the automatic initial send, and for `retry` (which
 * reuses it deliberately — see the route's doc comment). Folds in a digest of
 * the exact payload, not just the order id.
 *
 * Resend binds an idempotency key to the payload it was first used with for
 * 24h and returns a 409 if the same key is reused with a different body. An
 * order-id-only key would collide across attempts even when the underlying
 * order changed between them (e.g. an operator corrects the tracking number
 * after a failed automatic send, then presses Retry) — the retry would carry
 * a different payload under the OLD key and dead-end on that 409 for the rest
 * of the 24h window, with no operator recourse. Folding the payload into the
 * key keeps two calls with an unchanged payload colliding onto the same key
 * (so Resend's own dedupe still catches a genuine duplicate attempt), while
 * an order that changed between attempts naturally gets a fresh key instead
 * of a false conflict. (BMC-227 review finding.)
 */
export async function initialShippingEmailKey(
  orderId: string,
  data: ShippingConfirmationData,
): Promise<string> {
  const digest = await digestPayload(data);
  return `shipping-confirmation/${orderId}/initial/${digest}`;
}

/**
 * Send the single automatic shipping confirmation for a freshly shipped order
 * and record the outcome in the fulfillment audit trail.
 *
 * Returns `{ attempted: false, success: false }` — with no audit event — when
 * there is nothing to attempt: a non-shipped order (belt-and-braces against a
 * `processing`/`delivered` caller; product decision 7 forbids those emails) or
 * an order with no resolvable customer email.
 */
export async function sendInitialShippingEmail(
  order: Order,
  actor: Actor,
): Promise<InitialShippingEmailResult> {
  let attempted = false;
  const orderId = order.id || "";

  try {
    if (order.status !== "shipped") {
      console.warn(
        `[shipping-email] order ${orderId} is ${order.status}, not shipped; no email sent`,
      );
      return { attempted: false, success: false };
    }

    const data = await buildShippingConfirmationData(order);
    if (!data) {
      console.warn(`[shipping-email] order ${orderId} has no customer email; no email sent`);
      logCritical("email", "shipping_email_no_recipient", { orderId });
      // Still auditable: without this, the history can't distinguish "the
      // sender never ran" from "there was no address" once the ship response
      // is gone. Mirrors the admin route's identical no-recipient branch.
      const eventId = await recordEmailEvent(orderId, "shipping_email_failed", actor, {
        idempotencyKey: `shipping-confirmation/${orderId}/initial/no-recipient`,
        error: "no_customer_email",
      });
      return { attempted: false, success: false, error: "no_customer_email", eventId };
    }

    const idempotencyKey = await initialShippingEmailKey(orderId, data);
    attempted = true;
    const result = await sendShippingConfirmationEmail(data, { idempotencyKey });

    if (result.success) {
      const eventId = await recordEmailEvent(orderId, "shipping_email_sent", actor, {
        idempotencyKey,
      });
      return { attempted: true, success: true, eventId };
    }

    logCritical("email", "shipping_email_send_failed", { orderId }, result.error);
    const eventId = await recordEmailEvent(orderId, "shipping_email_failed", actor, {
      idempotencyKey,
      error: result.error,
    });
    return { attempted: true, success: false, error: result.error, eventId };
  } catch (error) {
    // Swallow by contract: the shipment is already committed and must stay so.
    console.error(`[shipping-email] initial send failed for ${orderId}:`, error);
    logCritical("fulfillment", "shipping_email_seam_threw", { orderId }, error);
    return {
      attempted,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

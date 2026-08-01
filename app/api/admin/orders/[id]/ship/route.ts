import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { shipOrder } from "@/lib/fulfillment/service";
import { sendInitialShippingEmail } from "@/lib/fulfillment/shipping-email";
import { buildTrackingUrl, normalizeCarrier } from "@/lib/fulfillment/tracking";
import { parseShipmentInput } from "@/lib/fulfillment/transitions";
import type { Actor } from "@/lib/fulfillment/types";
import type { Order } from "@/lib/types/order";
import { logCritical } from "@/lib/utils/observe";

/**
 * Derived at the response boundary. This route never stores a tracking URL —
 * it persists only (carrier, trackingNumber) and rebuilds the link on the way
 * out. As of BMC-230 (ticket F) no route stores one: PUT /api/orders rejects
 * top-level tracking-URL keys and strips a client `extensions.trackingUrl`
 * from the merge, so any stored value is a pre-BMC-230 legacy row that nothing
 * renders.
 */
function trackingProjection(order: Order) {
  const carrier = normalizeCarrier(order.shipping_carrier ?? null);
  const trackingNumber = order.tracking_number ?? null;
  return {
    carrier,
    trackingNumber,
    trackingUrl: buildTrackingUrl(carrier, trackingNumber),
  };
}

/**
 * POST /api/admin/orders/[id]/ship (BMC-216B)
 *
 * The fulfillment-owned writer of processing+paid -> shipped: timestamps are
 * server-owned and the body may carry nothing (untracked) or a full
 * carrier+tracking pair — it can never supply a status or a timestamp.
 *
 * As of BMC-230 (ticket F) this is the ENFORCED path, not merely the correct
 * one: the legacy `PUT /api/orders` was reduced to a metadata allowlist and now
 * rejects client-supplied `status`, `shipped_at`, `tracking_number`,
 * `shipping_method` and tracking URLs with a 400 naming this endpoint. Together
 * with `PATCH .../tracking`, this route and the Stripe webhook are the only
 * writers of order lifecycle state.
 *
 * Email is a best-effort side effect AFTER the shipment commit — a failed
 * send is reported in the 201 body, never a rollback.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 },
    );
  }
  const { id } = await params;

  // Only a truly empty body means "untracked shipment" — a present-but-broken
  // JSON payload is a client bug, not an intentional omission, and must not
  // be allowed to silently ship the order untracked.
  const rawBody = await request.text();
  let body: unknown = {};
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
  }
  const parsed = parseShipmentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const actor: Actor = auth.isServiceToken
    ? { type: "service", id: "api-token" }
    : { type: "admin", id: auth.userId ?? null };

  try {
    const result = await shipOrder(id, parsed.input, actor);

    switch (result.outcome) {
      case "shipped": {
        // Contract says this never throws, but the shipment has already
        // committed by this point — a broken seam must not turn a successful
        // ship into a 500 the admin thinks failed.
        let email;
        try {
          email = await sendInitialShippingEmail(result.order, actor);
        } catch (error) {
          console.error("sendInitialShippingEmail threw:", error);
          logCritical(
            "fulfillment",
            "shipping_email_threw",
            { orderId: id },
            error,
          );
          email = { attempted: true, success: false, error: "Send failed" };
        }
        return NextResponse.json(
          {
            order: result.order,
            tracking: trackingProjection(result.order),
            email,
            eventId: result.eventId,
          },
          { status: 201 },
        );
      }
      case "already_shipped":
        // Idempotent identical retry: no new event, no second email attempt.
        return NextResponse.json(
          {
            order: result.order,
            tracking: trackingProjection(result.order),
            email: { attempted: false, success: false },
            eventId: null,
          },
          { status: 200 },
        );
      case "not_found":
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      case "conflict":
        return NextResponse.json(
          {
            code: "shipment_conflict",
            status: result.order.status,
            paymentStatus: result.order.payment_status ?? null,
          },
          { status: 409 },
        );
      case "not_fulfillable":
        return NextResponse.json(
          {
            code: "not_fulfillable",
            status: result.status,
            paymentStatus: result.paymentStatus,
          },
          { status: 409 },
        );
    }
  } catch (error) {
    console.error("POST /api/admin/orders/[id]/ship error:", error);
    logCritical("fulfillment", "ship_failed", { orderId: id }, error);
    return NextResponse.json({ error: "Failed to ship order" }, { status: 500 });
  }
}

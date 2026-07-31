import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { shipOrder } from "@/lib/fulfillment/service";
import { sendInitialShippingEmail } from "@/lib/fulfillment/shipping-email";
import { buildTrackingUrl, normalizeCarrier } from "@/lib/fulfillment/tracking";
import { parseShipmentInput } from "@/lib/fulfillment/transitions";
import type { Actor } from "@/lib/fulfillment/types";
import type { Order } from "@/lib/types/order";

/**
 * Derived at the response boundary. This route never stores a tracking URL —
 * it persists only (carrier, trackingNumber) and rebuilds the link on the way
 * out. Note the legacy PUT /api/orders path still accepts and stores a
 * client-supplied `extensions.trackingUrl`; removing that is BMC-230 (ticket F).
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
 * It is NOT yet the only path that can set `shipped` repo-wide: the legacy
 * `PUT /api/orders` still accepts client-supplied `status`, `shipped_at` and
 * `tracking_number` (app/api/orders/route.ts), and the current admin UI uses
 * it. That path is unguarded — it can ship an unpaid order, backdate
 * `shipped_at`, and writes no order_events row. Closing it is BMC-230
 * (ticket F); until then, treat this route as the correct path, not the
 * enforced one.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {}; // absent/empty body = valid untracked shipment
  }
  const parsed = parseShipmentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const actor: Actor = auth.isServiceToken
    ? { type: "service", id: "api-token" }
    : { type: "admin", id: auth.userId ?? null };

  const result = await shipOrder(id, parsed.input, actor);

  switch (result.outcome) {
    case "shipped": {
      const email = await sendInitialShippingEmail(result.order, actor);
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
}

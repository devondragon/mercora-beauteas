import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { updateTracking } from "@/lib/fulfillment/service";
import { buildTrackingUrl, normalizeCarrier } from "@/lib/fulfillment/tracking";
import { parseShipmentInput } from "@/lib/fulfillment/transitions";
import type { Actor } from "@/lib/fulfillment/types";

/**
 * PATCH /api/admin/orders/[id]/tracking (BMC-216B)
 *
 * Tracking correction for an already-shipped order. Unlike /ship, BOTH fields
 * are required — a correction always states the full new pair. Never emails
 * the customer (resend is an explicit, separate action — ticket C).
 */
export async function PATCH(
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
    body = {};
  }
  const parsed = parseShipmentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.input.carrier === null || parsed.input.trackingNumber === null) {
    return NextResponse.json(
      { error: "carrier and trackingNumber are both required" },
      { status: 400 },
    );
  }

  const actor: Actor = auth.isServiceToken
    ? { type: "service", id: "api-token" }
    : { type: "admin", id: auth.userId ?? null };

  const result = await updateTracking(id, parsed.input, actor);

  switch (result.outcome) {
    case "updated": {
      const carrier = normalizeCarrier(result.order.shipping_carrier ?? null);
      const trackingNumber = result.order.tracking_number ?? null;
      return NextResponse.json(
        {
          order: result.order,
          tracking: {
            carrier,
            trackingNumber,
            trackingUrl: buildTrackingUrl(carrier, trackingNumber),
          },
          eventId: result.eventId,
        },
        { status: 200 },
      );
    }
    case "not_found":
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    case "not_shipped":
      return NextResponse.json(
        { code: "not_shipped", status: result.status },
        { status: 409 },
      );
  }
}

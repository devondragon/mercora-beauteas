import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { updateTracking } from "@/lib/fulfillment/service";
import { buildTrackingUrl, normalizeCarrier } from "@/lib/fulfillment/tracking";
import { parseShipmentInput } from "@/lib/fulfillment/transitions";
import type { Actor } from "@/lib/fulfillment/types";
import { logCritical } from "@/lib/utils/observe";
import { toWireOrder } from "@/lib/utils/order-wire";

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

  // Only a truly empty body falls through to the "both fields required" 400
  // below — a present-but-broken JSON payload is a client bug and gets its
  // own, more precise 400 rather than being coerced into the wrong error.
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
  if (parsed.input.carrier === null || parsed.input.trackingNumber === null) {
    return NextResponse.json(
      { error: "carrier and trackingNumber are both required" },
      { status: 400 },
    );
  }

  const actor: Actor = auth.isServiceToken
    ? { type: "service", id: "api-token" }
    : { type: "admin", id: auth.userId ?? null };

  try {
    const result = await updateTracking(id, parsed.input, actor);

    switch (result.outcome) {
      case "updated": {
        const carrier = normalizeCarrier(result.order.shipping_carrier ?? null);
        const trackingNumber = result.order.tracking_number ?? null;
        return NextResponse.json(
          {
            // Wire shape, not the internal cents projection (BMC-233) — the
            // same conversion every other order endpoint applies immediately
            // before NextResponse.json.
            order: toWireOrder(result.order),
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
      case "conflict":
        // Someone else corrected this order (or bounced its status) between
        // our read and our write. Retryable: the client should re-read the
        // current pair and decide whether its correction still applies.
        return NextResponse.json(
          {
            code: "tracking_conflict",
            status: result.order.status,
            tracking: {
              carrier: normalizeCarrier(result.order.shipping_carrier ?? null),
              trackingNumber: result.order.tracking_number ?? null,
            },
          },
          { status: 409 },
        );
      case "not_shipped":
        return NextResponse.json(
          { code: "not_shipped", status: result.status },
          { status: 409 },
        );
    }
  } catch (error) {
    console.error("PATCH /api/admin/orders/[id]/tracking error:", error);
    logCritical("fulfillment", "tracking_update_failed", { orderId: id }, error);
    return NextResponse.json(
      { error: "Failed to update tracking" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { listOrderEvents } from "@/lib/fulfillment/service";
import { getOrderById } from "@/lib/models/mach/orders";
import { logCritical } from "@/lib/utils/observe";

/**
 * GET /api/admin/orders/[id]/events (BMC-216B)
 *
 * Fulfillment audit history, oldest first. order_events contains only
 * fulfillment events — refund-ledger details and server-owned extension data
 * live elsewhere and are not reachable through this projection.
 */
export async function GET(
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

  try {
    // Distinguish "order doesn't exist" from "no fulfillment events yet" —
    // both would otherwise render as the same 200 { events: [] }.
    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const rows = await listOrderEvents(id);
    return NextResponse.json({
      events: rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        actorType: row.actor_type,
        actorId: row.actor_id,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        details: row.details,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/orders/[id]/events error:", error);
    logCritical("fulfillment", "list_events_failed", { orderId: id }, error);
    return NextResponse.json(
      { error: "Failed to load order events" },
      { status: 500 },
    );
  }
}

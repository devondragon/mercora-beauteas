import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { getDbAsync } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema/admin_users";
import { listRecentOrderEvents } from "@/lib/fulfillment/service";
import { getOrderById } from "@/lib/models/mach/orders";
import { logCritical } from "@/lib/utils/observe";

/** Bounded read (BMC-246): `?limit=` default / hard cap. */
const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;

/**
 * GET /api/admin/orders/[id]/events (BMC-216B)
 *
 * Fulfillment audit history, oldest first, bounded by `?limit=` (default 100,
 * capped at 500 — when a history exceeds the limit it is the OLDEST events
 * that drop). order_events contains only fulfillment events — refund-ledger
 * details and server-owned extension data live elsewhere and are not
 * reachable through this projection.
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

  const limitParam = request.nextUrl.searchParams.get("limit");
  let limit = DEFAULT_EVENT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: "limit must be a positive integer" },
        { status: 400 },
      );
    }
    limit = Math.min(parsed, MAX_EVENT_LIMIT);
  }

  try {
    // Distinguish "order doesn't exist" from "no fulfillment events yet" —
    // both would otherwise render as the same 200 { events: [] }.
    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Newest-first bounded page from the service, reversed to the wire's
    // oldest-first contract.
    const rows = (await listRecentOrderEvents(id, limit)).reverse();

    // Resolve admin actor ids to something an operator can read. The timeline
    // otherwise renders a raw Clerk id. One grouped lookup for the whole page —
    // not one per event — and a failure here must not cost the caller their
    // audit history, so it degrades to the shortened id the view falls back to.
    const adminIds = [
      ...new Set(
        rows
          .filter((row) => row.actor_type === "admin" && row.actor_id)
          .map((row) => row.actor_id as string),
      ),
    ];
    let actorLabels: Record<string, string> = {};
    if (adminIds.length) {
      try {
        const db = await getDbAsync();
        const admins = await db
          .select({
            userId: adminUsers.userId,
            email: adminUsers.email,
            displayName: adminUsers.displayName,
          })
          .from(adminUsers)
          .where(inArray(adminUsers.userId, adminIds));
        actorLabels = Object.fromEntries(
          admins
            .map((a) => [a.userId, a.displayName?.trim() || a.email?.trim() || ""] as const)
            .filter(([, label]) => label),
        );
      } catch (error) {
        console.error("Failed to resolve admin actor labels:", error);
      }
    }

    return NextResponse.json({
      events: rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        actorType: row.actor_type,
        actorId: row.actor_id,
        actorLabel: row.actor_id ? (actorLabels[row.actor_id] ?? null) : null,
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

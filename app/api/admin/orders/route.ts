/**
 * BMC-216D: SQL-backed admin order list for the fulfillment queue.
 *
 * This replaces `GET /api/orders?admin=true` FOR THE ADMIN QUEUE UI ONLY — that
 * legacy route still serves customer and MCP consumers and is untouched here.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  DEFAULT_ADMIN_ORDER_LIMIT,
  MAX_ADMIN_ORDER_LIMIT,
  isAdminOrderView,
  queryAdminOrders,
} from "@/lib/fulfillment/queries";
import { toWireOrder } from "@/lib/utils/order-wire";

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error ?? "Admin access required" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawView = searchParams.get("view");
  if (rawView !== null && !isAdminOrderView(rawView)) {
    return NextResponse.json({ error: `Unknown view "${rawView}"` }, { status: 400 });
  }
  const view = rawView ?? "awaiting";
  const limit = clampInt(
    searchParams.get("limit"),
    DEFAULT_ADMIN_ORDER_LIMIT,
    1,
    MAX_ADMIN_ORDER_LIMIT,
  );
  const offset = clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  try {
    const result = await queryAdminOrders({
      view,
      q: searchParams.get("q") ?? undefined,
      limit,
      offset,
    });

    return NextResponse.json({
      orders: result.orders.map(toWireOrder),
      total: result.total,
      counts: result.counts,
      meta: { view, limit, offset },
    });
  } catch (error) {
    console.error("Admin order queue query failed", error);
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
}

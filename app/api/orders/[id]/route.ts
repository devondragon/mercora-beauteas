import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDbAsync } from "@/lib/db";
import { orders } from "@/lib/db/schema/order";
import { eq } from "drizzle-orm";
import type { Order } from "@/lib/types/order";
import { authenticateRequest, PERMISSIONS } from "@/lib/auth/unified-auth";

function hydrateOrder(dbOrder: typeof orders.$inferSelect): Order {
  return {
    id: dbOrder.id,
    customer_id: dbOrder.customer_id || undefined,
    status: dbOrder.status,
    total_amount: typeof dbOrder.total_amount === 'string' ? JSON.parse(dbOrder.total_amount) : { amount: 0, currency: dbOrder.currency_code },
    currency_code: dbOrder.currency_code,
    shipping_address: typeof dbOrder.shipping_address === 'string' ? JSON.parse(dbOrder.shipping_address) : undefined,
    billing_address: typeof dbOrder.billing_address === 'string' ? JSON.parse(dbOrder.billing_address) : undefined,
    items: typeof dbOrder.items === 'string' ? JSON.parse(dbOrder.items) : [],
    shipping_method: dbOrder.shipping_method || undefined,
    payment_method: dbOrder.payment_method || undefined,
    payment_status: dbOrder.payment_status || 'pending',
    tracking_number: dbOrder.tracking_number || undefined,
    shipped_at: dbOrder.shipped_at || undefined,
    delivered_at: dbOrder.delivered_at || undefined,
    notes: dbOrder.notes || undefined,
    external_references: typeof dbOrder.external_references === 'string' ? JSON.parse(dbOrder.external_references) : undefined,
    extensions: typeof dbOrder.extensions === 'string' ? JSON.parse(dbOrder.extensions) : undefined,
    created_at: dbOrder.created_at || undefined,
    updated_at: dbOrder.updated_at || undefined
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
    }
    const { userId } = await auth();
    const db = await getDbAsync();
    const result = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!result.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const order = hydrateOrder(result[0]);

    // Authorize: the order's owner, or an admin. Order IDs are guessable/
    // enumerable (WEB-<user>-<timestamp_ms>), so this endpoint must never leak
    // PII to an unauthenticated or non-owner caller (BMC-138 IDOR). The prior
    // guard let anonymous requests (userId null) through and exposed the full
    // order — shipping/billing address, items, totals, payment_status, tracking.
    const isOwner = !!userId && order.customer_id === userId;
    if (!isOwner) {
      // Fall back to admin credentials (Clerk admin session or ORDERS_READ API
      // token) via the shared verifier used by the sibling /api/orders route.
      const adminAuth = await authenticateRequest(request, PERMISSIONS.ORDERS_READ);
      if (!adminAuth.success) {
        // Return 404 (not 403) so a guessable order ID can't be used as an
        // existence oracle — mirrors the account order page's notFound().
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ data: order, meta: { schema: "mach:order" } });
  } catch (error) {
    console.error("Order GET error:", error);
    return NextResponse.json({ error: "Failed to retrieve order" }, { status: 500 });
  }
}

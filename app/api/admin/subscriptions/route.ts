import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  listSubscriptionsAdmin,
  getAdminSubscriptionStats,
} from "@/lib/models/mach/subscriptions";

export async function GET(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = Number.parseInt(searchParams.get("limit") || "20", 10);
    const offsetParam = Number.parseInt(searchParams.get("offset") || "0", 10);
    const status = searchParams.get("status") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 100) : 20;
    const offset = Number.isFinite(offsetParam) ? offsetParam : 0;

    const [{ items, total }, stats] = await Promise.all([
      listSubscriptionsAdmin({ limit, offset, status, search }),
      getAdminSubscriptionStats(),
    ]);

    return NextResponse.json({
      success: true,
      data: items,
      stats,
      meta: { total, limit, offset },
    });
  } catch (error) {
    console.error("Failed to load subscription list", error);
    return NextResponse.json(
      { success: false, error: "Unable to load subscriptions" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  getSubscriptionDetail,
  getSubscriptionEvents,
} from "@/lib/models/mach/subscriptions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;

    const [subscription, events] = await Promise.all([
      getSubscriptionDetail(id),
      getSubscriptionEvents(id),
    ]);

    if (!subscription) {
      return NextResponse.json(
        { success: false, error: "Subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { subscription, events },
    });
  } catch (error) {
    console.error("Failed to load subscription detail", error);
    return NextResponse.json(
      { success: false, error: "Unable to load subscription detail" },
      { status: 500 }
    );
  }
}

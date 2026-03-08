import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  listSubscriptionsAdmin,
  getAdminSubscriptionStats,
} from "@/lib/models/mach/subscriptions";

/**
 * Transform a subscription item from the model layer (camelCase + nested objects)
 * to the flat snake_case shape expected by the UI Subscription interface.
 */
type AdminSubscriptionItem = Awaited<ReturnType<typeof listSubscriptionsAdmin>>['items'][number];

function transformSubscriptionForClient(item: AdminSubscriptionItem) {
  const {
    planFrequency,
    planDiscountPercent,
    productName,
    productSlug,
    customerPerson,
    variantPriceAmount,
    ...base
  } = item;
  const person = customerPerson as {
    email?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
  } | null;
  return {
    ...base,
    plan_frequency: planFrequency ?? "monthly",
    plan_discount_percent: planDiscountPercent ?? 0,
    product_name: productName ?? "Unknown Product",
    product_slug: productSlug ?? "",
    customer_name:
      person?.full_name ||
      [person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
      "Unknown",
    customer_email: person?.email ?? "",
    variant_price_amount: variantPriceAmount ?? 0,
  };
}

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
    const offset = Number.isFinite(offsetParam) ? Math.max(0, offsetParam) : 0;

    const [{ items, total }, stats] = await Promise.all([
      listSubscriptionsAdmin({ limit, offset, status, search }),
      getAdminSubscriptionStats(),
    ]);

    const transformedItems = items.map(transformSubscriptionForClient);

    return NextResponse.json({
      success: true,
      data: transformedItems,
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

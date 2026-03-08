import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  getSubscriptionDetail,
  getSubscriptionEvents,
} from "@/lib/models/mach/subscriptions";

/**
 * Transform subscription detail from the model layer (camelCase + nested plan object)
 * to the flat snake_case shape expected by the UI SubscriptionDetail interface.
 */
function transformDetailForClient(sub: any) {
  const { plan, productName, productSlug, customerPerson, variantPriceAmount, ...base } = sub;
  const person = customerPerson as {
    email?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
  } | null;
  return {
    ...base,
    plan_frequency: plan?.frequency ?? "monthly",
    plan_discount_percent: plan?.discount_percent ?? 0,
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
      data: { subscription: transformDetailForClient(subscription), events },
    });
  } catch (error) {
    console.error("Failed to load subscription detail", error);
    return NextResponse.json(
      { success: false, error: "Unable to load subscription detail" },
      { status: 500 }
    );
  }
}

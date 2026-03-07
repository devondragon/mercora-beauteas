import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  getPlansWithSubscriberCount,
  createSubscriptionPlan,
  updateSubscriptionPlan,
} from "@/lib/models/mach/subscriptions";

const VALID_FREQUENCIES = ["biweekly", "monthly", "bimonthly"] as const;
type Frequency = (typeof VALID_FREQUENCIES)[number];

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
    const productId = searchParams.get("productId");

    if (!productId) {
      return NextResponse.json(
        { success: false, error: "productId is required" },
        { status: 400 }
      );
    }

    const plans = await getPlansWithSubscriberCount(productId);
    const hasActiveSubscribers = plans.some(
      (p) => p.activeSubscriberCount > 0
    );

    return NextResponse.json({
      success: true,
      plans,
      hasActiveSubscribers,
    });
  } catch (error) {
    console.error("Failed to load subscription plans", error);
    return NextResponse.json(
      { success: false, error: "Unable to load subscription plans" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { productId, plans } = body as {
      productId: string;
      plans: Array<{
        frequency: Frequency;
        discount_percent: number;
        is_active: boolean;
      }>;
    };

    if (!productId || !Array.isArray(plans)) {
      return NextResponse.json(
        { success: false, error: "productId and plans array are required" },
        { status: 400 }
      );
    }

    // Validate each plan
    for (const plan of plans) {
      if (!VALID_FREQUENCIES.includes(plan.frequency as Frequency)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid frequency: ${plan.frequency}. Must be one of: ${VALID_FREQUENCIES.join(", ")}`,
          },
          { status: 400 }
        );
      }
      if (
        typeof plan.discount_percent !== "number" ||
        plan.discount_percent < 0 ||
        plan.discount_percent > 100
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "discount_percent must be a number between 0 and 100",
          },
          { status: 400 }
        );
      }
    }

    // Get existing plans for this product
    const existingPlans = await getPlansWithSubscriberCount(productId);
    const existingByFrequency = new Map(
      existingPlans.map((p) => [p.frequency, p])
    );

    // Upsert each plan
    for (const plan of plans) {
      const existing = existingByFrequency.get(plan.frequency);
      if (existing) {
        await updateSubscriptionPlan(existing.id, {
          discount_percent: plan.discount_percent,
          is_active: plan.is_active,
        });
      } else {
        await createSubscriptionPlan({
          product_id: productId,
          frequency: plan.frequency as typeof VALID_FREQUENCIES[number],
          discount_percent: plan.discount_percent,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Plans updated",
    });
  } catch (error) {
    console.error("Failed to update subscription plans", error);
    return NextResponse.json(
      { success: false, error: "Unable to update subscription plans" },
      { status: 500 }
    );
  }
}

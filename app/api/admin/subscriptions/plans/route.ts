import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import {
  getPlansWithSubscriberCount,
  createSubscriptionPlan,
  updateSubscriptionPlan,
} from "@/lib/models/mach/subscriptions";
import { getProduct } from "@/lib/models/mach/products";
import { getStripeForWorkers } from "@/lib/stripe";

const VALID_FREQUENCIES = ["biweekly", "monthly", "bimonthly"] as const;
type Frequency = (typeof VALID_FREQUENCIES)[number];

/** Map subscription frequency to Stripe recurring interval */
function frequencyToStripeInterval(frequency: Frequency): { interval: "week" | "month"; interval_count: number } {
  switch (frequency) {
    case "biweekly":
      return { interval: "week", interval_count: 2 };
    case "monthly":
      return { interval: "month", interval_count: 1 };
    case "bimonthly":
      return { interval: "month", interval_count: 2 };
  }
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

    // Look up product for Stripe Price creation (need name + base price)
    const product = await getProduct(productId);
    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    const defaultVariant = product.default_variant_id
      ? product.variants?.find((v) => v.id === product.default_variant_id)
      : product.variants?.[0];
    const basePriceInCents = defaultVariant?.price?.amount ?? 0;
    if (basePriceInCents <= 0) {
      return NextResponse.json(
        { success: false, error: "Product has no valid base price — cannot create Stripe price" },
        { status: 400 }
      );
    }

    const stripe = getStripeForWorkers();
    const productName =
      typeof product.name === "object" && product.name !== null
        ? (product.name as Record<string, string>).en ?? Object.values(product.name as Record<string, string>)[0] ?? "Product"
        : String(product.name ?? "Product");

    // Upsert each plan
    for (const plan of plans) {
      const existing = existingByFrequency.get(plan.frequency);
      if (existing) {
        await updateSubscriptionPlan(existing.id, {
          discount_percent: plan.discount_percent,
          is_active: plan.is_active,
        });
      } else {
        // Create a Stripe Price for the new plan
        const discountedPriceCents = Math.round(
          basePriceInCents * (1 - plan.discount_percent / 100)
        );
        const { interval, interval_count } = frequencyToStripeInterval(
          plan.frequency as Frequency
        );

        let stripePrice;
        try {
          stripePrice = await stripe.prices.create({
            currency: "usd",
            unit_amount: discountedPriceCents,
            recurring: { interval, interval_count },
            product_data: {
              name: `${productName} — ${plan.frequency} subscription`,
            },
          });
        } catch (stripeError) {
          console.error("Failed to create Stripe price for plan:", plan.frequency, stripeError);
          throw stripeError;
        }

        try {
          await createSubscriptionPlan({
            product_id: productId,
            frequency: plan.frequency as typeof VALID_FREQUENCIES[number],
            discount_percent: plan.discount_percent,
            stripe_price_id: stripePrice.id,
          });
        } catch (dbError) {
          console.error(
            "CRITICAL: Stripe price created but D1 plan insert failed. Orphaned Stripe price ID:",
            stripePrice.id,
            "frequency:", plan.frequency,
            dbError
          );
          throw dbError;
        }
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

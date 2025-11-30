import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { createBundle, listBundles, getBundle } from "@/lib/models/coupons";
import { getSubscriptionPlan } from "@/lib/models/subscriptions";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
});

// GET /api/subscription-bundles - List all bundles
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") !== "false";
    const includeItems = searchParams.get("includeItems") === "true";

    const bundles = await listBundles(activeOnly);

    // Optionally include bundle items with plan details
    if (includeItems) {
      const bundlesWithItems = await Promise.all(
        bundles.map(async (bundle) => {
          const fullBundle = await getBundle(bundle.id);
          if (fullBundle?.items) {
            const itemsWithPlans = await Promise.all(
              fullBundle.items.map(async (item) => {
                const plan = await getSubscriptionPlan(item.plan_id);
                return {
                  ...item,
                  plan: plan
                    ? {
                        id: plan.id,
                        name: plan.name,
                        price: plan.price,
                        interval: plan.interval,
                      }
                    : null,
                };
              })
            );
            return { ...fullBundle, items: itemsWithPlans };
          }
          return fullBundle;
        })
      );
      return NextResponse.json({ data: bundlesWithItems });
    }

    return NextResponse.json({ data: bundles });
  } catch (error) {
    console.error("Error listing bundles:", error);
    return NextResponse.json(
      { error: "Failed to list bundles" },
      { status: 500 }
    );
  }
}

// POST /api/subscription-bundles - Create a new bundle (admin only)
export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin =
      user.publicMetadata?.role === "admin" ||
      user.privateMetadata?.role === "admin";

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      price_amount,
      currency_code,
      interval,
      interval_count,
      plan_ids,
      create_in_stripe,
    } = body;

    if (!name || !price_amount || !interval || !plan_ids || plan_ids.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Calculate savings compared to individual plans
    let totalIndividualPrice = 0;
    for (const planId of plan_ids) {
      const plan = await getSubscriptionPlan(planId);
      if (plan) {
        totalIndividualPrice += plan.price.amount;
      }
    }

    const savingsAmount = Math.max(0, totalIndividualPrice - price_amount);
    const savingsPercentage =
      totalIndividualPrice > 0
        ? Math.round((savingsAmount / totalIndividualPrice) * 100)
        : 0;

    // Create bundle in our database
    const bundle = await createBundle({
      name,
      description,
      price_amount,
      currency_code: currency_code || "USD",
      interval,
      interval_count: interval_count || 1,
      savings_amount: savingsAmount,
      savings_percentage: savingsPercentage,
      plan_ids,
    });

    // Optionally create in Stripe
    if (create_in_stripe) {
      try {
        // Create product for the bundle
        const stripeProduct = await stripe.products.create({
          name: `Bundle: ${name}`,
          description: description || `Subscription bundle: ${name}`,
          metadata: {
            bundle_id: bundle.id,
            type: "subscription_bundle",
          },
        });

        // Create price for the bundle
        const stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: price_amount,
          currency: (currency_code || "USD").toLowerCase(),
          recurring: {
            interval: interval as Stripe.PriceCreateParams.Recurring.Interval,
            interval_count: interval_count || 1,
          },
          metadata: {
            bundle_id: bundle.id,
          },
        });

        // Update bundle with Stripe IDs (would need to add this function)
        // For now, return the IDs in the response
        return NextResponse.json({
          data: {
            ...bundle,
            stripe_product_id: stripeProduct.id,
            stripe_price_id: stripePrice.id,
          },
        }, { status: 201 });
      } catch (stripeError) {
        console.error("Failed to create Stripe product/price:", stripeError);
        // Continue without Stripe
      }
    }

    return NextResponse.json({ data: bundle }, { status: 201 });
  } catch (error) {
    console.error("Error creating bundle:", error);
    return NextResponse.json(
      { error: "Failed to create bundle" },
      { status: 500 }
    );
  }
}

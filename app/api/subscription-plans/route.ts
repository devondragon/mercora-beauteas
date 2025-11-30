/**
 * Subscription Plans API
 *
 * GET: List available subscription plans
 * POST: Create a new subscription plan (admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, PERMISSIONS } from "@/lib/auth/unified-auth";
import {
  listSubscriptionPlans,
  createSubscriptionPlan,
  updatePlanStripeIds,
} from "@/lib/models/subscriptions";
import { getStripeServer } from "@/lib/stripe";
import type { CreateSubscriptionPlanRequest } from "@/lib/types/subscription";

/**
 * GET /api/subscription-plans - List available subscription plans
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as "active" | "inactive" | "archived" | null;
    const includeInactive = url.searchParams.get("includeInactive") === "true";

    // By default, only return active plans for public access
    const filterStatus = includeInactive ? undefined : (status || "active");

    const plans = await listSubscriptionPlans(filterStatus as "active" | "inactive" | "archived" | undefined);

    return NextResponse.json({
      data: plans,
      meta: {
        total: plans.length,
        schema: "subscription:plan",
      },
    });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription plans" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/subscription-plans - Create a new subscription plan (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // Require admin authentication
    const authResult = await authenticateRequest(request, PERMISSIONS.ADMIN);
    if (!authResult.success) {
      return authResult.response!;
    }

    const body: CreateSubscriptionPlanRequest = await request.json();

    // Validate required fields
    if (!body.name || !body.interval || body.price_amount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: name, interval, price_amount" },
        { status: 400 }
      );
    }

    // Create the plan in our database
    const plan = await createSubscriptionPlan(body);

    // Sync with Stripe if we have Stripe configured
    try {
      const stripe = getStripeServer();
      if (stripe) {
        // Create Stripe product
        const stripeProduct = await stripe.products.create({
          name: plan.name,
          description: plan.description || undefined,
          metadata: {
            plan_id: plan.id,
          },
        });

        // Create Stripe price
        const stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: plan.price.amount,
          currency: plan.price.currency.toLowerCase(),
          recurring: {
            interval: plan.interval,
            interval_count: plan.interval_count,
          },
          metadata: {
            plan_id: plan.id,
          },
        });

        // Update our plan with Stripe IDs
        await updatePlanStripeIds(plan.id, stripeProduct.id, stripePrice.id);
        plan.stripe_product_id = stripeProduct.id;
        plan.stripe_price_id = stripePrice.id;
      }
    } catch (stripeError) {
      console.error("Error syncing plan with Stripe:", stripeError);
      // Plan is created locally, but Stripe sync failed
      // Admin can manually sync later
    }

    return NextResponse.json({
      data: plan,
      meta: { schema: "subscription:plan" },
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating subscription plan:", error);
    return NextResponse.json(
      { error: "Failed to create subscription plan" },
      { status: 500 }
    );
  }
}

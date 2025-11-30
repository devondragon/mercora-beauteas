import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import {
  getSubscription,
  getSubscriptionPlan,
  updateSubscription,
  logSubscriptionEvent,
} from "@/lib/models/subscriptions";
import { getCustomerByClerkId } from "@/lib/models/mach/customer";
import { sendPlanChangeEmail } from "@/lib/utils/subscription-emails";
import { getStripe } from "@/lib/stripe";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const stripe = getStripe();
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: subscriptionId } = await params;
    const body = await request.json();
    const { new_plan_id, proration_behavior = "create_prorations" } = body;

    if (!new_plan_id) {
      return NextResponse.json(
        { error: "new_plan_id is required" },
        { status: 400 }
      );
    }

    // Get customer
    const customer = await getCustomerByClerkId(user.id);
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Get subscription
    const subscription = await getSubscription(subscriptionId);
    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    // Verify ownership
    if (subscription.customer_id !== customer.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check subscription status
    if (!["active", "trialing"].includes(subscription.status)) {
      return NextResponse.json(
        { error: "Can only change plan for active subscriptions" },
        { status: 400 }
      );
    }

    // Get current and new plans
    const currentPlan = await getSubscriptionPlan(subscription.plan_id);
    const newPlan = await getSubscriptionPlan(new_plan_id);

    if (!currentPlan || !newPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    if (currentPlan.id === newPlan.id) {
      return NextResponse.json(
        { error: "Already subscribed to this plan" },
        { status: 400 }
      );
    }

    // Update Stripe subscription if exists
    let stripeSubscription: Stripe.Subscription | null = null;
    if (subscription.stripe_subscription_id && newPlan.stripe_price_id) {
      try {
        // Get the current subscription item
        const currentStripeSub = await stripe.subscriptions.retrieve(
          subscription.stripe_subscription_id
        );

        const currentItem = currentStripeSub.items.data[0];
        if (!currentItem) {
          throw new Error("No subscription items found");
        }

        // Update the subscription with the new price
        stripeSubscription = await stripe.subscriptions.update(
          subscription.stripe_subscription_id,
          {
            items: [
              {
                id: currentItem.id,
                price: newPlan.stripe_price_id,
              },
            ],
            proration_behavior: proration_behavior as Stripe.SubscriptionUpdateParams.ProrationBehavior,
          }
        );
      } catch (stripeError) {
        console.error("Stripe subscription update failed:", stripeError);
        return NextResponse.json(
          { error: "Failed to update subscription with payment provider" },
          { status: 500 }
        );
      }
    }

    // Update our database
    const previousStatus = subscription.status;
    const updatedSubscription = await updateSubscription(subscriptionId, {
      plan_id: new_plan_id,
      current_period_start: stripeSubscription?.current_period_start
        ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
        : undefined,
      current_period_end: stripeSubscription?.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
        : undefined,
    });

    // Log event
    await logSubscriptionEvent({
      subscription_id: subscriptionId,
      event_type: "plan_changed",
      data: {
        previous_plan_id: currentPlan.id,
        previous_plan_name: currentPlan.name,
        new_plan_id: newPlan.id,
        new_plan_name: newPlan.name,
        proration_behavior,
      },
      previous_status: previousStatus,
      new_status: updatedSubscription?.status,
    });

    // Send email notification
    const customerEmail = user.emailAddresses[0]?.emailAddress;
    const customerName =
      user.firstName || user.username || customerEmail?.split("@")[0] || "Customer";

    if (customerEmail) {
      await sendPlanChangeEmail({
        customerName,
        customerEmail,
        subscriptionId,
        planName: newPlan.name,
        planPrice: newPlan.price.amount,
        planInterval: newPlan.interval,
        currency: newPlan.price.currency,
        oldPlanName: currentPlan.name,
        oldPlanPrice: currentPlan.price.amount,
        newPlanName: newPlan.name,
        newPlanPrice: newPlan.price.amount,
        effectiveDate: new Date().toISOString(),
        proratedAmount:
          stripeSubscription?.latest_invoice &&
          typeof stripeSubscription.latest_invoice !== "string"
            ? (stripeSubscription.latest_invoice as any).amount_due
            : undefined,
      });
    }

    return NextResponse.json({
      data: {
        subscription: updatedSubscription,
        previous_plan: {
          id: currentPlan.id,
          name: currentPlan.name,
        },
        new_plan: {
          id: newPlan.id,
          name: newPlan.name,
        },
      },
    });
  } catch (error) {
    console.error("Error changing plan:", error);
    return NextResponse.json(
      { error: "Failed to change plan" },
      { status: 500 }
    );
  }
}

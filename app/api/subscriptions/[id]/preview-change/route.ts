import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getSubscription, getSubscriptionPlan } from "@/lib/models/subscriptions";
import { getCustomerByClerkId } from "@/lib/models/mach/customer";
import { getStripe } from "@/lib/stripe";

/**
 * GET /api/subscriptions/[id]/preview-change?new_plan_id=xxx
 *
 * Preview the proration for changing to a new plan using Stripe's upcoming invoice API.
 * This provides accurate proration calculations instead of client-side estimates.
 */
export async function GET(
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
    const newPlanId = request.nextUrl.searchParams.get("new_plan_id");

    if (!newPlanId) {
      return NextResponse.json(
        { error: "new_plan_id query parameter is required" },
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
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    // Verify ownership
    if (subscription.customer_id !== customer.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get new plan
    const newPlan = await getSubscriptionPlan(newPlanId);
    if (!newPlan) {
      return NextResponse.json({ error: "New plan not found" }, { status: 404 });
    }

    if (!newPlan.stripe_price_id) {
      return NextResponse.json(
        { error: "New plan has no Stripe price configured" },
        { status: 400 }
      );
    }

    // Check if we have a Stripe subscription to preview
    if (!subscription.stripe_subscription_id) {
      // No Stripe subscription - return basic calculation
      const currentPlan = await getSubscriptionPlan(subscription.plan_id);
      return NextResponse.json({
        data: {
          prorated_amount: 0,
          credit_amount: 0,
          immediate_charge: newPlan.price.amount,
          next_billing_amount: newPlan.price.amount,
          next_billing_date: subscription.current_period_end,
          currency: newPlan.price.currency,
          is_estimate: true,
          message: "Exact proration not available - no active Stripe subscription"
        }
      });
    }

    // Get the current Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_id
    );

    if (!stripeSubscription.items.data[0]) {
      return NextResponse.json(
        { error: "No subscription items found" },
        { status: 400 }
      );
    }

    // Use Stripe's upcoming invoice API to get accurate proration
    const upcomingInvoice = await stripe.invoices.createPreview({
      customer: customer.stripe_customer_id!,
      subscription: subscription.stripe_subscription_id,
      subscription_items: [
        {
          id: stripeSubscription.items.data[0].id,
          price: newPlan.stripe_price_id,
        },
      ],
      subscription_proration_behavior: "create_prorations",
      subscription_proration_date: Math.floor(Date.now() / 1000),
    });

    // Calculate proration details from the preview
    let prorationAmount = 0;
    let creditAmount = 0;

    for (const line of upcomingInvoice.lines.data) {
      if (line.proration) {
        if (line.amount > 0) {
          prorationAmount += line.amount;
        } else {
          creditAmount += Math.abs(line.amount);
        }
      }
    }

    // Calculate immediate charge (proration minus credits)
    const immediateCharge = Math.max(0, prorationAmount - creditAmount);

    return NextResponse.json({
      data: {
        prorated_amount: prorationAmount,
        credit_amount: creditAmount,
        immediate_charge: immediateCharge,
        next_billing_amount: newPlan.price.amount,
        next_billing_date: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
        currency: upcomingInvoice.currency.toUpperCase(),
        is_estimate: false,
        // Include line items for detailed breakdown
        line_items: upcomingInvoice.lines.data.map(line => ({
          description: line.description,
          amount: line.amount,
          proration: line.proration,
          period: line.period ? {
            start: new Date(line.period.start * 1000).toISOString(),
            end: new Date(line.period.end * 1000).toISOString(),
          } : null,
        })),
      }
    });
  } catch (error) {
    console.error("Error previewing plan change:", error);

    // If Stripe preview fails, return an estimate with a warning
    if (error instanceof Error && error.message.includes("Stripe")) {
      return NextResponse.json(
        {
          error: "Unable to calculate exact proration",
          is_estimate: true
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to preview plan change" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import {
  getGiftByRedeemCode,
  updateGiftSubscription,
} from "@/lib/models/coupons";
import {
  createSubscription,
  getSubscriptionPlan,
  updateSubscriptionStripeId,
  logSubscriptionEvent,
} from "@/lib/models/subscriptions";
import { getCustomerByClerkId } from "@/lib/models/mach/customer";
import { sendSubscriptionConfirmationEmail } from "@/lib/utils/subscription-emails";
import { getStripe } from "@/lib/stripe";

// POST /api/gift-subscriptions/redeem - Redeem a gift subscription
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { redeem_code, shipping_address } = body;

    if (!redeem_code) {
      return NextResponse.json(
        { error: "Redemption code is required" },
        { status: 400 }
      );
    }

    // Get customer
    const customer = await getCustomerByClerkId(user.id);
    if (!customer) {
      return NextResponse.json(
        { error: "Customer account not found" },
        { status: 404 }
      );
    }

    // Validate gift
    const gift = await getGiftByRedeemCode(redeem_code);

    if (!gift) {
      return NextResponse.json(
        { error: "Invalid redemption code" },
        { status: 404 }
      );
    }

    if (gift.status === "redeemed") {
      return NextResponse.json(
        { error: "This gift has already been redeemed" },
        { status: 400 }
      );
    }

    if (
      gift.status === "expired" ||
      (gift.expires_at && new Date(gift.expires_at) < new Date())
    ) {
      return NextResponse.json(
        { error: "This gift has expired" },
        { status: 400 }
      );
    }

    if (gift.status !== "paid") {
      return NextResponse.json(
        { error: "This gift has not been paid for" },
        { status: 400 }
      );
    }

    // Get plan
    const plan = await getSubscriptionPlan(gift.plan_id);
    if (!plan || plan.status !== "active") {
      return NextResponse.json(
        { error: "Subscription plan is no longer available" },
        { status: 400 }
      );
    }

    // Create Stripe subscription if plan has Stripe integration
    let stripeSubscriptionId: string | undefined;
    let stripeCustomerId = customer.stripe_customer_id;

    if (plan.stripe_price_id) {
      try {
        // Create or get Stripe customer
        if (!stripeCustomerId) {
          const stripeCustomer = await stripe.customers.create({
            email: user.emailAddresses[0]?.emailAddress,
            name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || undefined,
            metadata: {
              customer_id: customer.id,
              clerk_user_id: user.id,
            },
          });
          stripeCustomerId = stripeCustomer.id;
        }

        // Create subscription with 0-cost first period (already paid via gift)
        const stripeSubscription = await stripe.subscriptions.create({
          customer: stripeCustomerId,
          items: [{ price: plan.stripe_price_id }],
          // Use the gift payment as credit - subscription starts immediately
          // In production, you might want to use Stripe's billing_cycle_anchor
          // to handle proration properly
          payment_behavior: "default_incomplete",
          metadata: {
            gift_subscription_id: gift.id,
            customer_id: customer.id,
          },
        });

        stripeSubscriptionId = stripeSubscription.id;
      } catch (stripeError) {
        console.error("Failed to create Stripe subscription:", stripeError);
        // Continue without Stripe - subscription is still valid locally
      }
    }

    // Create the subscription in our database
    const subscription = await createSubscription({
      customer_id: customer.id,
      plan_id: plan.id,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: stripeCustomerId,
      status: "active",
      quantity: 1,
      shipping_address,
    });

    // Update Stripe IDs if needed
    if (stripeSubscriptionId) {
      await updateSubscriptionStripeId(
        subscription.id,
        stripeSubscriptionId,
        stripeCustomerId
      );
    }

    // Log event
    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: "created",
      data: {
        source: "gift_redemption",
        gift_subscription_id: gift.id,
        sender_name: gift.sender_name,
      },
      new_status: "active",
    });

    // Mark gift as redeemed
    await updateGiftSubscription(gift.id, {
      status: "redeemed",
      redeemed_at: new Date().toISOString(),
      redeemed_by_customer_id: customer.id,
      subscription_id: subscription.id,
    });

    // Send confirmation email
    const customerEmail = user.emailAddresses[0]?.emailAddress;
    const customerName =
      user.firstName || user.username || customerEmail?.split("@")[0] || "Customer";

    if (customerEmail) {
      await sendSubscriptionConfirmationEmail({
        customerName,
        customerEmail,
        subscriptionId: subscription.id,
        planName: plan.name,
        planPrice: plan.price.amount,
        planInterval: plan.interval,
        currency: plan.price.currency,
      });
    }

    return NextResponse.json({
      data: {
        subscription_id: subscription.id,
        status: subscription.status,
        plan: {
          id: plan.id,
          name: plan.name,
        },
        gift: {
          sender_name: gift.sender_name,
          message: gift.gift_message,
        },
      },
    });
  } catch (error) {
    console.error("Error redeeming gift subscription:", error);
    return NextResponse.json(
      { error: "Failed to redeem gift subscription" },
      { status: 500 }
    );
  }
}

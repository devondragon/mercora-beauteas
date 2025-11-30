import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import {
  createGiftSubscription,
  updateGiftSubscription,
  getGiftByRedeemCode,
} from "@/lib/models/coupons";
import { getSubscriptionPlan } from "@/lib/models/subscriptions";
import { getCustomerByClerkId } from "@/lib/models/customer";
import { sendGiftSubscriptionEmails } from "@/lib/utils/subscription-emails";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
});

// POST /api/gift-subscriptions - Purchase a gift subscription
export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    const body = await request.json();

    const {
      plan_id,
      sender_name,
      sender_email,
      recipient_name,
      recipient_email,
      gift_message,
      payment_method_id,
    } = body;

    // Validate required fields
    if (!plan_id || !recipient_name || !recipient_email) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Get the plan
    const plan = await getSubscriptionPlan(plan_id);
    if (!plan || plan.status !== "active") {
      return NextResponse.json(
        { error: "Invalid subscription plan" },
        { status: 400 }
      );
    }

    // Get sender info
    let senderCustomerId: string | undefined;
    let finalSenderName = sender_name;
    let finalSenderEmail = sender_email;

    if (user) {
      const customer = await getCustomerByClerkId(user.id);
      if (customer) {
        senderCustomerId = customer.id;
      }
      finalSenderName = finalSenderName || user.firstName || user.username || "Anonymous";
      finalSenderEmail = finalSenderEmail || user.emailAddresses[0]?.emailAddress;
    }

    if (!finalSenderName || !finalSenderEmail) {
      return NextResponse.json(
        { error: "Sender name and email are required" },
        { status: 400 }
      );
    }

    // Calculate expiry (90 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    // Create the gift subscription record
    const gift = await createGiftSubscription({
      sender_customer_id: senderCustomerId,
      sender_email: finalSenderEmail,
      sender_name: finalSenderName,
      recipient_email,
      recipient_name,
      plan_id,
      gift_message,
      amount_paid: plan.price.amount,
      currency_code: plan.price.currency,
      expires_at: expiresAt.toISOString(),
    });

    // Process payment if payment method provided
    if (payment_method_id) {
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: plan.price.amount,
          currency: plan.price.currency.toLowerCase(),
          payment_method: payment_method_id,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
          metadata: {
            gift_subscription_id: gift.id,
            type: "gift_subscription",
          },
        });

        if (paymentIntent.status === "succeeded") {
          await updateGiftSubscription(gift.id, {
            status: "paid",
            stripe_payment_intent_id: paymentIntent.id,
          });

          // Send emails to sender and recipient
          await sendGiftSubscriptionEmails({
            customerName: finalSenderName,
            customerEmail: finalSenderEmail,
            subscriptionId: gift.id,
            planName: plan.name,
            planPrice: plan.price.amount,
            planInterval: plan.interval,
            currency: plan.price.currency,
            senderName: finalSenderName,
            senderEmail: finalSenderEmail,
            recipientName: recipient_name,
            recipientEmail: recipient_email,
            giftMessage: gift_message,
            redeemCode: gift.redeem_code,
            expiresAt: expiresAt.toISOString(),
          });

          return NextResponse.json({
            data: {
              id: gift.id,
              redeem_code: gift.redeem_code,
              status: "paid",
              expires_at: gift.expires_at,
            },
          }, { status: 201 });
        } else if (paymentIntent.status === "requires_action") {
          return NextResponse.json({
            data: {
              id: gift.id,
              client_secret: paymentIntent.client_secret,
              requires_action: true,
            },
          }, { status: 200 });
        } else {
          throw new Error("Payment failed");
        }
      } catch (paymentError) {
        console.error("Payment failed:", paymentError);
        return NextResponse.json(
          { error: "Payment failed" },
          { status: 400 }
        );
      }
    }

    // Return unpaid gift (for checkout flow)
    return NextResponse.json({
      data: {
        id: gift.id,
        amount: plan.price.amount,
        currency: plan.price.currency,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating gift subscription:", error);
    return NextResponse.json(
      { error: "Failed to create gift subscription" },
      { status: 500 }
    );
  }
}

// GET /api/gift-subscriptions?code=XXX - Validate a gift code
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json(
        { error: "Redemption code is required" },
        { status: 400 }
      );
    }

    const gift = await getGiftByRedeemCode(code);

    if (!gift) {
      return NextResponse.json(
        { valid: false, error: "Invalid redemption code" },
        { status: 404 }
      );
    }

    if (gift.status === "redeemed") {
      return NextResponse.json(
        { valid: false, error: "This gift has already been redeemed" },
        { status: 400 }
      );
    }

    if (gift.status === "expired" || (gift.expires_at && new Date(gift.expires_at) < new Date())) {
      return NextResponse.json(
        { valid: false, error: "This gift has expired" },
        { status: 400 }
      );
    }

    if (gift.status !== "paid") {
      return NextResponse.json(
        { valid: false, error: "This gift has not been paid for" },
        { status: 400 }
      );
    }

    // Get plan details
    const plan = await getSubscriptionPlan(gift.plan_id);

    return NextResponse.json({
      valid: true,
      data: {
        id: gift.id,
        sender_name: gift.sender_name,
        gift_message: gift.gift_message,
        plan: plan
          ? {
              id: plan.id,
              name: plan.name,
              description: plan.description,
              price: plan.price,
              interval: plan.interval,
            }
          : null,
        expires_at: gift.expires_at,
      },
    });
  } catch (error) {
    console.error("Error validating gift code:", error);
    return NextResponse.json(
      { valid: false, error: "Failed to validate gift code" },
      { status: 500 }
    );
  }
}

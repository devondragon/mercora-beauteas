/**
 * Subscriptions API
 *
 * GET: List customer's subscriptions
 * POST: Create a new subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { authenticateRequest, PERMISSIONS } from "@/lib/auth/unified-auth";
import {
  listCustomerSubscriptions,
  listAllSubscriptions,
  createSubscription,
  getSubscriptionPlan,
  updateSubscription,
  updateSubscriptionStripeId,
  logSubscriptionEvent,
  savePaymentMethod,
} from "@/lib/models/subscriptions";
import { getCustomer, updateCustomer } from "@/lib/models/mach/customer";
import { getStripeServer } from "@/lib/stripe";
import type { CreateSubscriptionRequest, SubscriptionStatus } from "@/lib/types/subscription";
import type Stripe from "stripe";

/**
 * GET /api/subscriptions - List subscriptions
 *
 * For authenticated users: returns their subscriptions
 * For admin with API key: returns all subscriptions (with optional filters)
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    const url = new URL(request.url);

    const isAdminRequest = url.searchParams.has("admin");
    const customerId = url.searchParams.get("customerId");
    const status = url.searchParams.get("status") as SubscriptionStatus | null;
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    if (isAdminRequest) {
      // Admin request - requires API key authentication
      const authResult = await authenticateRequest(request, PERMISSIONS.ORDERS_READ);
      if (!authResult.success) {
        return authResult.response!;
      }

      const subscriptions = await listAllSubscriptions(status || undefined, limit, offset);

      return NextResponse.json({
        data: subscriptions,
        meta: {
          total: subscriptions.length,
          limit,
          offset,
          schema: "subscription",
        },
      });
    }

    // User request - must be authenticated
    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Users can only access their own subscriptions
    const targetCustomerId = customerId || userId;
    if (targetCustomerId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - can only access your own subscriptions" },
        { status: 403 }
      );
    }

    const subscriptions = await listCustomerSubscriptions(targetCustomerId, includeInactive);

    return NextResponse.json({
      data: subscriptions,
      meta: {
        total: subscriptions.length,
        schema: "subscription",
      },
    });
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/subscriptions - Create a new subscription
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body: CreateSubscriptionRequest = await request.json();

    // Validate required fields
    if (!body.plan_id || !body.payment_method_id) {
      return NextResponse.json(
        { error: "Missing required fields: plan_id, payment_method_id" },
        { status: 400 }
      );
    }

    // Get the subscription plan
    const plan = await getSubscriptionPlan(body.plan_id);
    if (!plan || plan.status !== "active") {
      return NextResponse.json(
        { error: "Invalid or inactive subscription plan" },
        { status: 400 }
      );
    }

    if (!plan.stripe_price_id) {
      return NextResponse.json(
        { error: "Subscription plan is not configured for billing" },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    const stripe = getStripeServer();
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment processing is not configured" },
        { status: 500 }
      );
    }

    // Get customer from our database
    let customer = await getCustomer(userId);
    let stripeCustomerId: string;

    if (customer?.extensions?.stripe_customer_id) {
      stripeCustomerId = customer.extensions.stripe_customer_id as string;
    } else {
      // Create a new Stripe customer
      const stripeCustomer = await stripe.customers.create({
        metadata: {
          customer_id: userId,
        },
      });
      stripeCustomerId = stripeCustomer.id;

      // Update our customer record with Stripe ID
      if (customer) {
        await updateCustomer(userId, {
          extensions: {
            ...customer.extensions,
            stripe_customer_id: stripeCustomerId,
          },
        });
      }
    }

    // Attach payment method to Stripe customer
    await stripe.paymentMethods.attach(body.payment_method_id, {
      customer: stripeCustomerId,
    });

    // Set as default payment method
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: {
        default_payment_method: body.payment_method_id,
      },
    });

    // Create our local subscription record first
    const subscription = await createSubscription({
      customer_id: body.customer_id || userId,
      plan_id: body.plan_id,
      quantity: body.quantity || 1,
      shipping_address: body.shipping_address,
      stripe_customer_id: stripeCustomerId,
    });

    // Create Stripe subscription
    const stripeSubscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: stripeCustomerId,
      items: [
        {
          price: plan.stripe_price_id,
          quantity: body.quantity || 1,
        },
      ],
      metadata: {
        subscription_id: subscription.id,
        customer_id: body.customer_id || userId,
        plan_id: body.plan_id,
      },
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
    };

    // Add trial period if configured
    if (plan.trial_period_days > 0 && body.trial_from_plan !== false) {
      stripeSubscriptionParams.trial_period_days = plan.trial_period_days;
    }

    const stripeSubscription = await stripe.subscriptions.create(stripeSubscriptionParams);

    // Update our subscription with Stripe ID
    await updateSubscriptionStripeId(
      subscription.id,
      stripeSubscription.id,
      stripeCustomerId
    );

    // Update subscription status based on Stripe status
    const statusMap: Record<string, SubscriptionStatus> = {
      incomplete: "pending",
      incomplete_expired: "expired",
      trialing: "trialing",
      active: "active",
      past_due: "past_due",
      canceled: "cancelled",
      unpaid: "past_due",
      paused: "paused",
    };

    await updateSubscription(subscription.id, {
      status: statusMap[stripeSubscription.status] || "pending",
      current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
      trial_start: stripeSubscription.trial_start
        ? new Date(stripeSubscription.trial_start * 1000).toISOString()
        : undefined,
      trial_end: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000).toISOString()
        : undefined,
    });

    // Log event
    await logSubscriptionEvent({
      subscription_id: subscription.id,
      event_type: "created",
      new_status: statusMap[stripeSubscription.status] || "pending",
      data: {
        plan_id: plan.id,
        stripe_subscription_id: stripeSubscription.id,
      },
    });

    // Save payment method record
    const paymentMethod = await stripe.paymentMethods.retrieve(body.payment_method_id);
    if (paymentMethod.type === "card" && paymentMethod.card) {
      await savePaymentMethod({
        customer_id: body.customer_id || userId,
        stripe_payment_method_id: body.payment_method_id,
        stripe_customer_id: stripeCustomerId,
        type: "card",
        card_brand: paymentMethod.card.brand,
        card_last4: paymentMethod.card.last4,
        card_exp_month: paymentMethod.card.exp_month,
        card_exp_year: paymentMethod.card.exp_year,
        card_funding: paymentMethod.card.funding,
        is_default: true,
      });
    }

    // Get client secret for payment confirmation if needed
    let clientSecret: string | undefined;
    const invoice = stripeSubscription.latest_invoice as Stripe.Invoice | null;
    if (invoice) {
      const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent | null;
      if (paymentIntent?.client_secret) {
        clientSecret = paymentIntent.client_secret;
      }
    }

    return NextResponse.json({
      data: {
        subscription_id: subscription.id,
        stripe_subscription_id: stripeSubscription.id,
        status: statusMap[stripeSubscription.status] || "pending",
        client_secret: clientSecret,
      },
      meta: { schema: "subscription:create_response" },
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating subscription:", error);

    if (error instanceof Error) {
      // Handle Stripe-specific errors
      if ("type" in error && (error as any).type === "StripeCardError") {
        return NextResponse.json(
          { error: "Payment failed. Please check your card details." },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to create subscription" },
      { status: 500 }
    );
  }
}

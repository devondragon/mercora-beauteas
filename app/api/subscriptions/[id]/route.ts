/**
 * Subscription Detail API
 *
 * GET: Get subscription details
 * PUT: Update subscription (change plan, quantity, pause, resume)
 * DELETE: Cancel subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { authenticateRequest, PERMISSIONS } from "@/lib/auth/unified-auth";
import {
  getSubscriptionWithPlan,
  getSubscription,
  updateSubscription,
  logSubscriptionEvent,
  listSubscriptionInvoices,
  listSubscriptionEvents,
  getSubscriptionPlan,
} from "@/lib/models/subscriptions";
import { getStripeServer } from "@/lib/stripe";
import type { UpdateSubscriptionRequest, SubscriptionStatus } from "@/lib/types/subscription";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/subscriptions/[id] - Get subscription details
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    const url = new URL(request.url);

    const isAdminRequest = url.searchParams.has("admin");
    const includeInvoices = url.searchParams.get("includeInvoices") === "true";
    const includeEvents = url.searchParams.get("includeEvents") === "true";

    if (isAdminRequest) {
      const authResult = await authenticateRequest(request, PERMISSIONS.ORDERS_READ);
      if (!authResult.success) {
        return authResult.response!;
      }
    } else if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const subscription = await getSubscriptionWithPlan(id);

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    // Check authorization for non-admin requests
    if (!isAdminRequest && subscription.customer_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - can only access your own subscriptions" },
        { status: 403 }
      );
    }

    // Optionally include related data
    const response: Record<string, unknown> = {
      data: subscription,
      meta: { schema: "subscription" },
    };

    if (includeInvoices) {
      response.invoices = await listSubscriptionInvoices(id);
    }

    if (includeEvents) {
      response.events = await listSubscriptionEvents(id);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/subscriptions/[id] - Update subscription
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const subscription = await getSubscription(id);

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    if (subscription.customer_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - can only update your own subscriptions" },
        { status: 403 }
      );
    }

    const body: UpdateSubscriptionRequest & { action?: string } = await request.json();
    const stripe = getStripeServer();

    // Handle specific actions
    if (body.action === "pause") {
      if (!stripe || !subscription.stripe_subscription_id) {
        return NextResponse.json(
          { error: "Cannot pause subscription - billing not configured" },
          { status: 400 }
        );
      }

      // Pause the Stripe subscription
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        pause_collection: {
          behavior: "mark_uncollectible",
        },
      });

      const previousStatus = subscription.status;
      await updateSubscription(id, {
        status: "paused",
        paused_at: new Date().toISOString(),
      });

      await logSubscriptionEvent({
        subscription_id: id,
        event_type: "paused",
        previous_status: previousStatus,
        new_status: "paused",
      });

      const updated = await getSubscription(id);
      return NextResponse.json({
        data: updated,
        meta: { schema: "subscription" },
      });
    }

    if (body.action === "resume") {
      if (!stripe || !subscription.stripe_subscription_id) {
        return NextResponse.json(
          { error: "Cannot resume subscription - billing not configured" },
          { status: 400 }
        );
      }

      // Resume the Stripe subscription
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        pause_collection: "",
      });

      const previousStatus = subscription.status;
      await updateSubscription(id, {
        status: "active",
        paused_at: undefined,
        resume_at: undefined,
      });

      await logSubscriptionEvent({
        subscription_id: id,
        event_type: "resumed",
        previous_status: previousStatus,
        new_status: "active",
      });

      const updated = await getSubscription(id);
      return NextResponse.json({
        data: updated,
        meta: { schema: "subscription" },
      });
    }

    // Handle plan change
    if (body.plan_id && body.plan_id !== subscription.plan_id) {
      const newPlan = await getSubscriptionPlan(body.plan_id);
      if (!newPlan || newPlan.status !== "active" || !newPlan.stripe_price_id) {
        return NextResponse.json(
          { error: "Invalid subscription plan" },
          { status: 400 }
        );
      }

      if (stripe && subscription.stripe_subscription_id) {
        // Update Stripe subscription
        const stripeSubscription = await stripe.subscriptions.retrieve(
          subscription.stripe_subscription_id
        );

        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          items: [
            {
              id: stripeSubscription.items.data[0].id,
              price: newPlan.stripe_price_id,
              quantity: body.quantity || subscription.quantity,
            },
          ],
          proration_behavior: "create_prorations",
        });
      }

      await updateSubscription(id, {
        plan_id: body.plan_id,
        quantity: body.quantity,
      });

      await logSubscriptionEvent({
        subscription_id: id,
        event_type: "plan_changed",
        data: {
          old_plan_id: subscription.plan_id,
          new_plan_id: body.plan_id,
        },
      });
    }

    // Handle quantity change
    if (body.quantity && body.quantity !== subscription.quantity && !body.plan_id) {
      if (stripe && subscription.stripe_subscription_id) {
        const stripeSubscription = await stripe.subscriptions.retrieve(
          subscription.stripe_subscription_id
        );

        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          items: [
            {
              id: stripeSubscription.items.data[0].id,
              quantity: body.quantity,
            },
          ],
        });
      }

      await updateSubscription(id, { quantity: body.quantity });

      await logSubscriptionEvent({
        subscription_id: id,
        event_type: "quantity_changed",
        data: {
          old_quantity: subscription.quantity,
          new_quantity: body.quantity,
        },
      });
    }

    // Handle shipping address update
    if (body.shipping_address) {
      await updateSubscription(id, { shipping_address: body.shipping_address });
    }

    // Handle cancel at period end
    if (body.cancel_at_period_end !== undefined) {
      if (stripe && subscription.stripe_subscription_id) {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: body.cancel_at_period_end,
        });
      }

      await updateSubscription(id, {
        cancel_at_period_end: body.cancel_at_period_end,
      });
    }

    const updated = await getSubscription(id);
    return NextResponse.json({
      data: updated,
      meta: { schema: "subscription" },
    });
  } catch (error) {
    console.error("Error updating subscription:", error);
    return NextResponse.json(
      { error: "Failed to update subscription" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/subscriptions/[id] - Cancel subscription
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    const url = new URL(request.url);

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const subscription = await getSubscription(id);

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    if (subscription.customer_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - can only cancel your own subscriptions" },
        { status: 403 }
      );
    }

    const immediate = url.searchParams.get("immediate") === "true";
    const reason = url.searchParams.get("reason") || undefined;

    const stripe = getStripeServer();

    if (stripe && subscription.stripe_subscription_id) {
      if (immediate) {
        // Cancel immediately
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
      } else {
        // Cancel at period end
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      }
    }

    const previousStatus = subscription.status;
    const now = new Date().toISOString();

    if (immediate) {
      await updateSubscription(id, {
        status: "cancelled",
        cancelled_at: now,
        ended_at: now,
        cancel_reason: reason,
      });
    } else {
      await updateSubscription(id, {
        cancel_at_period_end: true,
        cancelled_at: now,
        cancel_reason: reason,
      });
    }

    await logSubscriptionEvent({
      subscription_id: id,
      event_type: "cancelled",
      previous_status: previousStatus,
      new_status: immediate ? "cancelled" : previousStatus,
      data: {
        immediate,
        reason,
      },
    });

    const updated = await getSubscription(id);
    return NextResponse.json({
      data: updated,
      meta: { schema: "subscription" },
      message: immediate
        ? "Subscription cancelled immediately"
        : "Subscription will be cancelled at the end of the current billing period",
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    return NextResponse.json(
      { error: "Failed to cancel subscription" },
      { status: 500 }
    );
  }
}

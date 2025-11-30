import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { getCustomerByClerkId } from "@/lib/models/customer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
});

// POST /api/subscriptions/customer-portal - Create a Stripe Customer Portal session
export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { return_url } = body;

    // Get customer
    const customer = await getCustomerByClerkId(user.id);
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Check if customer has a Stripe ID
    if (!customer.stripe_customer_id) {
      return NextResponse.json(
        { error: "No Stripe customer associated with this account" },
        { status: 400 }
      );
    }

    // Create customer portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url:
        return_url ||
        `${process.env.NEXT_PUBLIC_APP_URL}/account/subscriptions`,
    });

    return NextResponse.json({
      data: {
        url: session.url,
      },
    });
  } catch (error) {
    console.error("Error creating customer portal session:", error);

    if (error instanceof Stripe.errors.StripeError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create customer portal session" },
      { status: 500 }
    );
  }
}

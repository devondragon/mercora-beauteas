/**
 * Payment Methods API
 *
 * GET: List customer's payment methods
 * POST: Add a new payment method
 * DELETE: Remove a payment method
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  listCustomerPaymentMethods,
  savePaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
  getPaymentMethod,
} from "@/lib/models/subscriptions";
import { getCustomer, updateCustomer } from "@/lib/models/mach/customer";
import { getStripeServer } from "@/lib/stripe";

/**
 * GET /api/payment-methods - List customer's payment methods
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const paymentMethods = await listCustomerPaymentMethods(userId);

    return NextResponse.json({
      data: paymentMethods,
      meta: {
        total: paymentMethods.length,
        schema: "payment_method",
      },
    });
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      { error: "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/payment-methods - Add a new payment method
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

    const body = await request.json();
    const { payment_method_id, set_as_default = false } = body;

    if (!payment_method_id) {
      return NextResponse.json(
        { error: "Missing required field: payment_method_id" },
        { status: 400 }
      );
    }

    const stripe = getStripeServer();
    if (!stripe) {
      return NextResponse.json(
        { error: "Payment processing is not configured" },
        { status: 500 }
      );
    }

    // Get customer and their Stripe customer ID
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
    await stripe.paymentMethods.attach(payment_method_id, {
      customer: stripeCustomerId,
    });

    // Set as default if requested
    if (set_as_default) {
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: payment_method_id,
        },
      });
    }

    // Get payment method details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id);

    // Save to our database
    let savedMethod;
    if (paymentMethod.type === "card" && paymentMethod.card) {
      savedMethod = await savePaymentMethod({
        customer_id: userId,
        stripe_payment_method_id: payment_method_id,
        stripe_customer_id: stripeCustomerId,
        type: "card",
        card_brand: paymentMethod.card.brand,
        card_last4: paymentMethod.card.last4,
        card_exp_month: paymentMethod.card.exp_month,
        card_exp_year: paymentMethod.card.exp_year,
        card_funding: paymentMethod.card.funding,
        is_default: set_as_default,
      });
    } else if (paymentMethod.type === "us_bank_account" && paymentMethod.us_bank_account) {
      savedMethod = await savePaymentMethod({
        customer_id: userId,
        stripe_payment_method_id: payment_method_id,
        stripe_customer_id: stripeCustomerId,
        type: "us_bank_account",
        bank_name: paymentMethod.us_bank_account.bank_name || undefined,
        bank_last4: paymentMethod.us_bank_account.last4 || undefined,
        is_default: set_as_default,
      });
    } else {
      savedMethod = await savePaymentMethod({
        customer_id: userId,
        stripe_payment_method_id: payment_method_id,
        stripe_customer_id: stripeCustomerId,
        type: paymentMethod.type as "card" | "bank_account" | "sepa_debit" | "us_bank_account" | "link",
        is_default: set_as_default,
      });
    }

    return NextResponse.json({
      data: savedMethod,
      meta: { schema: "payment_method" },
    }, { status: 201 });
  } catch (error) {
    console.error("Error adding payment method:", error);

    if (error instanceof Error) {
      if ("type" in error && (error as any).type === "StripeCardError") {
        return NextResponse.json(
          { error: "Invalid card. Please check your card details." },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to add payment method" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/payment-methods - Remove a payment method
 */
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const paymentMethodId = url.searchParams.get("id");

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: "Missing required parameter: id" },
        { status: 400 }
      );
    }

    // Get the payment method
    const paymentMethod = await getPaymentMethod(paymentMethodId);

    if (!paymentMethod) {
      return NextResponse.json(
        { error: "Payment method not found" },
        { status: 404 }
      );
    }

    if (paymentMethod.customer_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - can only remove your own payment methods" },
        { status: 403 }
      );
    }

    // Detach from Stripe
    const stripe = getStripeServer();
    if (stripe) {
      try {
        await stripe.paymentMethods.detach(paymentMethod.stripe_payment_method_id);
      } catch (stripeError) {
        console.error("Error detaching payment method from Stripe:", stripeError);
        // Continue to remove from our database even if Stripe fails
      }
    }

    // Remove from our database
    await removePaymentMethod(paymentMethodId);

    return NextResponse.json({
      message: "Payment method removed successfully",
    });
  } catch (error) {
    console.error("Error removing payment method:", error);
    return NextResponse.json(
      { error: "Failed to remove payment method" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/payment-methods - Set default payment method
 */
export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { id: paymentMethodId } = body;

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: "Missing required field: id" },
        { status: 400 }
      );
    }

    // Get the payment method
    const paymentMethod = await getPaymentMethod(paymentMethodId);

    if (!paymentMethod) {
      return NextResponse.json(
        { error: "Payment method not found" },
        { status: 404 }
      );
    }

    if (paymentMethod.customer_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized - can only update your own payment methods" },
        { status: 403 }
      );
    }

    // Update default in Stripe
    const stripe = getStripeServer();
    if (stripe && paymentMethod.stripe_customer_id) {
      await stripe.customers.update(paymentMethod.stripe_customer_id, {
        invoice_settings: {
          default_payment_method: paymentMethod.stripe_payment_method_id,
        },
      });
    }

    // Update in our database
    await setDefaultPaymentMethod(userId, paymentMethodId);

    return NextResponse.json({
      message: "Default payment method updated successfully",
    });
  } catch (error) {
    console.error("Error setting default payment method:", error);
    return NextResponse.json(
      { error: "Failed to set default payment method" },
      { status: 500 }
    );
  }
}

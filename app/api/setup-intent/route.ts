/**
 * POST /api/setup-intent
 *
 * Creates a Stripe SetupIntent for collecting payment method details
 * without an immediate charge. Used during subscription sign-up to
 * attach a payment method to a Stripe Customer for future off-session billing.
 *
 * Requires Clerk authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getStripeForWorkers } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, name } = (await req.json()) as {
      email: string;
      name: string;
    };

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const stripe = getStripeForWorkers();

    // Check for existing Stripe Customer linked to this Clerk user
    const existingCustomers = await stripe.customers.search({
      query: `metadata["clerk_user_id"]:"${userId}"`,
      limit: 1,
    });

    let stripeCustomerId: string;

    if (existingCustomers.data.length > 0) {
      stripeCustomerId = existingCustomers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: { clerk_user_id: userId },
      });
      stripeCustomerId = customer.id;
    }

    // Create SetupIntent for off-session future payments
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      customerId: stripeCustomerId,
    });
  } catch (error) {
    console.error('Error creating setup intent:', error);
    return NextResponse.json(
      { error: 'Failed to create setup intent' },
      { status: 500 }
    );
  }
}

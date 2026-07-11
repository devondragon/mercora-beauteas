/**
 * /api/subscriptions
 *
 * GET  - List authenticated user's subscriptions (enriched with plan details)
 * POST - Create a new subscription via Stripe (webhook handles D1 record)
 *
 * Requires Clerk authentication for both methods.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getStripeForWorkers } from '@/lib/stripe';
import {
  getSubscriptionsByCustomer,
  getSubscriptionPlanById,
} from '@/lib/models/mach/subscriptions';
import type { Address } from '@/lib/types';

// ─── GET /api/subscriptions ──────────────────────────────────────

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscriptions = await getSubscriptionsByCustomer(userId);

    // Enrich each subscription with its plan details
    const enriched = await Promise.all(
      subscriptions.map(async (sub) => {
        const plan = await getSubscriptionPlanById(sub.plan_id);
        return { ...sub, plan: plan ?? null };
      })
    );

    return NextResponse.json({ subscriptions: enriched });
  } catch (error) {
    console.error('Error listing subscriptions:', error);
    return NextResponse.json(
      { error: 'Failed to list subscriptions' },
      { status: 500 }
    );
  }
}

// ─── POST /api/subscriptions ─────────────────────────────────────

interface CreateSubscriptionBody {
  setupIntentId: string;
  planId: string;
  shippingAddress?: ClientShippingAddress;
}

/** Shape the subscription checkout client posts (SubscribeCheckoutClient.tsx). */
interface ClientShippingAddress {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
}

/**
 * Normalize the client-posted shipping address into a MACH Address, or return
 * null if it lacks the minimum fields to ship to (line1 + city + country).
 *
 * BMC-171: this address was previously collected at checkout but silently
 * dropped here. It is now forwarded to Stripe as subscription metadata so the
 * `customer.subscription.created` webhook can persist it on the D1 subscription
 * row, where the initial + renewal order-creation paths read it. Kept
 * non-blocking: an absent/partial address must not fail an otherwise-valid
 * subscription — the resulting order is simply created without an address for
 * the merchant to reconcile.
 */
function normalizeShippingAddress(
  input: ClientShippingAddress | undefined
): Address | null {
  if (!input) return null;
  const line1 = input.line1?.trim();
  const city = input.city?.trim();
  const country = input.country?.trim();
  if (!line1 || !city || !country) return null;

  const address: Address = { type: 'shipping', line1, city, country };
  if (input.line2?.trim()) address.line2 = input.line2.trim();
  if (input.region?.trim()) address.region = input.region.trim();
  if (input.postal_code?.trim()) address.postal_code = input.postal_code.trim();
  return address;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { setupIntentId, planId, shippingAddress } =
      (await req.json()) as CreateSubscriptionBody;

    if (!setupIntentId || !planId) {
      return NextResponse.json(
        { error: 'setupIntentId and planId are required' },
        { status: 400 }
      );
    }

    // Validate the plan exists
    const plan = await getSubscriptionPlanById(planId);
    if (!plan) {
      return NextResponse.json(
        { error: 'Subscription plan not found' },
        { status: 404 }
      );
    }

    if (!plan.is_active) {
      return NextResponse.json(
        { error: 'Subscription plan is no longer available' },
        { status: 400 }
      );
    }

    if (!plan.stripe_price_id) {
      return NextResponse.json(
        { error: 'Subscription plan has no Stripe price configured' },
        { status: 400 }
      );
    }

    const stripe = getStripeForWorkers();

    // Retrieve the confirmed SetupIntent to get the payment method. Expand the
    // customer so we can verify ownership from its metadata below.
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {
      expand: ['customer'],
    });

    // SECURITY (BMC-148): the setupIntentId is client-supplied, so we must not
    // trust the customer/payment-method embedded in it. Confirm the SetupIntent's
    // customer belongs to the calling Clerk user before billing anything to it —
    // otherwise an attacker who learns another user's seti_… could create a
    // subscription charged to that victim's payment method. The Clerk↔Stripe link
    // is the `clerk_user_id` metadata set at customer-creation time in
    // /api/setup-intent. Anything other than a live customer carrying the caller's
    // id (string ref, deleted customer, missing/mismatched metadata) fails closed.
    const setupIntentCustomer = setupIntent.customer;
    const ownerClerkId =
      setupIntentCustomer &&
      typeof setupIntentCustomer === 'object' &&
      !('deleted' in setupIntentCustomer)
        ? setupIntentCustomer.metadata?.clerk_user_id
        : undefined;

    // Uniform 403 for every case the caller can't legitimately act on: a
    // not-yet-succeeded intent and one owned by another user are indistinguishable
    // from the outside, so a client holding a candidate seti_… can't probe its
    // existence, status, or ownership.
    if (setupIntent.status !== 'succeeded' || ownerClerkId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'SetupIntent has no confirmed payment method' },
        { status: 400 }
      );
    }

    const stripeCustomerId =
      typeof setupIntent.customer === 'string'
        ? setupIntent.customer
        : setupIntent.customer?.id;

    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: 'SetupIntent has no associated customer' },
        { status: 400 }
      );
    }

    // Normalize the checkout shipping address (BMC-171). Forwarded via
    // subscription metadata so the webhook can persist it on the D1 row for the
    // initial + renewal order-creation paths. A Stripe metadata VALUE caps at
    // 500 chars; a normalized address JSON is well under that.
    const normalizedAddress = normalizeShippingAddress(shippingAddress);

    // Create the Stripe Subscription
    // The webhook handler (Phase 2) creates the D1 record and sends emails
    const stripeSubscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: plan.stripe_price_id }],
      default_payment_method: paymentMethodId,
      metadata: {
        customer_id: userId,
        plan_id: planId,
        product_id: plan.product_id,
        ...(normalizedAddress
          ? { shipping_address: JSON.stringify(normalizedAddress) }
          : {}),
      },
    });

    return NextResponse.json(
      {
        subscription: {
          id: stripeSubscription.id,
          status: stripeSubscription.status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating subscription:', error);
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    );
  }
}

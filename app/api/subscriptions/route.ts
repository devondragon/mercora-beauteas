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
import { rejectIfSubscriptionsDisabled } from '@/lib/sale/subscription-gate';
import {
  getSubscriptionsByCustomer,
  getSubscriptionPlanById,
} from '@/lib/models/mach/subscriptions';
import { normalizeShippableAddress } from '@/lib/utils/address';

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
 * BMC-171: the checkout shipping address was previously collected but silently
 * dropped here. It is now normalized (see `normalizeShippableAddress` —
 * line1 + city + a valid uppercase ISO-2 country required, else null) and
 * forwarded to Stripe as subscription metadata so the
 * `customer.subscription.created` webhook can persist it on the D1 subscription
 * row, where the initial + renewal order-creation paths read it. Kept
 * non-blocking: an absent/partial/invalid address must not fail an
 * otherwise-valid subscription — the resulting order is simply created without
 * an address for the merchant to reconcile.
 */

/** Stripe caps each metadata VALUE at 500 chars; a longer value fails the API call. */
const STRIPE_METADATA_VALUE_MAX = 500;

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Store policy, checked before the body is even parsed: nothing is created
    // and Stripe is never touched while subscriptions are off.
    const disabled = await rejectIfSubscriptionsDisabled();
    if (disabled) return disabled;

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
    // initial + renewal order-creation paths.
    const normalizedAddress = normalizeShippableAddress(
      shippingAddress as ClientShippingAddress | undefined
    );

    const metadata: Record<string, string> = {
      customer_id: userId,
      plan_id: planId,
      product_id: plan.product_id,
    };

    // Stripe caps each metadata VALUE at 500 chars. A normalized address JSON is
    // realistically well under that, but guard defensively: if it would exceed
    // the cap, omit the key (and log) rather than let stripe.subscriptions.create
    // reject the whole request — the address is non-critical and must never block
    // subscription creation.
    const shippingAddressJson = normalizedAddress
      ? JSON.stringify(normalizedAddress)
      : null;
    if (shippingAddressJson) {
      if (shippingAddressJson.length <= STRIPE_METADATA_VALUE_MAX) {
        metadata.shipping_address = shippingAddressJson;
      } else {
        console.warn(
          '[subscriptions] shipping_address metadata exceeds Stripe 500-char cap; omitting it',
          { length: shippingAddressJson.length }
        );
      }
    }

    // Create the Stripe Subscription
    // The webhook handler (Phase 2) creates the D1 record and sends emails
    const stripeSubscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: plan.stripe_price_id }],
      default_payment_method: paymentMethodId,
      metadata,
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

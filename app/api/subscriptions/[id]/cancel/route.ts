/**
 * POST /api/subscriptions/[id]/cancel
 *
 * Cancels a subscription at the end of the current billing period.
 * Uses cancel_at_period_end so the customer retains access until
 * the period they have already paid for expires.
 *
 * Requires Clerk authentication and subscription ownership.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getStripeForWorkers } from '@/lib/stripe';
import { getSubscriptionsByCustomer } from '@/lib/models/mach/subscriptions';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Ownership check
    const subscriptions = await getSubscriptionsByCustomer(userId);
    const subscription = subscriptions.find((sub) => sub.id === id);
    if (!subscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      );
    }

    const stripe = getStripeForWorkers();
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/subscriptions/[id]/skip
 *
 * Skips the next renewal by pausing with a resumes_at timestamp.
 * Uses pause_collection with behavior 'void' that auto-resumes
 * at the current period end.
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

    // Retrieve the Stripe subscription to get the current period end
    // Stripe API 2025-08-27.basil: period dates are on SubscriptionItem
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_id
    );
    const currentPeriodEnd =
      stripeSubscription.items.data[0]?.current_period_end;

    if (!currentPeriodEnd) {
      return NextResponse.json(
        { error: 'Unable to determine current billing period' },
        { status: 400 }
      );
    }

    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      pause_collection: {
        behavior: 'void',
        resumes_at: currentPeriodEnd,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error skipping subscription renewal:', error);
    return NextResponse.json(
      { error: 'Failed to skip subscription renewal' },
      { status: 500 }
    );
  }
}

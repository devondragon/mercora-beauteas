/**
 * POST /api/subscriptions/[id]/pause
 *
 * Pauses a subscription by setting pause_collection to 'void' in Stripe.
 * The webhook handler updates D1 automatically.
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
      pause_collection: { behavior: 'void' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error pausing subscription:', error);
    return NextResponse.json(
      { error: 'Failed to pause subscription' },
      { status: 500 }
    );
  }
}

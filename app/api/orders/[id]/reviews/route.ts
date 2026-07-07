import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getReviewsForOrder, submitReviewForOrderItem } from '@/lib/models';
import { errorDetails } from '@/lib/utils/error-response';
import type { ReviewSubmissionPayload } from '@/lib/types';

function resolveStatusFromError(message: string): number {
  const normalized = message.toLowerCase();
  if (normalized.includes('not found')) return 404;
  if (normalized.includes('only review products from your own orders')) return 403;
  if (normalized.includes('only review items after the order has been delivered')) return 409;
  if (normalized.includes('already submitted')) return 409;
  if (normalized.includes('prohibited content')) return 422;
  if (normalized.includes('required') || normalized.includes('must be')) return 400;
  return 400;
}

/**
 * Vetted, human-authored validation messages thrown by
 * `submitReviewForOrderItem()`. These are intentional user-facing copy (they
 * tell the customer *why* their submission was rejected), so they are echoed
 * back verbatim. Any other error — e.g. a raw DB/driver failure — is masked to
 * a generic message so internal detail never leaks in production (BMC-159).
 * Keep this in sync with the `throw new Error(...)` sites in
 * `lib/models/reviews.ts`.
 */
const KNOWN_REVIEW_ERROR_MESSAGES = new Set<string>([
  'Order ID is required.',
  'Product ID is required.',
  'Rating must be an integer between 1 and 5.',
  'Review body must be at least 30 characters long.',
  'Order not found.',
  'You can only review products from your own orders.',
  'You can only review items after the order has been delivered or returned.',
  'Order item could not be found for review.',
  'You have already submitted a review for this item.',
  'Review contains prohibited content.',
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const { id: orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required.' }, { status: 400 });
    }

    const reviews = await getReviewsForOrder(orderId, userId);
    return NextResponse.json({ data: reviews });
  } catch (error) {
    console.error('Failed to fetch order reviews', error);
    return NextResponse.json({ error: 'Unable to load reviews.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const { id: orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required.' }, { status: 400 });
    }

    const payload = await request.json() as ReviewSubmissionPayload;
    const review = await submitReviewForOrderItem({
      ...payload,
      orderId,
      customerId: userId,
    });

    return NextResponse.json({ data: review });
  } catch (error) {
    console.error('Failed to submit review', error);
    const message = error instanceof Error ? error.message : '';
    // Only echo back vetted validation copy; mask anything unexpected so raw
    // DB/internal errors don't leak in production (BMC-159).
    if (message && KNOWN_REVIEW_ERROR_MESSAGES.has(message)) {
      return NextResponse.json({ error: message }, { status: resolveStatusFromError(message) });
    }
    return NextResponse.json(
      { error: 'Unable to submit review.', details: errorDetails(error) },
      { status: 500 }
    );
  }
}

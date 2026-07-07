/**
 * Regression test for BMC-159 follow-up — the POST /api/orders/[id]/reviews
 * error-masking whitelist.
 *
 * PR #57 (BMC-159) gated raw error detail behind NODE_ENV across the API. The
 * reviews POST handler goes further: `submitReviewForOrderItem()` throws vetted,
 * human-authored *validation* copy (telling the customer why their submission
 * was rejected). Those messages are echoed back verbatim via an allow-list
 * (`KNOWN_REVIEW_ERROR_MESSAGES`); ANY other error — e.g. a raw D1/driver
 * failure — must be masked to a generic 500 so internal detail never leaks in
 * production.
 *
 * This test locks in that contract:
 *   - every whitelisted validation message is echoed verbatim with the correct
 *     4xx status (which also documents the whitelist ↔ model-message sync), and
 *   - an unexpected/raw error is masked to a generic 500 with no leaked detail,
 *     even when the model's raw message is present.
 *
 * Pure unit test (CI `npm test`): @clerk/nextjs/server and @/lib/models are
 * mocked so the handler runs with no Cloudflare Workers runtime dependency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/models', () => ({
  submitReviewForOrderItem: vi.fn(),
  getReviewsForOrder: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/[id]/reviews/route';
import { auth } from '@clerk/nextjs/server';
import { submitReviewForOrderItem } from '@/lib/models';

const ORDER_ID = 'WEB-user_owner-1751330000000';
const USER_ID = 'user_owner';

/**
 * The vetted validation messages `submitReviewForOrderItem()` throws, paired
 * with the HTTP status `resolveStatusFromError()` maps each to. This IS the
 * contract under test: it must stay in sync with both the route's
 * `KNOWN_REVIEW_ERROR_MESSAGES` whitelist AND the `throw new Error(...)` sites
 * in `lib/models/reviews.ts`. If a vetted message is added/renamed in the model
 * without updating the whitelist, its case here flips from an echoed 4xx to a
 * masked 500 and this table fails.
 */
const WHITELISTED_MESSAGES: Array<[message: string, status: number]> = [
  ['Order ID is required.', 400],
  ['Product ID is required.', 400],
  ['Rating must be an integer between 1 and 5.', 400],
  ['Review body must be at least 30 characters long.', 400],
  ['Order not found.', 404],
  ['You can only review products from your own orders.', 403],
  ['You can only review items after the order has been delivered or returned.', 409],
  ['Order item could not be found for review.', 400],
  ['You have already submitted a review for this item.', 409],
  ['Review contains prohibited content.', 422],
];

function postRequest(body: unknown = { productId: 'p1', rating: 5, body: 'x'.repeat(40) }) {
  return new NextRequest(`http://localhost/api/orders/${ORDER_ID}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callPOST() {
  return POST(postRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/orders/[id]/reviews error whitelist (BMC-159 follow-up)', () => {
  it('rejects an unauthenticated request with 401 before touching the model', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as any);

    const res = await callPOST();

    expect(res.status).toBe(401);
    expect(submitReviewForOrderItem).not.toHaveBeenCalled();
  });

  it.each(WHITELISTED_MESSAGES)(
    'echoes the vetted validation message %j verbatim with status %i',
    async (message, status) => {
      // Even in production, vetted validation copy is intentional user-facing
      // detail and must be echoed.
      vi.stubEnv('NODE_ENV', 'production');
      vi.mocked(submitReviewForOrderItem).mockRejectedValue(new Error(message));

      const res = await callPOST();
      const payload = (await res.json()) as { error: string; details?: unknown };

      expect(res.status).toBe(status);
      expect(payload.error).toBe(message);
      // The echoed branch never attaches raw `details`.
      expect(payload.details).toBeUndefined();
    }
  );

  it('masks an unexpected raw DB error to a generic 500 and leaks nothing in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const rawMessage = 'D1_ERROR: no such table: product_reviews';
    vi.mocked(submitReviewForOrderItem).mockRejectedValue(new Error(rawMessage));

    const res = await callPOST();
    const payload = (await res.json()) as { error: string; details?: unknown };

    expect(res.status).toBe(500);
    expect(payload.error).toBe('Unable to submit review.');
    // Raw internal detail is stripped in production...
    expect(payload.details).toBeUndefined();
    // ...and does not leak anywhere in the response body.
    expect(JSON.stringify(payload)).not.toContain('D1_ERROR');
    expect(JSON.stringify(payload)).not.toContain('product_reviews');
  });

  it('does not echo an arbitrary non-whitelisted message even if it looks validation-ish', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    // Close to a real message but NOT in the whitelist — must be masked.
    vi.mocked(submitReviewForOrderItem).mockRejectedValue(
      new Error('You have already submitted a review for this item today.')
    );

    const res = await callPOST();
    const payload = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(payload.error).toBe('Unable to submit review.');
  });

  it('exposes the raw error detail only in development (BMC-159 dev parity)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const rawMessage = 'D1_ERROR: connection reset';
    vi.mocked(submitReviewForOrderItem).mockRejectedValue(new Error(rawMessage));

    const res = await callPOST();
    const payload = (await res.json()) as { error: string; details?: string };

    expect(res.status).toBe(500);
    expect(payload.error).toBe('Unable to submit review.');
    // In development the generic message stays, but the detail is surfaced to aid debugging.
    expect(payload.details).toBe(rawMessage);
  });

  it('returns the created review on the success path', async () => {
    const review = {
      id: 'rev_1',
      product_id: 'p1',
      order_id: ORDER_ID,
      customer_id: USER_ID,
      rating: 5,
      body: 'x'.repeat(40),
      status: 'pending',
    };
    vi.mocked(submitReviewForOrderItem).mockResolvedValue(review as any);

    const res = await callPOST();
    const payload = (await res.json()) as { data: typeof review };

    expect(res.status).toBe(200);
    expect(payload.data).toEqual(review);
    expect(submitReviewForOrderItem).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, customerId: USER_ID })
    );
  });
});

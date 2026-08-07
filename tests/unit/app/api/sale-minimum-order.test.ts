/**
 * The 10-box minimum must hold server-side (GOOB).
 *
 * The cart drawer and checkout page prompt for it, but that copy is advisory —
 * a crafted request bypasses the UI entirely. These prove both money endpoints
 * refuse an under-minimum cart before any Stripe work happens.
 *
 * Same mocking shape as `payment-intent-catalog-guard.test.ts`: the handler
 * never touches the Workers runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(async () => ({ userId: null })) }));

const enforceRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

// Only the settings read is mocked; the pure rules run for real, so the test
// exercises the same box counting production uses.
const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: (...args: unknown[]) => getSaleRules(...args),
}));

import { NextRequest } from 'next/server';
import { POST as paymentIntentPost } from '@/app/api/payment-intent/route';
import { POST as ordersPost } from '@/app/api/orders/route';

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
  getSaleRules.mockResolvedValue({
    minimumBoxes: 10,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [{ max_boxes: null, cost: 22 }],
  });
});

const post = (handler: (req: NextRequest) => Promise<Response>, url: string, body: unknown) =>
  handler(
    new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

describe('POST /api/payment-intent — box minimum', () => {
  it('rejects a cart below the minimum with an actionable message', async () => {
    const res = await post(paymentIntentPost, 'http://localhost/api/payment-intent', {
      amount: 1200,
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 6 }],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Add 4 more boxes to check out. 10 box minimum.');
  });

  it('does not reject a cart at the minimum for this reason', async () => {
    const res = await post(paymentIntentPost, 'http://localhost/api/payment-intent', {
      amount: 2000,
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 10 }],
    });

    // Asserted unconditionally, not behind `if (res.status === 400)`: a gate
    // that had been silently disabled would return 200 here and a conditional
    // assertion would pass anyway, making this no control at all. Pin the exact
    // NEXT failure instead, which proves execution advanced past the gate.
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Shipping address is required');
  });

  it('rejects a cart with no items at all', async () => {
    const res = await post(paymentIntentPost, 'http://localhost/api/payment-intent', {
      amount: 2000,
      items: [],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/box minimum/);
  });

  it('gates on the order draft items when no top-level items are supplied', async () => {
    // Only `order.items` is present — the top-level `items` field a legacy or
    // crafted client might omit. The gate must still count from the draft.
    const res = await post(paymentIntentPost, 'http://localhost/api/payment-intent', {
      amount: 1200,
      shippingAddress: { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', recipient: 'A' },
      orderId: 'WEB-X-1',
      order: {
        items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 6 }],
        total_amount: { amount: 1200, currency: 'USD' },
        currency_code: 'USD',
      },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Add 4 more boxes to check out. 10 box minimum.');
  });
});

describe('POST /api/orders — box minimum', () => {
  const postOrders = (body: unknown) => post(ordersPost, 'http://localhost/api/orders', body);

  it('rejects a cart below the minimum with the identical message', async () => {
    const res = await postOrders({
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 6 }],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Add 4 more boxes to check out. 10 box minimum.');
  });

  it('does not reject a cart at the minimum for this reason', async () => {
    const res = await postOrders({
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 10 }],
      total_amount: { amount: 20000, currency: 'USD' },
      currency_code: 'USD',
    });

    // Unconditional for the same reason as the payment-intent case above. Here
    // the next failure is the unmocked D1 (`getDbAsync` resolves undefined),
    // which the route's catch turns into a 500.
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('Failed to create order');
  });
});

/**
 * The gate must count the list that actually PERSISTS.
 *
 * `persistPendingOrder` writes `order.items`, and the Stripe webhook later
 * promotes that row through `finalizePaidOrder` with no minimum check of its
 * own — so a request carrying a compliant top-level `items` decoy alongside a
 * sub-minimum `order.items` used to clear the gate and ship the small cart.
 */
describe('POST /api/payment-intent — gate counts the persisted list, not the decoy', () => {
  const withDraft = (topLevel: unknown[], draft: unknown[]) =>
    post(paymentIntentPost, 'http://localhost/api/payment-intent', {
      amount: 2000,
      shippingAddress: { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', recipient: 'A' },
      orderId: 'WEB-X-1',
      items: topLevel,
      order: {
        items: draft,
        total_amount: { amount: 2000, currency: 'USD' },
        currency_code: 'USD',
      },
    });

  it('rejects when the top-level items clear the minimum but the draft does not', async () => {
    const res = await withDraft(
      [{ productId: 'tea-1', variantId: 'var-1', quantity: 10 }],
      [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 2 }]
    );

    expect(res.status).toBe(400);
    // 8 short of 10 — the message describes the cart that would actually ship.
    expect(((await res.json()) as { error: string }).error).toBe(
      'Add 8 more boxes to check out. 10 box minimum.'
    );
  });

  it('counts an empty draft as zero boxes rather than falling back to the top-level list', async () => {
    const res = await withDraft([{ productId: 'tea-1', variantId: 'var-1', quantity: 10 }], []);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Add 10 more boxes to check out. 10 box minimum.'
    );
  });

  it('accepts matching lists at the minimum', async () => {
    const res = await withDraft(
      [{ productId: 'tea-1', variantId: 'var-1', quantity: 10 }],
      [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 10 }]
    );

    // Past both the minimum gate and the divergence check; fails later for an
    // unrelated reason (no Stripe/catalog in a unit test).
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.error ?? '').not.toMatch(/box minimum/);
    expect(body.code).not.toBe('cart_items_mismatch');
  });

  it('rejects divergent lists even when both clear the minimum', async () => {
    const res = await withDraft(
      [{ productId: 'tea-1', variantId: 'var-1', quantity: 12 }],
      [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 11 }]
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('cart_items_mismatch');
    expect(body.error).not.toMatch(/box minimum/);
  });

  it('rejects a swapped variant at an identical box count', async () => {
    const res = await withDraft(
      [{ productId: 'tea-1', variantId: 'var-1', quantity: 10 }],
      [{ product_id: 'tea-1', variant_id: 'var-CHEAP', quantity: 10 }]
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('cart_items_mismatch');
  });
});

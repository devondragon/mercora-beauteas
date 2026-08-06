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
    expect(body.error).toBe('Add 4 more boxes to check out — 10 box minimum.');
  });

  it('does not reject a cart at the minimum for this reason', async () => {
    const res = await post(paymentIntentPost, 'http://localhost/api/payment-intent', {
      amount: 2000,
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 10 }],
    });

    // It may still fail for unrelated reasons (no Stripe in a unit test); what
    // matters is that it is not the minimum-order rejection.
    if (res.status === 400) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/box minimum/);
    }
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
    expect(body.error).toBe('Add 4 more boxes to check out — 10 box minimum.');
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
    expect(body.error).toBe('Add 4 more boxes to check out — 10 box minimum.');
  });

  it('does not reject a cart at the minimum for this reason', async () => {
    const res = await postOrders({
      items: [{ product_id: 'tea-1', variant_id: 'var-1', quantity: 10 }],
      total_amount: { amount: 20000, currency: 'USD' },
      currency_code: 'USD',
    });

    // It may still fail for unrelated reasons (no D1 in a unit test); what
    // matters is that it is not the minimum-order rejection.
    if (res.status === 400) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/box minimum/);
    }
  });
});

/**
 * `sale.subscriptions_enabled` must be enforced server-side (GOOB).
 *
 * It used to be read only by the PDP (to hide the subscribe toggle) and by an
 * MCP tool (to reword a marketing blurb). Every route that actually starts
 * recurring billing ignored it, so a bookmarked subscribe page, a replayed
 * request, or a direct POST could still create a live Stripe subscription
 * during the closing sale — the UI-only gating anti-pattern docs/auth-model.md
 * warns about.
 *
 * These pin the four gated surfaces, the two deliberately-ungated ones, and the
 * fail-closed direction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  CALLER,
  retrieveSetupIntent,
  createSubscription,
  updateSubscription,
  retrieveSubscription,
  customersSearch,
  customersCreate,
  setupIntentsCreate,
  getSaleRules,
  getSubscriptionsByCustomer,
} = vi.hoisted(() => ({
  CALLER: 'user_caller',
  retrieveSetupIntent: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  retrieveSubscription: vi.fn(),
  customersSearch: vi.fn(),
  customersCreate: vi.fn(),
  setupIntentsCreate: vi.fn(),
  getSaleRules: vi.fn(),
  getSubscriptionsByCustomer: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: CALLER }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/stripe', () => ({
  getStripeForWorkers: vi.fn(() => ({
    setupIntents: { retrieve: retrieveSetupIntent, create: setupIntentsCreate },
    subscriptions: {
      create: createSubscription,
      update: updateSubscription,
      retrieve: retrieveSubscription,
    },
    customers: { search: customersSearch, create: customersCreate },
  })),
}));

vi.mock('@/lib/models/mach/subscriptions', () => ({
  getSubscriptionsByCustomer: (...a: unknown[]) => getSubscriptionsByCustomer(...a),
  getSubscriptionPlanById: vi.fn().mockResolvedValue({
    id: 'plan_1',
    is_active: true,
    stripe_price_id: 'price_1',
    product_id: 'prod_1',
  }),
}));

vi.mock('@/lib/sale/settings', () => ({ getSaleRules: (...a: unknown[]) => getSaleRules(...a) }));

import { NextRequest } from 'next/server';
import { SUBSCRIPTIONS_DISABLED_MESSAGE } from '@/lib/sale/rules';
import { POST as subscriptionsPost } from '@/app/api/subscriptions/route';
import { POST as setupIntentPost } from '@/app/api/setup-intent/route';
import { POST as resumePost } from '@/app/api/subscriptions/[id]/resume/route';
import { POST as skipPost } from '@/app/api/subscriptions/[id]/skip/route';
import { POST as pausePost } from '@/app/api/subscriptions/[id]/pause/route';
import { POST as cancelPost } from '@/app/api/subscriptions/[id]/cancel/route';

const SUB_ID = 'sub_local_1';

function req(url: string, body: unknown = {}) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: SUB_ID }) };

function saleRules(subscriptionsEnabled: boolean) {
  return { minimumBoxes: 10, finalSale: true, subscriptionsEnabled, tiers: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSaleRules.mockResolvedValue(saleRules(false));
  getSubscriptionsByCustomer.mockResolvedValue([
    { id: SUB_ID, stripe_subscription_id: 'sub_stripe_1', customer_id: CALLER },
  ]);
  retrieveSubscription.mockResolvedValue({ id: 'sub_stripe_1', items: { data: [] } });
  updateSubscription.mockResolvedValue({ id: 'sub_stripe_1' });
});

describe('surfaces that START recurring billing are gated', () => {
  it('POST /api/subscriptions refuses before parsing the body or calling Stripe', async () => {
    const res = await subscriptionsPost(
      req('http://localhost/api/subscriptions', { setupIntentId: 'seti_1', planId: 'plan_1' })
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(SUBSCRIPTIONS_DISABLED_MESSAGE);
    expect(createSubscription).not.toHaveBeenCalled();
    expect(retrieveSetupIntent).not.toHaveBeenCalled();
  });

  it('POST /api/setup-intent refuses before touching the Stripe customer', async () => {
    const res = await setupIntentPost(
      req('http://localhost/api/setup-intent', { email: 'a@b.com', name: 'Ada' })
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(SUBSCRIPTIONS_DISABLED_MESSAGE);
    expect(customersSearch).not.toHaveBeenCalled();
    expect(customersCreate).not.toHaveBeenCalled();
    expect(setupIntentsCreate).not.toHaveBeenCalled();
  });

  it('POST /api/subscriptions/[id]/resume refuses before the ownership lookup', async () => {
    const res = await resumePost(req(`http://localhost/api/subscriptions/${SUB_ID}/resume`), params);

    expect(res.status).toBe(403);
    expect(updateSubscription).not.toHaveBeenCalled();
    // Gate precedes ownership so a closed store never confirms an id exists.
    expect(getSubscriptionsByCustomer).not.toHaveBeenCalled();
  });

  it('POST /api/subscriptions/[id]/skip refuses — it schedules its own restart', async () => {
    const res = await skipPost(req(`http://localhost/api/subscriptions/${SUB_ID}/skip`), params);

    expect(res.status).toBe(403);
    expect(retrieveSubscription).not.toHaveBeenCalled();
    expect(updateSubscription).not.toHaveBeenCalled();
    expect(getSubscriptionsByCustomer).not.toHaveBeenCalled();
  });
});

describe('surfaces that STOP billing stay open', () => {
  it('pause still works while subscriptions are disabled', async () => {
    const res = await pausePost(req(`http://localhost/api/subscriptions/${SUB_ID}/pause`), params);

    expect(res.status).toBe(200);
    expect(updateSubscription).toHaveBeenCalledTimes(1);
  });

  it('cancel still works while subscriptions are disabled', async () => {
    // A customer must never be blocked from stopping a charge, least of all
    // during a going-out-of-business sale.
    const res = await cancelPost(req(`http://localhost/api/subscriptions/${SUB_ID}/cancel`), params);

    expect(res.status).toBe(200);
    expect(updateSubscription).toHaveBeenCalledTimes(1);
  });
});

describe('fail direction', () => {
  it('a settings read failure 500s without reaching Stripe', async () => {
    // The gate deliberately does NOT catch: the throw lands in the route's own
    // catch. If someone later "helpfully" wraps it in a try that defaults to
    // enabled, this test fails.
    getSaleRules.mockRejectedValue(new Error('D1 unavailable'));

    const res = await subscriptionsPost(
      req('http://localhost/api/subscriptions', { setupIntentId: 'seti_1', planId: 'plan_1' })
    );

    expect(res.status).toBe(500);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('lets a subscription through when the flag is on', async () => {
    getSaleRules.mockResolvedValue(saleRules(true));

    const res = await resumePost(req(`http://localhost/api/subscriptions/${SUB_ID}/resume`), params);

    expect(res.status).toBe(200);
    expect(updateSubscription).toHaveBeenCalledTimes(1);
  });
});

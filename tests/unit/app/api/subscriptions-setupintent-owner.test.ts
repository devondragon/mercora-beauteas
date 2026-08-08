/**
 * Regression test for BMC-148 (M5) — POST /api/subscriptions must verify the
 * client-supplied SetupIntent's Stripe customer belongs to the calling Clerk
 * user before creating a subscription.
 *
 * The route authenticates `userId` but takes `setupIntentId` verbatim from the
 * body and bills whatever customer/payment-method is embedded in that intent.
 * Without an ownership check, an attacker who learns another user's `seti_…`
 * could create a subscription charged to that victim's payment method. The fix
 * asserts the expanded customer's `metadata.clerk_user_id === userId`, failing
 * closed on any other shape (string ref, deleted customer, missing/mismatched
 * metadata).
 *
 * Pure unit test (CI `npm test`): Clerk auth, Stripe, and the subscriptions
 * model are mocked. The auth + ownership guards short-circuit before any
 * Cloudflare-binding call, so this is safe in the jsdom env.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock factories (which run before top-level code) can close
// over these without a "cannot access before initialization" error.
const { CALLER, retrieveSetupIntent, createSubscription } = vi.hoisted(() => ({
  CALLER: 'user_caller',
  retrieveSetupIntent: vi.fn(),
  createSubscription: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: CALLER }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/stripe', () => ({
  getStripeForWorkers: vi.fn(() => ({
    setupIntents: { retrieve: retrieveSetupIntent },
    subscriptions: { create: createSubscription },
  })),
}));

// This suite is about the SetupIntent ownership guard, not the sale gate that
// now precedes it — pin subscriptions ON so the pre-existing behaviour is what
// gets exercised. (Unmocked, getSaleRules reaches lib/db and 500s.) The gate
// itself is covered by subscriptions-sale-gate.test.ts.
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: vi.fn().mockResolvedValue({
    minimumBoxes: 10,
    finalSale: true,
    subscriptionsEnabled: true,
    tiers: [],
  }),
}));

vi.mock('@/lib/models/mach/subscriptions', () => ({
  getSubscriptionsByCustomer: vi.fn(),
  getSubscriptionPlanById: vi.fn().mockResolvedValue({
    id: 'plan_1',
    is_active: true,
    stripe_price_id: 'price_1',
    product_id: 'prod_1',
  }),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/subscriptions/route';

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A succeeded SetupIntent whose expanded customer carries the given clerk id. */
function setupIntentOwnedBy(clerkUserId: string | undefined) {
  return {
    status: 'succeeded',
    payment_method: 'pm_123',
    customer: {
      id: 'cus_victim',
      metadata: clerkUserId ? { clerk_user_id: clerkUserId } : {},
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createSubscription.mockResolvedValue({ id: 'sub_new', status: 'active' });
});

describe('POST /api/subscriptions SetupIntent ownership guard (BMC-148 / M5)', () => {
  it('rejects with 403 when the SetupIntent customer belongs to another user', async () => {
    retrieveSetupIntent.mockResolvedValue(setupIntentOwnedBy('user_victim'));

    const res = await POST(postRequest({ setupIntentId: 'seti_victim', planId: 'plan_1' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the SetupIntent has no customer attached', async () => {
    retrieveSetupIntent.mockResolvedValue({
      status: 'succeeded',
      payment_method: 'pm_123',
      customer: null,
    });

    const res = await POST(postRequest({ setupIntentId: 'seti_x', planId: 'plan_1' }));

    expect(res.status).toBe(403);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the customer has no clerk_user_id metadata', async () => {
    retrieveSetupIntent.mockResolvedValue(setupIntentOwnedBy(undefined));

    const res = await POST(postRequest({ setupIntentId: 'seti_x', planId: 'plan_1' }));

    expect(res.status).toBe(403);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('rejects with 403 for a non-owned SetupIntent regardless of status (not succeeded)', async () => {
    // A non-owner must never learn a candidate seti_…'s status: a not-succeeded
    // intent owned by someone else fails closed to 403, same as any other denial.
    retrieveSetupIntent.mockResolvedValue({
      status: 'requires_confirmation',
      payment_method: 'pm_123',
      customer: { id: 'cus_victim', metadata: { clerk_user_id: 'user_victim' } },
    });

    const res = await POST(postRequest({ setupIntentId: 'seti_victim', planId: 'plan_1' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the customer is an unexpanded string ref', async () => {
    retrieveSetupIntent.mockResolvedValue({
      status: 'succeeded',
      payment_method: 'pm_123',
      customer: 'cus_victim',
    });

    const res = await POST(postRequest({ setupIntentId: 'seti_x', planId: 'plan_1' }));

    expect(res.status).toBe(403);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the customer was deleted', async () => {
    retrieveSetupIntent.mockResolvedValue({
      status: 'succeeded',
      payment_method: 'pm_123',
      customer: { id: 'cus_gone', deleted: true },
    });

    const res = await POST(postRequest({ setupIntentId: 'seti_x', planId: 'plan_1' }));

    expect(res.status).toBe(403);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('rejects with a uniform 403 when the caller-owned SetupIntent has not succeeded', async () => {
    // Hardening (BMC-148 review): a not-yet-succeeded intent returns the same
    // 403/Forbidden as a not-owned one — no 400 with the raw status string that
    // would let a caller probe a candidate seti_… for its lifecycle stage.
    retrieveSetupIntent.mockResolvedValue({
      status: 'processing',
      payment_method: 'pm_123',
      customer: { id: 'cus_mine', metadata: { clerk_user_id: CALLER } },
    });

    const res = await POST(postRequest({ setupIntentId: 'seti_mine', planId: 'plan_1' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('creates the subscription when the SetupIntent customer belongs to the caller', async () => {
    retrieveSetupIntent.mockResolvedValue(setupIntentOwnedBy(CALLER));

    const res = await POST(postRequest({ setupIntentId: 'seti_mine', planId: 'plan_1' }));

    expect(res.status).toBe(201);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_victim',
        default_payment_method: 'pm_123',
        metadata: expect.objectContaining({ customer_id: CALLER, plan_id: 'plan_1' }),
      })
    );
  });

  it('expands the customer when retrieving the SetupIntent', async () => {
    retrieveSetupIntent.mockResolvedValue(setupIntentOwnedBy(CALLER));

    await POST(postRequest({ setupIntentId: 'seti_mine', planId: 'plan_1' }));

    expect(retrieveSetupIntent).toHaveBeenCalledWith('seti_mine', { expand: ['customer'] });
  });
});

describe('POST /api/subscriptions shipping_address metadata (BMC-171)', () => {
  beforeEach(() => {
    retrieveSetupIntent.mockResolvedValue(setupIntentOwnedBy(CALLER));
  });

  function metadataFromCreateCall() {
    return createSubscription.mock.calls[0][0].metadata as Record<string, string>;
  }

  it('forwards a valid shipping address as normalized JSON metadata (country uppercased)', async () => {
    const res = await POST(
      postRequest({
        setupIntentId: 'seti_mine',
        planId: 'plan_1',
        shippingAddress: {
          line1: '1 Tea Rd',
          city: 'Portland',
          region: 'OR',
          postal_code: '97201',
          country: 'us',
        },
      })
    );

    expect(res.status).toBe(201);
    const metadata = metadataFromCreateCall();
    expect(metadata.shipping_address).toBeDefined();
    expect(JSON.parse(metadata.shipping_address)).toEqual({
      type: 'shipping',
      line1: '1 Tea Rd',
      city: 'Portland',
      region: 'OR',
      postal_code: '97201',
      country: 'US',
    });
  });

  it('omits the metadata key (still creates the subscription) when no address is posted', async () => {
    const res = await POST(postRequest({ setupIntentId: 'seti_mine', planId: 'plan_1' }));

    expect(res.status).toBe(201);
    expect(metadataFromCreateCall().shipping_address).toBeUndefined();
  });

  it('drops an invalid address (non-ISO-2 country) rather than storing it', async () => {
    const res = await POST(
      postRequest({
        setupIntentId: 'seti_mine',
        planId: 'plan_1',
        shippingAddress: { line1: '1 Tea Rd', city: 'Portland', country: 'United States' },
      })
    );

    expect(res.status).toBe(201);
    expect(metadataFromCreateCall().shipping_address).toBeUndefined();
  });

  it('omits the address (never fails creation) when the JSON would exceed Stripe 500-char cap', async () => {
    const res = await POST(
      postRequest({
        setupIntentId: 'seti_mine',
        planId: 'plan_1',
        shippingAddress: {
          line1: 'A'.repeat(600),
          city: 'Portland',
          country: 'US',
        },
      })
    );

    // Degrades gracefully: subscription still created, oversized metadata dropped.
    expect(res.status).toBe(201);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(metadataFromCreateCall().shipping_address).toBeUndefined();
  });
});

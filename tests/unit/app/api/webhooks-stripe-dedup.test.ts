/**
 * Regression test for BMC-153 / L3 — Stripe webhook dedup TOCTOU.
 *
 * The route used to do a `SELECT` dedup check (isWebhookEventProcessed) and
 * only record the event as processed *after* the handler finished
 * (recordWebhookEvent). Two concurrent duplicate deliveries of the same event
 * could both pass the "not yet processed" read before either write landed,
 * so both would run the handler.
 *
 * The fix makes the PK insert itself the atomic dedup gate: claimWebhookEvent
 * is attempted BEFORE the handler runs, and a UNIQUE/PK violation (modeled
 * here by claimWebhookEvent resolving to `false`, exactly as the real
 * implementation does on a constraint violation — see
 * lib/models/mach/subscriptions.ts) means the delivery is a duplicate and
 * must skip the handler entirely. A handler failure after a successful claim
 * must release the claim so a legitimate Stripe retry isn't skipped forever.
 *
 * Runs in the jsdom unit env (CI `npm test`). Mocking @/lib/stripe,
 * @/lib/models/mach/subscriptions, the event handler modules, and the legacy
 * payment helper modules keeps lib/db.ts / @opennextjs/cloudflare and the
 * real Stripe SDK network calls out of the import graph entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above top-level const declarations, so the
// fake event must be created via vi.hoisted() to be visible inside them.
const { fakeEvent } = vi.hoisted(() => ({
  fakeEvent: {
    id: 'evt_test_123',
    type: 'customer.subscription.created',
    data: { object: { id: 'sub_test_123' } },
  },
}));

vi.mock('@/lib/stripe', () => ({
  verifyWebhookSignature: vi.fn().mockResolvedValue(fakeEvent),
  getWebhookSecret: vi.fn().mockReturnValue('whsec_test'),
}));

vi.mock('@/lib/models/mach/subscriptions', () => ({
  claimWebhookEvent: vi.fn(),
  releaseWebhookEventClaim: vi.fn().mockResolvedValue(undefined),
  cleanupOldWebhookEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/subscription-handlers', () => ({
  handleSubscriptionCreated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/invoice-handlers', () => ({
  handleInvoicePaymentSucceeded: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue(undefined),
  handleInvoiceUpcoming: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrderById: vi.fn(),
  markOrderPaid: vi.fn(),
}));

vi.mock('@/lib/services/gift-card-fulfillment', () => ({
  processGiftCardsForOrder: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/stripe/route';
import { claimWebhookEvent, releaseWebhookEventClaim } from '@/lib/models/mach/subscriptions';
import { handleSubscriptionCreated } from '@/app/api/webhooks/stripe/handlers/subscription-handlers';

const url = 'http://localhost/api/webhooks/stripe';

function makeRequest() {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify({ id: fakeEvent.id }),
    headers: { 'stripe-signature': 't=1,v1=test-signature' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks only wipes call history, not implementations set via
  // mockResolvedValue/mockRejectedValue in a previous test — restore the
  // "handler succeeds" default explicitly so tests don't leak into each other.
  vi.mocked(handleSubscriptionCreated).mockResolvedValue(undefined);
});

describe('POST /api/webhooks/stripe dedup gate (BMC-153 / L3)', () => {
  it('first delivery: claims the event, runs the handler once, returns 200', async () => {
    vi.mocked(claimWebhookEvent).mockResolvedValue(true);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(vi.mocked(claimWebhookEvent)).toHaveBeenCalledWith(fakeEvent.id, fakeEvent.type);
    expect(vi.mocked(handleSubscriptionCreated)).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(vi.mocked(releaseWebhookEventClaim)).not.toHaveBeenCalled();
  });

  it('duplicate delivery: claim loses the PK race, handler never runs, returns 200 duplicate', async () => {
    vi.mocked(claimWebhookEvent).mockResolvedValue(false);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(vi.mocked(claimWebhookEvent)).toHaveBeenCalledWith(fakeEvent.id, fakeEvent.type);
    expect(vi.mocked(handleSubscriptionCreated)).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: true });
  });

  it('handler failure after a successful claim releases the claim and returns 500 for retry', async () => {
    vi.mocked(claimWebhookEvent).mockResolvedValue(true);
    vi.mocked(handleSubscriptionCreated).mockRejectedValue(new Error('boom'));

    const res = await POST(makeRequest());

    expect(vi.mocked(handleSubscriptionCreated)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(releaseWebhookEventClaim)).toHaveBeenCalledWith(fakeEvent.id);
    expect(res.status).toBe(500);
  });

  it('two concurrent duplicate deliveries: only the winning claim runs the handler', async () => {
    // Simulate the PK race directly: the first insert wins (true), the second
    // hits the UNIQUE/PK violation and claimWebhookEvent resolves false —
    // exactly the behavior the real DB-backed implementation guarantees
    // because event_id is a PRIMARY KEY column (see
    // lib/db/schema/webhook-events.ts) and D1/SQLite serializes the inserts.
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const [first, second] = await Promise.all([POST(makeRequest()), POST(makeRequest())]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);

    expect(vi.mocked(handleSubscriptionCreated)).toHaveBeenCalledTimes(1);
    expect([firstBody, secondBody]).toContainEqual({ received: true });
    expect([firstBody, secondBody]).toContainEqual({ received: true, duplicate: true });
  });
});

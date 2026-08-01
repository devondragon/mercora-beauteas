/**
 * BMC-213: the webhook route must actually ROUTE `charge.refunded` to the
 * reconciliation handler.
 *
 * The handler's own behaviour is covered in
 * webhooks-stripe-charge-refunded.test.ts. This pins the wiring — before this
 * ticket `charge.refunded` fell through to `default:` and only logged, which is
 * precisely how a Dashboard refund stayed invisible. A future edit that drops
 * the `case` would restore the money-loss path silently, so the dispatch itself
 * gets a guard.
 *
 * Every seam is mocked so this runs in the jsdom unit env (the CI-gated suite).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeEvent } = vi.hoisted(() => ({
  fakeEvent: {
    id: 'evt_charge_refunded_dispatch',
    type: 'charge.refunded',
    data: {
      object: { id: 'ch_test_123', payment_intent: 'pi_test_123', amount_refunded: 5000 },
    },
  },
}));

vi.mock('@/lib/stripe', () => ({
  verifyWebhookSignature: vi.fn().mockResolvedValue(fakeEvent),
  getWebhookSecret: vi.fn().mockReturnValue('whsec_test'),
}));

vi.mock('@/lib/models/mach/subscriptions', () => ({
  claimWebhookEvent: vi.fn().mockResolvedValue(true),
  releaseWebhookEventClaim: vi.fn().mockResolvedValue(undefined),
  cleanupOldWebhookEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/subscription-handlers', () => ({
  handleSubscriptionCreated: vi.fn(),
  handleSubscriptionUpdated: vi.fn(),
  handleSubscriptionDeleted: vi.fn(),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/invoice-handlers', () => ({
  handleInvoicePaymentSucceeded: vi.fn(),
  handleInvoicePaymentFailed: vi.fn(),
  handleInvoiceUpcoming: vi.fn(),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/refund-handlers', () => ({
  handleChargeRefunded: vi.fn().mockResolvedValue(undefined),
  handleRefundLifecycle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/models/mach/orders', () => ({ getOrderById: vi.fn() }));
vi.mock('@/lib/services/order-finalization', () => ({ finalizePaidOrder: vi.fn() }));
vi.mock('@/lib/utils/observe', () => ({ logCritical: vi.fn() }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/stripe/route';
import {
  handleChargeRefunded,
  handleRefundLifecycle,
} from '@/app/api/webhooks/stripe/handlers/refund-handlers';
import { releaseWebhookEventClaim } from '@/lib/models/mach/subscriptions';

/** The `charge.refunded` shape every test starts from (see `resetEvent`). */
const CHARGE_REFUNDED = {
  id: 'evt_charge_refunded_dispatch',
  type: 'charge.refunded',
  data: { object: { id: 'ch_test_123', payment_intent: 'pi_test_123', amount_refunded: 5000 } },
};

/**
 * `verifyWebhookSignature` resolves the SAME object reference every call, so a
 * test selects an event type by rewriting that object in place.
 */
function resetEvent() {
  Object.assign(fakeEvent, structuredClone(CHARGE_REFUNDED));
}

function post() {
  return new NextRequest('https://shop.beauteas.com/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    body: JSON.stringify(fakeEvent),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEvent();
});

describe('POST /api/webhooks/stripe — charge.refunded dispatch', () => {
  it('routes the event to the reconciliation handler', async () => {
    const res = await POST(post());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(handleChargeRefunded).toHaveBeenCalledTimes(1);
    expect(handleChargeRefunded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ch_test_123', amount_refunded: 5000 }),
      fakeEvent.id
    );
  });

  it('releases the dedup claim and 500s when reconciliation fails, so Stripe retries', async () => {
    vi.mocked(handleChargeRefunded).mockRejectedValueOnce(new Error('ledger write failed'));

    const res = await POST(post());

    expect(res.status).toBe(500);
    // Without the release, the PK row from this failed attempt would make every
    // legitimate Stripe retry look like a duplicate and skip forever.
    expect(releaseWebhookEventClaim).toHaveBeenCalledWith(fakeEvent.id);
  });
});

/**
 * BMC-224: `charge.refunded` alone cannot resume a refund it recorded as
 * `pending` — it fires at refund creation and never re-fires. These three event
 * types are the only ones that do, so the dispatch gets the same guard: dropping
 * a `case` here silently restores the stuck-refund path.
 */
describe('POST /api/webhooks/stripe — refund lifecycle dispatch', () => {
  const REFUND = { id: 're_test_123', charge: 'ch_test_123', amount: 5000 };

  it.each([
    ['refund.updated', 'succeeded'],
    ['refund.failed', 'failed'],
    // The legacy name, which fires only on selected payment methods — routed for
    // completeness, never a substitute for the two above.
    ['charge.refund.updated', 'succeeded'],
  ])('routes %s to the lifecycle handler', async (type, status) => {
    Object.assign(fakeEvent, {
      id: `evt_${type}`,
      type,
      data: { object: { ...REFUND, status } },
    });

    const res = await POST(post());

    expect(res.status).toBe(200);
    expect(handleChargeRefunded).not.toHaveBeenCalled();
    expect(handleRefundLifecycle).toHaveBeenCalledTimes(1);
    // The event TYPE is passed through — the handler logs against it, and the
    // three names are not interchangeable operationally.
    expect(handleRefundLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 're_test_123', status }),
      `evt_${type}`,
      type
    );
  });

  it('releases the dedup claim and 500s when the lifecycle handler fails', async () => {
    Object.assign(fakeEvent, {
      id: 'evt_refund_updated_boom',
      type: 'refund.updated',
      data: { object: { ...REFUND, status: 'succeeded' } },
    });
    vi.mocked(handleRefundLifecycle).mockRejectedValueOnce(new Error('charge unreadable'));

    const res = await POST(post());

    expect(res.status).toBe(500);
    expect(releaseWebhookEventClaim).toHaveBeenCalledWith('evt_refund_updated_boom');
  });
});

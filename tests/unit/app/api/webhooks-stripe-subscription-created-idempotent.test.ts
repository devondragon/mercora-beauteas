/**
 * Regression test for BMC-182 — handleSubscriptionCreated must be idempotent on
 * Stripe redelivery.
 *
 * The bug: handleSubscriptionCreated unconditionally inserted the subscription
 * row (stripe_subscription_id is UNIQUE) and then did more awaited work
 * (createSubscriptionEvent, getCustomerDetails). If anything AFTER the insert
 * threw, the route released the dedup claim and returned 500; Stripe redelivered;
 * the handler reran and the insert now hit the UNIQUE violation (uncaught) →
 * 500 → release → retry, looping forever. The row existed but the `created`
 * audit event + welcome email never landed.
 *
 * The fix (exercised end-to-end here over a mocked D1):
 *  (a) the handler short-circuits when a row with that stripe_subscription_id
 *      already exists — a redelivery is a safe no-op (no second insert, no throw);
 *  (b) createCustomerSubscriptionWithCreatedEvent batches the row + `created`
 *      event atomically and, on a concurrent-redelivery UNIQUE violation, returns
 *      the existing row with `created: false` instead of throwing (so the route
 *      does not 500). The handler then skips the duplicate welcome email.
 *
 * Mocking style follows tests/unit/app/api/webhooks-stripe-dedup.test.ts: the
 * D1/db layer (@/lib/db) is mocked, so the REAL handler + REAL model functions
 * run without ever importing @opennextjs/cloudflare's getCloudflareContext().
 * The Stripe/email/product-name boundaries (handlers/utils.ts, @/lib/utils/email)
 * and BASE_URL (@/lib/seo/metadata) are mocked to keep the SDK + env out too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// A minimal chainable fake of the Drizzle `db`. `select(...).from(...).where(...)
// .limit(...)` resolves to the next array queued on `state.selectQueue` (shifted
// in call order); `batch(...)` is a spy configured per test; `insert(...)` returns
// an inert builder because the real batch call is what we stub. vi.hoisted keeps
// these visible inside the hoisted vi.mock factory below.
const { fakeDb, state, batchSpy } = vi.hoisted(() => {
  const state = { selectQueue: [] as unknown[][] };
  const selectChain: Record<string, unknown> = {};
  selectChain.from = () => selectChain;
  selectChain.where = () => selectChain;
  selectChain.limit = () => Promise.resolve(state.selectQueue.shift() ?? []);

  const insertChain: Record<string, unknown> = {};
  insertChain.values = () => insertChain;
  insertChain.returning = () => insertChain;

  const batchSpy = vi.fn();
  const fakeDb = {
    select: () => selectChain,
    insert: () => insertChain,
    batch: batchSpy,
  };
  return { fakeDb, state, batchSpy };
});

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn().mockResolvedValue(fakeDb),
  getDb: vi.fn().mockReturnValue(fakeDb),
}));

vi.mock('@/lib/utils/email', () => ({
  sendSubscriptionEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/utils', () => ({
  getCustomerDetails: vi.fn().mockResolvedValue({ email: 'shopper@example.com', name: 'Tea Fan' }),
  getProductName: vi.fn().mockResolvedValue('Morning Blend'),
}));

vi.mock('@/lib/seo/metadata', () => ({
  BASE_URL: 'https://test.example',
}));

import { handleSubscriptionCreated } from '@/app/api/webhooks/stripe/handlers/subscription-handlers';
import { createCustomerSubscriptionWithCreatedEvent } from '@/lib/models/mach/subscriptions';
import { sendSubscriptionEmail } from '@/lib/utils/email';

const STRIPE_SUB_ID = 'sub_stripe_123';

const fakeSubscription = {
  id: STRIPE_SUB_ID,
  customer: 'cus_stripe_123',
  status: 'active',
  metadata: { customer_id: 'CUST-1' },
  items: {
    data: [
      {
        price: { id: 'price_123' },
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
      },
    ],
  },
} as unknown as Stripe.Subscription;

const existingSub = {
  id: 'SUB-EXISTING',
  stripe_subscription_id: STRIPE_SUB_ID,
  customer_id: 'CUST-1',
  plan_id: 'PLN-1',
  status: 'active',
};

const fakePlan = {
  id: 'PLN-1',
  product_id: 'PROD-1',
  frequency: 'monthly',
  discount_percent: 10,
  stripe_price_id: 'price_123',
  is_active: true,
};

// D1/SQLite surfaces UNIQUE violations with this text; isUniqueViolation() matches it.
const uniqueViolation = () =>
  new Error('D1_ERROR: UNIQUE constraint failed: customer_subscriptions.stripe_subscription_id');

beforeEach(() => {
  // clearAllMocks wipes call history but keeps implementations, so the
  // vi.mock factory defaults (getDbAsync → fakeDb, sendSubscriptionEmail →
  // resolves) survive across tests. batchSpy is the exception: reset it so a
  // previous test's queued *Once impl can't leak into the next.
  vi.clearAllMocks();
  batchSpy.mockReset();
  state.selectQueue = [];
});

describe('handleSubscriptionCreated idempotency (BMC-182)', () => {
  it('(a) redelivery where the row already exists → no-op: no second insert, no throw, no email', async () => {
    // First (and only) DB read — getSubscriptionByStripeId — finds the row.
    state.selectQueue = [[existingSub]];

    await expect(handleSubscriptionCreated(fakeSubscription, 'evt_redelivery')).resolves.toBeUndefined();

    expect(batchSpy).not.toHaveBeenCalled(); // never re-inserts
    expect(vi.mocked(sendSubscriptionEmail)).not.toHaveBeenCalled(); // no duplicate email
  });

  it('(b) UNIQUE-violation race → createCustomerSubscriptionWithCreatedEvent returns created:false, no throw', async () => {
    batchSpy.mockRejectedValueOnce(uniqueViolation());
    // The catch re-reads the now-committed row via getSubscriptionByStripeId.
    state.selectQueue = [[existingSub]];

    const result = await createCustomerSubscriptionWithCreatedEvent(
      {
        customer_id: 'CUST-1',
        plan_id: 'PLN-1',
        stripe_subscription_id: STRIPE_SUB_ID,
        stripe_customer_id: 'cus_stripe_123',
        status: 'active',
      },
      'evt_race'
    );

    expect(result).toEqual({ subscription: existingSub, created: false });
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it('(b) redelivery race through the handler → skips the duplicate email and does not throw (no 500)', async () => {
    // getSubscriptionByStripeId (pre-check) → none; plan lookup → plan; then the
    // atomic insert races a UNIQUE violation; the catch re-reads → existing row.
    state.selectQueue = [[], [fakePlan], [existingSub]];
    batchSpy.mockRejectedValueOnce(uniqueViolation());

    await expect(handleSubscriptionCreated(fakeSubscription, 'evt_race_handler')).resolves.toBeUndefined();

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSubscriptionEmail)).not.toHaveBeenCalled();
  });

  it('a non-UNIQUE DB error still propagates (so a genuine failure is retried, not swallowed)', async () => {
    batchSpy.mockRejectedValueOnce(new Error('D1_ERROR: database is locked'));

    await expect(
      createCustomerSubscriptionWithCreatedEvent(
        {
          customer_id: 'CUST-1',
          plan_id: 'PLN-1',
          stripe_subscription_id: STRIPE_SUB_ID,
          stripe_customer_id: 'cus_stripe_123',
          status: 'active',
        },
        'evt_boom'
      )
    ).rejects.toThrow(/database is locked/);
  });

  it('first delivery: inserts row + created event atomically and sends the welcome email once', async () => {
    const newSub = { ...existingSub, id: 'SUB-NEW' };
    // getSubscriptionByStripeId (pre-check) → none; plan lookup → plan.
    state.selectQueue = [[], [fakePlan]];
    // db.batch resolves [subRows, eventResult]; model reads subRows[0].
    batchSpy.mockResolvedValueOnce([[newSub], undefined]);

    await expect(handleSubscriptionCreated(fakeSubscription, 'evt_first')).resolves.toBeUndefined();

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSubscriptionEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSubscriptionEmail)).toHaveBeenCalledWith('created', expect.objectContaining({
      subscriptionId: 'SUB-NEW',
      customerEmail: 'shopper@example.com',
    }));
  });

  // BMC-186: the ARL recurring-terms line in the `created` email must state the
  // real per-cycle charge, derived from the Stripe price (unit_amount × quantity).
  it('derives the ARL `amount` from the Stripe price (unit_amount × quantity)', async () => {
    const newSub = { ...existingSub, id: 'SUB-AMT' };
    state.selectQueue = [[], [fakePlan]];
    batchSpy.mockResolvedValueOnce([[newSub], undefined]);

    const pricedSubscription = {
      ...fakeSubscription,
      items: {
        data: [
          {
            price: { id: 'price_123', unit_amount: 1999 },
            quantity: 2,
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
          },
        ],
      },
    } as unknown as Stripe.Subscription;

    await handleSubscriptionCreated(pricedSubscription, 'evt_amount');

    expect(vi.mocked(sendSubscriptionEmail)).toHaveBeenCalledWith(
      'created',
      expect.objectContaining({ amount: 3998 })
    );
  });

  it('leaves `amount` undefined when the Stripe price has no unit_amount', async () => {
    const newSub = { ...existingSub, id: 'SUB-NOAMT' };
    state.selectQueue = [[], [fakePlan]];
    batchSpy.mockResolvedValueOnce([[newSub], undefined]);

    // fakeSubscription's item has `price: { id }` only — no unit_amount.
    await handleSubscriptionCreated(fakeSubscription, 'evt_noamt');

    const lastCall = vi.mocked(sendSubscriptionEmail).mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('created');
    expect((lastCall?.[1] as { amount?: number }).amount).toBeUndefined();
  });
});

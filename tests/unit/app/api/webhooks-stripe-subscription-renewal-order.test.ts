/**
 * Regression test for BMC-171 — subscription invoices must create a fulfillable,
 * paid order.
 *
 * The bug: handleInvoicePaymentSucceeded only wrote a `renewed` audit event +
 * email and, for the initial invoice, returned early — it never created an
 * order, so subscription shipments (initial and every renewal) were invisible to
 * the admin Orders screen. This exercises the fix: the handler now delegates to
 * createSubscriptionOrder for BOTH the initial (`subscription_create`) and renewal
 * invoices, keeping the renewal-only audit event + email, and self-heals the
 * initial-invoice-before-row race by throwing so Stripe retries.
 *
 * Mocking style mirrors webhooks-stripe-subscription-created-idempotent.test.ts:
 * the model + helper boundaries are mocked so the REAL handler runs without the
 * Workers runtime. createSubscriptionOrder is a spy — its own logic is covered in
 * webhooks-stripe-subscription-order-idempotent.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('@/app/api/webhooks/stripe/handlers/subscription-order', () => ({
  createSubscriptionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/models/mach/subscriptions', () => ({
  getSubscriptionByStripeId: vi.fn(),
  getSubscriptionPlanById: vi.fn(),
  createSubscriptionEvent: vi.fn().mockResolvedValue(undefined),
  updateSubscriptionStatus: vi.fn().mockResolvedValue(undefined),
  updateSubscriptionPeriod: vi.fn().mockResolvedValue(undefined),
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

import { handleInvoicePaymentSucceeded } from '@/app/api/webhooks/stripe/handlers/invoice-handlers';
import { createSubscriptionOrder } from '@/app/api/webhooks/stripe/handlers/subscription-order';
import {
  getSubscriptionByStripeId,
  getSubscriptionPlanById,
  createSubscriptionEvent,
} from '@/lib/models/mach/subscriptions';
import { sendSubscriptionEmail } from '@/lib/utils/email';

const STRIPE_SUB_ID = 'sub_123';

const d1Sub = {
  id: 'SUB-1',
  stripe_subscription_id: STRIPE_SUB_ID,
  customer_id: 'CUST-1',
  plan_id: 'PLN-1',
  status: 'active',
  shipping_address: { type: 'shipping', line1: '1 Tea Rd', city: 'Portland', region: 'OR', country: 'US' },
};

const fakePlan = { id: 'PLN-1', product_id: 'PROD-1', frequency: 'monthly', stripe_price_id: 'price_1' };

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function invoice(overrides: Record<string, unknown>): Stripe.Invoice {
  return {
    id: 'in_default',
    parent: { subscription_details: { subscription: STRIPE_SUB_ID } },
    amount_paid: 2249,
    currency: 'usd',
    customer: 'cus_1',
    created: NOW_SECONDS, // fresh: within the initial-invoice race grace window
    lines: { data: [{ period: { start: 1_700_000_000, end: 1_702_592_000 } }] },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubscriptionPlanById).mockResolvedValue(fakePlan as never);
});

describe('handleInvoicePaymentSucceeded creates orders (BMC-171)', () => {
  it('renewal invoice → creates a renewal order AND keeps the renewed audit event + email', async () => {
    vi.mocked(getSubscriptionByStripeId).mockResolvedValue(d1Sub as never);

    await handleInvoicePaymentSucceeded(
      invoice({ id: 'in_renew_1', billing_reason: 'subscription_cycle' }),
      'evt_renew'
    );

    expect(vi.mocked(createSubscriptionOrder)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSubscriptionOrder)).toHaveBeenCalledWith({
      subscription: d1Sub,
      invoiceId: 'in_renew_1',
      amountPaidMinor: 2249,
      currency: 'USD',
      kind: 'renewal',
    });
    // Renewal-specific side effects still run.
    expect(vi.mocked(createSubscriptionEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_id: 'SUB-1', event_type: 'renewed' })
    );
    expect(vi.mocked(sendSubscriptionEmail)).toHaveBeenCalledWith('renewed', expect.any(Object));
  });

  it('initial invoice → creates an initial order but SKIPS the renewal event + email', async () => {
    vi.mocked(getSubscriptionByStripeId).mockResolvedValue(d1Sub as never);

    await handleInvoicePaymentSucceeded(
      invoice({ id: 'in_init_1', billing_reason: 'subscription_create' }),
      'evt_init'
    );

    expect(vi.mocked(createSubscriptionOrder)).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'in_init_1', kind: 'initial' })
    );
    expect(vi.mocked(createSubscriptionEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(sendSubscriptionEmail)).not.toHaveBeenCalled();
  });

  it('fresh initial invoice before the D1 row exists → throws so Stripe retries (race)', async () => {
    vi.mocked(getSubscriptionByStripeId).mockResolvedValue(undefined as never);

    await expect(
      handleInvoicePaymentSucceeded(
        invoice({ id: 'in_init_race', billing_reason: 'subscription_create', created: NOW_SECONDS }),
        'evt_race'
      )
    ).rejects.toThrow(/arrived before subscription row/);

    expect(vi.mocked(createSubscriptionOrder)).not.toHaveBeenCalled();
  });

  it('old initial invoice with no D1 row (past grace window) → no throw, no order (permanent gap alerted)', async () => {
    vi.mocked(getSubscriptionByStripeId).mockResolvedValue(undefined as never);

    await expect(
      handleInvoicePaymentSucceeded(
        invoice({
          id: 'in_init_orphan',
          billing_reason: 'subscription_create',
          created: NOW_SECONDS - 60 * 60, // an hour old — well past the 15-min grace
        }),
        'evt_orphan_init'
      )
    ).resolves.toBeUndefined();

    expect(vi.mocked(createSubscriptionOrder)).not.toHaveBeenCalled();
  });

  it('renewal invoice for an unknown subscription → no throw, no order (skips)', async () => {
    vi.mocked(getSubscriptionByStripeId).mockResolvedValue(undefined as never);

    await expect(
      handleInvoicePaymentSucceeded(
        invoice({ id: 'in_orphan', billing_reason: 'subscription_cycle' }),
        'evt_orphan'
      )
    ).resolves.toBeUndefined();

    expect(vi.mocked(createSubscriptionOrder)).not.toHaveBeenCalled();
  });

  it('non-subscription invoice → skips entirely (no order)', async () => {
    await handleInvoicePaymentSucceeded(
      invoice({ id: 'in_oneoff', parent: null, billing_reason: 'manual' }),
      'evt_oneoff'
    );

    expect(vi.mocked(getSubscriptionByStripeId)).not.toHaveBeenCalled();
    expect(vi.mocked(createSubscriptionOrder)).not.toHaveBeenCalled();
  });
});

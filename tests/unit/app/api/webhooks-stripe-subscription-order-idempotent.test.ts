/**
 * Unit test for BMC-171 — createSubscriptionOrder builds a correct paid order and
 * is idempotent across Stripe webhook redeliveries.
 *
 * The order id is derived deterministically from the funding invoice id
 * (`SUBORD-<invoiceId>`), so a redelivery collides on the orders PRIMARY KEY and
 * must be treated as a safe no-op — never a second shipment for one charge. This
 * exercises the four paths: fresh create, pre-existing (fast-path skip),
 * PK-collision race (caught → skip), and a genuine failure (rethrown so Stripe
 * retries).
 *
 * The model boundaries (@/lib/models/mach/{orders,subscriptions,products}) and the
 * product-name helper are mocked, so the REAL helper runs without the Workers
 * runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/orders', () => ({
  createOrderPaid: vi.fn(),
  getOrderById: vi.fn(),
}));

vi.mock('@/lib/models/mach/subscriptions', () => ({
  getSubscriptionPlanById: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProductVariants: vi.fn(),
}));

vi.mock('@/app/api/webhooks/stripe/handlers/utils', () => ({
  getProductName: vi.fn().mockResolvedValue('Morning Blend'),
}));

import {
  createSubscriptionOrder,
  subscriptionOrderId,
} from '@/app/api/webhooks/stripe/handlers/subscription-order';
import { createOrderPaid, getOrderById } from '@/lib/models/mach/orders';
import { getSubscriptionPlanById } from '@/lib/models/mach/subscriptions';
import { getProductVariants } from '@/lib/models/mach/products';

const address = { type: 'shipping', line1: '1 Tea Rd', city: 'Portland', region: 'OR', country: 'US' };
// billing reuses the shipping address but is relabeled type: 'billing' (BMC-171 review).
const billingAddress = { ...address, type: 'billing' };

const sub = {
  id: 'SUB-1',
  stripe_subscription_id: 'sub_123',
  customer_id: 'CUST-1',
  plan_id: 'PLN-1',
  status: 'active',
  shipping_address: address,
} as never;

const baseParams = {
  subscription: sub,
  invoiceId: 'in_1',
  amountPaidMinor: 2249,
  currency: 'USD',
  kind: 'renewal' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubscriptionPlanById).mockResolvedValue({ id: 'PLN-1', product_id: 'PROD-1' } as never);
  vi.mocked(getProductVariants).mockResolvedValue([{ id: 'VAR-1', sku: 'SKU-1' }] as never);
});

describe('createSubscriptionOrder (BMC-171)', () => {
  it('derives a deterministic order id from the invoice id', () => {
    expect(subscriptionOrderId('in_ABC')).toBe('SUBORD-in_ABC');
  });

  it('fresh invoice → creates a paid order with the right id, amount, line item, and address', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    vi.mocked(createOrderPaid).mockResolvedValue({ id: 'SUBORD-in_1' } as never);

    await createSubscriptionOrder(baseParams);

    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledTimes(1);
    const [orderData, paid] = vi.mocked(createOrderPaid).mock.calls[0];
    expect(orderData).toEqual(
      expect.objectContaining({
        id: 'SUBORD-in_1',
        customer_id: 'CUST-1',
        currency_code: 'USD',
        total_amount: { amount: 2249, currency: 'USD' },
        shipping_address: address,
        billing_address: billingAddress,
        payment_method: 'subscription',
      })
    );
    expect(orderData.items).toEqual([
      expect.objectContaining({
        product_id: 'PROD-1',
        variant_id: 'VAR-1',
        sku: 'SKU-1',
        quantity: 1,
        unit_price: { amount: 2249, currency: 'USD' },
        total_price: { amount: 2249, currency: 'USD' },
        product_name: 'Morning Blend',
      }),
    ]);
    expect(paid).toEqual({ status: 'processing' });
  });

  it('order already exists (redelivery) → fast-path skip, never calls createOrderPaid', async () => {
    vi.mocked(getOrderById).mockResolvedValue({ id: 'SUBORD-in_1' } as never);

    await createSubscriptionOrder(baseParams);

    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('PK collision (concurrent race) → caught and treated as an idempotent no-op', async () => {
    // Pre-check finds nothing, insert races and collides, re-read finds the row.
    vi.mocked(getOrderById)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'SUBORD-in_1' } as never);
    vi.mocked(createOrderPaid).mockRejectedValue(
      new Error('D1_ERROR: UNIQUE constraint failed: orders.id')
    );

    await expect(createSubscriptionOrder(baseParams)).resolves.toBeUndefined();
    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledTimes(1);
  });

  it('genuine failure (no row after the throw) → rethrows so Stripe retries', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null); // both the pre-check and the catch re-read
    vi.mocked(createOrderPaid).mockRejectedValue(new Error('D1_ERROR: database is locked'));

    await expect(createSubscriptionOrder(baseParams)).rejects.toThrow(/database is locked/);
  });

  it('falls back to the product id as SKU when the product has no variants', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    vi.mocked(getProductVariants).mockResolvedValue([] as never);
    vi.mocked(createOrderPaid).mockResolvedValue({ id: 'SUBORD-in_1' } as never);

    await createSubscriptionOrder(baseParams);

    const [orderData] = vi.mocked(createOrderPaid).mock.calls[0];
    expect(orderData.items[0]).toEqual(
      expect.objectContaining({ sku: 'PROD-1', variant_id: undefined })
    );
  });

  it('multi-variant product → picks a deterministic primary variant regardless of DB order', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    vi.mocked(createOrderPaid).mockResolvedValue({ id: 'SUBORD-in_1' } as never);

    // Same variants, two different arrival orders (getProductVariants has no
    // ORDER BY). The stable pick (position asc, nulls last, then id) must select
    // the same SKU both times so initial + renewal orders never diverge.
    const unordered = [
      { id: 'VAR-C', sku: 'SKU-C', position: 2 },
      { id: 'VAR-A', sku: 'SKU-A', position: 1 },
      { id: 'VAR-B', sku: 'SKU-B' }, // no position → sorts last
    ];
    vi.mocked(getProductVariants).mockResolvedValueOnce(unordered as never);
    await createSubscriptionOrder(baseParams);

    vi.mocked(getProductVariants).mockResolvedValueOnce([...unordered].reverse() as never);
    await createSubscriptionOrder(baseParams);

    const first = vi.mocked(createOrderPaid).mock.calls[0][0].items[0];
    const second = vi.mocked(createOrderPaid).mock.calls[1][0].items[0];
    expect(first).toEqual(expect.objectContaining({ sku: 'SKU-A', variant_id: 'VAR-A' }));
    expect(second).toEqual(expect.objectContaining({ sku: 'SKU-A', variant_id: 'VAR-A' }));
  });
});

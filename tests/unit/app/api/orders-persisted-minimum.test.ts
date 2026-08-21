/**
 * POST /api/orders must gate the ROW it promotes, not just the request body.
 *
 * Since BMC-167 the storefront persists a pending order at PaymentIntent
 * creation, so on the normal flow this route finds-and-promotes an existing row
 * — `body.items` is never compared against it. A compliant decoy body therefore
 * cleared the box-minimum gate for whatever the pending row actually held.
 *
 * This runs after Stripe has captured, so it is a fast-path stop (no email, no
 * gift-card fulfillment, no inventory decrement), not a money backstop; the
 * webhook finalizes the row regardless. Pre-capture enforcement is pinned in
 * sale-minimum-order.test.ts against /api/payment-intent.
 *
 * Harness mirrors orders-post-charge-verification.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/stripe', () => ({ retrievePaymentIntent: vi.fn() }));
vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn().mockResolvedValue({ id: 'guest' }),
  createCustomer: vi.fn(),
}));
vi.mock('@/lib/services/order-finalization', () => ({
  finalizePaidOrder: vi.fn().mockResolvedValue({ paid: true, promotedByUs: true }),
}));
vi.mock('@/lib/models/mach/products', () => ({ getProduct: vi.fn(), getProductVariant: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));
vi.mock('@/lib/utils/observe', () => ({ logCritical: vi.fn() }));

const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: (...args: unknown[]) => getSaleRules(...args),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';
import { retrievePaymentIntent } from '@/lib/stripe';
import { getProduct } from '@/lib/models/mach/products';
import { finalizePaidOrder } from '@/lib/services/order-finalization';

const ORDER_ID = 'WEB-GUEST-2000';
let selectResults: any[][] = [];

function makeDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResults.length ? selectResults.shift() : [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: any) => ({ returning: vi.fn(() => Promise.resolve([{ ...row }])) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })),
    })),
  };
}

/** A persisted pending row whose line items total `boxes`. */
function pendingRow(boxes: number, overrides: Record<string, any> = {}) {
  return {
    id: ORDER_ID,
    customer_id: null,
    status: 'pending',
    payment_status: 'pending',
    currency_code: 'USD',
    total_amount: 2500,
    items: JSON.stringify([
      {
        product_id: 'tea-1',
        variant_id: 'var-1',
        product_name: 'Clearly Calendula Morning',
        quantity: boxes,
        unit_price: { amount: 2500, currency: 'USD' },
        total_price: { amount: 2500 * boxes, currency: 'USD' },
      },
    ]),
    // A guest proves ownership by matching the request's payment_intent_id
    // against the persisted row's (callerOwnsExistingOrder), so the default
    // fixture is OWNED by compliantBody()'s caller.
    extensions: JSON.stringify({ payment_intent_id: 'pi_test_1' }),
    ...overrides,
  };
}

/** A request body that comfortably clears the minimum on its own. */
function compliantBody() {
  return {
    order_id: ORDER_ID,
    currency_code: 'USD',
    total_amount: { amount: 25000, currency: 'USD' },
    items: [
      {
        product_id: 'tea-1',
        variant_id: 'var-1',
        product_name: 'Clearly Calendula Morning',
        quantity: 10,
        unit_price: { amount: 2500, currency: 'USD' },
        total_price: { amount: 25000, currency: 'USD' },
      },
    ],
    extensions: { payment_intent_id: 'pi_test_1' },
  };
}

const postOrders = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  selectResults = [];
  vi.mocked(getDbAsync).mockResolvedValue(makeDb() as any);
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(finalizePaidOrder).mockResolvedValue({ paid: true, promotedByUs: true });
  vi.mocked(retrievePaymentIntent).mockResolvedValue({
    status: 'succeeded',
    metadata: { orderId: ORDER_ID },
    amount_received: 25000,
  } as any);
  getSaleRules.mockResolvedValue({
    minimumBoxes: 10,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [],
  });
});

describe('POST /api/orders — the persisted row is gated, not just the body', () => {
  it('rejects when the body clears the minimum but the pending row does not', async () => {
    selectResults = [[pendingRow(2)]];

    const res = await postOrders(compliantBody());

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Add 8 more boxes to check out. 10 box minimum.'
    );
    // The whole point: rejected before any Stripe call or side effect.
    expect(vi.mocked(retrievePaymentIntent)).not.toHaveBeenCalled();
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('promotes normally when the persisted row meets the minimum', async () => {
    selectResults = [[pendingRow(10)]];

    const res = await postOrders(compliantBody());

    // 201 is the terminal success for both the promote and create paths; 200 is
    // reserved for the idempotent already-paid returns.
    expect(res.status).toBe(201);
    expect(vi.mocked(finalizePaidOrder)).toHaveBeenCalledTimes(1);
  });

  it('never re-gates an already-paid order, so a replay stays idempotent', async () => {
    // A customer refreshing /checkout/success after the webhook finalized a
    // sub-minimum order must get the idempotent 200, not a 400.
    selectResults = [[pendingRow(2, { payment_status: 'paid', status: 'processing' })]];

    const res = await postOrders(compliantBody());

    expect(res.status).toBe(200);
    expect(((await res.json()) as { meta: { idempotent: boolean } }).meta.idempotent).toBe(true);
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('keeps the ownership check ahead of the gate so a sub-minimum id is not disclosed', async () => {
    // Non-owner guessing the id must see the generic 409, never a 400 that
    // would confirm the order exists and reveal its box count. Neither
    // ownership route matches: a different Clerk user, and a PI that isn't the
    // one on the row.
    const { auth } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: 'user_other' } as any);
    selectResults = [
      [
        pendingRow(2, {
          customer_id: 'user_owner',
          extensions: JSON.stringify({ payment_intent_id: 'pi_someone_else' }),
        }),
      ],
    ];

    const res = await postOrders(compliantBody());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('Order already exists');
  });
});

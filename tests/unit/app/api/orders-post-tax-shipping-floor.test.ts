/**
 * Regression test for the BMC-201 review finding — the omit-`items`+`order`
 * bypass, closed at the POST /api/orders fresh-insert path.
 *
 * The bypass: call POST /api/payment-intent with NO `items` and NO `order` draft
 * → the charge floor is skipped AND no pending order is persisted. Pay a
 * goods-only amount, then create the order via a FRESH POST /api/orders insert
 * (branch c). If that insert only STRIPPED client `expected_*_cents` without
 * RECOMPUTING them, finalization would default to a goods-only floor and collect
 * $0 tax/shipping — defeating BMC-201 through a different door.
 *
 * The fix: branch (c) recomputes the server-authoritative expected shipping + tax
 * from the catalog items + settings and stamps them on the inserted row, so
 * finalization (which enforces the persisted figures — see
 * order-finalization.test.ts) rejects a tax/shipping-omitting capture here too.
 *
 * This test pins the STAMPING (the route's responsibility). finalizePaidOrder is
 * mocked; the floor-enforcement of the stamped values is covered separately.
 *
 * Pure unit test: every Cloudflare/Stripe/Clerk seam + finalizePaidOrder mocked;
 * order-pricing + checkout-charges left real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(true),
  formatAmountForStripe: (a: number) => Math.round(a * 100),
  calculateTax: vi.fn().mockResolvedValue({ tax_amount_exclusive: 200 }),
}));

vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn().mockResolvedValue({ id: 'guest' }),
  createCustomer: vi.fn(),
}));

vi.mock('@/lib/services/order-finalization', () => ({
  finalizePaidOrder: vi.fn().mockResolvedValue({ paid: true, promotedByUs: true }),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

// Settings drive the shipping floor → default {} = standard $5.99 cheapest method.
vi.mock('@/lib/utils/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';
import { retrievePaymentIntent } from '@/lib/stripe';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';

const ORDER_ID = 'WEB-GUEST-2000';
const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };

let insertedRows: any[] = [];
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
      values: vi.fn((row: any) => ({
        returning: vi.fn(() => {
          insertedRows.push(row);
          return Promise.resolve([{ ...row }]);
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) })),
    })),
  };
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function orderBody(overrides: Record<string, any> = {}) {
  return {
    order_id: ORDER_ID,
    currency_code: 'USD',
    total_amount: { amount: 2500, currency: 'USD' },
    shipping_address: { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', country: 'US' },
    items: [
      {
        product_id: 'tea-1',
        variant_id: 'var-tea-1',
        product_name: 'Clearly Calendula Morning',
        quantity: 1,
        unit_price: { amount: 2500, currency: 'USD' },
        total_price: { amount: 2500, currency: 'USD' },
      },
    ],
    extensions: { payment_intent_id: 'pi_test_1' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows = [];
  selectResults = [[]]; // existing lookup: none → fresh insert (branch c)
  vi.mocked(getDbAsync).mockResolvedValue(makeDb() as any);
  vi.mocked(getProduct).mockResolvedValue({ id: 'tea-1', type: 'Tea Bags', tax_category: 'food' } as any);
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(retrievePaymentIntent).mockResolvedValue({
    status: 'succeeded',
    metadata: { orderId: ORDER_ID },
    amount_received: 2999,
  } as any);
});

describe('POST /api/orders fresh-insert stamps expected tax/shipping (BMC-201 bypass fix)', () => {
  it('rejects a direct non-US shipping address', async () => {
    const res = await POST(postRequest(orderBody({
      shipping_address: { line1: '1 King St', city: 'Toronto', region: 'ON', postal_code: 'M5V 2T6', country: 'CA' },
    })));
    expect(res.status).toBe(400);
    expect(insertedRows).toHaveLength(0);
  });

  it('recomputes + stamps server expected shipping ($5.99) and tax ($2.00) on the fresh insert', async () => {
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    // The bypass entry path (no pre-persisted row) still gets a tax/shipping-
    // inclusive floor because these are recomputed and persisted here.
    expect(insertedRows[0].extensions.expected_shipping_cents).toBe(599);
    expect(insertedRows[0].extensions.expected_tax_cents).toBe(200);
  });

  it('overwrites a client-supplied expected_tax_cents in the body with the SERVER value', async () => {
    // Attacker tries to persist a $0 tax floor via the order body extensions.
    const res = await POST(
      postRequest(
        orderBody({ extensions: { payment_intent_id: 'pi_test_1', expected_tax_cents: 0, expected_shipping_cents: 0 } })
      )
    );
    expect(res.status).toBe(201);
    // Server value wins — the client's 0/0 never survives.
    expect(insertedRows[0].extensions.expected_tax_cents).toBe(200);
    expect(insertedRows[0].extensions.expected_shipping_cents).toBe(599);
  });

  it('leaves the fields unstamped (goods-only floor) when the cart is unpriceable', async () => {
    const res = await POST(
      postRequest(orderBody({ items: [{ product_id: 'tea-1', variant_id: 'ghost', quantity: 1 }] }))
    );
    expect(res.status).toBe(201);
    // Unpriceable → not stamped; the goods charge gate at finalization still fails
    // closed on the unpriceable cart, so no tax/shipping under-collection results.
    expect(insertedRows[0].extensions.expected_tax_cents).toBeUndefined();
    expect(insertedRows[0].extensions.expected_shipping_cents).toBeUndefined();
  });
});

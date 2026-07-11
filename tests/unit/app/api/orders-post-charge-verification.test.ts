/**
 * Route test for POST /api/orders — the client fast-path (BMC-131 + BMC-165 +
 * BMC-167).
 *
 * Since BMC-167 the storefront persists a PENDING order at PaymentIntent
 * creation, so this route FINDS-AND-PROMOTES rather than blindly inserting. It
 * delegates the actual pending→paid promotion (charge gate, guarded CAS, gift
 * cards, H1, email) to the shared `finalizePaidOrder`, whose internals are
 * unit-tested in tests/unit/lib/services/order-finalization.test.ts. This test
 * pins the ROUTE responsibilities:
 *
 *  - order already exists + pending + owned → PROMOTE it (no second insert),
 *    delegating to finalizePaidOrder with the CAPTURED amount (BMC-167
 *    client-first path).
 *  - order does not exist → create it pending, then finalize (older client / a
 *    PI-time persistence failure fallback).
 *  - order already exists + PAID + owned → pure idempotent no-op: 200, id only,
 *    NO re-verify, NO finalize, NO PII echo (BMC-165).
 *  - a non-owner guessing an id → 409, no insert, no PII echo (BMC-165 IDOR).
 *  - the PK-insert race → recover to promote/200 or 409, never a spurious 400.
 *  - the client payment_status flag is NEVER trusted: the order is only promoted
 *    when Stripe confirms the PaymentIntent SUCCEEDED and bound to THIS order.
 *
 * Pure unit test: every Cloudflare/Stripe/Clerk seam + finalizePaidOrder mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
}));

vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn().mockResolvedValue({ id: 'guest' }),
  createCustomer: vi.fn(),
}));

vi.mock('@/lib/services/order-finalization', () => ({
  finalizePaidOrder: vi.fn().mockResolvedValue({ paid: true, promotedByUs: true }),
}));

// Catalog seam that canonicalizeOrderItemsDisplay (left REAL) reads through.
vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { POST } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';
import { retrievePaymentIntent } from '@/lib/stripe';
import { getProduct } from '@/lib/models/mach/products';
import { finalizePaidOrder } from '@/lib/services/order-finalization';

const ORDER_ID = 'WEB-GUEST-1000';

// Captures every row written via db.insert(orders).values(row).returning().
let insertedRows: any[] = [];
// Per-call select() results queue. Each select().limit() shifts the next entry;
// falls back to [] when the queue is empty.
let selectResults: any[][] = [];
// When set, the insert's .returning() rejects with this error.
let insertShouldFail: Error | null = null;

function makeDb() {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() =>
            Promise.resolve(selectResults.length ? selectResults.shift() : [])
          ),
        })),
      })),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: any) => ({
        returning: vi.fn().mockImplementation(() => {
          if (insertShouldFail) return Promise.reject(insertShouldFail);
          insertedRows.push(row);
          return Promise.resolve([{ ...row }]);
        }),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      })),
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

const SUCCEEDED_PI = { status: 'succeeded', metadata: { orderId: ORDER_ID }, amount_received: 2999 };

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows = [];
  selectResults = [];
  insertShouldFail = null;
  vi.mocked(auth).mockResolvedValue({ userId: null } as any);
  vi.mocked(getDbAsync).mockResolvedValue(makeDb() as any);
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(finalizePaidOrder).mockResolvedValue({ paid: true, promotedByUs: true });
  vi.mocked(retrievePaymentIntent).mockResolvedValue(SUCCEEDED_PI as any);
});

describe('POST /api/orders create-or-promote (BMC-167)', () => {
  it('order does NOT exist → inserts pending/pending then delegates to finalizePaidOrder with the captured amount', async () => {
    selectResults = [[]]; // existing lookup: none
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);

    // Always persisted pending; paid state is reached only via the guarded promote.
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].status).toBe('pending');
    expect(insertedRows[0].payment_status).toBe('pending');
    // The PI id is bound into external_references so getOrderByPaymentIntentId finds it.
    expect(insertedRows[0].external_references?.payment_intent_id).toBe('pi_test_1');

    expect(vi.mocked(finalizePaidOrder)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(finalizePaidOrder).mock.calls[0][0];
    expect(arg.paidAmountCents).toBe(2999); // captured amount, never client total
    expect(arg.sendEmail).toBe(true);
  });

  it('BMC-167 client-first: an existing PENDING order is PROMOTED, never re-inserted', async () => {
    // The pending order persisted at PI creation already exists.
    selectResults = [
      [
        {
          id: ORDER_ID,
          customer_id: null,
          status: 'pending',
          payment_status: 'pending',
          total_amount: { amount: 2500, currency: 'USD' },
          currency_code: 'USD',
          items: [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }],
          shipping_address: null,
          billing_address: null,
          extensions: { payment_intent_id: 'pi_test_1' },
        },
      ],
    ];
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);
    expect(insertedRows).toHaveLength(0); // promoted, NOT duplicated
    expect(vi.mocked(finalizePaidOrder)).toHaveBeenCalledTimes(1);
  });

  it('never trusts the client: a PI that did NOT succeed does not finalize (order left pending)', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({ status: 'requires_payment_method', metadata: { orderId: ORDER_ID } } as any);
    selectResults = [[]];
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);
    expect(insertedRows[0].payment_status).toBe('pending');
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('never trusts the client: a PI bound to a DIFFERENT order does not finalize', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({ status: 'succeeded', metadata: { orderId: 'WEB-OTHER-9' }, amount_received: 999999 } as any);
    selectResults = [[]];
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('BMC-165 idempotency: an owner re-POST of an already-PAID order returns 200 id-only — no finalize, no PII echo', async () => {
    selectResults = [
      [
        {
          id: ORDER_ID,
          customer_id: null,
          status: 'processing',
          payment_status: 'paid',
          total_amount: { amount: 2500, currency: 'USD' },
          currency_code: 'USD',
          items: [],
          shipping_address: { line1: '123 Private Rd', recipient: 'Jane Doe', email: 'jane@example.com' },
          billing_address: null,
          extensions: { payment_intent_id: 'pi_test_1' },
        },
      ],
    ];
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.meta.idempotent).toBe(true);
    expect(json.data).toEqual({ id: ORDER_ID });
    expect(JSON.stringify(json)).not.toContain('Private Rd');
    expect(JSON.stringify(json)).not.toContain('jane@example.com');
    expect(insertedRows).toHaveLength(0);
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
    expect(retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('BMC-165 IDOR: a guessed order id from a non-owner returns 409 and leaks no order PII', async () => {
    selectResults = [
      [
        {
          id: ORDER_ID,
          customer_id: 'user_victim',
          status: 'processing',
          payment_status: 'paid',
          total_amount: { amount: 2500, currency: 'USD' },
          currency_code: 'USD',
          items: [{ product_name: 'Secret Item' }],
          shipping_address: { line1: '123 Private Rd', recipient: 'Jane Doe', email: 'jane@example.com' },
          billing_address: null,
          extensions: { payment_intent_id: 'pi_victim_secret' },
        },
      ],
    ];
    const res = await POST(postRequest(orderBody({ extensions: { payment_intent_id: 'pi_attacker_guess' } })));
    expect(res.status).toBe(409);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('Private Rd');
    expect(body).not.toContain('jane@example.com');
    expect(body).not.toContain('Secret Item');
    expect(insertedRows).toHaveLength(0);
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('BMC-165 idempotency: an authenticated owner (customer_id match) returns 200 id-only, no PI-id needed', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_owner' } as any);
    selectResults = [
      [
        {
          id: 'WEB-USEROWNER-1000',
          customer_id: 'user_owner',
          status: 'processing',
          payment_status: 'paid',
          total_amount: { amount: 2500, currency: 'USD' },
          currency_code: 'USD',
          items: [],
          shipping_address: { line1: '9 Secret Ave' },
          billing_address: null,
          extensions: { payment_intent_id: 'pi_stored_owner' },
        },
      ],
    ];
    const res = await POST(postRequest(orderBody({ order_id: 'WEB-USEROWNER-1000', extensions: { payment_intent_id: 'pi_body_differs' } })));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toEqual({ id: 'WEB-USEROWNER-1000' });
    expect(JSON.stringify(json)).not.toContain('Secret Ave');
    expect(insertedRows).toHaveLength(0);
  });

  it('BMC-165 auth-transition: an authenticated caller may finalize a WEB-GUEST order id (no namespace 400)', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_late' } as any);
    vi.mocked(retrievePaymentIntent).mockResolvedValue({ status: 'succeeded', metadata: { orderId: 'WEB-GUEST-1000' }, amount_received: 2999 } as any);
    selectResults = [[]];
    const res = await POST(postRequest(orderBody({ order_id: 'WEB-GUEST-1000' })));
    expect(res.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].id).toBe('WEB-GUEST-1000');
  });

  it('BMC-165 race: losing the PK insert race but owning the pending order promotes it (no duplicate)', async () => {
    // Pre-check sees no order; the insert loses a PK race; the raced select then
    // finds the concurrently-created PENDING row, owned via the matching PI id.
    selectResults = [
      [],
      [
        {
          id: ORDER_ID,
          customer_id: null,
          status: 'pending',
          payment_status: 'pending',
          total_amount: { amount: 2500, currency: 'USD' },
          currency_code: 'USD',
          items: [{ product_id: 'tea-1', variant_id: 'var-tea-1', quantity: 1 }],
          shipping_address: { line1: '9 Secret Rd' },
          billing_address: null,
          extensions: { payment_intent_id: 'pi_test_1' },
        },
      ],
    ];
    insertShouldFail = new Error('D1_ERROR: UNIQUE constraint failed: orders.id');
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);
    expect(insertedRows).toHaveLength(0);
    expect(vi.mocked(finalizePaidOrder)).toHaveBeenCalledTimes(1);
  });

  it('BMC-165 race: losing the PK race to an already-PAID owned order returns 200 idempotent', async () => {
    selectResults = [
      [],
      [
        {
          id: ORDER_ID,
          customer_id: null,
          status: 'processing',
          payment_status: 'paid',
          total_amount: { amount: 2500, currency: 'USD' },
          currency_code: 'USD',
          items: [],
          shipping_address: { line1: '9 Secret Rd' },
          billing_address: null,
          extensions: { payment_intent_id: 'pi_test_1' },
        },
      ],
    ];
    insertShouldFail = new Error('UNIQUE constraint failed: orders.id');
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.meta.idempotent).toBe(true);
    expect(json.data).toEqual({ id: ORDER_ID });
    expect(JSON.stringify(json)).not.toContain('Secret Rd');
    expect(vi.mocked(finalizePaidOrder)).not.toHaveBeenCalled();
  });

  it('BMC-165 race: losing the PK race to a NON-owned order returns 409, no PII', async () => {
    selectResults = [
      [],
      [
        {
          id: ORDER_ID,
          customer_id: 'user_victim',
          status: 'processing',
          payment_status: 'paid',
          total_amount: { amount: 2500, currency: 'USD' },
          currency_code: 'USD',
          items: [{ product_name: 'Secret Item' }],
          shipping_address: { line1: '9 Secret Rd', email: 'victim@example.com' },
          billing_address: null,
          extensions: { payment_intent_id: 'pi_victim' },
        },
      ],
    ];
    insertShouldFail = new Error('UNIQUE constraint failed: orders.id');
    const res = await POST(postRequest(orderBody({ extensions: { payment_intent_id: 'pi_attacker' } })));
    expect(res.status).toBe(409);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('Secret Rd');
    expect(body).not.toContain('victim@example.com');
    expect(body).not.toContain('Secret Item');
  });

  it('BMC-165 race: a NON-unique insert error is surfaced, never masked as idempotent', async () => {
    selectResults = [[], [{ id: ORDER_ID, extensions: { payment_intent_id: 'pi_test_1' } }]];
    insertShouldFail = new Error('D1_ERROR: network connection lost');
    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(400); // generic error handler, not an idempotent 200
    const json = (await res.json()) as any;
    expect(json?.meta?.idempotent).toBeUndefined();
  });
});

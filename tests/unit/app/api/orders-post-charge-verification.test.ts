/**
 * Regression test for BMC-131 (C1 / H1) — the POST /api/orders charge gate.
 *
 * The pure `order-pricing.ts` logic is unit-tested separately; this test proves
 * the ROUTE actually wires it in and fails closed:
 *
 *  - A succeeded, order-bound PaymentIntent whose CAPTURED amount does not cover
 *    the catalog goods must persist the order as pending/pending, never
 *    processing/paid (the core BMC-131 invariant at the order-creation writer).
 *  - C1: if the charge verification THROWS (e.g. a transient D1 error while
 *    reading the catalog), the order must still fail closed to pending — the old
 *    code set paymentConfirmed=true before the check and swallowed the throw in
 *    an outer catch, leaving it true.
 *  - H1: when the order relied on gift-card tender but the actual redemption
 *    fails (a lost balance race), the order must be reverted to pending rather
 *    than left paid for goods that were never fully tendered.
 *
 * Pure unit test (CI `npm test`): every Cloudflare/Stripe/Clerk seam is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
}));

vi.mock('@/lib/utils/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue({ success: true, id: 'email_1' }),
  sendOrderStatusUpdateEmail: vi.fn().mockResolvedValue({ success: true, id: 'email_2' }),
}));

vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn().mockResolvedValue({ id: 'guest' }),
  createCustomer: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrdersByCustomer: vi.fn(),
  getOrderById: vi.fn(),
  createOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderShipping: vi.fn(),
}));

vi.mock('@/lib/models/order', () => ({
  getOrdersByCustomerId: vi.fn(),
  insertOrder: vi.fn(),
}));

// Catalog + gift-card seams that order-pricing (left REAL) reads through.
vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));
vi.mock('@/lib/models/mach/giftCard', () => ({
  getGiftCardByCode: vi.fn(),
}));

vi.mock('@/lib/services/gift-card-fulfillment', () => ({
  processGiftCardsForOrder: vi.fn().mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: [] }),
  orderInvolvesGiftCards: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { POST } from '@/app/api/orders/route';
import { getDbAsync } from '@/lib/db';
import { retrievePaymentIntent } from '@/lib/stripe';
import { getProductVariant, getProduct } from '@/lib/models/mach/products';
import { getGiftCardByCode } from '@/lib/models/mach/giftCard';
import { processGiftCardsForOrder, orderInvolvesGiftCards } from '@/lib/services/gift-card-fulfillment';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };
const ORDER_ID = 'WEB-GUEST-1000';

// Captures every row written via db.insert(orders).values(row).returning().
let insertedRows: any[] = [];
// Captures every db.update(orders).set(row) payload (used to detect H1 revert).
let updatedRows: any[] = [];
// Rows the idempotency pre-check (select ... where id = orderId) should return.
// Default empty: the order does not exist yet, so POST proceeds to insert.
let existingOrderRows: any[] = [];

function makeDb() {
  return {
    // BMC-165 idempotency pre-check: db.select().from(orders).where(id).limit(1).
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockResolvedValue(existingOrderRows),
        })),
      })),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: any) => {
        insertedRows.push(row);
        return { returning: vi.fn().mockResolvedValue([{ ...row }]) };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((row: any) => {
        updatedRows.push(row);
        return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: ORDER_ID, ...row }]) }) };
      }),
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

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows = [];
  updatedRows = [];
  existingOrderRows = [];
  // Default to a guest caller; individual tests override for authenticated cases.
  // (clearAllMocks keeps implementations, so reset explicitly for isolation.)
  vi.mocked(auth).mockResolvedValue({ userId: null } as any);
  vi.mocked(getDbAsync).mockResolvedValue(makeDb() as any);
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(getProduct).mockResolvedValue(null as any);
  vi.mocked(getGiftCardByCode).mockResolvedValue(null as any);
  vi.mocked(orderInvolvesGiftCards).mockReturnValue(false);
  vi.mocked(processGiftCardsForOrder).mockResolvedValue({ issued: 0, redeemed: 0, redeemedAmount: 0, errors: [] });
});

describe('POST /api/orders charge verification (BMC-131 C1/H1)', () => {
  it('THE EXPLOIT: succeeded PI that captured only $0.50 persists the order pending, not paid', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      status: 'succeeded',
      metadata: { orderId: ORDER_ID },
      amount_received: 50, // $0.50 captured for $25 of catalog goods
    } as any);

    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].status).toBe('pending');
    expect(insertedRows[0].payment_status).toBe('pending');
  });

  it('happy path: a PI that captured the full catalog amount marks the order processing/paid', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      status: 'succeeded',
      metadata: { orderId: ORDER_ID },
      amount_received: 2999, // covers $25 goods + tax/shipping
    } as any);

    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);

    expect(insertedRows[0].status).toBe('processing');
    expect(insertedRows[0].payment_status).toBe('paid');
  });

  it('C1: a throw inside charge verification fails closed to pending (no fail-open)', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      status: 'succeeded',
      metadata: { orderId: ORDER_ID },
      amount_received: 5000,
    } as any);
    // Transient D1 error while reading the catalog — must NOT leave the order paid.
    vi.mocked(getProductVariant).mockRejectedValue(new Error('D1 unavailable'));

    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(201);

    expect(insertedRows[0].status).toBe('pending');
    expect(insertedRows[0].payment_status).toBe('pending');
  });

  it('H1: a gift-card order whose redemption fails is reverted from paid back to pending', async () => {
    // $25 goods, $25 gift card tender, $0 residual cash. The card has balance,
    // so the sufficiency check passes and the order is first written paid...
    vi.mocked(getGiftCardByCode).mockResolvedValue({ code: 'GC-1', status: 'active', balance: 2500 } as any);
    vi.mocked(orderInvolvesGiftCards).mockReturnValue(true);
    // ...but the actual redemption loses the balance race and applies nothing.
    vi.mocked(processGiftCardsForOrder).mockResolvedValue({
      issued: 0,
      redeemed: 0,
      redeemedAmount: 0,
      errors: ['Gift card redemption failed: insufficient balance'],
    });
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      status: 'succeeded',
      metadata: { orderId: ORDER_ID },
      amount_received: 0,
    } as any);

    const res = await POST(
      postRequest(orderBody({ extensions: { payment_intent_id: 'pi_test_1', gift_card: { code: 'GC-1', amount: 2500 } } }))
    );
    expect(res.status).toBe(201);

    // The order must not remain paid for goods whose gift-card tender never
    // materialized — it is reverted to pending via a follow-up update.
    const revert = updatedRows.find((r) => r.payment_status === 'pending' || r.status === 'pending');
    expect(revert).toBeTruthy();
  });

  it('BMC-165 idempotency: an owner re-POST (matching PaymentIntent id) returns 200, id only, no insert/re-verify', async () => {
    // The redirect (Klarna/Cash App/Amazon Pay) return page can POST the same
    // order_id again — e.g. the shopper refreshes /checkout/success, or the
    // return races the Stripe webhook. Ownership is proven here by the matching
    // PaymentIntent id (orderBody() default extensions.payment_intent_id).
    existingOrderRows = [
      {
        id: ORDER_ID,
        customer_id: null, // guest order
        status: 'processing',
        payment_status: 'paid',
        total_amount: { amount: 2500, currency: 'USD' },
        currency_code: 'USD',
        items: [],
        shipping_address: { line1: '123 Private Rd', recipient: 'Jane Doe', email: 'jane@example.com' },
        billing_address: null,
        extensions: { payment_intent_id: 'pi_test_1' },
      },
    ];

    const res = await POST(postRequest(orderBody()));
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.meta.idempotent).toBe(true);
    // Response echoes ONLY the id — never the persisted order's PII.
    expect(json.data).toEqual({ id: ORDER_ID });
    expect(JSON.stringify(json)).not.toContain('Private Rd');
    expect(JSON.stringify(json)).not.toContain('jane@example.com');
    // No second row written, and payment state is never re-touched.
    expect(insertedRows).toHaveLength(0);
    expect(retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('BMC-165 IDOR: a guessed order id from a non-owner returns 409 and leaks no order PII', async () => {
    // Guest orders share the WEB-GUEST-<ts> namespace, so a guessed id must not
    // hand back someone else's order. Caller is a guest (userId null) whose
    // PaymentIntent id does NOT match the stored order's.
    existingOrderRows = [
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
    ];

    const res = await POST(postRequest(orderBody({ extensions: { payment_intent_id: 'pi_attacker_guess' } })));
    expect(res.status).toBe(409);

    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('Private Rd');
    expect(body).not.toContain('jane@example.com');
    expect(body).not.toContain('Secret Item');
    expect(insertedRows).toHaveLength(0);
  });

  it('BMC-165 idempotency: an authenticated owner (customer_id match) returns 200 id-only, no PI-id needed', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_owner' } as any);
    existingOrderRows = [
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
        // A DIFFERENT PaymentIntent id than the body's — ownership must come from
        // the customer_id match, not the PI-id proof.
        extensions: { payment_intent_id: 'pi_stored_owner' },
      },
    ];

    const res = await POST(
      postRequest(orderBody({ order_id: 'WEB-USEROWNER-1000', extensions: { payment_intent_id: 'pi_body_differs' } }))
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toEqual({ id: 'WEB-USEROWNER-1000' });
    expect(JSON.stringify(json)).not.toContain('Secret Ave');
    expect(insertedRows).toHaveLength(0);
  });

  it('BMC-165 auth-transition: an authenticated caller may finalize a WEB-GUEST order id (no namespace 400)', async () => {
    // A checkout that began as a guest (order_id WEB-GUEST-1000, baked into the
    // redirect snapshot) whose Clerk session authenticates mid-redirect must
    // still create the order on return — not 400 on the namespace check.
    vi.mocked(auth).mockResolvedValue({ userId: 'user_late' } as any);
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      status: 'succeeded',
      metadata: { orderId: 'WEB-GUEST-1000' },
      amount_received: 2999,
    } as any);

    const res = await POST(postRequest(orderBody({ order_id: 'WEB-GUEST-1000' })));
    expect(res.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].id).toBe('WEB-GUEST-1000');
  });
});

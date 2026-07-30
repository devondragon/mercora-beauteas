/**
 * Regression test for BMC-167 — POST /api/payment-intent persists a server-side
 * PENDING order keyed to the minted PaymentIntent, and the review fixes C1/H1.
 *
 * This is the crux of the fix: an order row must exist BEFORE the shopper can
 * pay, so the Stripe webhook can promote it to paid even if the client-side POST
 * /api/orders never lands. The route only hands back a client secret once the
 * pending order is persisted — it never exposes a payable PaymentIntent with no
 * order behind it.
 *
 * C1 (review): D1 enforces orders.customer_id -> customers.id and Clerk sign-up
 * does NOT create a customers row, so a first-time authenticated buyer's insert
 * would FK-fail without provisioning. This test leaves `getOrCreateCustomer`
 * REAL (mocks only the customer model) so the provisioning path is actually
 * exercised — the gap that a `createOrder`-only mock hid.
 *
 * H1 (review): a genuine non-unique constraint error (e.g. FOREIGN KEY) must
 * fail closed (500, withhold the client secret) via the canonical
 * `isUniqueViolation`, never be swallowed as "already exists".
 *
 * Pure unit test: Stripe, the orders model, the customer model, and Clerk auth
 * are mocked; order-pricing + getOrCreateCustomer are left real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn().mockReturnValue(true),
  formatAmountForStripe: vi.fn((a: number) => Math.round(a * 100)),
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_minted', client_secret: 'pi_minted_secret_abc' }),
  cancelPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_minted', status: 'canceled' }),
  // BMC-201: the floor now recomputes tax via the checkout-charges seam. Pin $0
  // tax here so these BMC-167 assertions turn on persistence/customer logic, not
  // tax math (the tax floor has its own dedicated test). $34.99 comfortably clears
  // $25 goods + $5.99 shipping (settings floor) + $0 tax = $30.99.
  calculateTax: vi.fn().mockResolvedValue({ tax_amount_exclusive: 0 }),
}));

// Settings drive the shipping floor → default {} yields the built-in $5.99
// cheapest method (free ≥ $75; the $25 cart is under, so $5.99 applies).
vi.mock('@/lib/utils/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null }),
  currentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/models/mach/giftCard', () => ({
  validateGiftCardForRedemption: vi.fn(),
  getGiftCardByCode: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  createOrder: vi.fn().mockResolvedValue({ id: 'WEB-X-1' }),
}));

// Customer model behind the REAL getOrCreateCustomer (customer provisioning).
vi.mock('@/lib/models/mach/customer', () => ({
  getCustomer: vi.fn(),
  createCustomer: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/payment-intent/route';
import { createPaymentIntent, cancelPaymentIntent } from '@/lib/stripe';
import { getProductVariant } from '@/lib/models/mach/products';
import { createOrder } from '@/lib/models/mach/orders';
import { getCustomer, createCustomer } from '@/lib/models/mach/customer';
import { auth } from '@clerk/nextjs/server';

const VARIANT_TEA = { id: 'var-tea-1', product_id: 'tea-1', price: { amount: 2500, currency: 'USD' } };
const shippingAddress = { line1: '1 St', city: 'Town', region: 'CA', postal_code: '90210', recipient: 'A' };

/** A minimal order draft as buildCreateOrderBody produces it (no PI id yet). */
function orderDraft(overrides: Record<string, any> = {}) {
  return {
    order_id: 'WEB-X-1',
    items: [
      {
        product_id: 'tea-1',
        variant_id: 'var-tea-1',
        quantity: 1,
        unit_price: { amount: 2500, currency: 'USD' },
        total_price: { amount: 2500, currency: 'USD' },
        product_name: 'Morning',
      },
    ],
    total_amount: { amount: 3499, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: shippingAddress,
    billing_address: shippingAddress,
    shipping_method: 'standard',
    payment_method: 'stripe',
    extensions: { payment_intent_id: '', shipping_cost: 999, tax_amount: 0, subtotal: 2500 },
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, any> = {}) {
  return {
    amount: 34.99,
    taxAmount: 0,
    shippingAddress,
    orderId: 'WEB-X-1',
    items: [{ productId: 'tea-1', variantId: 'var-tea-1', quantity: 1 }],
    order: orderDraft(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: null } as any);
  vi.mocked(getProductVariant).mockImplementation(async (id: string) =>
    id === VARIANT_TEA.id ? (VARIANT_TEA as any) : null
  );
  vi.mocked(createOrder).mockResolvedValue({ id: 'WEB-X-1' } as any);
  // Default: the customer already exists (no provisioning insert needed).
  vi.mocked(getCustomer).mockResolvedValue({ id: 'existing' } as any);
  vi.mocked(createCustomer).mockResolvedValue({ id: 'created' } as any);
});

describe('POST /api/payment-intent pending-order persistence (BMC-167)', () => {
  it('BMC-177 review: bounds a huge discount_codes array persisted via the order draft', async () => {
    // The order draft's extensions is client-controlled; without bounding, an
    // unbounded discount_codes array would be stored verbatim in the D1 extensions
    // JSON (this route is pre-auth reachable). It must be normalized + capped.
    const many = Array.from({ length: 200 }, (_, i) => `CODE${i}`);
    const draft = orderDraft({ extensions: { payment_intent_id: '', shipping_cost: 999, tax_amount: 0, subtotal: 2500, discount_codes: many } });
    const res = await POST(postRequest(baseBody({ order: draft })));
    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.extensions.discount_codes.length).toBe(25);
  });

  it('persists a pending order stamped with the MINTED PaymentIntent id, then returns the client secret', async () => {
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.clientSecret).toBe('pi_minted_secret_abc');
    expect(json.paymentIntentId).toBe('pi_minted');

    expect(vi.mocked(createOrder)).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.id).toBe('WEB-X-1');
    expect(persisted.extensions.payment_intent_id).toBe('pi_minted');
    expect(persisted.external_references.payment_intent_id).toBe('pi_minted');
    // BMC-201: the SERVER-computed expected shipping + tax are stamped on the
    // order so finalization enforces them. $5.99 shipping (settings floor, cart
    // under the free threshold), $0 tax (mocked).
    expect(persisted.extensions.expected_shipping_cents).toBe(599);
    expect(persisted.extensions.expected_tax_cents).toBe(0);
    // Guest checkout → no customer id bound, no provisioning attempted.
    expect(persisted.customer_id).toBeUndefined();
    expect(vi.mocked(getCustomer)).not.toHaveBeenCalled();
  });

  it('BMC-201: overwrites a client-supplied expected_tax_cents in the draft with the SERVER value', async () => {
    // A tampered draft tries to persist expected_tax_cents: 0 to defeat the floor.
    // The server must overwrite it with its own computed value (here also 0 via the
    // mock, but the KEY assertion is that the client copy never survives as-is on a
    // higher-tax cart). We assert the persisted value is the server figure, and
    // that a bogus non-numeric client value is not carried through.
    const draft = orderDraft({
      extensions: { payment_intent_id: '', shipping_cost: 999, tax_amount: 0, subtotal: 2500, expected_tax_cents: 999999, expected_shipping_cents: 1 },
    });
    const res = await POST(postRequest(baseBody({ order: draft })));
    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.extensions.expected_tax_cents).toBe(0); // server value, not 999999
    expect(persisted.extensions.expected_shipping_cents).toBe(599); // server value, not 1
  });

  it('C1: a first-time AUTHENTICATED buyer with no customers row is PROVISIONED before insert (no FK-fail)', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_new' } as any);
    vi.mocked(getCustomer).mockResolvedValue(null as any); // no row yet
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(200);
    // Provisioned: getOrCreateCustomer saw no row and created one...
    expect(vi.mocked(createCustomer)).toHaveBeenCalledTimes(1);
    expect((vi.mocked(createCustomer).mock.calls[0][0] as any).id).toBe('user_new');
    // ...and the order is then bound to that customer (FK satisfied).
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.customer_id).toBe('user_new');
  });

  it('an authenticated buyer who already has a customers row is NOT re-provisioned', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_existing' } as any);
    vi.mocked(getCustomer).mockResolvedValue({ id: 'user_existing' } as any);
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(200);
    expect(vi.mocked(createCustomer)).not.toHaveBeenCalled();
    expect((vi.mocked(createOrder).mock.calls[0][0] as any).customer_id).toBe('user_existing');
  });

  it('C1 degrade: if customer provisioning fails, the order still persists as a GUEST order (never FK-fails)', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_new' } as any);
    vi.mocked(getCustomer).mockRejectedValue(new Error('D1 unavailable'));
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    // customer_id dropped to guest → null FK is allowed, so the order persists.
    expect(persisted.customer_id).toBeUndefined();
  });

  it('binds the pending order to the authenticated customer (never the client draft)', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_42' } as any);
    vi.mocked(getCustomer).mockResolvedValue({ id: 'user_42' } as any);
    const res = await POST(postRequest(baseBody({ order: orderDraft({ customer_id: 'user_impersonated' }) })));
    expect(res.status).toBe(200);
    expect((vi.mocked(createOrder).mock.calls[0][0] as any).customer_id).toBe('user_42');
  });

  it('a duplicate pending order (UNIQUE/PK collision) is tolerated — still returns the client secret, does NOT cancel the PI', async () => {
    vi.mocked(createOrder).mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: orders.id'));
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).clientSecret).toBe('pi_minted_secret_abc');
    expect(vi.mocked(cancelPaymentIntent)).not.toHaveBeenCalled();
  });

  it('H1: a FOREIGN KEY constraint error is NOT swallowed — fails closed (500) and cancels the orphaned PI', async () => {
    // The old broad regex matched bare SQLITE_CONSTRAINT and would have masked
    // this as "already exists", handing back a secret for an order-less payment.
    vi.mocked(createOrder).mockRejectedValue(new Error('D1_ERROR: FOREIGN KEY constraint failed'));
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(500);
    const json = (await res.json()) as any;
    expect(json.code).toBe('pending_order_persist_failed');
    expect(json.clientSecret).toBeUndefined();
    // Orphaned PI is best-effort cancelled.
    expect(vi.mocked(cancelPaymentIntent)).toHaveBeenCalledWith('pi_minted');
  });

  it('refuses to return a client secret if the pending order cannot be persisted, and cancels the orphaned PI', async () => {
    vi.mocked(createOrder).mockRejectedValue(new Error('D1_ERROR: network connection lost'));
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(500);
    const json = (await res.json()) as any;
    expect(json.code).toBe('pending_order_persist_failed');
    expect(json.clientSecret).toBeUndefined();
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cancelPaymentIntent)).toHaveBeenCalledWith('pi_minted');
  });

  it('a PI-cancel failure on the persist-failure path stays non-fatal — still returns 500', async () => {
    vi.mocked(createOrder).mockRejectedValue(new Error('D1_ERROR: network connection lost'));
    vi.mocked(cancelPaymentIntent).mockRejectedValue(new Error('stripe unreachable'));
    const res = await POST(postRequest(baseBody()));
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).code).toBe('pending_order_persist_failed');
  });

  it('back-compat: an older client that sends no order draft still gets a PaymentIntent (no pending order)', async () => {
    const { order, ...noDraft } = baseBody();
    const res = await POST(postRequest(noDraft));
    expect(res.status).toBe(200);
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });
});

/**
 * The persisted `total_amount` must come from the SERVER-charged amount, not the
 * client draft.
 *
 * `POST /api/orders` rejects a `total_amount` that isn't an integer minor-unit
 * Money, but this route's draft path had no equivalent check — it ran the client
 * value through `Money.fromStored()`, which ROUNDS. So a draft carrying major
 * units (`{amount: 34.99}`) silently persisted an order totalling 35 CENTS.
 *
 * The charge is unaffected (the floor is computed server-side from the catalog),
 * so nothing rejects it — but the refund path treats `total_amount` as the
 * full-refund ceiling, so the order record and any later full refund are wrong by
 * ~100x. Same class of hole as the client-supplied `expected_tax_cents` the
 * route already overwrites: the draft is display data, never authoritative.
 */
describe('POST /api/payment-intent — pending-order total is server-derived', () => {
  it('ignores a major-unit total in the draft and persists the charged cents', async () => {
    // The client sends dollars where minor units are expected. Old behaviour:
    // Math.round(34.99) => 35 cents persisted.
    const draft = orderDraft({ total_amount: { amount: 34.99, currency: 'USD' } });

    const res = await POST(postRequest(baseBody({ order: draft })));

    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.total_amount.amount).toBe(3499);
  });

  it('ignores an inflated total in the draft and persists the charged cents', async () => {
    const draft = orderDraft({ total_amount: { amount: 999999, currency: 'USD' } });

    const res = await POST(postRequest(baseBody({ order: draft })));

    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.total_amount.amount).toBe(3499);
  });

  it('persists the charged cents when the draft omits a total entirely', async () => {
    const draft = orderDraft({ total_amount: undefined });

    const res = await POST(postRequest(baseBody({ order: draft })));

    expect(res.status).toBe(200);
    const persisted = vi.mocked(createOrder).mock.calls[0][0] as any;
    expect(persisted.total_amount.amount).toBe(3499);
  });

  it('charges Stripe and records the order with the SAME cents value', async () => {
    // The invariant the fix rests on: one `chargedAmountCents` feeds both the
    // PaymentIntent and the order row. Asserting both in one test is what
    // actually catches a future edit that reintroduces a second computation —
    // checking either side alone would still pass.
    const draft = orderDraft({ total_amount: { amount: 34.99, currency: 'USD' } });

    const res = await POST(postRequest(baseBody({ order: draft })));

    expect(res.status).toBe(200);
    const chargedCents = (vi.mocked(createPaymentIntent).mock.calls[0][0] as any).amount;
    const persistedCents = (vi.mocked(createOrder).mock.calls[0][0] as any).total_amount.amount;

    expect(chargedCents).toBe(3499);
    expect(persistedCents).toBe(chargedCents);
  });
});

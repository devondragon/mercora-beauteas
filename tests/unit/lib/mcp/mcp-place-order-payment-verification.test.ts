/**
 * Regression test for BMC-132 / C5 — MCP place_order must NOT persist an order
 * without a server-verified Stripe PaymentIntent. Previously placeOrder() called
 * createOrder() directly with a hardcoded status and zero payment verification,
 * so any authenticated agent could mint a real order for free.
 *
 * The gate requires a PaymentIntent that (a) succeeded, (b) is bound to this
 * agent+session via metadata, (c) covers the catalog value of the goods, and
 * (d) has not already funded another order. Any failure must return an error and
 * MUST NOT persist an order. The happy path must persist AND mark the order paid
 * atomically via createOrderPaid() (never a hardcoded 'confirmed', and never a
 * non-atomic create-then-markPaid that could strand a paid order).
 *
 * Mocks the session, Stripe, catalog pricing, and orders model so it runs in the
 * jsdom unit env (CI `npm test`) without touching D1/Cloudflare bindings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/session', () => ({
  requireOwnedSession: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
}));

// Preserve real exports (notably AMOUNT_TOLERANCE_CENTS, which the full-total
// gate in placeOrder reads) and override only the catalog-pricing verifier.
vi.mock('@/lib/services/order-pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/order-pricing')>();
  return { ...actual, verifyOrderChargeSufficient: vi.fn() };
});

vi.mock('@/lib/models/mach/orders', () => ({
  createOrderPaid: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
}));

// canonicalizeOrderItemsDisplay (real, not mocked above) resolves each line's
// display fields via getProduct. Mock the catalog read so it runs in the jsdom
// unit env — WITHOUT this mock the real getProduct calls getDb() (no D1 binding
// here), throws, and every test silently exercises the fail-soft catch instead
// of the intended canonicalization path (BMC-161 review).
vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

// GOOB: this suite pins the BMC-132/C5/BMC-161 place_order behavior with
// single-item, single-quantity carts — it isn't about the box minimum (that
// has its own dedicated test, mcp-sale-minimum-order.test.ts). Pin
// minimumBoxes to 0 so the new gate never trips here.
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: vi.fn().mockResolvedValue({
    minimumBoxes: 0,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [],
  }),
}));

import { requireOwnedSession } from '@/lib/mcp/session';
import { retrievePaymentIntent } from '@/lib/stripe';
import { verifyOrderChargeSufficient } from '@/lib/services/order-pricing';
import { createOrderPaid, getOrderByPaymentIntentId } from '@/lib/models/mach/orders';
import { getProduct, getProductVariant } from '@/lib/models/mach/products';
import { placeOrder } from '@/lib/mcp/tools/order';
import { computeOrderTotals } from '@/lib/services/order-pricing';
import { Money } from '@/lib/money';

const AGENT = 'agent-a';
const SESSION = 's1';
const PI = 'pi_123';

function ownedSessionWithCart() {
  return {
    ok: true as const,
    session: {
      sessionId: SESSION,
      agentId: AGENT,
      userContext: { agentId: AGENT },
      cart: [
        { productId: 'p1', variantId: 'v1', name: 'Morning Blend', price: 20, quantity: 1, primaryImageUrl: '' },
      ],
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    shippingAddress: { region: 'CA' },
    paymentMethod: 'agent-processed',
    shippingOption: 'standard',
    paymentIntentId: PI,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart());
  vi.mocked(getOrderByPaymentIntentId).mockResolvedValue(null);
  vi.mocked(verifyOrderChargeSufficient).mockResolvedValue({ ok: true, goodsCents: 2000, requiredCashCents: 2000 } as any);
  vi.mocked(createOrderPaid).mockResolvedValue({ id: 'ORD-1', status: 'processing', total_amount: { amount: 3174, currency: 'USD' } } as any);
  // Catalog truth for the single cart line (p1): a canonical name + image that
  // differ from the session-supplied display so canonicalization is observable.
  vi.mocked(getProduct).mockResolvedValue({ id: 'p1', name: 'Morning Blend', primary_image: 'https://cdn/catalog-p1.jpg' } as any);
});

describe('place_order requires a verified Stripe PaymentIntent (BMC-132 / C5)', () => {
  it('rejects and never creates an order when no paymentIntentId is supplied', async () => {
    const result = await placeOrder(baseRequest({ paymentIntentId: undefined }), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_REQUIRED');
    expect(vi.mocked(retrievePaymentIntent)).not.toHaveBeenCalled();
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('rejects when the PaymentIntent has not succeeded', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'requires_payment_method', amount_received: 0, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_NOT_COMPLETED');
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('rejects when the PaymentIntent is not bound to this agent+session', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 2000, metadata: { agentId: 'other-agent', sessionId: SESSION },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_NOT_BOUND');
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('rejects (replay guard) when the PaymentIntent already funded an order', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 2000, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);
    vi.mocked(getOrderByPaymentIntentId).mockResolvedValue({ id: 'ORD-existing' } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_ALREADY_USED');
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('treats a PK collision on insert (concurrent double-submit) as a replay, not a crash', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 3200, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);
    // Early lookup sees nothing (the racing order isn't visible yet)...
    vi.mocked(getOrderByPaymentIntentId).mockResolvedValueOnce(null);
    // ...then the atomic create+markPaid loses the PK race and throws...
    vi.mocked(createOrderPaid).mockRejectedValueOnce(new Error('UNIQUE constraint failed: orders.id'));
    // ...and the post-collision re-check now sees the winner's order.
    vi.mocked(getOrderByPaymentIntentId).mockResolvedValueOnce({ id: `MCP-${PI}` } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_ALREADY_USED');
    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledTimes(1);
  });

  it('rejects when the captured amount does not cover the catalog goods', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 50, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);
    vi.mocked(verifyOrderChargeSufficient).mockResolvedValue({ ok: false, reason: 'paid 50c is less than required 2000c', goodsCents: 2000, requiredCashCents: 2000 } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_INSUFFICIENT');
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('rejects when the captured amount covers the goods but not shipping+tax for the destination', async () => {
    // Goods ($20) pass verifyOrderChargeSufficient, but the full total for CA
    // (goods + $9.99 shipping + 8.75% tax = $31.74) is not covered — an agent
    // must not fund a cheap/empty-address PaymentIntent and ship to a costlier one.
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 2000, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_INSUFFICIENT');
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('persists and marks the order paid atomically via createOrderPaid on a fully verified payment', async () => {
    // $32.00 captured covers the full CA total ($31.74 = goods + shipping + tax).
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 3200, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(true);
    // Verification uses ONLY the captured amount, never the client total.
    expect(vi.mocked(verifyOrderChargeSufficient)).toHaveBeenCalledWith(
      expect.objectContaining({ paidAmountCents: 3200 })
    );
    // Order is persisted (bound to the PI) AND moved to paid/processing in a single
    // atomic call — never a hardcoded 'confirmed', never a strandable two-step write.
    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledWith(
      expect.objectContaining({ external_references: { payment_intent_id: PI } }),
      expect.objectContaining({ status: 'processing' })
    );
    expect(result.data.status).toBe('processing');
  });
});

describe('place_order persists catalog-canonicalized display + total (BMC-161)', () => {
  const succeededPi = {
    id: PI, status: 'succeeded', amount_received: 3200, metadata: { agentId: AGENT, sessionId: SESSION },
  } as any;

  it('persists total_amount as the catalog-derived total in CENTS, not the session-cart total', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue(succeededPi);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(true);
    // goods $20 (from goodsCents 2000) + $9.99 shipping + 8.75% CA tax ($1.75)
    // = $31.74 → 3174 cents. Must be cents (Money.amount convention), never the
    // dollars value 31.74 that would render 100x too small in the admin UI.
    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledWith(
      expect.objectContaining({ total_amount: { amount: 3174, currency: 'USD' } }),
      expect.anything()
    );
  });

  it('overwrites each line\'s display fields with catalog truth before persisting', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue(succeededPi);
    // Session cart claims a spoofed name/image; catalog says otherwise.
    vi.mocked(requireOwnedSession).mockResolvedValue({
      ok: true as const,
      session: {
        sessionId: SESSION,
        agentId: AGENT,
        userContext: { agentId: AGENT },
        cart: [
          { productId: 'p1', variantId: 'v1', name: 'Free Sample', price: 20, quantity: 1, primaryImageUrl: 'https://evil/spoof.jpg' },
        ],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    } as any);

    await placeOrder(baseRequest(), SESSION, AGENT);

    const persisted = vi.mocked(createOrderPaid).mock.calls[0][0] as any;
    expect(persisted.items[0].product_name).toBe('Morning Blend');
    expect(persisted.items[0].imageUrl).toBe('https://cdn/catalog-p1.jpg');
  });

  it('falls back to session display (name + image) without blocking the order when canonicalization fails', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue(succeededPi);
    vi.mocked(getProduct).mockRejectedValue(new Error('D1 unavailable'));
    vi.mocked(requireOwnedSession).mockResolvedValue({
      ok: true as const,
      session: {
        sessionId: SESSION,
        agentId: AGENT,
        userContext: { agentId: AGENT },
        cart: [
          { productId: 'p1', variantId: 'v1', name: 'Session Name', price: 20, quantity: 1, primaryImageUrl: 'https://cdn/session.jpg' },
        ],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(true);
    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(createOrderPaid).mock.calls[0][0] as any;
    expect(persisted.items[0].product_name).toBe('Session Name');
    expect(persisted.items[0].imageUrl).toBe('https://cdn/session.jpg');
  });
});

// Defect 1 (BMC-161 follow-up): shipping + tax are computed in DOLLARS, but the
// MCP cart carries prices in CENTS. computeOrderTotals is the shared
// shipping/tax helper; its callers pass a dollars subtotal (`…Cents / 100`).
//
// Final-review fix wave, item 5: this path never grants free shipping at any
// subtotal — see calculateShipping's doc comment in order-pricing.ts for why
// (the stale $100 threshold this describe block is named for is gone).
describe('shipping charges apply to dollars, not cents, with no free-shipping threshold (BMC-161 follow-up)', () => {
  it('charges standard shipping for a modest subtotal', () => {
    const { shipping } = computeOrderTotals(Money.fromMajor(50, 'USD'), { region: 'CA' } as any);
    expect(shipping.toMach().amount).toBe(9.99);
  });

  it('still charges standard shipping for a large subtotal (no free-shipping threshold)', () => {
    const { shipping } = computeOrderTotals(Money.fromMajor(150, 'USD'), { region: 'CA' } as any);
    expect(shipping.isZero()).toBe(false);
    expect(shipping.toMach().amount).toBe(9.99);
  });

  it('does not falsely trip the budget gate for a $20 (2000c) cart under a $100 budget', async () => {
    // Regression for the cents/dollars bug in placeOrder's budget block: with the
    // old code a 2000-cent subtotal made `subtotal >= 100` true (free shipping) AND
    // computed tax as 2000 * rate, so `total` was ~$2175 and blew any real budget.
    // With the fix the cart is treated as $20 → total $31.74 → well under $100.
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 3200, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);
    vi.mocked(requireOwnedSession).mockResolvedValue({
      ok: true as const,
      session: {
        sessionId: SESSION,
        agentId: AGENT,
        userContext: { agentId: AGENT },
        // price in CENTS, as the real MCP cart carries it (variant.price.amount).
        cart: [
          { productId: 'p1', variantId: 'v1', name: 'Morning Blend', price: 2000, quantity: 1, primaryImageUrl: '' },
        ],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    } as any);

    const result = await placeOrder(
      baseRequest({ agent_context: { userPreferences: { budget: 100 } } }),
      SESSION,
      AGENT,
    );

    // Fix: order proceeds. Bug: it would return status 'budget_exceeded'.
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('processing');
  });
});

// Defect 2 (BMC-161 follow-up): each line's unit_price/total_price must be derived
// from the catalog variant, never the session/client-supplied price.
describe('place_order canonicalizes per-line unit_price/total_price from the catalog (BMC-161 follow-up)', () => {
  const succeededPi = {
    id: PI, status: 'succeeded', amount_received: 3200, metadata: { agentId: AGENT, sessionId: SESSION },
  } as any;

  it('persists catalog-derived unit_price/total_price even when the session supplies spoofed prices', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue(succeededPi);
    // Catalog variant price is $20.00 (2000c) and belongs to product p1.
    vi.mocked(getProductVariant).mockResolvedValue({
      id: 'v1', product_id: 'p1', price: { amount: 2000, currency: 'USD' },
    } as any);
    // Session claims a spoofed $0.01 unit price for qty 2.
    vi.mocked(requireOwnedSession).mockResolvedValue({
      ok: true as const,
      session: {
        sessionId: SESSION,
        agentId: AGENT,
        userContext: { agentId: AGENT },
        cart: [
          { productId: 'p1', variantId: 'v1', name: 'Morning Blend', price: 1, quantity: 2, primaryImageUrl: '' },
        ],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    } as any);

    await placeOrder(baseRequest(), SESSION, AGENT);

    const persisted = vi.mocked(createOrderPaid).mock.calls[0][0] as any;
    // unit_price is the catalog cents value, NOT the spoofed 1c; total_price is
    // recomputed server-side as unit_price * quantity (2000 * 2 = 4000c).
    expect(persisted.items[0].unit_price).toEqual({ amount: 2000, currency: 'USD' });
    expect(persisted.items[0].total_price).toEqual({ amount: 4000, currency: 'USD' });
  });

  it('fails soft to the session price for a line when the catalog lookup throws', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue(succeededPi);
    // Catalog read blows up — pricing canonicalization must not block the paid order.
    vi.mocked(getProductVariant).mockRejectedValue(new Error('D1 unavailable'));
    vi.mocked(requireOwnedSession).mockResolvedValue({
      ok: true as const,
      session: {
        sessionId: SESSION,
        agentId: AGENT,
        userContext: { agentId: AGENT },
        cart: [
          { productId: 'p1', variantId: 'v1', name: 'Morning Blend', price: 1500, quantity: 1, primaryImageUrl: '' },
        ],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(true);
    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(createOrderPaid).mock.calls[0][0] as any;
    // Falls back to the session-supplied price (in cents) rather than dropping the line.
    expect(persisted.items[0].unit_price).toEqual({ amount: 1500, currency: 'USD' });
    expect(persisted.items[0].total_price).toEqual({ amount: 1500, currency: 'USD' });
  });
});

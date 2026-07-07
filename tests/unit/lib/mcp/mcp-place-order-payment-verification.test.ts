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

import { requireOwnedSession } from '@/lib/mcp/session';
import { retrievePaymentIntent } from '@/lib/stripe';
import { verifyOrderChargeSufficient } from '@/lib/services/order-pricing';
import { createOrderPaid, getOrderByPaymentIntentId } from '@/lib/models/mach/orders';
import { getProduct } from '@/lib/models/mach/products';
import { placeOrder } from '@/lib/mcp/tools/order';

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

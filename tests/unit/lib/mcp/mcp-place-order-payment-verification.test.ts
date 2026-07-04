/**
 * Regression test for BMC-132 / C5 — MCP place_order must NOT persist an order
 * without a server-verified Stripe PaymentIntent. Previously placeOrder() called
 * createOrder() directly with a hardcoded status and zero payment verification,
 * so any authenticated agent could mint a real order for free.
 *
 * The gate requires a PaymentIntent that (a) succeeded, (b) is bound to this
 * agent+session via metadata, (c) covers the catalog value of the goods, and
 * (d) has not already funded another order. Any failure must return an error and
 * MUST NOT call createOrder(). The happy path must mark the order paid via
 * markOrderPaid() (never a hardcoded 'confirmed').
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

vi.mock('@/lib/services/order-pricing', () => ({
  verifyOrderChargeSufficient: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  createOrder: vi.fn(),
  markOrderPaid: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
}));

import { requireOwnedSession } from '@/lib/mcp/session';
import { retrievePaymentIntent } from '@/lib/stripe';
import { verifyOrderChargeSufficient } from '@/lib/services/order-pricing';
import { createOrder, markOrderPaid, getOrderByPaymentIntentId } from '@/lib/models/mach/orders';
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
  vi.mocked(createOrder).mockResolvedValue({ id: 'ORD-1', status: 'pending', total_amount: { amount: 29.99, currency: 'USD' } } as any);
  vi.mocked(markOrderPaid).mockResolvedValue({ id: 'ORD-1', status: 'processing', total_amount: { amount: 29.99, currency: 'USD' } } as any);
});

describe('place_order requires a verified Stripe PaymentIntent (BMC-132 / C5)', () => {
  it('rejects and never creates an order when no paymentIntentId is supplied', async () => {
    const result = await placeOrder(baseRequest({ paymentIntentId: undefined }), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_REQUIRED');
    expect(vi.mocked(retrievePaymentIntent)).not.toHaveBeenCalled();
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
    expect(vi.mocked(markOrderPaid)).not.toHaveBeenCalled();
  });

  it('rejects when the PaymentIntent has not succeeded', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'requires_payment_method', amount_received: 0, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_NOT_COMPLETED');
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });

  it('rejects when the PaymentIntent is not bound to this agent+session', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 2000, metadata: { agentId: 'other-agent', sessionId: SESSION },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_NOT_BOUND');
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });

  it('rejects (replay guard) when the PaymentIntent already funded an order', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 2000, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);
    vi.mocked(getOrderByPaymentIntentId).mockResolvedValue({ id: 'ORD-existing' } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_ALREADY_USED');
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });

  it('treats a PK collision on insert (concurrent double-submit) as a replay, not a crash', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 2000, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);
    // Early lookup sees nothing (the racing order isn't visible yet)...
    vi.mocked(getOrderByPaymentIntentId).mockResolvedValueOnce(null);
    // ...then createOrder loses the PK race and throws...
    vi.mocked(createOrder).mockRejectedValueOnce(new Error('UNIQUE constraint failed: orders.id'));
    // ...and the post-collision re-check now sees the winner's order.
    vi.mocked(getOrderByPaymentIntentId).mockResolvedValueOnce({ id: `MCP-${PI}` } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_ALREADY_USED');
    expect(vi.mocked(markOrderPaid)).not.toHaveBeenCalled();
  });

  it('rejects when the captured amount does not cover the catalog goods', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 50, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);
    vi.mocked(verifyOrderChargeSufficient).mockResolvedValue({ ok: false, reason: 'paid 50c is less than required 2000c', goodsCents: 2000, requiredCashCents: 2000 } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_INSUFFICIENT');
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });

  it('creates the order and marks it paid via markOrderPaid on a fully verified payment', async () => {
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: PI, status: 'succeeded', amount_received: 2000, metadata: { agentId: AGENT, sessionId: SESSION },
    } as any);

    const result = await placeOrder(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(true);
    // Verification uses ONLY the captured amount, never the client total.
    expect(vi.mocked(verifyOrderChargeSufficient)).toHaveBeenCalledWith(
      expect.objectContaining({ paidAmountCents: 2000 })
    );
    // Order is persisted, bound to the PI, then marked paid — never hardcoded 'confirmed'.
    expect(vi.mocked(createOrder)).toHaveBeenCalledWith(
      expect.objectContaining({ external_references: { payment_intent_id: PI } })
    );
    expect(vi.mocked(markOrderPaid)).toHaveBeenCalledWith('ORD-1', expect.objectContaining({ status: 'processing' }));
    expect(result.data.status).toBe('processing');
  });
});

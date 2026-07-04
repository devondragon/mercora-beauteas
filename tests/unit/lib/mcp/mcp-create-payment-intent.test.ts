/**
 * Unit tests for the MCP create_payment_intent tool (BMC-132 / C5).
 *
 * create_payment_intent is the other half of the place_order payment handshake:
 * it prices the caller's session cart from the CATALOG (never client/session-
 * supplied prices) and mints a Stripe PaymentIntent stamped with
 * { agentId, sessionId } so place_order can verify the payment is bound to this
 * exact caller. These tests lock in the fail-closed branches (ownership, empty
 * cart, Stripe not configured, catalog pricing errors, sub-minimum amount) and
 * the server-derived amount + metadata binding on the happy path.
 *
 * Mocks the session, catalog pricing, Stripe, and the order-totals helper so it
 * runs in the jsdom unit env (CI `npm test`) without touching D1/Cloudflare.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/session', () => ({
  requireOwnedSession: vi.fn(),
}));

vi.mock('@/lib/services/order-pricing', () => ({
  computeCatalogSubtotalCents: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  createPaymentIntent: vi.fn(),
  formatAmountForStripe: vi.fn((amount: number) => Math.round(amount * 100)),
  isStripeConfigured: vi.fn(),
}));

// computeOrderTotals is exercised elsewhere; mock it here so this test controls
// the total directly and never loads the real order.ts (and its DB imports).
// normalizeAddress is mocked as identity — its own behavior is covered via the
// place_order tests; here we only need the total the (mocked) computeOrderTotals
// returns.
vi.mock('@/lib/mcp/tools/order', () => ({
  computeOrderTotals: vi.fn(),
  normalizeAddress: vi.fn((a) => a ?? {}),
}));

import { requireOwnedSession } from '@/lib/mcp/session';
import { computeCatalogSubtotalCents } from '@/lib/services/order-pricing';
import { createPaymentIntent, isStripeConfigured } from '@/lib/stripe';
import { computeOrderTotals } from '@/lib/mcp/tools/order';
import { createAgentPaymentIntent } from '@/lib/mcp/tools/payment';

const AGENT = 'agent-a';
const SESSION = 's1';

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
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart());
  vi.mocked(computeCatalogSubtotalCents).mockResolvedValue({ subtotalCents: 2000, errors: [] } as any);
  vi.mocked(isStripeConfigured).mockReturnValue(true);
  vi.mocked(computeOrderTotals).mockReturnValue({ subtotal: 20, shipping: 5, tax: 2, total: 27 });
  vi.mocked(createPaymentIntent).mockResolvedValue({ id: 'pi_new', client_secret: 'cs_123' } as any);
});

describe('create_payment_intent (BMC-132 / C5)', () => {
  it('rejects when the caller does not own the session and never charges', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue({
      ok: false, code: 'SESSION_ACCESS_DENIED', message: 'Agent does not own this session',
    } as any);

    const result = await createAgentPaymentIntent(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SESSION_ACCESS_DENIED');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('rejects an empty cart', async () => {
    const owned = ownedSessionWithCart();
    owned.session.cart = [];
    vi.mocked(requireOwnedSession).mockResolvedValue(owned);

    const result = await createAgentPaymentIntent(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EMPTY_CART');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('fails closed when Stripe is not configured', async () => {
    vi.mocked(isStripeConfigured).mockReturnValue(false);

    const result = await createAgentPaymentIntent(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('STRIPE_NOT_CONFIGURED');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('rejects when catalog pricing reports errors (never falls back to cart prices)', async () => {
    vi.mocked(computeCatalogSubtotalCents).mockResolvedValue({
      subtotalCents: 0, errors: ['p1/v1 not found'],
    } as any);

    const result = await createAgentPaymentIntent(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CATALOG_PRICE_UNAVAILABLE');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('rejects a sub-$0.50 total (below the Stripe minimum)', async () => {
    vi.mocked(computeOrderTotals).mockReturnValue({ subtotal: 0.2, shipping: 0, tax: 0, total: 0.2 });

    const result = await createAgentPaymentIntent(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AMOUNT_TOO_LOW');
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('prices from the catalog and mints a PaymentIntent bound to this agent+session', async () => {
    const result = await createAgentPaymentIntent(baseRequest(), SESSION, AGENT);

    expect(result.success).toBe(true);
    // Amount comes from the catalog subtotal (2000c) → computeOrderTotals, never
    // the caller. The PI is stamped with { agentId, sessionId } so place_order can
    // verify the binding, and the amount is server-derived (formatAmountForStripe).
    expect(vi.mocked(computeCatalogSubtotalCents)).toHaveBeenCalledWith([
      { product_id: 'p1', variant_id: 'v1', quantity: 1 },
    ]);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2700, // formatAmountForStripe(27)
        currency: 'usd',
        metadata: { agentId: AGENT, sessionId: SESSION },
      })
    );
    expect(result.data.paymentIntentId).toBe('pi_new');
    expect(result.data.clientSecret).toBe('cs_123');
    expect(result.data.amount).toBe(27);
  });
});

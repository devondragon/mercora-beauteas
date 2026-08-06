/**
 * The 10-box minimum must hold for the MCP agent-commerce surface too (GOOB).
 *
 * The HTTP routes (POST /api/payment-intent, POST /api/orders) are gated —
 * see tests/unit/app/api/sale-minimum-order.test.ts — but an authenticated
 * agent (a hashed X-Agent-API-Key holder) can mint a PaymentIntent and place
 * an order through a completely separate code path: lib/mcp/tools/payment.ts
 * (create_payment_intent) and lib/mcp/tools/order.ts (place_order). Both must
 * refuse an under-minimum cart through the identical lib/sale/rules seam, so
 * the threshold and message can never drift from the HTTP gates.
 *
 * place_order is gated independently of create_payment_intent (not just
 * relying on the earlier gate) because the session cart is mutable between
 * the two calls — see the comment in lib/mcp/tools/order.ts.
 *
 * Same mocking shape as mcp-create-payment-intent.test.ts and
 * mcp-place-order-payment-verification.test.ts: the session, catalog pricing,
 * Stripe, and order-model boundaries are mocked so this runs in the jsdom
 * unit env without touching D1/Cloudflare bindings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CartItem } from '@/lib/types/cartitem';

vi.mock('@/lib/mcp/session', () => ({
  requireOwnedSession: vi.fn(),
}));

vi.mock('@/lib/services/order-pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/order-pricing')>();
  return {
    ...actual,
    computeCatalogSubtotalCents: vi.fn(),
    verifyOrderChargeSufficient: vi.fn(),
  };
});

vi.mock('@/lib/stripe', () => ({
  createPaymentIntent: vi.fn(),
  formatAmountForStripe: vi.fn((amount: number) => Math.round(amount * 100)),
  isStripeConfigured: vi.fn(),
  retrievePaymentIntent: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  createOrderPaid: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  getProductVariant: vi.fn(),
}));

// Only the settings read is mocked; the pure rules run for real, so the test
// exercises the same box counting the HTTP routes use.
const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: (...args: unknown[]) => getSaleRules(...args),
}));

import { requireOwnedSession } from '@/lib/mcp/session';
import { computeCatalogSubtotalCents, verifyOrderChargeSufficient } from '@/lib/services/order-pricing';
import { createPaymentIntent, isStripeConfigured, retrievePaymentIntent } from '@/lib/stripe';
import { createOrderPaid, getOrderByPaymentIntentId } from '@/lib/models/mach/orders';
import { getProduct } from '@/lib/models/mach/products';
import { createAgentPaymentIntent } from '@/lib/mcp/tools/payment';
import { placeOrder } from '@/lib/mcp/tools/order';

const AGENT = 'agent-a';
const SESSION = 's1';
const PI = 'pi_123';

function cartLine(overrides: Partial<CartItem> = {}): CartItem {
  return { productId: 'p1', variantId: 'v1', name: 'Morning Blend', price: 20, quantity: 6, primaryImageUrl: '', ...overrides };
}

function ownedSessionWithCart(cart: CartItem[]) {
  return {
    ok: true as const,
    session: {
      sessionId: SESSION,
      agentId: AGENT,
      userContext: { agentId: AGENT },
      cart,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSaleRules.mockResolvedValue({
    minimumBoxes: 10,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [{ max_boxes: null, cost: 22 }],
  });
});

describe('create_payment_intent — box minimum', () => {
  beforeEach(() => {
    vi.mocked(computeCatalogSubtotalCents).mockResolvedValue({ subtotalCents: 2000, errors: [] } as any);
    vi.mocked(isStripeConfigured).mockReturnValue(true);
    vi.mocked(createPaymentIntent).mockResolvedValue({ id: 'pi_new', client_secret: 'cs_123' } as any);
  });

  it('refuses an under-minimum agent cart with the identical message and never mints a PaymentIntent', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart([cartLine({ quantity: 6 })]));

    const result = await createAgentPaymentIntent({ shippingAddress: { region: 'CA' } } as any, SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BELOW_MINIMUM_ORDER');
    expect(result.error?.message).toBe('Add 4 more boxes to check out — 10 box minimum.');
    expect(vi.mocked(computeCatalogSubtotalCents)).not.toHaveBeenCalled();
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it('does not refuse a cart at the minimum for this reason', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart([cartLine({ quantity: 10 })]));

    const result = await createAgentPaymentIntent({ shippingAddress: { region: 'CA' } } as any, SESSION, AGENT);

    expect(result.success).toBe(true);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledTimes(1);
  });
});

describe('place_order — box minimum', () => {
  const succeededPi = {
    id: PI, status: 'succeeded', amount_received: 3200, metadata: { agentId: AGENT, sessionId: SESSION },
  } as any;

  beforeEach(() => {
    vi.mocked(getOrderByPaymentIntentId).mockResolvedValue(null);
    vi.mocked(verifyOrderChargeSufficient).mockResolvedValue({ ok: true, goodsCents: 2000, requiredCashCents: 2000 } as any);
    vi.mocked(createOrderPaid).mockResolvedValue({ id: 'ORD-1', status: 'processing', total_amount: { amount: 3174, currency: 'USD' } } as any);
    vi.mocked(retrievePaymentIntent).mockResolvedValue(succeededPi);
    vi.mocked(getProduct).mockResolvedValue({ id: 'p1', name: 'Morning Blend', primary_image: 'https://cdn/catalog-p1.jpg' } as any);
  });

  it('refuses an under-minimum agent cart with the identical message and never persists an order', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart([cartLine({ quantity: 6 })]));

    const result = await placeOrder(
      { shippingAddress: { region: 'CA' }, paymentMethod: 'agent-processed', shippingOption: 'standard', paymentIntentId: PI } as any,
      SESSION,
      AGENT
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BELOW_MINIMUM_ORDER');
    expect(result.error?.message).toBe('Add 4 more boxes to check out — 10 box minimum.');
    // Gate runs before Stripe verification and before the order is persisted.
    expect(vi.mocked(retrievePaymentIntent)).not.toHaveBeenCalled();
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('refuses even when a PaymentIntent already funded the (now-shrunk) cart', async () => {
    // The exploit this closes: mint a PaymentIntent against a qualifying cart,
    // then remove items before calling place_order. The captured cash still
    // covers the (now smaller) goods total, so the money-sufficiency gate alone
    // would let this through — the box gate must catch it independently.
    vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart([cartLine({ quantity: 2 })]));

    const result = await placeOrder(
      { shippingAddress: { region: 'CA' }, paymentMethod: 'agent-processed', shippingOption: 'standard', paymentIntentId: PI } as any,
      SESSION,
      AGENT
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BELOW_MINIMUM_ORDER');
    expect(vi.mocked(createOrderPaid)).not.toHaveBeenCalled();
  });

  it('does not refuse a cart at the minimum for this reason', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart([cartLine({ quantity: 10 })]));

    const result = await placeOrder(
      { shippingAddress: { region: 'CA' }, paymentMethod: 'agent-processed', shippingOption: 'standard', paymentIntentId: PI } as any,
      SESSION,
      AGENT
    );

    expect(result.success).toBe(true);
    expect(vi.mocked(createOrderPaid)).toHaveBeenCalledTimes(1);
  });
});

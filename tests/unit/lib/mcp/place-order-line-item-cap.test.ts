/**
 * Unit test for the MCP place_order line-item cap (BMC-188).
 *
 * place_order prices/verifies the session cart with one catalog read per line
 * (verifyOrderChargeSufficient, canonicalize*), so an oversized cart is a cheap
 * way to force hundreds of concurrent D1 reads and exhaust Worker CPU. The cap
 * reuses the same MAX_ORDER_LINE_ITEMS (100) the web checkout path enforces and
 * fails closed BEFORE any catalog read or Stripe call.
 *
 * Keeps the REAL order-pricing module (so MAX_ORDER_LINE_ITEMS resolves) and
 * mocks only the session + the Stripe/order-model boundaries the cap must never
 * reach, so this runs in the jsdom unit env (CI `npm test`) without touching D1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/session', () => ({
  requireOwnedSession: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  createOrderPaid: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
}));

// GOOB: this suite pins the BMC-188 line-item cap with quantity-1 fixtures
// (100 items = 100 boxes, well above any real minimum, but the second case
// needs the gate to fall through cleanly) — it isn't about the box minimum
// itself (that has its own dedicated test, mcp-sale-minimum-order.test.ts).
// Pin minimumBoxes to 0 so the new gate never trips here.
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
import { getOrderByPaymentIntentId } from '@/lib/models/mach/orders';
import { placeOrder } from '@/lib/mcp/tools/order';

const AGENT = 'agent-a';
const SESSION = 's1';

function ownedSessionWithCart(itemCount: number) {
  return {
    ok: true as const,
    session: {
      sessionId: SESSION,
      agentId: AGENT,
      userContext: { agentId: AGENT },
      cart: Array.from({ length: itemCount }, (_, i) => ({
        productId: `p${i}`, variantId: `v${i}`, name: 'Blend', price: 20, quantity: 1, primaryImageUrl: '',
      })),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

const baseRequest = { shippingAddress: { region: 'CA' }, paymentIntentId: 'pi_x' } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('place_order line-item cap (BMC-188)', () => {
  it('rejects a cart of 101 items before any catalog read or Stripe call', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart(101));

    const result = await placeOrder(baseRequest, SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TOO_MANY_LINE_ITEMS');
    // Cap short-circuits before the payment gate / replay lookup — no Stripe or
    // order-model reads happen for an oversized cart.
    expect(vi.mocked(retrievePaymentIntent)).not.toHaveBeenCalled();
    expect(vi.mocked(getOrderByPaymentIntentId)).not.toHaveBeenCalled();
  });

  it('does not trip the cap at exactly the limit (100 items)', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(ownedSessionWithCart(100));
    // Missing paymentIntentId here; a 100-item cart passes the cap and reaches
    // the payment gate, so the error is PAYMENT_REQUIRED — NOT TOO_MANY_LINE_ITEMS.
    const result = await placeOrder({ shippingAddress: { region: 'CA' } } as any, SESSION, AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYMENT_REQUIRED');
  });
});

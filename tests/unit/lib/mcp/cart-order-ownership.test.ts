/**
 * Regression test for BMC-133 / C6 — MCP cart/order tool functions must
 * verify session ownership (via requireOwnedSession()) before reading or
 * mutating the session's cart / placing an order on it. Without this, an
 * agent could pass another agent's session_id and hijack its cart or order
 * on its behalf.
 *
 * This mocks lib/mcp/session (and the model layers cart/order tools call
 * into) so it runs in the jsdom unit env (CI `npm test`) without touching
 * D1/Cloudflare bindings. It verifies the ownership gate short-circuits
 * before any mutation (updateSessionCart / getProductBySlug / createOrder)
 * runs, for both the "session not found" and "wrong agent" cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/session', () => ({
  requireOwnedSession: vi.fn(),
  updateSessionCart: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProductBySlug: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  createOrder: vi.fn(),
}));

vi.mock('@/lib/mcp/catalog', () => ({
  ritualBundleSuggestions: vi.fn().mockReturnValue([]),
}));

import { requireOwnedSession, updateSessionCart } from '@/lib/mcp/session';
import { getProductBySlug } from '@/lib/models/mach/products';
import { createOrder } from '@/lib/models/mach/orders';
import {
  addToCart,
  bulkAddToCart,
  clearCart,
  updateCart,
  removeFromCart,
  getCartEstimate,
} from '@/lib/mcp/tools/cart';
import { placeOrder } from '@/lib/mcp/tools/order';

const NOT_FOUND = { ok: false as const, code: 'SESSION_NOT_FOUND' as const, message: 'Session not found or expired' };
const DENIED = { ok: false as const, code: 'SESSION_ACCESS_DENIED' as const, message: 'Agent does not own this session' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cart/order tools enforce session ownership (BMC-133 / C6)', () => {
  it.each([
    ['addToCart', () => addToCart({ productId: 1, variantId: 1, agent_context: undefined } as any, 's1', 'agent-attacker')],
    ['bulkAddToCart', () => bulkAddToCart({ items: [{ productId: 1, variantId: 1 }] } as any, 's1', 'agent-attacker')],
    ['clearCart', () => clearCart('s1', 'agent-attacker')],
    ['updateCart', () => updateCart({ productId: 1, variantId: 1, quantity: 1 } as any, 's1', 'agent-attacker')],
    ['removeFromCart', () => removeFromCart({ productId: 1, variantId: 1 } as any, 's1', 'agent-attacker')],
    ['getCartEstimate', () => getCartEstimate('s1', 'agent-attacker')],
    ['placeOrder', () => placeOrder({ shippingAddress: {}, paymentMethod: 'x', shippingOption: 'standard' } as any, 's1', 'agent-attacker')],
  ])('%s rejects with SESSION_ACCESS_DENIED and never mutates when the caller does not own the session', async (_name, run) => {
    vi.mocked(requireOwnedSession).mockResolvedValue(DENIED);

    const result = await run();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SESSION_ACCESS_DENIED');
    expect(vi.mocked(updateSessionCart)).not.toHaveBeenCalled();
    expect(vi.mocked(getProductBySlug)).not.toHaveBeenCalled();
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });

  it.each([
    ['addToCart', () => addToCart({ productId: 1, variantId: 1, agent_context: undefined } as any, 'missing', 'agent-a')],
    ['bulkAddToCart', () => bulkAddToCart({ items: [{ productId: 1, variantId: 1 }] } as any, 'missing', 'agent-a')],
    ['clearCart', () => clearCart('missing', 'agent-a')],
    ['updateCart', () => updateCart({ productId: 1, variantId: 1, quantity: 1 } as any, 'missing', 'agent-a')],
    ['removeFromCart', () => removeFromCart({ productId: 1, variantId: 1 } as any, 'missing', 'agent-a')],
    ['getCartEstimate', () => getCartEstimate('missing', 'agent-a')],
    ['placeOrder', () => placeOrder({ shippingAddress: {}, paymentMethod: 'x', shippingOption: 'standard' } as any, 'missing', 'agent-a')],
  ])('%s fails gracefully with SESSION_NOT_FOUND (not a crash) when the session does not exist', async (_name, run) => {
    vi.mocked(requireOwnedSession).mockResolvedValue(NOT_FOUND);

    const result = await run();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SESSION_NOT_FOUND');
    expect(vi.mocked(updateSessionCart)).not.toHaveBeenCalled();
    expect(vi.mocked(getProductBySlug)).not.toHaveBeenCalled();
    expect(vi.mocked(createOrder)).not.toHaveBeenCalled();
  });

  it('addToCart proceeds normally when the caller owns the session', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue({
      ok: true,
      session: {
        sessionId: 's1',
        agentId: 'agent-a',
        userContext: { agentId: 'agent-a' },
        cart: [],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    vi.mocked(getProductBySlug).mockResolvedValue({
      id: 'p1',
      name: 'Morning Blend',
      variants: [{ id: 'v1', price: 1000 }],
    } as any);

    const result = await addToCart(
      { productId: 1 as any, variantId: 'v1' as any, sessionId: 's1', agent_context: undefined },
      's1',
      'agent-a'
    );

    expect(requireOwnedSession).toHaveBeenCalledWith('s1', 'agent-a');
    expect(result.success).toBe(true);
    expect(vi.mocked(updateSessionCart)).toHaveBeenCalledWith('s1', expect.any(Array));
  });
});

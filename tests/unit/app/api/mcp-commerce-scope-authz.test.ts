/**
 * Regression test for BMC-188 — MCP commerce permission-scope authorization.
 *
 * The cart-mutating tools (add/update/remove/bulk-add/clear) and the placement
 * tools (place_order, create_payment_intent) previously ran for ANY
 * authenticated agent, ignoring the per-agent `permissions` array entirely. A
 * key provisioned `["read:products"]` — or `[]` — could still mutate carts and
 * spend money. The fix gates them behind hasPermission (write:cart / place:orders,
 * with admin/* as superuser), failing closed. The JSON dispatcher (POST /api/mcp)
 * is the primary path callers reach these tools by, so the gate is tested here.
 *
 * Mocks authenticateAgent (keeping the REAL hasPermission / COMMERCE_TOOL_SCOPES
 * via importActual) and the tool modules so nothing touches D1 — runs in the
 * jsdom unit env (CI `npm test`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/auth', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/mcp/auth')>();
  return {
    ...actual,
    authenticateAgent: vi.fn(),
  };
});

vi.mock('@/lib/mcp/tools/cart', () => ({
  addToCart: vi.fn().mockResolvedValue({ success: true }),
  updateCart: vi.fn().mockResolvedValue({ success: true }),
  removeFromCart: vi.fn().mockResolvedValue({ success: true }),
  bulkAddToCart: vi.fn().mockResolvedValue({ success: true }),
  clearCart: vi.fn().mockResolvedValue({ success: true }),
  getCartEstimate: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/mcp/tools/order', () => ({
  placeOrder: vi.fn().mockResolvedValue({ success: true }),
  getOrderStatus: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/mcp/tools/payment', () => ({
  createAgentPaymentIntent: vi.fn().mockResolvedValue({ success: true }),
  validatePayment: vi.fn().mockResolvedValue({ success: true }),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/mcp/route';
import { authenticateAgent } from '@/lib/mcp/auth';
import { addToCart, updateCart, removeFromCart, bulkAddToCart, clearCart } from '@/lib/mcp/tools/cart';
import { placeOrder } from '@/lib/mcp/tools/order';
import { createAgentPaymentIntent } from '@/lib/mcp/tools/payment';

const url = 'http://localhost/api/mcp';

function postTool(tool: string, params: Record<string, unknown> = {}) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify({ tool, params, session_id: 's1' }),
  });
}

const CART_TOOLS: Array<[string, ReturnType<typeof vi.fn>]> = [
  ['add_to_cart', vi.mocked(addToCart)],
  ['update_cart', vi.mocked(updateCart)],
  ['remove_from_cart', vi.mocked(removeFromCart)],
  ['bulk_add_to_cart', vi.mocked(bulkAddToCart)],
  ['clear_cart', vi.mocked(clearCart)],
];

const PLACEMENT_TOOLS: Array<[string, ReturnType<typeof vi.fn>]> = [
  ['place_order', vi.mocked(placeOrder)],
  ['create_payment_intent', vi.mocked(createAgentPaymentIntent)],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP commerce-scope authorization (BMC-188)', () => {
  it.each(CART_TOOLS)(
    '%s is 403 for an agent without write:cart, and the tool never runs',
    async (tool, toolFn) => {
      vi.mocked(authenticateAgent).mockResolvedValue({
        success: true,
        agentId: 'agent-readonly',
        permissions: ['read:products'],
      });

      const res = await POST(postTool(tool));

      expect(res.status).toBe(403);
      expect(toolFn).not.toHaveBeenCalled();
    }
  );

  it.each(PLACEMENT_TOOLS)(
    '%s is 403 for an agent without place:orders, and the tool never runs',
    async (tool, toolFn) => {
      // write:cart alone must NOT grant placement — a distinct scope guards money.
      vi.mocked(authenticateAgent).mockResolvedValue({
        success: true,
        agentId: 'agent-cart-only',
        permissions: ['write:cart'],
      });

      const res = await POST(postTool(tool));

      expect(res.status).toBe(403);
      expect(toolFn).not.toHaveBeenCalled();
    }
  );

  it.each(CART_TOOLS)('allows %s for an agent holding write:cart', async (tool, toolFn) => {
    vi.mocked(authenticateAgent).mockResolvedValue({
      success: true,
      agentId: 'agent-cart',
      permissions: ['write:cart'],
    });

    const res = await POST(postTool(tool));

    expect(res.status).toBe(200);
    expect(toolFn).toHaveBeenCalled();
  });

  it.each(PLACEMENT_TOOLS)('allows %s for an agent holding place:orders', async (tool, toolFn) => {
    vi.mocked(authenticateAgent).mockResolvedValue({
      success: true,
      agentId: 'agent-buyer',
      permissions: ['place:orders'],
    });

    const res = await POST(postTool(tool));

    expect(res.status).toBe(200);
    expect(toolFn).toHaveBeenCalled();
  });

  it.each([...CART_TOOLS, ...PLACEMENT_TOOLS])(
    'allows %s for a superuser (admin) agent',
    async (tool, toolFn) => {
      vi.mocked(authenticateAgent).mockResolvedValue({
        success: true,
        agentId: 'agent-admin',
        permissions: ['admin'],
      });

      const res = await POST(postTool(tool));

      expect(res.status).toBe(200);
      expect(toolFn).toHaveBeenCalled();
    }
  );

  it('does not apply the commerce gate to read-only tools (get_cart)', async () => {
    vi.mocked(authenticateAgent).mockResolvedValue({
      success: true,
      agentId: 'agent-readonly',
      permissions: [],
    });

    const res = await POST(postTool('get_cart'));

    expect(res.status).not.toBe(403);
  });
});

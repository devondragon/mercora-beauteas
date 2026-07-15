/**
 * Regression test for BMC-188 — MCP commerce permission-scope authorization on
 * the REST `/api/mcp/tools/*` routes.
 *
 * The commerce-scope gate is enforced on BOTH the JSON dispatcher (POST
 * /api/mcp, covered by mcp-commerce-scope-authz.test.ts) AND the individual
 * REST tool routes — an agent can reach a cart/order tool directly via its REST
 * endpoint, so the REST routes must fail closed too. After the BMC-188 review
 * the REST routes derive their required scope from `COMMERCE_TOOL_SCOPES` (the
 * single source of truth) via `requiredScopeForTool`; this test locks in that
 * the 403 enforcement is actually wired on the REST path.
 *
 * Exercises one write:cart route (cart/add) and one place:orders route
 * (order/place). Mocks authenticateAgent (keeping the REAL hasPermission /
 * requiredScopeForTool / COMMERCE_TOOL_SCOPES via importActual) and the tool
 * modules so nothing touches D1 — runs in the jsdom unit env (CI `npm test`).
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
}));

vi.mock('@/lib/mcp/tools/order', () => ({
  placeOrder: vi.fn().mockResolvedValue({ success: true }),
}));

import { NextRequest } from 'next/server';
import { POST as cartAddPOST } from '@/app/api/mcp/tools/cart/add/route';
import { POST as orderPlacePOST } from '@/app/api/mcp/tools/order/place/route';
import { authenticateAgent } from '@/lib/mcp/auth';
import { addToCart } from '@/lib/mcp/tools/cart';
import { placeOrder } from '@/lib/mcp/tools/order';

function post(path: string, body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify({ session_id: 's1', ...body }),
  });
}

function auth(permissions: string[] | undefined) {
  vi.mocked(authenticateAgent).mockResolvedValue({
    success: true,
    agentId: 'agent-under-test',
    permissions,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP REST commerce-scope authorization (BMC-188)', () => {
  describe('cart/add (write:cart route)', () => {
    it('is 403 for an agent without write:cart, and addToCart never runs', async () => {
      auth(['read:products']);

      const res = await cartAddPOST(post('/api/mcp/tools/cart/add'));

      expect(res.status).toBe(403);
      expect(addToCart).not.toHaveBeenCalled();
    });

    it('fails closed for empty permissions ([])', async () => {
      auth([]);

      const res = await cartAddPOST(post('/api/mcp/tools/cart/add'));

      expect(res.status).toBe(403);
      expect(addToCart).not.toHaveBeenCalled();
    });

    it('fails closed for undefined permissions', async () => {
      auth(undefined);

      const res = await cartAddPOST(post('/api/mcp/tools/cart/add'));

      expect(res.status).toBe(403);
      expect(addToCart).not.toHaveBeenCalled();
    });

    it('allows the request for an agent holding write:cart', async () => {
      auth(['write:cart']);

      const res = await cartAddPOST(post('/api/mcp/tools/cart/add'));

      expect(res.status).toBe(200);
      expect(addToCart).toHaveBeenCalled();
    });
  });

  describe('order/place (place:orders route)', () => {
    it('is 403 for an agent with only write:cart, and placeOrder never runs', async () => {
      // A distinct scope guards money — cart access must not imply order placement.
      auth(['write:cart']);

      const res = await orderPlacePOST(post('/api/mcp/tools/order/place'));

      expect(res.status).toBe(403);
      expect(placeOrder).not.toHaveBeenCalled();
    });

    it('fails closed for empty permissions ([])', async () => {
      auth([]);

      const res = await orderPlacePOST(post('/api/mcp/tools/order/place'));

      expect(res.status).toBe(403);
      expect(placeOrder).not.toHaveBeenCalled();
    });

    it('fails closed for undefined permissions', async () => {
      auth(undefined);

      const res = await orderPlacePOST(post('/api/mcp/tools/order/place'));

      expect(res.status).toBe(403);
      expect(placeOrder).not.toHaveBeenCalled();
    });

    it('allows the request for an agent holding place:orders', async () => {
      auth(['place:orders']);

      const res = await orderPlacePOST(post('/api/mcp/tools/order/place'));

      expect(res.status).toBe(200);
      expect(placeOrder).toHaveBeenCalled();
    });
  });
});

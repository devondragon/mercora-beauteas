/**
 * Regression test for BMC-133 (review follow-up) — the shipping and
 * payment/validate MCP tool routes trusted a client-supplied session_id to
 * read cart contents (`body.cart || await getSessionCart(sessionId)`) with no
 * check that the session belonged to the calling agent. An attacker agent
 * could pass a victim's session_id (omitting body.cart) and the shipping
 * route would leak that victim's cart size/value via the computed weight and
 * shipping cost — the same disclosure vector already gated for
 * getCartEstimate/get_cart (BMC-133 / C6). payment/validate has the same
 * anti-pattern (no disclosure today since it doesn't use the cart, but it
 * should be consistent).
 *
 * The fix gates the session read behind requireOwnedSession() at the route
 * level: if body.cart is provided it's used as-is (no session read); if not,
 * the session must exist and belong to the authenticated agent or the route
 * returns 403 before any cart is read.
 *
 * Runs in the jsdom unit env (CI `npm test`). Mocking @/lib/mcp/auth and
 * @/lib/mcp/session keeps their real getDbAsync()/Cloudflare-binding-touching
 * implementations out of the import graph, mirroring
 * tests/unit/app/api/products-auth.test.ts and
 * tests/unit/lib/mcp/cart-order-ownership.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/auth', () => ({
  authenticateAgent: vi.fn(),
}));

vi.mock('@/lib/mcp/session', () => ({
  requireOwnedSession: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { authenticateAgent } from '@/lib/mcp/auth';
import { requireOwnedSession } from '@/lib/mcp/session';
import { POST as shippingPOST } from '@/app/api/mcp/tools/shipping/route';
import { POST as validatePaymentPOST } from '@/app/api/mcp/tools/payment/validate/route';

const DENIED = { ok: false as const, code: 'SESSION_ACCESS_DENIED' as const, message: 'Agent does not own this session' };
const NOT_FOUND = { ok: false as const, code: 'SESSION_NOT_FOUND' as const, message: 'Session not found or expired' };
const OWNED_SESSION = {
  ok: true as const,
  session: {
    sessionId: 'victim-session',
    agentId: 'agent-a',
    userContext: { agentId: 'agent-a' },
    cart: [{ productId: 'p1', variantId: 'v1', quantity: 2, name: 'Morning Blend', price: 25, primaryImageUrl: '' }],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  },
};

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateAgent).mockResolvedValue({ success: true, agentId: 'agent-attacker' });
});

describe('POST /api/mcp/tools/shipping session-ownership gate (BMC-133 review)', () => {
  const url = 'http://localhost/api/mcp/tools/shipping';

  it('rejects an unowned session_id with 403 and never reads its cart', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(DENIED);

    const res = await shippingPOST(jsonRequest(url, {
      address: { line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701' },
      session_id: 'victim-session',
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SESSION_ACCESS_DENIED');
    expect(requireOwnedSession).toHaveBeenCalledWith('victim-session', 'agent-attacker');
  });

  it('rejects a missing/expired session_id with 403 (fails closed, not a default empty cart)', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(NOT_FOUND);

    const res = await shippingPOST(jsonRequest(url, {
      address: { line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701' },
      // no session_id -> defaults to 'temp', which must still fail closed
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('SESSION_NOT_FOUND');
    expect(requireOwnedSession).toHaveBeenCalledWith('temp', 'agent-attacker');
  });

  it('allows the body.cart-provided path without reading the session at all', async () => {
    const res = await shippingPOST(jsonRequest(url, {
      address: { line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701' },
      session_id: 'victim-session',
      cart: [{ productId: 'p1', variantId: 'v1', quantity: 1, name: 'Evening Blend', price: 20 }],
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(requireOwnedSession).not.toHaveBeenCalled();
  });

  it('allows a legitimately-owned session to read its own cart', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(OWNED_SESSION);

    const res = await shippingPOST(jsonRequest(url, {
      address: { line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701' },
      session_id: 'victim-session',
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // total_weight reflects the owned session's cart (2 items * 2lbs), proving
    // the resolved session cart (not an empty fallback) was used.
    expect(body.data.total_weight).toBe(4);
  });
});

describe('POST /api/mcp/tools/payment/validate session-ownership gate (BMC-133 review)', () => {
  const url = 'http://localhost/api/mcp/tools/payment/validate';
  const basePayload = { payment_method: 'agent_processed', total_amount: 50 };

  it('rejects an unowned session_id with 403 and never reads its cart', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(DENIED);

    const res = await validatePaymentPOST(jsonRequest(url, {
      ...basePayload,
      session_id: 'victim-session',
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('SESSION_ACCESS_DENIED');
    expect(requireOwnedSession).toHaveBeenCalledWith('victim-session', 'agent-attacker');
  });

  it('allows the body.cart-provided path without reading the session at all', async () => {
    const res = await validatePaymentPOST(jsonRequest(url, {
      ...basePayload,
      session_id: 'victim-session',
      cart: [],
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(requireOwnedSession).not.toHaveBeenCalled();
  });

  it('allows a legitimately-owned session', async () => {
    vi.mocked(requireOwnedSession).mockResolvedValue(OWNED_SESSION);

    const res = await validatePaymentPOST(jsonRequest(url, {
      ...basePayload,
      session_id: 'victim-session',
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

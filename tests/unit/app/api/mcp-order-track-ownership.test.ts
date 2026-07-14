/**
 * Regression test for BMC-181 — the MCP order/track route must return the REAL
 * order's tracking state scoped to the owning agent, never fabricated data.
 * Previously it returned a hardcoded `VT${Date.now()}` tracking number, an
 * 'Oakland, CA' location, and a fake 3-event history without ever reading the
 * orders table or checking ownership.
 *
 * The route reuses the shared getOwnedOrder() gate, so this test also guards the
 * ownership/IDOR check on the route side (the check is duplicated nowhere — but
 * the route is a distinct entrypoint from get_order_status and must be exercised
 * independently). Missing orders, orders owned by another agent, and non-MCP
 * orders (no agent attribution) must all return an IDENTICAL 404 ORDER_NOT_FOUND.
 *
 * Mocks @/lib/mcp/auth and @/lib/models/mach/orders (+ @/lib/stripe to keep it
 * out of the import graph) so it runs in the jsdom unit env (CI `npm test`)
 * without touching D1/Cloudflare bindings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/auth', () => ({
  authenticateAgent: vi.fn(),
}));

vi.mock('@/lib/models/mach/orders', () => ({
  getOrderById: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { authenticateAgent } from '@/lib/mcp/auth';
import { getOrderById } from '@/lib/models/mach/orders';
import { GET, POST } from '@/app/api/mcp/tools/order/track/route';

const AGENT = 'agent-a';
const CREATED = '2026-07-10T00:00:00.000Z';
const SHIPPED = '2026-07-11T00:00:00.000Z';
const DELIVERED = '2026-07-12T00:00:00.000Z';

function ownedOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'MCP-pi_123',
    status: 'processing',
    total_amount: { amount: 4200, currency: 'USD' },
    currency_code: 'USD',
    tracking_number: undefined,
    shipping_method: 'standard',
    shipping_address: { region: 'CA' },
    extensions: { agent_id: AGENT },
    created_at: CREATED,
    shipped_at: undefined,
    delivered_at: undefined,
    ...overrides,
  };
}

function getReq(orderId?: string) {
  const url = new URL('http://localhost/api/mcp/tools/order/track');
  if (orderId !== undefined) url.searchParams.set('orderId', orderId);
  return new NextRequest(url, { method: 'GET' });
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/mcp/tools/order/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateAgent).mockResolvedValue({ success: true, agentId: AGENT } as any);
});

describe('GET /api/mcp/tools/order/track — real, agent-scoped tracking (BMC-181)', () => {
  it('returns real tracking for the owning agent (no fabricated VT number/location)', async () => {
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ status: 'shipped', tracking_number: '1Z999REAL', shipped_at: SHIPPED }) as any
    );

    const res = await GET(getReq('MCP-pi_123'));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.orderId).toBe('MCP-pi_123');
    expect(body.data.status).toBe('shipped');
    expect(body.data.trackingNumber).toBe('1Z999REAL');
    // No fabricated location.
    expect(body.data.location).toBeUndefined();
  });

  it('builds history only from the order\'s real timestamps', async () => {
    // Still-processing order: only the order_confirmed entry, never a fabricated
    // "shipped"/"in_transit" event.
    vi.mocked(getOrderById).mockResolvedValue(ownedOrder() as any);
    let res = await GET(getReq('MCP-pi_123'));
    let body = await res.json() as any;
    expect(body.data.history).toHaveLength(1);
    expect(body.data.history[0].status).toBe('order_confirmed');

    // Delivered order: all three events, sourced from created/shipped/delivered.
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ status: 'delivered', shipped_at: SHIPPED, delivered_at: DELIVERED }) as any
    );
    res = await GET(getReq('MCP-pi_123'));
    body = await res.json() as any;
    expect(body.data.history.map((h: any) => h.status)).toEqual([
      'order_confirmed',
      'shipped',
      'delivered',
    ]);
    expect(body.data.estimatedDelivery).toBe('Delivered');
  });

  it('returns 404 ORDER_NOT_FOUND for a missing order', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);

    const res = await GET(getReq('nope'));
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('returns an INDISTINGUISHABLE 404 for another agent\'s order (IDOR/enumeration guard)', async () => {
    // Missing order response.
    vi.mocked(getOrderById).mockResolvedValue(null);
    const missing = await GET(getReq('MCP-pi_123'));
    const missingBody = await missing.json();

    // Order owned by a different agent — must be byte-identical to "missing".
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ extensions: { agent_id: 'agent-b' } }) as any
    );
    const notOwned = await GET(getReq('MCP-pi_123'));
    const notOwnedBody = await notOwned.json();

    expect(notOwned.status).toBe(missing.status);
    expect(notOwnedBody).toEqual(missingBody);
  });

  it('returns 404 for a non-MCP order with no agent attribution', async () => {
    vi.mocked(getOrderById).mockResolvedValue(ownedOrder({ extensions: undefined }) as any);

    const res = await GET(getReq('MCP-pi_123'));
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('returns 400 MISSING_ORDER_ID when no orderId is supplied and never reads an order', async () => {
    const res = await GET(getReq());
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('MISSING_ORDER_ID');
    expect(getOrderById).not.toHaveBeenCalled();
  });

  it('returns 401 and never reads an order when auth fails', async () => {
    vi.mocked(authenticateAgent).mockResolvedValue({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'nope' },
    } as any);

    const res = await GET(getReq('MCP-pi_123'));

    expect(res.status).toBe(401);
    expect(getOrderById).not.toHaveBeenCalled();
  });
});

describe('POST /api/mcp/tools/order/track — same gate as GET (BMC-181)', () => {
  it('returns real tracking for the owning agent', async () => {
    vi.mocked(getOrderById).mockResolvedValue(ownedOrder() as any);

    const res = await POST(postReq({ orderId: 'MCP-pi_123' }));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('processing');
    expect(getOrderById).toHaveBeenCalledWith('MCP-pi_123');
  });

  it('returns 404 for another agent\'s order', async () => {
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ extensions: { agent_id: 'agent-b' } }) as any
    );

    const res = await POST(postReq({ orderId: 'MCP-pi_123' }));
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('returns 400 when orderId is missing from the body', async () => {
    const res = await POST(postReq({}));
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('MISSING_ORDER_ID');
  });
});

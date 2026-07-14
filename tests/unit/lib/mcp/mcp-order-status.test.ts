/**
 * Regression test for BMC-181 — MCP get_order_status must return the REAL order
 * state scoped to the owning agent, never fabricated data. Previously it always
 * returned status:'confirmed', total:$299.99, and a fake `BT${Date.now()}`
 * tracking number without ever reading the orders table.
 *
 * The wired behavior:
 *   - reads the order via getOrderById,
 *   - returns it ONLY to the agent that placed it (extensions.agent_id),
 *   - returns an identical ORDER_NOT_FOUND for a missing order AND one owned by
 *     another agent, so an agent can't probe orders it doesn't own (IDOR).
 *
 * Mocks the orders model + Stripe so it runs in the jsdom unit env (CI `npm
 * test`) without touching D1/Cloudflare bindings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/orders', () => ({
  getOrderById: vi.fn(),
  createOrderPaid: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  retrievePaymentIntent: vi.fn(),
}));

import { getOrderById } from '@/lib/models/mach/orders';
import { getOrderStatus } from '@/lib/mcp/tools/order';
import { describeOrderDelivery } from '@/lib/mcp/order-delivery';

const AGENT = 'agent-a';

function ownedOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'MCP-pi_123',
    status: 'processing',
    total_amount: { amount: 4200, currency: 'USD' }, // stored cents → $42.00
    currency_code: 'USD',
    tracking_number: undefined,
    shipping_method: 'standard',
    shipping_address: { region: 'CA' },
    extensions: { agent_id: AGENT },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrderStatus returns real, agent-scoped order state (BMC-181)', () => {
  it('returns the real order status/total for the owning agent — never the mock', async () => {
    vi.mocked(getOrderById).mockResolvedValue(ownedOrder() as any);

    const result = await getOrderStatus('MCP-pi_123', AGENT);

    expect(getOrderById).toHaveBeenCalledWith('MCP-pi_123');
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('processing');
    // Real total: 4200 stored cents → MACH major $42.00, NOT the old hardcoded $299.99.
    expect(result.data.total).toEqual({ amount: 42, currency: 'USD', precision: 2 });
    expect(result.data.orderId).toBe('MCP-pi_123');
    // No fabricated `BT...` tracking number.
    expect(result.data.tracking_number).toBeUndefined();
  });

  it('surfaces a real tracking number when the order has one', async () => {
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ status: 'shipped', tracking_number: '1Z999REAL' }) as any
    );

    const result = await getOrderStatus('MCP-pi_123', AGENT);

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('shipped');
    expect(result.data.tracking_number).toBe('1Z999REAL');
  });

  it('reports "Delivered" (not a forward-looking estimate) for a delivered order', async () => {
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ status: 'delivered', delivered_at: new Date().toISOString() }) as any
    );

    const result = await getOrderStatus('MCP-pi_123', AGENT);

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('delivered');
    expect(result.data.estimated_delivery).toBe('Delivered');
  });

  it('returns ORDER_NOT_FOUND for a missing order (no fabricated confirmation)', async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);

    const result = await getOrderStatus('does-not-exist', AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ORDER_NOT_FOUND');
    expect(result.data.status).not.toBe('confirmed');
  });

  it('returns ORDER_NOT_FOUND when another agent owns the order (IDOR guard)', async () => {
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ extensions: { agent_id: 'agent-b' } }) as any
    );

    const result = await getOrderStatus('MCP-pi_123', AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ORDER_NOT_FOUND');
  });

  it('returns ORDER_NOT_FOUND for a non-MCP order with no agent attribution', async () => {
    vi.mocked(getOrderById).mockResolvedValue(
      ownedOrder({ extensions: undefined }) as any
    );

    const result = await getOrderStatus('MCP-pi_123', AGENT);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('describeOrderDelivery reports terminal statuses, not a forward estimate (BMC-181)', () => {
  it.each([
    ['delivered', 'Delivered'],
    ['cancelled', 'Cancelled'],
    ['refunded', 'Refunded'],
  ])('returns %s → "%s" instead of an in-transit estimate', (status, expected) => {
    expect(describeOrderDelivery({ status, shipping_address: { region: 'CA' }, shipping_method: 'standard' }))
      .toBe(expected);
  });

  it('falls through to the shipping estimate for in-flight statuses (AK surcharge routed via normalizeAddress)', () => {
    expect(describeOrderDelivery({ status: 'processing', shipping_address: { region: 'AK' }, shipping_method: 'standard' }))
      .toBe('5-7 business days');
  });
});

/**
 * BMC-216F regression — MCP get_order_status must keep returning
 * tracking_number after the legacy write path is locked down (agents read
 * tracking through this tool; lib/mcp/tools/order.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/models/mach/orders', () => ({
  createOrderPaid: vi.fn(),
  getOrderByPaymentIntentId: vi.fn(),
}));
vi.mock('@/lib/services/inventory-adjustment', () => ({
  decrementStockForOrder: vi.fn(),
  flagOversoldForReview: vi.fn(),
}));
vi.mock('@/lib/mcp/session', () => ({ requireOwnedSession: vi.fn() }));
vi.mock('@/lib/mcp/context', () => ({ enhanceUserContext: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ retrievePaymentIntent: vi.fn() }));
vi.mock('@/lib/services/order-pricing', () => ({
  verifyOrderChargeSufficient: vi.fn(),
  AMOUNT_TOLERANCE_CENTS: 50,
  MAX_ORDER_LINE_ITEMS: 50,
  canonicalizeOrderItemsDisplay: vi.fn(),
  canonicalizeOrderItemsPricing: vi.fn(),
  computeOrderTotals: vi.fn(),
}));
vi.mock('@/lib/mcp/order-delivery', () => ({
  getOwnedOrder: vi.fn(),
  describeOrderDelivery: vi.fn().mockReturnValue('3-5 business days'),
}));

import { getOrderStatus } from '@/lib/mcp/tools/order';
import { getOwnedOrder } from '@/lib/mcp/order-delivery';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP get_order_status retains tracking fields (BMC-216F)', () => {
  it('returns the stored tracking_number for an owned shipped order', async () => {
    vi.mocked(getOwnedOrder).mockResolvedValue({
      id: 'MCP-pi_1',
      status: 'shipped',
      total_amount: { amount: 2500, currency: 'USD' },
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      tracking_number: '1Z999AA10123456784',
      shipping_address: null,
      shipping_method: 'standard',
    } as any);

    const res = await getOrderStatus('MCP-pi_1', 'agent-1');
    expect(res.success).toBe(true);
    expect(res.data.status).toBe('shipped');
    expect(res.data.tracking_number).toBe('1Z999AA10123456784');
  });

  it('omits tracking_number when none is stored (no fabricated tracking)', async () => {
    vi.mocked(getOwnedOrder).mockResolvedValue({
      id: 'MCP-pi_2',
      status: 'processing',
      total_amount: { amount: 2500, currency: 'USD' },
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      tracking_number: null,
      shipping_address: null,
    } as any);

    const res = await getOrderStatus('MCP-pi_2', 'agent-1');
    expect(res.success).toBe(true);
    expect(res.data.tracking_number).toBeUndefined();
  });
});

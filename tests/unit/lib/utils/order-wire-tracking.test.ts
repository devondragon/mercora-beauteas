/**
 * BMC-216F regression — locking down the WRITE path must not strip tracking
 * fields from the READ path. toWireOrder is the shared projection for
 * GET /api/orders, GET /api/orders/[id], and the PUT response, so pinning it
 * pins every customer-facing order read.
 */
import { describe, it, expect } from 'vitest';
import { toWireOrder } from '@/lib/utils/order-wire';
import { Money } from '@/lib/money';
import type { Order } from '@/lib/types/order';

describe('toWireOrder retains fulfillment fields (BMC-216F)', () => {
  it('passes tracking_number, shipped_at, delivered_at and shipping_method through to the wire', () => {
    const order: Order = {
      id: 'WEB-1',
      status: 'shipped',
      total_amount: Money.fromMinor(2500, 'USD').toJSON(),
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      shipping_method: 'standard',
      tracking_number: '1Z999AA10123456784',
      shipped_at: '2026-07-30T12:00:00.000Z',
      delivered_at: '2026-07-31T12:00:00.000Z',
    } as Order;

    const wire = toWireOrder(order);
    expect(wire.tracking_number).toBe('1Z999AA10123456784');
    expect(wire.shipped_at).toBe('2026-07-30T12:00:00.000Z');
    expect(wire.delivered_at).toBe('2026-07-31T12:00:00.000Z');
    expect(wire.shipping_method).toBe('standard');
  });
});

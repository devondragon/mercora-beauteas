// tests/unit/lib/db/schema/orders-shipping-carrier.test.ts
//
// The Drizzle orders table must expose the column added by
// migrations/0022_add_shipping_carrier.sql, and the Order TS type must carry
// it, or every runtime read of shipping_carrier silently returns undefined.

import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { orders } from '@/lib/db/schema/order';
import type { Order } from '@/lib/types/order';

describe('orders.shipping_carrier', () => {
  it('exists on the Drizzle orders table as a nullable text column', () => {
    const config = getTableConfig(orders);
    const column = config.columns.find((c) => c.name === 'shipping_carrier');
    expect(column).toBeDefined();
    expect(column!.notNull).toBe(false);
  });

  it('keeps the existing fulfillment columns alongside it', () => {
    const names = getTableConfig(orders).columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['status', 'payment_status', 'tracking_number', 'shipped_at', 'delivered_at', 'shipping_carrier']),
    );
  });

  it('is carried on the Order type', () => {
    const order: Order = {
      status: 'shipped',
      total_amount: { amount: 1000, currency: 'USD' },
      currency_code: 'USD',
      items: [],
      payment_status: 'paid',
      shipping_carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    };
    expect(order.shipping_carrier).toBe('ups');
  });
});

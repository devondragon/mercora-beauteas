// tests/unit/lib/db/schema/order-events.test.ts
//
// The Drizzle table must match migrations/0023_add_order_events.sql exactly —
// a mismatched column name only surfaces as a runtime D1 error in production,
// long after CI is green.

import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { orderEvents } from '@/lib/db/schema/order-events';
import { orderEvents as reExported } from '@/lib/db/schema';

describe('order_events schema', () => {
  it('maps to the order_events table', () => {
    expect(getTableConfig(orderEvents).name).toBe('order_events');
  });

  it('declares exactly the migration 0023 columns', () => {
    const names = getTableConfig(orderEvents)
      .columns.map((c) => c.name)
      .sort();
    expect(names).toEqual(
      [
        'actor_id',
        'actor_type',
        'created_at',
        'details',
        'event_type',
        'from_status',
        'id',
        'order_id',
        'to_status',
      ].sort(),
    );
  });

  it('marks order_id, event_type, actor_type, and created_at NOT NULL', () => {
    const columns = getTableConfig(orderEvents).columns;
    const notNull = columns.filter((c) => c.notNull).map((c) => c.name).sort();
    expect(notNull).toEqual(['actor_type', 'created_at', 'event_type', 'id', 'order_id'].sort());
  });

  it('stores details as a JSON-mode column so raw objects are passed, never pre-stringified', () => {
    const details = getTableConfig(orderEvents).columns.find((c) => c.name === 'details');
    expect(details).toBeDefined();
    expect(details!.notNull).toBe(false);
    expect(details!.mapToDriverValue({ carrier: 'ups' })).toBe('{"carrier":"ups"}');
  });

  it('is re-exported from the schema barrel so drizzle(env.DB, { schema }) sees it', () => {
    expect(reExported).toBe(orderEvents);
  });
});

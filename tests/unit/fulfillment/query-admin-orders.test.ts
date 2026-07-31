/**
 * BMC-216D: queryAdminOrders must filter/sort/count in SQL, not in JS.
 * The D1 layer is mocked with a thenable fake builder that records the
 * fragments it was handed — no Cloudflare bindings are touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

import { queryAdminOrders } from '@/lib/fulfillment/queries';
import { getDbAsync } from '@/lib/db';

const dialect = new SQLiteAsyncDialect();
const text = (fragment: SQL) => dialect.sqlToQuery(fragment).sql.replace(/\s+/g, ' ').trim();
const bound = (fragment: SQL) => dialect.sqlToQuery(fragment).params as unknown[];

interface RecordedQuery {
  kind: 'rows' | 'total' | 'counts';
  where?: SQL;
  orderBy?: SQL;
  limit?: number;
  offset?: number;
}

function row(id: string, status: string, payment_status: string, created_at: string) {
  return {
    id,
    customer_id: 'cus_1',
    status,
    payment_status,
    total_amount: { amount: 2500, currency: 'USD' },
    currency_code: 'USD',
    shipping_address: { recipient: 'Ada Lovelace', email: 'ada@example.com' },
    billing_address: null,
    items: [{ product_name: 'Morning Blend', quantity: 1 }],
    shipping_method: 'standard',
    payment_method: 'card',
    shipping_carrier: 'ups',
    tracking_number: '1Z999',
    shipped_at: null,
    delivered_at: null,
    notes: null,
    external_references: null,
    extensions: { email: 'ada@example.com' },
    created_at,
    updated_at: created_at,
  };
}

const ROWS = [
  row('WEB-1', 'processing', 'paid', '2026-07-01T00:00:00.000Z'),
  // Deliberately NOT matching the awaiting view: if this survives, the SQL
  // result is being trusted (correct). If it were dropped, a JS filter crept in.
  row('WEB-2', 'refunded', 'refunded', '2026-07-02T00:00:00.000Z'),
];

let recorded: RecordedQuery[] = [];

function fakeDb(totalValue: number, counts: Record<string, number>) {
  return {
    select(fields?: Record<string, unknown>) {
      const kind: RecordedQuery['kind'] =
        fields === undefined ? 'rows' : 'awaiting' in fields ? 'counts' : 'total';
      const state: RecordedQuery = { kind };
      recorded.push(state);
      const builder: Record<string, unknown> = {
        from: () => builder,
        where: (w: SQL) => { state.where = w; return builder; },
        orderBy: (o: SQL) => { state.orderBy = o; return builder; },
        limit: (n: number) => { state.limit = n; return builder; },
        offset: (n: number) => { state.offset = n; return builder; },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const value =
            kind === 'rows' ? ROWS : kind === 'total' ? [{ value: totalValue }] : [counts];
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

beforeEach(() => {
  recorded = [];
  vi.mocked(getDbAsync).mockResolvedValue(
    fakeDb(2, { awaiting: 3, shipped: 4, cancelled: 5, all: 12 }) as never,
  );
});

const rowsQuery = () => recorded.find((q) => q.kind === 'rows')!;

describe('queryAdminOrders', () => {
  it('applies the view filter in SQL on the same query that paginates', async () => {
    await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 40 });
    const q = rowsQuery();
    expect(text(q.where!)).toContain("status = 'processing'");
    expect(text(q.where!)).toContain("payment_status = 'paid'");
    expect(q.limit).toBe(20);
    expect(q.offset).toBe(40);
  });

  it('returns the SQL result verbatim — no JS re-filtering of the page', async () => {
    const result = await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 0 });
    expect(result.orders.map((o) => o.id)).toEqual(['WEB-1', 'WEB-2']);
  });

  it('orders the awaiting queue oldest-first', async () => {
    await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 0 });
    expect(text(rowsQuery().orderBy!)).toBe('created_at ASC, id ASC');
  });

  it('orders every other view newest-first', async () => {
    await queryAdminOrders({ view: 'shipped', limit: 20, offset: 0 });
    expect(text(rowsQuery().orderBy!)).toBe('created_at DESC, id DESC');
  });

  it('pushes the search term into the SQL predicate, not into JS', async () => {
    await queryAdminOrders({ view: 'all', q: 'Ada', limit: 20, offset: 0 });
    const where = rowsQuery().where!;
    expect(text(where)).toContain("json_extract(shipping_address, '$.recipient')");
    expect(bound(where)).toEqual(Array(5).fill('%ada%'));
  });

  it('caps limit at 100 and floors offset at 0', async () => {
    await queryAdminOrders({ view: 'all', limit: 5000, offset: -10 });
    expect(rowsQuery().limit).toBe(100);
    expect(rowsQuery().offset).toBe(0);
  });

  it('returns the per-view counts and the filtered total', async () => {
    const result = await queryAdminOrders({ view: 'awaiting', limit: 20, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.counts).toEqual({ awaiting: 3, shipped: 4, cancelled: 5, all: 12 });
  });

  it('scopes the counts query by the search term but not by the active view', async () => {
    await queryAdminOrders({ view: 'awaiting', q: 'ada', limit: 20, offset: 0 });
    const countsQuery = recorded.find((q) => q.kind === 'counts')!;
    expect(text(countsQuery.where!)).toContain("json_extract(extensions, '$.email')");
    expect(text(countsQuery.where!)).not.toContain("status = 'processing' AND payment_status = 'paid' AND");
  });

  it('hydrates JSON columns and the persisted total', async () => {
    const [order] = (await queryAdminOrders({ view: 'all', limit: 20, offset: 0 })).orders;
    expect(order.shipping_address?.recipient).toBe('Ada Lovelace');
    expect(order.items).toHaveLength(1);
    expect(order.shipping_carrier).toBe('ups');
    expect(order.total_amount.amount).toBe(2500);
  });
});

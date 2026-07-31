/**
 * BMC-216D: the admin queue's SQL predicates. These are compiled with
 * Drizzle's own SQLite dialect so the assertions are on the real emitted SQL
 * + bound params — no D1, no Cloudflare bindings.
 */
import { describe, it, expect } from 'vitest';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
  ADMIN_ORDER_VIEWS,
  isAdminOrderView,
  normalizeSearchTerm,
  viewPredicate,
  searchPredicate,
  whereForView,
  orderByForView,
  MAX_ADMIN_SEARCH_LENGTH,
} from '@/lib/fulfillment/queries';

const dialect = new SQLiteAsyncDialect();

function compile(fragment: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment);
  return { sql: query.sql.replace(/\s+/g, ' ').trim(), params: query.params as unknown[] };
}

describe('admin order view predicates', () => {
  it('lists exactly the four contracted views', () => {
    expect([...ADMIN_ORDER_VIEWS]).toEqual(['awaiting', 'shipped', 'cancelled', 'all']);
    expect(isAdminOrderView('awaiting')).toBe(true);
    expect(isAdminOrderView('bogus')).toBe(false);
    expect(isAdminOrderView(undefined)).toBe(false);
  });

  it('awaiting excludes unpaid drafts — paid AND processing only', () => {
    const { sql } = compile(viewPredicate('awaiting'));
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain("payment_status = 'paid'");
  });

  it('shipped covers shipped + delivered, cancelled covers cancelled + refunded', () => {
    expect(compile(viewPredicate('shipped')).sql).toContain("status IN ('shipped', 'delivered')");
    expect(compile(viewPredicate('cancelled')).sql).toContain("status IN ('cancelled', 'refunded')");
  });

  it('all excludes unpaid pending drafts and is NULL-safe on payment_status', () => {
    const { sql } = compile(viewPredicate('all'));
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('COALESCE(payment_status');
    expect(sql.startsWith('NOT (')).toBe(true);
  });
});

describe('search term normalization', () => {
  it('lowercases, trims and strips LIKE wildcards', () => {
    expect(normalizeSearchTerm('  Ac%me_Co\\ ')).toBe('acmeco');
  });

  it('bounds length so the %term% pattern stays under D1’s 50-char LIKE cap', () => {
    const long = 'a'.repeat(200);
    expect(normalizeSearchTerm(long)).toHaveLength(MAX_ADMIN_SEARCH_LENGTH);
    expect(MAX_ADMIN_SEARCH_LENGTH + 2).toBeLessThanOrEqual(50);
  });

  it('returns null for empty / non-string input', () => {
    expect(normalizeSearchTerm('   ')).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
    expect(normalizeSearchTerm(7)).toBeNull();
  });
});

describe('search predicate', () => {
  it('matches order id, both email keys and the recipient-name keys', () => {
    const { sql, params } = compile(searchPredicate('acme'));
    expect(sql).toContain('lower(id) LIKE');
    expect(sql).toContain("json_extract(shipping_address, '$.email')");
    expect(sql).toContain("json_extract(extensions, '$.email')");
    expect(sql).toContain("json_extract(shipping_address, '$.recipient')");
    expect(sql).toContain("json_extract(shipping_address, '$.company')");
    expect(params).toEqual(Array(5).fill('%acme%'));
  });
});

describe('whereForView', () => {
  it('ANDs the search predicate onto the view predicate', () => {
    const { sql, params } = compile(whereForView('shipped', 'acme'));
    expect(sql).toContain("status IN ('shipped', 'delivered')");
    expect(sql).toContain(') AND (');
    expect(params).toEqual(Array(5).fill('%acme%'));
  });

  it('emits the bare view predicate when there is no search term', () => {
    const { sql, params } = compile(whereForView('awaiting', null));
    expect(sql).toContain("status = 'processing'");
    expect(params).toEqual([]);
  });
});

describe('orderByForView', () => {
  it('sorts awaiting oldest-first with a stable id tiebreak', () => {
    expect(compile(orderByForView('awaiting')).sql).toBe('created_at ASC, id ASC');
  });

  it('sorts every other view newest-first with a stable id tiebreak', () => {
    for (const view of ['shipped', 'cancelled', 'all'] as const) {
      expect(compile(orderByForView(view)).sql).toBe('created_at DESC, id DESC');
    }
  });
});

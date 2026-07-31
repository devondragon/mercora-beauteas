/**
 * BMC-216D: GET /api/admin/orders — admin auth + param validation.
 * Auth and the query layer are mocked; no D1 or Clerk is reached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({ checkAdminPermissions: vi.fn() }));
vi.mock('@/lib/fulfillment/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fulfillment/queries')>(
    '@/lib/fulfillment/queries',
  );
  return { ...actual, queryAdminOrders: vi.fn() };
});

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/orders/route';
import { checkAdminPermissions } from '@/lib/auth/admin-middleware';
import { queryAdminOrders } from '@/lib/fulfillment/queries';

const ORDER = {
  id: 'WEB-1',
  status: 'processing' as const,
  total_amount: { amount: 2500, currency: 'USD' },
  currency_code: 'USD',
  items: [],
  payment_status: 'paid',
  created_at: '2026-07-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAdminPermissions).mockResolvedValue({ success: true, userId: 'user_admin' });
  vi.mocked(queryAdminOrders).mockResolvedValue({
    orders: [ORDER] as never,
    total: 1,
    counts: { awaiting: 1, shipped: 2, cancelled: 3, all: 6 },
  });
});

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/orders${qs ? `?${qs}` : ''}`);

describe('GET /api/admin/orders', () => {
  it('rejects a non-admin without touching the query layer', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({ success: false, error: 'nope' });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(queryAdminOrders).not.toHaveBeenCalled();
  });

  it('defaults to the awaiting view, limit 20, offset 0', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0]).toMatchObject({
      view: 'awaiting',
      limit: 20,
      offset: 0,
    });
  });

  it('caps limit at 100', async () => {
    await GET(req('limit=5000'));
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0].limit).toBe(100);
  });

  it('falls back to the default limit for junk input', async () => {
    await GET(req('limit=abc&offset=abc'));
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0]).toMatchObject({ limit: 20, offset: 0 });
  });

  it('400s on an unknown view rather than silently defaulting', async () => {
    const res = await GET(req('view=everything'));
    expect(res.status).toBe(400);
    expect(queryAdminOrders).not.toHaveBeenCalled();
  });

  it('passes the raw search term through and returns orders + total + counts', async () => {
    const res = await GET(req('view=shipped&q=ada'));
    expect(vi.mocked(queryAdminOrders).mock.calls[0][0]).toMatchObject({ view: 'shipped', q: 'ada' });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.total).toBe(1);
    expect(body.counts).toEqual({ awaiting: 1, shipped: 2, cancelled: 3, all: 6 });
    expect(Array.isArray(body.orders)).toBe(true);
  });

  it('500s (not throws) when the query layer fails', async () => {
    vi.mocked(queryAdminOrders).mockRejectedValue(new Error('d1 down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});

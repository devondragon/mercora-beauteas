/**
 * Regression test for BMC-138 / H1 — IDOR: anonymous read of any order's PII
 * via GET /api/orders/[id].
 *
 * Order IDs are guessable/enumerable (`WEB-<user>-<timestamp_ms>` /
 * `WEB-GUEST-<timestamp_ms>`), so the detail endpoint must never hand the full
 * order — shipping/billing address, items, totals, payment_status, tracking —
 * to an unauthenticated or non-owner caller.
 *
 * Before the fix the guard was
 *   `if (order.customer_id && userId && order.customer_id !== userId) return 403`
 * which only blocked an *authenticated* *different* user. An anonymous request
 * (`userId === null`) short-circuited the check and received the whole order.
 *
 * The fix requires an authenticated owner (`userId === order.customer_id`) OR an
 * admin (Clerk admin session / ORDERS_READ API token via authenticateRequest).
 * Everyone else — anonymous, cross-user non-admin, and strangers hitting guest
 * orders — gets a 404 (not 403) so the guessable id can't be used as an
 * existence oracle.
 *
 * Runs in the jsdom unit env (CI `npm test`). @clerk/nextjs/server,
 * @/lib/auth/unified-auth and @/lib/db are mocked so this stays a pure unit
 * test with no Cloudflare Workers runtime dependency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateRequest: vi.fn(),
  PERMISSIONS: { ORDERS_READ: ['orders:read'] },
}));

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/orders/[id]/route';
import { auth } from '@clerk/nextjs/server';
import { authenticateRequest } from '@/lib/auth/unified-auth';
import { getDbAsync } from '@/lib/db';

const ORDER_ID = 'WEB-GUEST-1751330000000';

const orderRow = {
  id: ORDER_ID,
  customer_id: 'user_owner',
  status: 'processing',
  total_amount: { amount: 4200, currency: 'USD' },
  currency_code: 'USD',
  shipping_address: { line1: '1 Secret St', city: 'Portland', region: 'OR', postal_code: '97201', country: 'US' },
  billing_address: null,
  items: [{ product_id: 'p1', product_name: 'Morning Blend', quantity: 1 }],
  shipping_method: 'standard',
  payment_method: 'stripe',
  payment_status: 'paid',
  tracking_number: '1Z-SECRET',
  shipped_at: null,
  delivered_at: null,
  notes: null,
  external_references: null,
  extensions: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

// GET does `await db.select().from(orders).where(eq(...))`, so `where()` must
// resolve to the rows array (no `.limit()` on this route).
function mockDb(rows: any[]) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(getDbAsync).mockResolvedValue({
    select: vi.fn().mockReturnValue(selectChain),
  } as any);
}

function getRequest() {
  return new NextRequest(`http://localhost/api/orders/${ORDER_ID}`, { method: 'GET' });
}

function callGET() {
  return GET(getRequest(), { params: Promise.resolve({ id: ORDER_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/orders/[id] IDOR guard (BMC-138 / H1)', () => {
  it('rejects an anonymous request with 404 and leaks no order data', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as any);
    vi.mocked(authenticateRequest).mockResolvedValue({
      success: false,
      response: undefined,
    } as any);
    mockDb([orderRow]);

    const res = await callGET();

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body).not.toHaveProperty('data');
    expect(JSON.stringify(body)).not.toContain('Secret');
  });

  it('rejects an authenticated non-owner, non-admin with 404 (no existence oracle)', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_other' } as any);
    vi.mocked(authenticateRequest).mockResolvedValue({ success: false } as any);
    mockDb([orderRow]);

    const res = await callGET();

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body).not.toHaveProperty('data');
  });

  it('returns the order to its authenticated owner', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_owner' } as any);
    // Owner is authorized before any admin check is attempted.
    vi.mocked(authenticateRequest).mockResolvedValue({ success: false } as any);
    mockDb([orderRow]);

    const res = await callGET();

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe(ORDER_ID);
    // The owner short-circuit means the admin verifier is never consulted.
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it('returns the order to an admin (ORDERS_READ) who is not the owner', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'admin_user' } as any);
    vi.mocked(authenticateRequest).mockResolvedValue({
      success: true,
      tokenInfo: { id: 0, tokenName: 'admin-service', permissions: ['admin:*'], lastUsedAt: null },
    } as any);
    mockDb([orderRow]);

    const res = await callGET();

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe(ORDER_ID);
  });

  it('returns 404 for a missing order without consulting authorization', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_owner' } as any);
    mockDb([]);

    const res = await callGET();

    expect(res.status).toBe(404);
  });
});

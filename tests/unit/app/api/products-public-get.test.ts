/**
 * Regression test for BMC-149 / M6 — public GET /api/products status +
 * field-projection leak.
 *
 * Before the fix, a client-supplied `?status=` value was passed straight
 * into listProducts() (leaking draft/inactive/archived products to anyone),
 * and the full product/variant rows — including internal-only fields like
 * cost, barcode, and inventory — were returned to unauthenticated callers.
 *
 * This guards that:
 *  - non-admin callers always get status:['active'] regardless of the
 *    `?status=` query param, and
 *  - non-admin responses never contain cost/barcode/inventory.
 *
 * Runs in the jsdom unit env (CI `npm test`), following the same mocking
 * strategy as products-auth.test.ts: mock admin-middleware and the products
 * model so the real @clerk/nextjs/server and lib/db.ts/Cloudflare-binding
 * imports never enter the graph.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: vi.fn(),
}));

vi.mock('@/lib/models/mach/products', () => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  getProductsByCategory: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/products/route';
import { checkAdminPermissions } from '@/lib/auth/admin-middleware';
import { listProducts } from '@/lib/models/mach/products';

const fakeProductWithInternalFields = {
  id: 'prod_1',
  name: 'Clearly Calendula — Morning Blend',
  status: 'draft',
  variants: [
    {
      id: 'var_1',
      sku: 'SKU-1',
      option_values: [],
      price: { amount: 2500, currency: 'USD' },
      status: 'active',
      position: 0,
      cost: { amount: 900, currency: 'USD' },
      barcode: '012345678905',
      inventory: { track_inventory: true, quantity: 42 },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/products public access (BMC-149 / M6)', () => {
  it('forces status to ["active"] for non-admin callers, ignoring ?status=draft', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
    vi.mocked(listProducts).mockResolvedValue([]);

    const res = await GET(new NextRequest('http://localhost/api/products?status=draft'));
    expect(res.status).toBe(200);

    for (const call of vi.mocked(listProducts).mock.calls) {
      expect(call[0]?.status).toEqual(['active']);
    }
    expect(vi.mocked(listProducts)).toHaveBeenCalled();
  });

  it('strips cost/barcode/inventory from the response for non-admin callers', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
    vi.mocked(listProducts).mockResolvedValue([fakeProductWithInternalFields as any]);

    const res = await GET(new NextRequest('http://localhost/api/products?status=draft'));
    const body = await res.json() as any;
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('"cost"');
    expect(serialized).not.toContain('"barcode"');
    expect(serialized).not.toContain('"inventory"');
    // Public fields should still be present.
    expect(body.data[0].id).toBe('prod_1');
    expect(body.data[0].variants[0].sku).toBe('SKU-1');
  });

  it('allows admins to request an arbitrary status and returns full fields', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({ success: true, userId: 'admin-1' });
    vi.mocked(listProducts).mockResolvedValue([fakeProductWithInternalFields as any]);

    const res = await GET(new NextRequest('http://localhost/api/products?status=draft'));
    const body = await res.json() as any;

    for (const call of vi.mocked(listProducts).mock.calls) {
      expect(call[0]?.status).toEqual(['draft']);
    }
    expect(body.data[0].variants[0]).toHaveProperty('cost');
    expect(body.data[0].variants[0]).toHaveProperty('barcode');
    expect(body.data[0].variants[0]).toHaveProperty('inventory');
  });

  it('defaults non-admin callers to active-only when no status is supplied', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
    vi.mocked(listProducts).mockResolvedValue([]);

    await GET(new NextRequest('http://localhost/api/products'));

    for (const call of vi.mocked(listProducts).mock.calls) {
      expect(call[0]?.status).toEqual(['active']);
    }
  });
});

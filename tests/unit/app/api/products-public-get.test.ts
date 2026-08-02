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
import { listProducts, getProductsByCategory } from '@/lib/models/mach/products';

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

const fakeDraftCategoryProduct = {
  id: 'prod_draft',
  name: 'Clearly Calendula — Afternoon Blend (draft)',
  status: 'draft',
  categories: ['cat_tea'],
  variants: [
    {
      id: 'var_draft',
      sku: 'SKU-DRAFT',
      option_values: [],
      price: { amount: 2500, currency: 'USD' },
      status: 'draft',
      position: 0,
      cost: { amount: 900, currency: 'USD' },
      barcode: '012345678905',
      inventory: { track_inventory: true, quantity: 42 },
    },
  ],
};

const fakeActiveCategoryProduct = {
  id: 'prod_active',
  name: 'Clearly Calendula — Evening Blend',
  status: 'active',
  categories: ['cat_tea'],
  variants: [
    {
      id: 'var_active',
      sku: 'SKU-ACTIVE',
      option_values: [],
      price: { amount: 2500, currency: 'USD' },
      status: 'active',
      position: 0,
      cost: { amount: 700, currency: 'USD' },
      barcode: '012345678912',
      inventory: { track_inventory: true, quantity: 10 },
    },
  ],
};

const fakeGiftCardProduct = {
  ...fakeActiveCategoryProduct,
  id: 'gift-card',
  slug: 'gift-card',
  type: 'gift-card',
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
    expect(res.status).toBe(200);
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

  it('excludes launch-disabled gift cards before public pagination and totals', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
    vi.mocked(listProducts).mockResolvedValue([
      fakeGiftCardProduct as any,
      fakeActiveCategoryProduct as any,
    ]);

    const res = await GET(new NextRequest('http://localhost/api/products'));
    const body = await res.json() as any;
    expect(body.data.map((p: any) => p.id)).toEqual(['prod_active']);
    expect(body.meta.total).toBe(1);
  });
});

describe('GET /api/products?category= public access (BMC-149 / M6 review gap)', () => {
  it('filters out draft products and strips cost/barcode/inventory for non-admin callers on the category branch', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
    vi.mocked(getProductsByCategory).mockResolvedValue([
      fakeDraftCategoryProduct as any,
      fakeActiveCategoryProduct as any,
    ]);

    const res = await GET(
      new NextRequest('http://localhost/api/products?category=cat_tea&status=draft')
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // getProductsByCategory itself isn't status-aware — the route's
    // filterByStatus() post-filter must strip the draft product out.
    expect(vi.mocked(getProductsByCategory)).toHaveBeenCalledWith('cat_tea');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('prod_active');
    expect(body.meta.total).toBe(1);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('"cost"');
    expect(serialized).not.toContain('"barcode"');
    expect(serialized).not.toContain('"inventory"');
    // Public fields should still be present.
    expect(body.data[0].variants[0].sku).toBe('SKU-ACTIVE');
  });

  it('lets admins see all statuses and full fields on the category branch', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({ success: true, userId: 'admin-1' });
    vi.mocked(getProductsByCategory).mockResolvedValue([
      fakeDraftCategoryProduct as any,
      fakeActiveCategoryProduct as any,
    ]);

    const res = await GET(
      new NextRequest('http://localhost/api/products?category=cat_tea&status=draft')
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Admins pass an explicit status filter through, so only the
    // requested status (draft) survives the category branch's filter.
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('prod_draft');
    expect(body.data[0].variants[0]).toHaveProperty('cost');
    expect(body.data[0].variants[0]).toHaveProperty('barcode');
    expect(body.data[0].variants[0]).toHaveProperty('inventory');
  });
});

describe('GET /api/products pagination + input validation', () => {
  const makeActiveProduct = (id: string) => ({
    id,
    name: `Product ${id}`,
    status: 'active',
    categories: ['cat_tea'],
    variants: [
      {
        id: `${id}_var`,
        sku: `SKU-${id}`,
        option_values: [],
        price: { amount: 2500, currency: 'USD' },
        status: 'active',
        position: 0,
        cost: { amount: 700, currency: 'USD' },
        barcode: '012345678912',
        inventory: { track_inventory: true, quantity: 10 },
      },
    ],
  });

  it('respects limit/offset on the ?category= branch while reporting the full filtered total', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
    vi.mocked(getProductsByCategory).mockResolvedValue([
      makeActiveProduct('a') as any,
      makeActiveProduct('b') as any,
      makeActiveProduct('c') as any,
    ]);

    const res = await GET(
      new NextRequest('http://localhost/api/products?category=cat_tea&limit=1&offset=1')
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Fetched once, sliced for the page; total reflects the full filtered list.
    expect(vi.mocked(getProductsByCategory)).toHaveBeenCalledTimes(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('b');
    expect(body.meta.total).toBe(3);
    expect(body.meta.limit).toBe(1);
    expect(body.meta.offset).toBe(1);
    // Consistent next/prev links derived from the same total.
    expect(body.links.next).toContain('offset=2');
    expect(body.links.prev).toContain('offset=0');
  });

  it('clamps non-finite limit and negative offset instead of producing NaN/negative pagination', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
    vi.mocked(listProducts).mockResolvedValue([]);

    const res = await GET(
      new NextRequest('http://localhost/api/products?limit=foo&offset=-5')
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // limit defaults to 20 (finite), offset floors at 0.
    expect(body.meta.limit).toBe(20);
    expect(body.meta.offset).toBe(0);
    for (const call of vi.mocked(listProducts).mock.calls) {
      if (call[0] && 'limit' in call[0]) {
        expect(call[0].limit).toBe(20);
      }
      if (call[0] && 'offset' in call[0]) {
        expect(call[0].offset).toBe(0);
      }
    }
  });

  it('returns 400 when an admin supplies an invalid ?status= value', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({ success: true, userId: 'admin-1' });

    const res = await GET(
      new NextRequest('http://localhost/api/products?status=garbage')
    );
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Validation failed');
    // No DB query should have run for an invalid status.
    expect(vi.mocked(listProducts)).not.toHaveBeenCalled();
  });
});

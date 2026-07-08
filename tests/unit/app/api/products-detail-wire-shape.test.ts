/**
 * Regression test for BMC-164 code-review Finding 1 — cross-endpoint
 * inconsistency between GET /api/products (list) and GET/PUT
 * /api/products/[id] (detail).
 *
 * Before this fix, the list endpoint ran every product through
 * toWireProduct() (MACH wire money shape: decimal major units + precision),
 * while the detail GET/PUT routes returned the raw cents-shaped product
 * straight from the model layer — same underlying data, two different wire
 * shapes depending on which endpoint you hit.
 *
 * This guards that GET and PUT /api/products/[id] both emit the same
 * {amount, currency, precision} MACH money shape as the list endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/models/mach/products', () => ({
  getProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/products/[id]/route';
import { getProduct, updateProduct } from '@/lib/models/mach/products';

const params = { params: Promise.resolve({ id: 'prod_1' }) };

const fakeCentsProduct = {
  id: 'prod_1',
  name: 'Clearly Calendula — Morning Blend',
  status: 'active',
  variants: [
    {
      id: 'var_1',
      sku: 'SKU-1',
      option_values: [],
      price: { amount: 2999, currency: 'USD' },
      compare_at_price: { amount: 3499, currency: 'USD' },
      status: 'active',
      position: 0,
      cost: { amount: 900, currency: 'USD' },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/products/[id] emits MACH wire-shaped money (BMC-164 review Finding 1)', () => {
  it('converts variant price/compare_at_price/cost to {amount, currency, precision}', async () => {
    vi.mocked(getProduct).mockResolvedValue(fakeCentsProduct as any);

    const res = await GET(new NextRequest('http://localhost/api/products/prod_1'), params);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    const [variant] = body.data.variants;
    expect(variant.price).toEqual({ amount: 29.99, currency: 'USD', precision: 2 });
    expect(variant.compare_at_price).toEqual({ amount: 34.99, currency: 'USD', precision: 2 });
    expect(variant.cost).toEqual({ amount: 9, currency: 'USD', precision: 2 });
  });
});

describe('PUT /api/products/[id] emits MACH wire-shaped money (BMC-164 review Finding 1)', () => {
  it('converts the updated product variant money fields to MACH wire shape', async () => {
    vi.mocked(updateProduct).mockResolvedValue(fakeCentsProduct as any);

    const res = await PUT(
      new NextRequest('http://localhost/api/products/prod_1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Clearly Calendula — Morning Blend' }),
      }),
      params
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    const [variant] = body.data.variants;
    expect(variant.price).toEqual({ amount: 29.99, currency: 'USD', precision: 2 });
    // Raw cents shape must not leak through.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('"amount":2999');
  });
});

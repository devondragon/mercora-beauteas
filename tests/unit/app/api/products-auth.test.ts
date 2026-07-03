/**
 * Regression test for BMC-128 / C1 — unauthenticated product CRUD.
 *
 * Guards that the mutating verbs on the public /api/products routes stay behind
 * the admin gate: when checkAdminPermissions() denies, the handler must return
 * 401 and must NOT reach the model layer (no create/update/delete).
 *
 * Runs in the jsdom unit env (CI `npm test`). This is safe — the auth guard is
 * the first statement in each handler and short-circuits before any getDb()/
 * Cloudflare-binding call. Mocking the admin-middleware module also keeps the
 * real @clerk/nextjs/server import out of the graph; mocking the products model
 * keeps lib/db.ts / @opennextjs/cloudflare out of it entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: vi.fn().mockResolvedValue({
    success: false,
    error: 'Authentication required. Please sign in.',
  }),
}));

vi.mock('@/lib/models/mach/products', () => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  getProductsByCategory: vi.fn(),
  getProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/products/route';
import { PUT, DELETE } from '@/app/api/products/[id]/route';
import { createProduct, updateProduct, deleteProduct } from '@/lib/models/mach/products';
import { checkAdminPermissions } from '@/lib/auth/admin-middleware';

const url = 'http://localhost/api/products';
const params = { params: Promise.resolve({ id: 'p1' }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/products admin auth gate (BMC-128 / C1)', () => {
  it('POST returns 401 when not admin and never creates a product', async () => {
    const res = await POST(new NextRequest(url, { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(vi.mocked(createProduct)).not.toHaveBeenCalled();
  });

  it('PUT returns 401 when not admin and never updates a product', async () => {
    const res = await PUT(new NextRequest(url, { method: 'PUT' }), params);
    expect(res.status).toBe(401);
    expect(vi.mocked(updateProduct)).not.toHaveBeenCalled();
  });

  it('DELETE returns 401 when not admin and never deletes a product', async () => {
    const res = await DELETE(new NextRequest(url, { method: 'DELETE' }), params);
    expect(res.status).toBe(401);
    expect(vi.mocked(deleteProduct)).not.toHaveBeenCalled();
  });
});

describe('/api/products admin auth gate — success path reaches the model', () => {
  it('POST creates a product when admin', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValueOnce({ success: true } as any);
    await POST(
      new NextRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Morning Blend' }),
      })
    );
    expect(vi.mocked(createProduct)).toHaveBeenCalled();
  });

  it('PUT updates a product when admin', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValueOnce({ success: true } as any);
    await PUT(
      new NextRequest(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Morning Blend' }),
      }),
      params
    );
    expect(vi.mocked(updateProduct)).toHaveBeenCalled();
  });

  it('DELETE deletes a product when admin', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValueOnce({ success: true } as any);
    await DELETE(new NextRequest(url, { method: 'DELETE' }), params);
    expect(vi.mocked(deleteProduct)).toHaveBeenCalled();
  });
});

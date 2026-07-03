/**
 * Regression test for BMC-129 / C2 — unauthenticated category CRUD.
 *
 * Guards that the mutating verbs on the public /api/categories routes stay behind
 * the admin gate: when checkAdminPermissions() denies, the handler must return
 * 401 and must NOT reach the model layer (no create/update/delete).
 *
 * Runs in the jsdom unit env (CI `npm test`). This is safe — the auth guard is
 * the first statement in each handler and short-circuits before any getDb()/
 * Cloudflare-binding call. Mocking the admin-middleware module also keeps the
 * real @clerk/nextjs/server import out of the graph; mocking the categories
 * model keeps lib/db.ts / @opennextjs/cloudflare out of it entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: vi.fn().mockResolvedValue({
    success: false,
    error: 'Authentication required. Please sign in.',
  }),
}));

vi.mock('@/lib/models', () => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  listCategoriesWithRealTimeCounts: vi.fn(),
}));

vi.mock('@/lib/models/mach/category', () => ({
  getCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/categories/route';
import { GET as GET_BY_ID, PUT, DELETE } from '@/app/api/categories/[id]/route';
import { createCategory, listCategoriesWithRealTimeCounts } from '@/lib/models';
import { updateCategory, deleteCategory } from '@/lib/models/mach/category';

const url = 'http://localhost/api/categories';
const params = { params: Promise.resolve({ id: 'c1' }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/categories admin auth gate (BMC-129 / C2)', () => {
  it('POST returns 401 when not admin and never creates a category', async () => {
    const res = await POST(new NextRequest(url, { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(vi.mocked(createCategory)).not.toHaveBeenCalled();
  });

  it('PUT returns 401 when not admin and never updates a category', async () => {
    const res = await PUT(new NextRequest(url, { method: 'PUT' }), params);
    expect(res.status).toBe(401);
    expect(vi.mocked(updateCategory)).not.toHaveBeenCalled();
  });

  it('DELETE returns 401 when not admin and never deletes a category', async () => {
    const res = await DELETE(new NextRequest(url, { method: 'DELETE' }), params);
    expect(res.status).toBe(401);
    expect(vi.mocked(deleteCategory)).not.toHaveBeenCalled();
  });
});

describe('/api/categories GET stays public even when admin check denies', () => {
  it('GET /api/categories is not gated (non-401)', async () => {
    vi.mocked(listCategoriesWithRealTimeCounts).mockResolvedValue([]);
    const res = await GET(new NextRequest(url, { method: 'GET' }));
    expect(res.status).not.toBe(401);
  });

  it('GET /api/categories/[id] is not gated (non-401)', async () => {
    const res = await GET_BY_ID(new NextRequest(`${url}/c1`, { method: 'GET' }), params);
    expect(res.status).not.toBe(401);
  });
});

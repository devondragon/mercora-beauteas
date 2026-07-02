/**
 * Regression test for BMC-130 / C3 — unauthenticated promotion CRUD.
 *
 * Guards that all verbs on /api/promotions stay behind the admin gate: when
 * checkAdminPermissions() denies, each handler must return 401 and must NOT
 * reach the model/DB layer (no list/create/update/delete).
 *
 * GET is included because the finding also covers unauthenticated enumeration
 * of all promotions (including inactive ones) and their raw codes — no public
 * storefront caller depends on GET /api/promotions (discount code validation
 * goes through the separate /api/validate-discount route, which calls the
 * model layer directly), so GET was gated admin-only alongside POST/PUT/DELETE.
 *
 * Runs in the jsdom unit env (CI `npm test`). This is safe — the auth guard is
 * the first statement in each handler and short-circuits before any getDbAsync()/
 * Cloudflare-binding call. Mocking the admin-middleware module also keeps the
 * real @clerk/nextjs/server import out of the graph; mocking the model modules
 * keeps lib/db.ts / @opennextjs/cloudflare calls from ever being exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: vi.fn().mockResolvedValue({
    success: false,
    error: 'Authentication required. Please sign in.',
  }),
}));

vi.mock('@/lib/models', () => ({
  listPromotions: vi.fn(),
  listCouponInstances: vi.fn(),
}));

vi.mock('@/lib/models/mach/couponInstance', () => ({
  createCouponInstance: vi.fn(),
  hardDeleteCouponInstance: vi.fn(),
  updateCouponInstance: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET, POST, PUT, DELETE } from '@/app/api/promotions/route';
import { listPromotions, listCouponInstances } from '@/lib/models';
import { createCouponInstance, updateCouponInstance, hardDeleteCouponInstance } from '@/lib/models/mach/couponInstance';
import { getDbAsync } from '@/lib/db';

const url = 'http://localhost/api/promotions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/promotions admin auth gate (BMC-130 / C3)', () => {
  it('GET returns 401 when not admin and never lists promotions', async () => {
    const res = await GET(new NextRequest(url, { method: 'GET' }));
    expect(res.status).toBe(401);
    expect(vi.mocked(listPromotions)).not.toHaveBeenCalled();
    expect(vi.mocked(listCouponInstances)).not.toHaveBeenCalled();
  });

  it('POST returns 401 when not admin and never creates a promotion', async () => {
    const res = await POST(new NextRequest(url, { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(vi.mocked(getDbAsync)).not.toHaveBeenCalled();
    expect(vi.mocked(createCouponInstance)).not.toHaveBeenCalled();
  });

  it('PUT returns 401 when not admin and never updates a promotion', async () => {
    const res = await PUT(new NextRequest(url, { method: 'PUT' }));
    expect(res.status).toBe(401);
    expect(vi.mocked(getDbAsync)).not.toHaveBeenCalled();
    expect(vi.mocked(updateCouponInstance)).not.toHaveBeenCalled();
  });

  it('DELETE returns 401 when not admin and never deletes a promotion', async () => {
    const res = await DELETE(new NextRequest(`${url}?id=promo_1`, { method: 'DELETE' }));
    expect(res.status).toBe(401);
    expect(vi.mocked(getDbAsync)).not.toHaveBeenCalled();
    expect(vi.mocked(hardDeleteCouponInstance)).not.toHaveBeenCalled();
  });
});

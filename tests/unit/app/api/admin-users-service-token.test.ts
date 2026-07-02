/**
 * Regression test for BMC-145 / M2 — service token could self-promote to
 * a persistent admin.
 *
 * checkAdminPermissions() treats the ADMIN_VECTORIZE_TOKEN service credential
 * as authenticated (isServiceToken: true), which is fine for server-to-server
 * endpoints like vectorize. But POST /api/admin/users mutates the admin_users
 * table, and that mutation must require a DB-verified, interactive Clerk
 * admin session — not the service token. Otherwise anyone holding the one
 * shared service token could insert a durable admin_users row for any Clerk
 * user id, self-promoting to browser-session admin that outlives the token's
 * intended scope.
 *
 * Runs in the jsdom unit env (CI `npm test`). Mocking admin-middleware keeps
 * the real @clerk/nextjs/server import out of the graph; mocking the admin
 * model keeps lib/db.ts / @opennextjs/cloudflare bindings out of it entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/admin-middleware', () => ({
  checkAdminPermissions: vi.fn(),
}));

vi.mock('@/lib/models/admin', () => ({
  getAllAdminUsers: vi.fn(),
  addAdminUser: vi.fn(),
  removeAdminUser: vi.fn(),
  getAdminUser: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/users/route';
import { checkAdminPermissions } from '@/lib/auth/admin-middleware';
import { addAdminUser, getAdminUser } from '@/lib/models/admin';

const url = 'http://localhost/api/admin/users';

function postRequest(body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/users service-token gate (BMC-145 / M2)', () => {
  it('rejects the service-token identity with 403 and never calls addAdminUser', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: true,
      userId: 'admin-service',
      isServiceToken: true,
    });

    const res = await POST(postRequest({ action: 'add', userId: 'user_abc123' }));

    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/interactive admin session/i);
    expect(vi.mocked(addAdminUser)).not.toHaveBeenCalled();
    expect(vi.mocked(getAdminUser)).not.toHaveBeenCalled();
  });

  it('allows a real, DB-verified Clerk admin session through to addAdminUser', async () => {
    vi.mocked(checkAdminPermissions).mockResolvedValue({
      success: true,
      userId: 'user_123',
    });
    vi.mocked(getAdminUser).mockResolvedValue(null);
    vi.mocked(addAdminUser).mockResolvedValue({
      id: 1,
      userId: 'user_abc123',
      email: null,
      displayName: null,
      role: 'admin',
      isActive: true,
      createdBy: 'user_123',
      createdAt: new Date().toISOString(),
      lastLogin: null,
    } as never);

    const res = await POST(postRequest({ action: 'add', userId: 'user_abc123' }));

    expect(res.status).toBe(200);
    expect(vi.mocked(addAdminUser)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_abc123', role: 'admin', createdBy: 'user_123' })
    );
  });
});

/**
 * Regression test for BMC-133 / C6 — MCP cart/order tools trusted a
 * client-supplied session_id with no check that it belonged to the calling
 * agent, letting one agent hijack another agent's cart/order by reusing or
 * guessing its session_id.
 *
 * `requireOwnedSession()` (lib/mcp/session.ts) is the fix: it mirrors the
 * ownership check already enforced in app/api/mcp/sessions/[sessionId]/route.ts
 * (same SESSION_NOT_FOUND / SESSION_ACCESS_DENIED codes and messages) so the
 * cart/order tool functions can apply it too. This test exercises the real
 * getSession() + requireOwnedSession() logic against a mocked D1 layer.
 *
 * Runs in the jsdom unit env (CI `npm test`). Only @/lib/db (getDbAsync) is
 * mocked — the Drizzle table definitions and query builders (eq/lt/gte) are
 * pure and safe to import directly, so this exercises the real decision logic,
 * not just call-through wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const selectLimitMock = vi.fn();
const deleteWhereMock = vi.fn();

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (n: number) => selectLimitMock(n),
        }),
      }),
    }),
    delete: () => ({
      where: () => deleteWhereMock(),
    }),
  })),
}));

import { requireOwnedSession } from '@/lib/mcp/session';

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    agentId: 'agent-a',
    userId: null,
    userPreferences: null,
    sessionContext: null,
    cart: '[]',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe('requireOwnedSession (BMC-133 / C6)', () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
    deleteWhereMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns SESSION_NOT_FOUND when the session does not exist', async () => {
    selectLimitMock.mockResolvedValue([]);

    const result = await requireOwnedSession('missing-session', 'agent-a');

    expect(result).toEqual({
      ok: false,
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found or expired',
    });
  });

  it('treats an expired session as not found and deletes it', async () => {
    selectLimitMock.mockResolvedValue([
      sessionRow({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);

    const result = await requireOwnedSession('s1', 'agent-a');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SESSION_NOT_FOUND');
    }
    expect(deleteWhereMock).toHaveBeenCalled();
  });

  it('returns SESSION_ACCESS_DENIED when a different agent owns the session (the hijack case)', async () => {
    selectLimitMock.mockResolvedValue([sessionRow({ agentId: 'agent-victim' })]);

    const result = await requireOwnedSession('s1', 'agent-attacker');

    expect(result).toEqual({
      ok: false,
      code: 'SESSION_ACCESS_DENIED',
      message: 'Agent does not own this session',
    });
  });

  it('returns ok:true with the session when the calling agent owns it', async () => {
    selectLimitMock.mockResolvedValue([
      sessionRow({ agentId: 'agent-a', cart: JSON.stringify([{ productId: 'p1', variantId: 'v1', quantity: 2, name: 'Tea', price: 10 }]) }),
    ]);

    const result = await requireOwnedSession('s1', 'agent-a');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.agentId).toBe('agent-a');
      expect(result.session.cart).toEqual([
        { productId: 'p1', variantId: 'v1', quantity: 2, name: 'Tea', price: 10 },
      ]);
    }
  });
});

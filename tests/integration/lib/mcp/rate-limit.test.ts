/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Integration tests for the MCP rate limiter (BMC-142 review fixes).
 *
 * Runs inside the Cloudflare Workers runtime (miniflare) via
 * @cloudflare/vitest-pool-workers so the mcp_rate_limits upsert/read behaviour
 * — SQLite CASE expressions, PRIMARY KEY conflict handling — is exercised for
 * real, not mocked. Covers two HIGH findings from PR #35 review:
 *
 *  F1 — the hourly cap (ophLimit) must only apply to order-placement
 *       operations. Every other MCP call (search, cart, sessions, ...) must
 *       be governed only by the per-minute (rpm) limit, or legitimate
 *       traffic gets throttled to ophLimit (default 10) calls/hour.
 *  F2 — updateRateLimit's upsert must actually reset the counter once the
 *       window rolls over. The previous `where: eq(windowStart, windowStart)`
 *       clause only matched when the row's STORED windowStart already
 *       equaled the incoming one, so an existing row's window could never
 *       advance and the counter froze forever.
 *
 * The @opennextjs/cloudflare module is mocked so getDbAsync() (used inside
 * lib/mcp/auth.ts) resolves to the test env.DB binding instead of trying to
 * read the OpenNext AsyncLocalStorage context (which doesn't exist here).
 *
 * Run with: npm run test:workers
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { mcpRateLimits } from '@/lib/db/schema/mcp';
// The real production migration, imported as a raw string, so the test
// schema can never silently drift from what production applies.
import migration0004 from '@/migrations/0004_add_mcp_tables.sql?raw';

// Must be hoisted before any import that calls getDbAsync / getCloudflareContext.
vi.mock('@opennextjs/cloudflare', async () => {
  const { env: testEnv } = await import('cloudflare:test');
  return {
    getCloudflareContext: async () => ({ env: testEnv }),
  };
});

import { checkRateLimit, updateRateLimit, getRateLimitWindowStarts } from '@/lib/mcp/auth';

// ─── Schema bootstrap ────────────────────────────────────────────────────────
// Apply 0004 minus its seed INSERT (a dev test agent row) — checkRateLimit /
// updateRateLimit only ever touch mcp_rate_limits directly and take agentId
// as a plain string, so no mcp_agents row is required.
function migrationStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '') // strip SQL line comments first — they can contain ';'
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !/^INSERT\b/i.test(s));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [
    { name: '0004_add_mcp_tables', queries: migrationStatements(migration0004) },
  ]);
});

beforeEach(async () => {
  const db = drizzle(env.DB);
  await db.delete(mcpRateLimits);
});

async function getHourRow(agentId: string) {
  const db = drizzle(env.DB);
  const rows = await db
    .select()
    .from(mcpRateLimits)
    .where(and(eq(mcpRateLimits.agentId, agentId), eq(mcpRateLimits.window, 'hour')));
  return rows[0];
}

// ─── F1: hourly cap scoped to order-placement ops only ───────────────────────
describe('checkRateLimit — hourly cap is scoped to order-placement operations (F1)', () => {
  it('does not block non-order calls past ophLimit within the same hour (only rpm applies)', async () => {
    const agentId = 'agent-non-order';
    const ophLimit = 3;
    const rpmLimit = 1000; // high enough that the minute cap never trips here

    for (let i = 0; i < ophLimit + 5; i++) {
      const result = await checkRateLimit(agentId, rpmLimit, ophLimit, false);
      expect(result.success).toBe(true);
    }

    // Non-order calls must never write an 'hour' row at all.
    expect(await getHourRow(agentId)).toBeUndefined();
  });

  it('blocks the (ophLimit + 1)th order-placement call within the same hour', async () => {
    const agentId = 'agent-order';
    const ophLimit = 3;
    const rpmLimit = 1000;

    for (let i = 0; i < ophLimit; i++) {
      const result = await checkRateLimit(agentId, rpmLimit, ophLimit, true);
      expect(result.success).toBe(true);
    }

    const blocked = await checkRateLimit(agentId, rpmLimit, ophLimit, true);
    expect(blocked.success).toBe(false);
    expect(blocked.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(blocked.error?.message).toContain('operations per hour');

    // The blocked call must not have incremented the counter further.
    const row = await getHourRow(agentId);
    expect(row?.count).toBe(ophLimit);
  });

  it('still enforces the per-minute (rpm) limit on non-order calls', async () => {
    const agentId = 'agent-minute-limit';
    const rpmLimit = 2;
    const ophLimit = 1000; // irrelevant here — isOrderOp is false

    expect((await checkRateLimit(agentId, rpmLimit, ophLimit, false)).success).toBe(true);
    expect((await checkRateLimit(agentId, rpmLimit, ophLimit, false)).success).toBe(true);

    const blocked = await checkRateLimit(agentId, rpmLimit, ophLimit, false);
    expect(blocked.success).toBe(false);
    expect(blocked.error?.message).toContain('requests per minute');
  });
});

// ─── F2: the rate-limit window actually resets across boundaries ────────────
describe('updateRateLimit — resets the counter once the window rolls over (F2)', () => {
  it('resets count to 1 (not frozen, not incremented) when a stale row exists for an earlier window', async () => {
    const agentId = 'agent-rollover-update';
    const db = drizzle(env.DB);

    // Simulate a maxed-out previous hour that was never cleaned up.
    const staleWindowStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(mcpRateLimits).values({
      agentId,
      window: 'hour',
      count: 99,
      windowStart: staleWindowStart,
    });

    const { hourStart: currentHourStart } = getRateLimitWindowStarts();
    await updateRateLimit(agentId, 'hour', currentHourStart);

    const row = await getHourRow(agentId);
    // Before the fix, the upsert's `where: eq(windowStart, windowStart)` clause
    // only matched when the STORED windowStart already equaled the incoming
    // one. Since the stored value here is stale, that predicate would never
    // have matched, so the UPDATE silently would not have applied at all —
    // count would stay frozen at 99 and windowStart would stay stale forever.
    expect(row?.count).toBe(1);
    expect(row?.windowStart).toBe(currentHourStart);
  });

  it('keeps incrementing normally when the window has not changed', async () => {
    const agentId = 'agent-same-window';
    const { hourStart } = getRateLimitWindowStarts();

    await updateRateLimit(agentId, 'hour', hourStart);
    await updateRateLimit(agentId, 'hour', hourStart);
    await updateRateLimit(agentId, 'hour', hourStart);

    const row = await getHourRow(agentId);
    expect(row?.count).toBe(3);
    expect(row?.windowStart).toBe(hourStart);
  });

  it('checkRateLimit does not block on a stale hour row (read side) and resets it (write side)', async () => {
    const agentId = 'agent-rollover-checkratelimit';
    const db = drizzle(env.DB);
    const ophLimit = 2;

    // A stale row whose count is already far past ophLimit, but belongs to a
    // window that has since rolled over.
    const staleWindowStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await db.insert(mcpRateLimits).values({
      agentId,
      window: 'hour',
      count: 50,
      windowStart: staleWindowStart,
    });

    const result = await checkRateLimit(agentId, 1000, ophLimit, true);
    expect(result.success).toBe(true);

    const row = await getHourRow(agentId);
    expect(row?.count).toBe(1);
  });

  it('starts a fresh window (count 1) after the wall clock crosses an hour boundary', async () => {
    const agentId = 'agent-real-clock-rollover';
    const ophLimit = 2;
    const rpmLimit = 1000;

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 1, 10, 30, 0, 0));

      expect((await checkRateLimit(agentId, rpmLimit, ophLimit, true)).success).toBe(true);
      expect((await checkRateLimit(agentId, rpmLimit, ophLimit, true)).success).toBe(true);
      // Third order op in the same hour exceeds ophLimit=2.
      expect((await checkRateLimit(agentId, rpmLimit, ophLimit, true)).success).toBe(false);

      // Cross into the next hour.
      vi.setSystemTime(new Date(2026, 0, 1, 11, 5, 0, 0));

      const fresh = await checkRateLimit(agentId, rpmLimit, ophLimit, true);
      expect(fresh.success).toBe(true);

      const row = await getHourRow(agentId);
      expect(row?.count).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

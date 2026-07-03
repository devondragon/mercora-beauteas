/**
 * Regression test for checkRateLimit's atomic batched counter write
 * (lib/mcp/auth.ts, BMC-142 follow-up).
 *
 * The minute + hour rate-limit increments are issued in a single db.batch([...])
 * so they commit atomically (D1 has no db.transaction()). Previously they were
 * two sequential awaited writes, so a failure after the first left the counters
 * drifted. This asserts:
 *   - a non-order op writes exactly one (minute) upsert in one batch call
 *   - an order op writes both (minute + hour) upserts in a single batch call
 *   - a rejected batch surfaces as one clean RATE_LIMIT_ERROR, not a partial write
 *
 * Mocks @/lib/db so the real function runs against a fake db in the jsdom unit
 * env (CI `npm test`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { limitMock, batchMock, getDbAsyncMock } = vi.hoisted(() => {
  const limitMock = vi.fn().mockResolvedValue([]); // no existing usage row → under limit
  const batchMock = vi.fn().mockResolvedValue(undefined);
  // select().from().where().limit()
  const select = () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) });
  // insert().values().onConflictDoUpdate() → returns an opaque statement marker
  const insert = () => ({ values: () => ({ onConflictDoUpdate: () => ({ __upsert: true }) }) });
  const getDbAsyncMock = vi.fn(async () => ({ select, insert, batch: batchMock }));
  return { limitMock, batchMock, getDbAsyncMock };
});

vi.mock('@/lib/db', () => ({
  getDbAsync: getDbAsyncMock,
}));

import { checkRateLimit } from '@/lib/mcp/auth';

beforeEach(() => {
  vi.clearAllMocks();
  limitMock.mockResolvedValue([]);
  batchMock.mockResolvedValue(undefined);
});

describe('checkRateLimit atomic batch write', () => {
  it('writes exactly one (minute) upsert in a single batch for a non-order op', async () => {
    const result = await checkRateLimit('agent-a', 100, 10, false);

    expect(result.success).toBe(true);
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0][0]).toHaveLength(1);
  });

  it('writes both minute + hour upserts in a single batch for an order op', async () => {
    const result = await checkRateLimit('agent-a', 100, 10, true);

    expect(result.success).toBe(true);
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0][0]).toHaveLength(2);
  });

  it('surfaces a batch failure as a single RATE_LIMIT_ERROR (no partial write)', async () => {
    batchMock.mockRejectedValueOnce(new Error('D1_ERROR: batch failed'));

    const result = await checkRateLimit('agent-a', 100, 10, true);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RATE_LIMIT_ERROR');
    expect(batchMock).toHaveBeenCalledTimes(1);
  });
});

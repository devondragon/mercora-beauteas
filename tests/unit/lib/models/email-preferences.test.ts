// tests/unit/lib/models/email-preferences.test.ts
//
// BMC-184: direct coverage for the suppression-list query used to gate review
// reminders (getReviewReminderOptOuts). Mocks getDbAsync with a chainable stub
// so we can assert the short-circuit, the injected-db reuse, and that it returns
// the set of opted-out addresses the query yields.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(),
}));

import { getReviewReminderOptOuts } from '@/lib/models/email-preferences';
import { getDbAsync } from '@/lib/db';

// Chainable stub for `db.select({...}).from(...).where(...)` resolving to `rows`.
function stubDb(rows: Array<{ email: string }>) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where } as never;
}

describe('getReviewReminderOptOuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits on empty input without acquiring a db', async () => {
    const result = await getReviewReminderOptOuts([]);
    expect(result).toEqual(new Set());
    expect(getDbAsync).not.toHaveBeenCalled();
  });

  it('returns the set of opted-out emails and reuses an injected db', async () => {
    const db = stubDb([{ email: 'a@example.com' }, { email: 'b@example.com' }]);

    const result = await getReviewReminderOptOuts(
      ['a@example.com', 'b@example.com', 'c@example.com'],
      db,
    );

    expect(result).toEqual(new Set(['a@example.com', 'b@example.com']));
    expect(getDbAsync).not.toHaveBeenCalled(); // injected db reused
  });

  it('acquires a db when none is injected', async () => {
    vi.mocked(getDbAsync).mockResolvedValue(stubDb([]));
    const result = await getReviewReminderOptOuts(['x@example.com']);
    expect(result).toEqual(new Set());
    expect(getDbAsync).toHaveBeenCalledTimes(1);
  });
});

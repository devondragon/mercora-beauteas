/**
 * Regression test for BMC-153 / L3 review follow-up.
 *
 * PR #42 replaced the read-then-write webhook dedup with an insert-first
 * `claimWebhookEvent` that treats a UNIQUE/PK violation on
 * processed_webhook_events as "already claimed" (see
 * lib/models/mach/subscriptions.ts). The existing route test
 * (tests/unit/app/api/webhooks-stripe-dedup.test.ts) mocks
 * `@/lib/models/mach/subscriptions` wholesale, so the actual constraint
 * -detection + rethrow logic — the core of the new behavior — was never
 * exercised.
 *
 * `isUniqueViolation` itself lives in lib/utils/db-errors.ts (a pure module
 * with zero imports) rather than being tested via lib/models/mach/
 * subscriptions.ts directly: that module imports lib/db.ts, which imports
 * @opennextjs/cloudflare's getCloudflareContext(), and per the policy in
 * vitest.config.ts, tests/unit/** must never import anything with a
 * Cloudflare binding dependency (lib/db, lib/models/**) — those belong in
 * E2E / @cloudflare/vitest-pool-workers. subscriptions.ts and
 * lib/models/mach/giftCard.ts both import and use the shared helper from
 * lib/utils/db-errors.ts; their behavior is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { isUniqueViolation } from '@/lib/utils/db-errors';

/** Build an Error whose `cause` chain nests `message` `depth` levels deep. */
function nestedCauseError(message: string, depth: number): Error {
  let err = new Error(message);
  for (let i = 0; i < depth; i++) {
    const wrapper = new Error(`wrapper level ${i}`);
    (wrapper as { cause?: unknown }).cause = err;
    err = wrapper;
  }
  return err;
}

describe('isUniqueViolation (BMC-153 review)', () => {
  it('returns true for a top-level UNIQUE constraint message', () => {
    expect(
      isUniqueViolation(
        new Error('UNIQUE constraint failed: processed_webhook_events.event_id')
      )
    ).toBe(true);
  });

  it('returns true for a top-level SQLITE_CONSTRAINT_PRIMARYKEY message', () => {
    expect(isUniqueViolation(new Error('SQLITE_CONSTRAINT_PRIMARYKEY'))).toBe(true);
  });

  it('returns true when the constraint text is nested one level down err.cause', () => {
    const outer = new Error('Failed query: insert into processed_webhook_events...');
    (outer as { cause?: unknown }).cause = new Error(
      'UNIQUE constraint failed: processed_webhook_events.event_id'
    );
    expect(isUniqueViolation(outer)).toBe(true);
  });

  it('returns true when the constraint text is nested deeper in the cause chain (within the 5-level walk)', () => {
    // isUniqueViolation walks up to 5 levels (depth 0..4); place the real
    // SQLITE_CONSTRAINT text at the last level the walk still visits.
    const err = nestedCauseError('SQLITE_CONSTRAINT: UNIQUE constraint failed', 4);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('returns false when the constraint text is beyond the 5-level cause-walk depth', () => {
    const err = nestedCauseError('UNIQUE constraint failed', 5);
    expect(isUniqueViolation(err)).toBe(false);
  });

  it('returns false for a generic non-constraint error', () => {
    expect(isUniqueViolation(new Error('network timeout'))).toBe(false);
  });

  it('returns false for a generic error with a non-constraint cause', () => {
    const outer = new Error('Failed query: insert into processed_webhook_events...');
    (outer as { cause?: unknown }).cause = new Error('connection reset');
    expect(isUniqueViolation(outer)).toBe(false);
  });

  it('returns false and does not throw for null', () => {
    expect(() => isUniqueViolation(null)).not.toThrow();
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('returns false and does not throw for undefined', () => {
    expect(() => isUniqueViolation(undefined)).not.toThrow();
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('returns false and does not throw for a plain string that is not a constraint message', () => {
    expect(() => isUniqueViolation('just a plain string')).not.toThrow();
    expect(isUniqueViolation('just a plain string')).toBe(false);
  });
});

/**
 * Unit tests for `formatDate` (lib/utils/account.ts), used on both the
 * registered-customer order page and the signed guest order-status page.
 *
 * Regression coverage for BMC-229 review pass 2: an unparseable date string
 * previously flowed straight into `Date#toLocaleDateString`, which renders
 * the literal string "Invalid Date" to the customer instead of the shared
 * "–" placeholder every other missing-value case already uses.
 */
import { describe, it, expect } from 'vitest';
import { formatDate } from '@/lib/utils/account';

describe('formatDate', () => {
  it('returns "–" for a null/undefined/empty input', () => {
    expect(formatDate(null)).toBe('–');
    expect(formatDate(undefined)).toBe('–');
    expect(formatDate('')).toBe('–');
  });

  it('returns "–" instead of the literal "Invalid Date" for an unparseable string', () => {
    expect(formatDate('not-a-date')).toBe('–');
  });

  it('returns "–" for a well-formed but out-of-range date string', () => {
    // A distinct malformed-date shape from the case above — guards against a
    // future edit that only special-cases free-text garbage.
    expect(formatDate('2026-13-45')).toBe('–');
  });

  it('formats a valid ISO date string', () => {
    expect(formatDate('2026-07-28T18:00:00.000Z')).toBe('Jul 28, 2026');
  });

  it('includes the time when showTime is true', () => {
    expect(formatDate('2026-07-28T18:00:00.000Z', true)).toBe('Jul 28, 2026, 6:00 PM');
  });

  it('renders in UTC regardless of how close the timestamp is to a local-time day boundary', () => {
    // The explicit `timeZone: "UTC"` pin is what keeps a signed guest link
    // showing the same date to every viewer regardless of the reader's or the
    // Worker colo's local offset. Straddle midnight from both sides so a
    // regression that drops the pin fails here instead of only failing for a
    // contributor sitting at UTC+6 or beyond.
    expect(formatDate('2026-07-28T23:30:00.000Z')).toBe('Jul 28, 2026');
    expect(formatDate('2026-07-28T00:30:00.000Z')).toBe('Jul 28, 2026');
  });
});

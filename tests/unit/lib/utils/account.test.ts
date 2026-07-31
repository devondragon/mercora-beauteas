/**
 * Unit tests for `formatDate` (lib/utils/account.ts), used on both the
 * registered-customer order page and the signed guest order-status page.
 *
 * Regression coverage for BMC-229 review pass 2: an unparseable date string
 * previously flowed straight into `Date#toLocaleDateString`, which renders
 * the literal string "Invalid Date" to the customer instead of the shared
 * "—" placeholder every other missing-value case already uses.
 */
import { describe, it, expect } from 'vitest';
import { formatDate } from '@/lib/utils/account';

describe('formatDate', () => {
  it('returns "—" for a null/undefined/empty input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('returns "—" instead of the literal "Invalid Date" for an unparseable string', () => {
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('not-a-date')).not.toContain('Invalid');
  });

  it('formats a valid ISO date string', () => {
    expect(formatDate('2026-07-28T18:00:00.000Z')).toBe('Jul 28, 2026');
  });

  it('includes the time when showTime is true', () => {
    const formatted = formatDate('2026-07-28T18:00:00.000Z', true);
    expect(formatted).toContain('2026');
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});

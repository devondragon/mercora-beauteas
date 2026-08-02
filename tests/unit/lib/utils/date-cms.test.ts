import { describe, expect, it } from 'vitest';
import { cmsTimestampToDate } from '@/lib/utils/date';

describe('cmsTimestampToDate', () => {
  it('interprets Unix seconds as seconds rather than milliseconds', () => {
    expect(cmsTimestampToDate(1_767_225_600).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves Unix milliseconds and ISO timestamps', () => {
    expect(cmsTimestampToDate(1_767_225_600_000).getUTCFullYear()).toBe(2026);
    expect(cmsTimestampToDate('2025-06-15T12:00:00Z').getUTCFullYear()).toBe(2025);
  });
});

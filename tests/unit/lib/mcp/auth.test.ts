import { describe, it, expect, vi } from 'vitest';
import { getRateLimitWindowStarts } from '@/lib/mcp/auth';

// BMC-142: the hourly ops-per-hour rate limit never tripped because
// checkRateLimit() read the 'hour' window using one hourStart derivation,
// while updateRateLimit() was never called for the 'hour' window at all, so
// no row was ever written for the check to find. getRateLimitWindowStarts()
// is now the single source of truth both the read and write paths call, so
// this test asserts the two paths can never drift apart on the window key.
//
// Dates below use the local `new Date(y, m, d, h, min, s, ms)` constructor
// (not ISO UTC strings) because the helper floors using local time getters
// (getHours/getMinutes) — constructing inputs the same way keeps this test
// correct regardless of the machine's timezone.
describe('getRateLimitWindowStarts', () => {
  it('floors the minute and hour boundaries to the start of their period', () => {
    const now = new Date(2026, 6, 2, 14, 37, 52, 123);
    const { minuteStart, hourStart } = getRateLimitWindowStarts(now);

    const minuteStartDate = new Date(minuteStart);
    expect(minuteStartDate.getFullYear()).toBe(2026);
    expect(minuteStartDate.getMonth()).toBe(6);
    expect(minuteStartDate.getDate()).toBe(2);
    expect(minuteStartDate.getHours()).toBe(14);
    expect(minuteStartDate.getMinutes()).toBe(37);
    expect(minuteStartDate.getSeconds()).toBe(0);
    expect(minuteStartDate.getMilliseconds()).toBe(0);

    const hourStartDate = new Date(hourStart);
    expect(hourStartDate.getFullYear()).toBe(2026);
    expect(hourStartDate.getMonth()).toBe(6);
    expect(hourStartDate.getDate()).toBe(2);
    expect(hourStartDate.getHours()).toBe(14);
    expect(hourStartDate.getMinutes()).toBe(0);
    expect(hourStartDate.getSeconds()).toBe(0);
    expect(hourStartDate.getMilliseconds()).toBe(0);
  });

  it('produces the same hourStart (write key) for two timestamps in the same hour (read key)', () => {
    const earlyInHour = getRateLimitWindowStarts(new Date(2026, 6, 2, 14, 0, 0, 500));
    const lateInHour = getRateLimitWindowStarts(new Date(2026, 6, 2, 14, 59, 59, 999));

    // This is the core of BMC-142: a request checked near the top of the hour
    // and one checked near the end of the hour must key the same D1 row, or
    // the hour counter can never accumulate past 1 and ophLimit never trips.
    expect(lateInHour.hourStart).toBe(earlyInHour.hourStart);
  });

  it('produces a different hourStart once the clock crosses into the next hour', () => {
    const beforeRollover = getRateLimitWindowStarts(new Date(2026, 6, 2, 14, 59, 59, 999));
    const afterRollover = getRateLimitWindowStarts(new Date(2026, 6, 2, 15, 0, 0, 0));

    expect(afterRollover.hourStart).not.toBe(beforeRollover.hourStart);
  });

  it('produces a different minuteStart once the clock crosses into the next minute', () => {
    const beforeRollover = getRateLimitWindowStarts(new Date(2026, 6, 2, 14, 37, 59, 999));
    const afterRollover = getRateLimitWindowStarts(new Date(2026, 6, 2, 14, 38, 0, 0));

    expect(afterRollover.minuteStart).not.toBe(beforeRollover.minuteStart);
  });

  it('defaults to the current time when no argument is given', () => {
    // Freeze the wall clock so the default-parameter branch is exercised
    // deterministically. The previous version compared the result against two
    // live Date.now() reads (`before`/`after`) taken around the call, which
    // could straddle an hour boundary and flake (e.g. the clock ticks into the
    // next hour between capturing `before` and running the floor logic, making
    // `hourStartMs <= before` false). Pinning a fixed `now` removes that race.
    vi.useFakeTimers();
    try {
      const now = new Date(2026, 6, 2, 14, 37, 52, 123);
      vi.setSystemTime(now);

      const { hourStart } = getRateLimitWindowStarts();
      // Same fixed instant passed explicitly must yield the identical window key.
      const expected = getRateLimitWindowStarts(now);

      expect(hourStart).toBe(expected.hourStart);
    } finally {
      vi.useRealTimers();
    }
  });
});

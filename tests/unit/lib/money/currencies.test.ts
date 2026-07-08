import { describe, it, expect } from 'vitest';
import { getPrecision, DEFAULT_PRECISION } from '@/lib/money/currencies';

describe('getPrecision', () => {
  it('returns 2 for USD', () => expect(getPrecision('USD')).toBe(2));
  it('returns 0 for JPY', () => expect(getPrecision('JPY')).toBe(0));
  it('returns 3 for BHD', () => expect(getPrecision('BHD')).toBe(3));
  it('is case-insensitive', () => expect(getPrecision('usd')).toBe(2));
  it('defaults to 2 for unknown currencies', () => {
    expect(getPrecision('XYZ')).toBe(DEFAULT_PRECISION);
    expect(DEFAULT_PRECISION).toBe(2);
  });
});

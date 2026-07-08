import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money/money';

describe('Money constructors + persistence', () => {
  it('fromMinor stores integer minor units', () => {
    expect(Money.fromMinor(2999, 'USD').toMinorUnits()).toBe(2999);
  });
  it('fromMinor rejects non-integers', () => {
    expect(() => Money.fromMinor(29.99, 'USD')).toThrow();
  });
  it('fromMajor converts dollars to cents (half-up)', () => {
    expect(Money.fromMajor('29.99', 'USD').toMinorUnits()).toBe(2999);
    expect(Money.fromMajor(29.995, 'USD').toMinorUnits()).toBe(3000);
  });
  it('fromMajor respects 0-precision currencies', () => {
    expect(Money.fromMajor(1000, 'JPY').toMinorUnits()).toBe(1000);
  });
  it('zero is zero', () => expect(Money.zero('USD').toMinorUnits()).toBe(0));
  it('currency is normalized uppercase', () => {
    expect(Money.fromMinor(1, 'usd').currency).toBe('USD');
  });
  it('toJSON persists minor units (not major)', () => {
    expect(Money.fromMinor(2999, 'USD').toJSON()).toEqual({ amount: 2999, currency: 'USD' });
  });
  describe('fromStored (legacy encodings, all = minor units)', () => {
    it('parses a Money object', () => {
      expect(Money.fromStored({ amount: 2999, currency: 'USD' }).toMinorUnits()).toBe(2999);
    });
    it('parses a JSON string', () => {
      expect(Money.fromStored('{"amount":2999,"currency":"USD"}').toMinorUnits()).toBe(2999);
    });
    it('parses a bare numeric string as minor units', () => {
      expect(Money.fromStored('2999', 'USD').toMinorUnits()).toBe(2999);
    });
    it('parses a bare number as minor units', () => {
      expect(Money.fromStored(2999, 'USD').toMinorUnits()).toBe(2999);
    });
    it('falls back to zero on garbage', () => {
      expect(Money.fromStored(null, 'USD').toMinorUnits()).toBe(0);
    });
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts same-currency', () => {
    expect(Money.fromMinor(2999).add(Money.fromMinor(1)).toMinorUnits()).toBe(3000);
    expect(Money.fromMinor(3000).subtract(Money.fromMinor(1)).toMinorUnits()).toBe(2999);
  });
  it('throws on currency mismatch', () => {
    expect(() => Money.fromMinor(1, 'USD').add(Money.fromMinor(1, 'EUR'))).toThrow(/mismatch/i);
  });
  it('times multiplies by an integer quantity', () => {
    expect(Money.fromMinor(2999).times(3).toMinorUnits()).toBe(8997);
  });
  it('times rejects non-integer quantity', () => {
    expect(() => Money.fromMinor(2999).times(1.5)).toThrow();
  });
  it('applyRate multiplies then rounds half-up to integer minor', () => {
    // 8.25% tax on $29.99 = 247.4175c -> 247c
    expect(Money.fromMinor(2999).applyRate(0.0825).toMinorUnits()).toBe(247);
    // half-up boundary: 100c * 0.005 = 0.5 -> 1c
    expect(Money.fromMinor(100).applyRate(0.005).toMinorUnits()).toBe(1);
  });
  it('negate flips sign (for refunds)', () => {
    expect(Money.fromMinor(2999).negate().toMinorUnits()).toBe(-2999);
  });
  it('allocate splits without losing minor units', () => {
    const parts = Money.fromMinor(1000).allocate([1, 1, 1]);
    expect(parts.map(p => p.toMinorUnits())).toEqual([334, 333, 333]);
    expect(parts.reduce((a, p) => a + p.toMinorUnits(), 0)).toBe(1000);
  });
});

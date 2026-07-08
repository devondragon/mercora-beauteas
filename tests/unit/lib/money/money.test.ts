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

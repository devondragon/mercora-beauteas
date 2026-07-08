import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money';

// Pure regression coverage for the Stripe boundary conversion arithmetic in
// lib/stripe.ts (formatAmountForStripe / formatAmountFromStripe), which is
// now routed through Money instead of raw `* 100` / `/ 100`. This file
// intentionally imports only @/lib/money (no lib/stripe) so it stays free of
// Cloudflare Worker dependencies pulled in by the Stripe SDK. Extended in
// Task 7 with order-pricing-specific cases.
describe('Stripe boundary', () => {
  it('Money -> Stripe minor units is exact', () => {
    expect(Money.fromMajor('29.99', 'USD').toMinorUnits()).toBe(2999);
  });
  it('Stripe minor units -> Money round-trips', () => {
    expect(Money.fromMinor(2999, 'USD').toMach().amount).toBe(29.99);
  });
});

describe('Stripe boundary rounding', () => {
  it('half-cent exact-decimal rounds half-up to next minor unit', () => {
    expect(Money.fromMajor('1.005', 'USD').toMinorUnits()).toBe(101);
  });
  it('standard major unit converts exactly', () => {
    expect(Money.fromMajor('29.99', 'USD').toMinorUnits()).toBe(2999);
  });
  it('minor -> major round-trips without loss', () => {
    expect(Money.fromMinor(2999, 'USD').toMach().amount).toBe(29.99);
  });
});

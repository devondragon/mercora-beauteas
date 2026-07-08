import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money';
import { computeOrderTotals, calculateShipping, calculateTax } from '@/lib/services/order-pricing';

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

// Task 7 (BMC-164): computeOrderTotals/calculateShipping/calculateTax moved into
// this pure module and are now Money-typed end to end, so the cents/dollars
// mismatch that BMC-161 had to point-fix (free-shipping threshold comparing a
// cents subtotal against a dollars threshold) is impossible at the type level.
describe('order totals (Money-typed)', () => {
  const addr = { line1: '1 Main St', city: 'LA', region: 'CA', country: 'US', postal_code: '90001' } as any;

  it('free-shipping threshold compares correctly (no cents/dollars bug)', () => {
    // $50 subtotal -> paid shipping; $150 -> free
    expect(calculateShipping(addr, Money.fromMajor(50, 'USD')).isZero()).toBe(false);
    expect(calculateShipping(addr, Money.fromMajor(150, 'USD')).isZero()).toBe(true);
  });

  it('applies the AK/HI shipping surcharge instead of standard shipping', () => {
    const ak = { ...addr, region: 'AK' };
    expect(calculateShipping(ak, Money.fromMajor(50, 'USD')).toMinorUnits()).toBe(1999);
    expect(calculateShipping(addr, Money.fromMajor(50, 'USD')).toMinorUnits()).toBe(999);
  });

  it('tax is subtotal * rate, exact', () => {
    const tax = calculateTax(Money.fromMajor('29.99', 'USD'), { ...addr, region: 'CA' });
    // 29.99 * 0.0875 = 2.624125 -> rounds half-up to 262 minor units.
    expect(tax.toMinorUnits()).toBe(262);
  });

  it('falls back to the default tax rate for an unlisted region', () => {
    const tax = calculateTax(Money.fromMajor('100', 'USD'), { ...addr, region: 'WA' });
    expect(tax.toMinorUnits()).toBe(500); // 5% default
  });

  it('computeOrderTotals returns Money and total = subtotal+shipping+tax', () => {
    const r = computeOrderTotals(Money.fromMajor('29.99', 'USD'), addr, {});
    expect(r.total.toMinorUnits())
      .toBe(r.subtotal.add(r.shipping).add(r.tax).toMinorUnits());
    expect(r.subtotal.toMinorUnits()).toBe(2999);
    expect(r.shipping.toMinorUnits()).toBe(999);
    expect(r.tax.toMinorUnits()).toBe(262);
    expect(r.total.toMinorUnits()).toBe(2999 + 999 + 262);
  });

  it('computeOrderTotals gives free shipping at the $100 threshold', () => {
    const r = computeOrderTotals(Money.fromMajor(100, 'USD'), addr, {});
    expect(r.shipping.isZero()).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money';

// Introduce a pure builder that maps order money (minor units) -> display strings.
import { buildOrderEmailTotals } from '@/lib/utils/order-email-totals';

describe('order email totals', () => {
  it('formats a $25 order as $25.00, not $2500.00', () => {
    const t = buildOrderEmailTotals({
      subtotal: 2000, shipping: 500, tax: 0, total: 2500, currency: 'USD',
    });
    expect(t.total).toBe('$25.00');
    expect(t.shipping).toBe('$5.00');
  });

  it('formats subtotal and tax as dollars, not cents', () => {
    const t = buildOrderEmailTotals({
      subtotal: 2000, shipping: 500, tax: 165, total: 2665, currency: 'USD',
    });
    expect(t.subtotal).toBe('$20.00');
    expect(t.tax).toBe('$1.65');
    expect(t.total).toBe('$26.65');
  });

  it('defaults to USD when no currency is given', () => {
    const t = buildOrderEmailTotals({ subtotal: 100, shipping: 0, tax: 0, total: 100 });
    expect(t.total).toBe('$1.00');
  });

  it('adds a gift-card line and post-gift-card amount charged when a gift-card tender is present', () => {
    const t = buildOrderEmailTotals({
      subtotal: 2000, shipping: 500, tax: 0, total: 2500, currency: 'USD', giftCardAmount: 1000,
    });
    expect(t.total).toBe('$25.00');
    expect(t.giftCard).toBe('$10.00');
    expect(t.amountCharged).toBe('$15.00');
  });

  it('omits the gift-card fields when there is no gift-card tender', () => {
    const t = buildOrderEmailTotals({ subtotal: 2000, shipping: 500, tax: 0, total: 2500 });
    expect(t.giftCard).toBeUndefined();
    expect(t.amountCharged).toBeUndefined();
  });

  it('matches Money.fromMinor(...).format() directly for a known value', () => {
    const t = buildOrderEmailTotals({ subtotal: 2500, shipping: 0, tax: 0, total: 2500, currency: 'USD' });
    expect(t.subtotal).toBe(Money.fromMinor(2500, 'USD').format());
  });
});

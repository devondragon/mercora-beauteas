import { describe, it, expect } from 'vitest';
import { Money } from '@/lib/money';

// Pure helper we will introduce for MCP/API money fields:
import { toWireMoney } from '@/lib/money/wire';

describe('wire money shape', () => {
  it('serializes stored cents to MACH major units', () => {
    expect(toWireMoney({ amount: 2999, currency: 'USD' }))
      .toEqual({ amount: 29.99, currency: 'USD', precision: 2 });
  });

  it('serializes a bare cents number to MACH major units', () => {
    expect(toWireMoney(500)).toEqual({ amount: 5, currency: 'USD', precision: 2 });
  });

  it('defaults currency when not provided by the stored value', () => {
    expect(toWireMoney(1234, 'USD')).toEqual({ amount: 12.34, currency: 'USD', precision: 2 });
  });

  it('is equivalent to Money.fromStored(...).toMach()', () => {
    const value = { amount: 999, currency: 'USD' };
    expect(toWireMoney(value)).toEqual(Money.fromStored(value).toMach());
  });
});

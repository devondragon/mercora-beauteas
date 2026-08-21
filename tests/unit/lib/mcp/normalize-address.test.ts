/**
 * Unit tests for normalizeAddress backward-compatibility (BMC-162).
 *
 * The MCP tool schemas were updated from the legacy street/state/street2 shape
 * to the MACH Address shape (line1/region/line2). normalizeAddress guarantees
 * that agents still sending the old keys work correctly at runtime. These tests
 * lock in that guarantee so a future refactor can't silently break it.
 *
 * Also covers computeOrderTotals so we verify that region-dependent pricing
 * (AK/HI surcharge, state tax rates) fires correctly for both old and new
 * address shapes.
 */
import { describe, it, expect } from 'vitest';
import { normalizeAddress } from '@/lib/mcp/tools/order';
import { computeOrderTotals } from '@/lib/services/order-pricing';
import { Money } from '@/lib/money';

describe('normalizeAddress — legacy street/state keys (backward compat)', () => {
  it('maps street → line1 and state → region', () => {
    const result = normalizeAddress({ street: '123 Main St', state: 'CA', city: 'LA', country: 'US' });
    expect(result.line1).toBe('123 Main St');
    expect(result.region).toBe('CA');
  });

  it('maps street2 → line2', () => {
    const result = normalizeAddress({ street: '1 Tea Way', street2: 'Apt 2', state: 'NY', city: 'NYC', country: 'US' });
    expect(result.line2).toBe('Apt 2');
  });

  it('preserves MACH-shape inputs unchanged (idempotent)', () => {
    const result = normalizeAddress({ line1: '10 Bloom Ave', region: 'TX', city: 'Austin', country: 'US' });
    expect(result.line1).toBe('10 Bloom Ave');
    expect(result.region).toBe('TX');
  });

  it('prefers MACH fields when both old and new keys are present', () => {
    const result = normalizeAddress({ line1: 'MACH St', street: 'Legacy St', region: 'WA', state: 'CA', city: 'Seattle', country: 'US' });
    expect(result.line1).toBe('MACH St');
    expect(result.region).toBe('WA');
  });

  it('handles undefined input gracefully', () => {
    const result = normalizeAddress(undefined);
    expect(result.line1).toBe('');
    expect(result.city).toBe('');
    expect(result.country).toBe('US');
  });

  it('defaults country to US when omitted', () => {
    const result = normalizeAddress({ street: '1 St', state: 'OR', city: 'Portland' });
    expect(result.country).toBe('US');
  });
});

describe('computeOrderTotals — region-dependent pricing via legacy keys', () => {
  it('applies AK surcharge when state: AK is supplied (legacy shape)', () => {
    const addr = normalizeAddress({ street: '1 Arctic Way', state: 'AK', city: 'Anchorage', country: 'US' });
    const { shipping } = computeOrderTotals(Money.fromMajor(50, 'USD'), addr);
    expect(shipping.toMach().amount).toBe(19.99);
  });

  it('applies HI surcharge when state: HI is supplied (legacy shape)', () => {
    const addr = normalizeAddress({ street: '1 Aloha Blvd', state: 'HI', city: 'Honolulu', country: 'US' });
    const { shipping } = computeOrderTotals(Money.fromMajor(50, 'USD'), addr);
    expect(shipping.toMach().amount).toBe(19.99);
  });

  it('uses standard shipping for continental state supplied as legacy key', () => {
    const addr = normalizeAddress({ street: '1 Main St', state: 'TX', city: 'Austin', country: 'US' });
    const { shipping } = computeOrderTotals(Money.fromMajor(50, 'USD'), addr);
    expect(shipping.toMach().amount).toBe(9.99);
  });

  it('applies CA tax rate when state: CA is supplied (legacy shape)', () => {
    const addr = normalizeAddress({ street: '1 Sunset Blvd', state: 'CA', city: 'LA', country: 'US' });
    const { tax } = computeOrderTotals(Money.fromMajor(100, 'USD'), addr);
    expect(tax.toMach().amount).toBeCloseTo(8.75); // 8.75% CA rate
  });

  it('applies CA tax rate identically when region: CA is supplied (MACH shape)', () => {
    const addr = normalizeAddress({ line1: '1 Sunset Blvd', region: 'CA', city: 'LA', country: 'US' });
    const { tax } = computeOrderTotals(Money.fromMajor(100, 'USD'), addr);
    expect(tax.toMach().amount).toBeCloseTo(8.75);
  });

  // Final-review fix wave, item 5: no free-shipping threshold exists on this
  // path anymore (see calculateShipping's doc comment in order-pricing.ts) —
  // pinned here for both address shapes so a future change can't quietly
  // reintroduce it for one shape but not the other.
  it('never grants free shipping regardless of address shape', () => {
    const legacyAddr = normalizeAddress({ street: '1 St', state: 'CA', city: 'LA', country: 'US' });
    const machAddr = normalizeAddress({ line1: '1 St', region: 'CA', city: 'LA', country: 'US' });
    expect(computeOrderTotals(Money.fromMajor(150, 'USD'), legacyAddr).shipping.isZero()).toBe(false);
    expect(computeOrderTotals(Money.fromMajor(150, 'USD'), machAddr).shipping.isZero()).toBe(false);
  });
});

/**
 * Unit tests for BMC-171 address normalization at untrusted boundaries.
 *
 * `normalizeShippableAddress` is used by both POST /api/subscriptions (client
 * body) and the subscription webhook (Stripe metadata JSON). It must:
 *  - require the minimum shippable shape (line1 + city + a valid ISO-2 country),
 *  - uppercase-normalize the country and reject non-ISO-2 values, and
 *  - stay non-blocking — returning null (never throwing) on partial/invalid input.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeCountryCode,
  normalizeUsRegion,
  validateUsShippingAddress,
  normalizeShippableAddress,
} from '@/lib/utils/address';

describe('normalizeCountryCode', () => {
  it('uppercases a 2-letter code', () => {
    expect(normalizeCountryCode('us')).toBe('US');
    expect(normalizeCountryCode(' ca ')).toBe('CA');
    expect(normalizeCountryCode('GB')).toBe('GB');
  });

  it('rejects non-ISO-2 values', () => {
    expect(normalizeCountryCode('United States')).toBeNull();
    expect(normalizeCountryCode('USA')).toBeNull();
    expect(normalizeCountryCode('U')).toBeNull();
    expect(normalizeCountryCode('')).toBeNull();
    expect(normalizeCountryCode('12')).toBeNull();
    expect(normalizeCountryCode(undefined)).toBeNull();
    expect(normalizeCountryCode(null)).toBeNull();
    expect(normalizeCountryCode(42)).toBeNull();
  });
});

describe('launch US shipping validation', () => {
  it('normalizes Colorado names and case variants', () => {
    expect(normalizeUsRegion('co')).toBe('CO');
    expect(normalizeUsRegion('Colorado')).toBe('CO');
  });

  it('accepts supported territories and rejects non-US or malformed ZIPs', () => {
    expect(validateUsShippingAddress({ country: 'US', region: 'PR', postal_code: '00901' })).toEqual([]);
    expect(validateUsShippingAddress({ country: 'CA', region: 'ON', postal_code: 'K1A 0B1' })).toContain(
      'We currently ship within the United States only'
    );
    expect(validateUsShippingAddress({ country: 'US', region: 'CO', postal_code: '80' })).toContain(
      'Enter a valid 5-digit US ZIP code'
    );
  });
});

describe('normalizeShippableAddress', () => {
  it('normalizes a full valid address (country uppercased, type shipping, optionals kept)', () => {
    expect(
      normalizeShippableAddress({
        line1: '1 Tea Rd',
        line2: 'Apt 2',
        city: 'Portland',
        region: 'OR',
        postal_code: '97201',
        country: 'us',
      })
    ).toEqual({
      type: 'shipping',
      line1: '1 Tea Rd',
      city: 'Portland',
      country: 'US',
      line2: 'Apt 2',
      region: 'OR',
      postal_code: '97201',
    });
  });

  it('trims fields and drops empty optionals', () => {
    expect(
      normalizeShippableAddress({
        line1: '  1 Tea Rd  ',
        line2: '   ',
        city: ' Portland ',
        region: '',
        country: 'US',
      })
    ).toEqual({ type: 'shipping', line1: '1 Tea Rd', city: 'Portland', country: 'US' });
  });

  it('returns null when a required field is missing', () => {
    expect(normalizeShippableAddress({ city: 'Portland', country: 'US' })).toBeNull(); // no line1
    expect(normalizeShippableAddress({ line1: '1 Tea Rd', country: 'US' })).toBeNull(); // no city
    expect(normalizeShippableAddress({ line1: '1 Tea Rd', city: 'Portland' })).toBeNull(); // no country
  });

  it('returns null when country is not a valid ISO-2 code', () => {
    expect(
      normalizeShippableAddress({ line1: '1 Tea Rd', city: 'Portland', country: 'United States' })
    ).toBeNull();
  });

  it('returns null on absent / non-object input', () => {
    expect(normalizeShippableAddress(undefined)).toBeNull();
    expect(normalizeShippableAddress(null)).toBeNull();
    expect(normalizeShippableAddress('not-an-object' as never)).toBeNull();
  });

  it('ignores non-string field values rather than throwing', () => {
    expect(
      normalizeShippableAddress({
        line1: 123 as never,
        city: 'Portland',
        country: 'US',
      })
    ).toBeNull();
  });
});

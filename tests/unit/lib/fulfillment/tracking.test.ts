// tests/unit/lib/fulfillment/tracking.test.ts
//
// Carrier normalization + tracking sanitization + carrier deep links (BMC-216A).
// These rules are APPROXIMATED (not exactly mirrored) by the SQL backfill in
// migrations/0022 — keep the two in sync, but see that file's header for the
// concrete inputs (e.g. a leading/embedded ASCII tab) where SQL and JS
// normalization diverge. Tracking values are customer-visible and end up in
// an href, so encoding and control-character handling are load-bearing, not
// cosmetic.

import { describe, it, expect } from 'vitest';
import {
  MAX_TRACKING_LENGTH,
  normalizeCarrier,
  normalizeLegacyCarrier,
  sanitizeTrackingNumber,
  buildTrackingUrl,
} from '@/lib/fulfillment/tracking';

describe('normalizeCarrier (strict API input)', () => {
  it('accepts the three carriers case-insensitively', () => {
    expect(normalizeCarrier('ups')).toBe('ups');
    expect(normalizeCarrier('UPS')).toBe('ups');
    expect(normalizeCarrier(' FedEx ')).toBe('fedex');
    expect(normalizeCarrier('Other')).toBe('other');
  });

  it('rejects anything that is not an exact carrier code', () => {
    expect(normalizeCarrier('dhl')).toBeNull();
    expect(normalizeCarrier('UPS Ground')).toBeNull();
    expect(normalizeCarrier('')).toBeNull();
    expect(normalizeCarrier(null)).toBeNull();
    expect(normalizeCarrier(undefined)).toBeNull();
    expect(normalizeCarrier(42)).toBeNull();
    expect(normalizeCarrier({ carrier: 'ups' })).toBeNull();
  });
});

describe('normalizeLegacyCarrier (lenient legacy/backfill)', () => {
  it('maps UPS variants to ups', () => {
    expect(normalizeLegacyCarrier('UPS')).toBe('ups');
    expect(normalizeLegacyCarrier('  ups ground ')).toBe('ups');
    expect(normalizeLegacyCarrier('U.P.S.')).toBe('ups');
    expect(normalizeLegacyCarrier('UPS 2nd Day Air')).toBe('ups');
    expect(normalizeLegacyCarrier('United Parcel Service')).toBe('ups');
  });

  it('maps FedEx variants to fedex', () => {
    expect(normalizeLegacyCarrier('FedEx')).toBe('fedex');
    expect(normalizeLegacyCarrier('fed-ex')).toBe('fedex');
    expect(normalizeLegacyCarrier('FedEx Home Delivery')).toBe('fedex');
    expect(normalizeLegacyCarrier('Federal Express')).toBe('fedex');
  });

  it('maps USPS variants to usps', () => {
    expect(normalizeLegacyCarrier('USPS')).toBe('usps');
    expect(normalizeLegacyCarrier('U.S.P.S.')).toBe('usps');
    expect(normalizeLegacyCarrier('USPS Priority Mail')).toBe('usps');
    expect(normalizeLegacyCarrier('United States Postal Service')).toBe('usps');
    expect(normalizeLegacyCarrier('US Postal Service')).toBe('usps');
  });

  it('does not confuse the ups and usps prefixes', () => {
    expect(normalizeLegacyCarrier('UPS')).toBe('ups');
    expect(normalizeLegacyCarrier('USPS')).toBe('usps');
    expect(normalizeLegacyCarrier('UPS Ground')).toBe('ups');
    expect(normalizeLegacyCarrier('USPS Ground Advantage')).toBe('usps');
  });

  it('maps any other non-empty value to other', () => {
    expect(normalizeLegacyCarrier('DHL Express')).toBe('other');
    expect(normalizeLegacyCarrier('some free text')).toBe('other');
    expect(normalizeLegacyCarrier('other')).toBe('other');
  });

  it('maps empty, whitespace, and non-strings to null', () => {
    expect(normalizeLegacyCarrier('')).toBeNull();
    expect(normalizeLegacyCarrier('   ')).toBeNull();
    expect(normalizeLegacyCarrier(null)).toBeNull();
    expect(normalizeLegacyCarrier(undefined)).toBeNull();
    expect(normalizeLegacyCarrier(7)).toBeNull();
  });
});

describe('sanitizeTrackingNumber', () => {
  it('trims and returns a plausible tracking number', () => {
    expect(sanitizeTrackingNumber('  1Z999AA10123456784  ')).toBe('1Z999AA10123456784');
  });

  it('strips control characters', () => {
    expect(sanitizeTrackingNumber('1Z999\u0000AA1\u001F0123\u007F456784')).toBe('1Z999AA10123456784');
    expect(sanitizeTrackingNumber('1Z999\nAA1\r0123456784')).toBe('1Z999AA10123456784');
  });

  it('strips bidi overrides and zero-width formatting characters', () => {
    // A right-to-left override reorders a tracking number visually in the admin
    // table and the shipping email without changing the stored bytes, so the
    // rendered value can disagree with what was saved.
    expect(sanitizeTrackingNumber('1Z999\u202eAA10123456784')).toBe('1Z999AA10123456784');
    expect(sanitizeTrackingNumber('\u2066\u20681Z999AA10123456784\u2069')).toBe('1Z999AA10123456784');
    // Zero-width joiners, word joiner and BOM are invisible padding, not data.
    expect(sanitizeTrackingNumber('1Z999\u200bAA1\u200d0123456784')).toBe('1Z999AA10123456784');
    expect(sanitizeTrackingNumber('\ufeff1Z999AA1\u20600123456784')).toBe('1Z999AA10123456784');
  });

  it('returns null for empty, whitespace-only, control-only, and non-string input', () => {
    expect(sanitizeTrackingNumber('')).toBeNull();
    expect(sanitizeTrackingNumber('    ')).toBeNull();
    expect(sanitizeTrackingNumber('\u202e\u200b\ufeff')).toBeNull();
    expect(sanitizeTrackingNumber('\u0000\u0001')).toBeNull();
    expect(sanitizeTrackingNumber(null)).toBeNull();
    expect(sanitizeTrackingNumber(undefined)).toBeNull();
    expect(sanitizeTrackingNumber(1234567890)).toBeNull();
  });

  it('rejects rather than truncates over-length input', () => {
    expect(MAX_TRACKING_LENGTH).toBe(100);
    expect(sanitizeTrackingNumber('A'.repeat(MAX_TRACKING_LENGTH))).toBe('A'.repeat(MAX_TRACKING_LENGTH));
    expect(sanitizeTrackingNumber('A'.repeat(MAX_TRACKING_LENGTH + 1))).toBeNull();
  });
});

describe('buildTrackingUrl', () => {
  it('builds a UPS link', () => {
    expect(buildTrackingUrl('ups', '1Z999AA10123456784')).toBe(
      'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
    );
  });

  it('builds a FedEx link', () => {
    expect(buildTrackingUrl('fedex', '123456789012')).toBe(
      'https://www.fedex.com/fedextrack/?trknbr=123456789012',
    );
  });

  it('URL-encodes the tracking value so it cannot break out of the query string', () => {
    expect(buildTrackingUrl('ups', 'a b&c=d#e')).toBe(
      'https://www.ups.com/track?loc=en_US&tracknum=a%20b%26c%3Dd%23e',
    );
    expect(buildTrackingUrl('fedex', '"><script>')).toBe(
      'https://www.fedex.com/fedextrack/?trknbr=%22%3E%3Cscript%3E',
    );
  });

  it('builds a USPS link', () => {
    expect(buildTrackingUrl('usps', '9400111899223197428490')).toBe(
      'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490',
    );
  });

  it('returns null when there is no link to build (never a search-engine URL)', () => {
    expect(buildTrackingUrl('other', '123456789012')).toBeNull();
    expect(buildTrackingUrl(null, '123456789012')).toBeNull();
    expect(buildTrackingUrl('ups', null)).toBeNull();
    expect(buildTrackingUrl(null, null)).toBeNull();
  });
});

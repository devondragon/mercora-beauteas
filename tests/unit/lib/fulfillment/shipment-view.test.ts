/**
 * BMC-240 — buildShipmentView is THE shared derivation for customer-facing
 * shipment display: normalizeLegacyCarrier → CARRIER_LABELS →
 * sanitizeTrackingNumber → buildTrackingUrl, in one pure helper.
 *
 * Both the guest order-status projection and the account order page consume
 * it, so these tests pin the exact semantics each call site previously
 * implemented inline. The downstream pages' own tests
 * (guest-projection.test.ts, account-order-detail.test.ts) remain the
 * end-to-end fence; this file is the unit fence on the extracted helper.
 */
import { describe, it, expect } from 'vitest';
import { buildShipmentView } from '@/lib/fulfillment/shipment-view';
import { MAX_TRACKING_LENGTH } from '@/lib/fulfillment/tracking';

describe('buildShipmentView — typed carrier codes', () => {
  it('derives the full UPS view from a shipped row', () => {
    const view = buildShipmentView({
      shipping_carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    });
    expect(view).toEqual({
      carrier: 'ups',
      carrierLabel: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      trackingUrl: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
    });
  });

  it('derives a FedEx view', () => {
    const view = buildShipmentView({
      shipping_carrier: 'fedex',
      tracking_number: '794611131',
    });
    expect(view.carrier).toBe('fedex');
    expect(view.carrierLabel).toBe('FedEx');
    expect(view.trackingUrl).toContain('fedex.com');
    expect(view.trackingUrl).toContain('794611131');
  });

  it('derives a USPS view', () => {
    const view = buildShipmentView({
      shipping_carrier: 'usps',
      tracking_number: '9400111899223197428490',
    });
    expect(view.carrier).toBe('usps');
    expect(view.carrierLabel).toBe('USPS');
    expect(view.trackingUrl).toContain('usps.com');
  });

  it('keeps the tracking number but produces NO link for "other"', () => {
    const view = buildShipmentView({
      shipping_carrier: 'other',
      tracking_number: 'DHL-123',
    });
    expect(view.carrier).toBe('other');
    expect(view.carrierLabel).toBe('Other');
    expect(view.trackingNumber).toBe('DHL-123');
    expect(view.trackingUrl).toBeNull();
  });
});

describe('buildShipmentView — legacy raw carrier strings', () => {
  it('prefix-matches a legacy free-text carrier that escaped the 0022 backfill', () => {
    const view = buildShipmentView({
      shipping_carrier: 'UPS Ground',
      tracking_number: '1Z999AA10123456784',
    });
    expect(view.carrier).toBe('ups');
    expect(view.carrierLabel).toBe('UPS');
    expect(view.trackingUrl).toContain('ups.com');
  });

  it('degrades an unmappable legacy carrier to "other" with no link', () => {
    const view = buildShipmentView({
      shipping_carrier: 'DHL Express',
      tracking_number: 'JD0123456789',
    });
    expect(view.carrier).toBe('other');
    expect(view.carrierLabel).toBe('Other');
    expect(view.trackingNumber).toBe('JD0123456789');
    expect(view.trackingUrl).toBeNull();
  });
});

describe('buildShipmentView — null / missing carrier', () => {
  it('returns all-null carrier fields when shipping_carrier is null', () => {
    const view = buildShipmentView({
      shipping_carrier: null,
      tracking_number: '1Z999AA10123456784',
    });
    expect(view.carrier).toBeNull();
    expect(view.carrierLabel).toBeNull();
    // A sanitized tracking number is still surfaced for display…
    expect(view.trackingNumber).toBe('1Z999AA10123456784');
    // …but no URL can be derived without a carrier.
    expect(view.trackingUrl).toBeNull();
  });

  it('treats an absent shipping_carrier field the same as null', () => {
    const view = buildShipmentView({ tracking_number: '1Z999AA10123456784' });
    expect(view.carrier).toBeNull();
    expect(view.carrierLabel).toBeNull();
    expect(view.trackingUrl).toBeNull();
  });

  it('returns the all-null view for a never-shipped row', () => {
    expect(buildShipmentView({ shipping_carrier: null, tracking_number: null })).toEqual({
      carrier: null,
      carrierLabel: null,
      trackingNumber: null,
      trackingUrl: null,
    });
  });

  it('returns the all-null view for an entirely empty input object', () => {
    expect(buildShipmentView({})).toEqual({
      carrier: null,
      carrierLabel: null,
      trackingNumber: null,
      trackingUrl: null,
    });
  });
});

describe('buildShipmentView — tracking number sanitization', () => {
  it('strips a bidi override before both display and the derived href', () => {
    // Escape sequence rather than a literal invisible codepoint in the source:
    // a raw U+202E in a fixture is indistinguishable by eye from an
    // already-clean one and regresses silently under editor normalization.
    const view = buildShipmentView({
      shipping_carrier: 'ups',
      tracking_number: '1Z999\u202E48765432101AA999Z1',
    });
    expect(view.trackingNumber).toBe('1Z99948765432101AA999Z1');
    expect(view.trackingUrl).toContain('1Z99948765432101AA999Z1');
    expect(view.trackingUrl).not.toContain('%E2%80%AE');
  });

  it('nulls an over-length tracking number (and its link) rather than truncating', () => {
    const view = buildShipmentView({
      shipping_carrier: 'ups',
      tracking_number: 'X'.repeat(MAX_TRACKING_LENGTH + 1),
    });
    expect(view.trackingNumber).toBeNull();
    expect(view.trackingUrl).toBeNull();
    // The carrier fields are independent of the tracking number.
    expect(view.carrier).toBe('ups');
    expect(view.carrierLabel).toBe('UPS');
  });

  it('nulls a tracking number that is pure control/spoofing characters', () => {
    const view = buildShipmentView({
      shipping_carrier: 'ups',
      tracking_number: '\u202E\u200B\u00AD',
    });
    expect(view.trackingNumber).toBeNull();
    expect(view.trackingUrl).toBeNull();
  });

  it('produces no URL when the tracking number is null even for a linkable carrier', () => {
    const view = buildShipmentView({ shipping_carrier: 'ups', tracking_number: null });
    expect(view.carrier).toBe('ups');
    expect(view.carrierLabel).toBe('UPS');
    expect(view.trackingNumber).toBeNull();
    expect(view.trackingUrl).toBeNull();
  });
});

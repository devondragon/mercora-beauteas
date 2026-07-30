// tests/unit/lib/fulfillment/transitions.test.ts
//
// The fulfillment transition matrix (BMC-216A). Only paid + processing orders
// can be newly shipped; an already-shipped order is either an idempotent retry
// or a conflict. This module is the single source of truth for those decisions
// and imports no D1/Next/Clerk/Resend.

import { describe, it, expect } from 'vitest';
import {
  parseShipmentInput,
  shipmentDataEqual,
  decideShipment,
  canEditTracking,
  type OrderFulfillmentSnapshot,
} from '@/lib/fulfillment/transitions';
import { MAX_TRACKING_LENGTH } from '@/lib/fulfillment/tracking';
import type { ShipmentInput } from '@/lib/fulfillment/types';

function snapshot(over: Partial<OrderFulfillmentSnapshot> = {}): OrderFulfillmentSnapshot {
  return {
    status: 'processing',
    payment_status: 'paid',
    shipping_carrier: null,
    tracking_number: null,
    ...over,
  };
}

const UNTRACKED: ShipmentInput = { carrier: null, trackingNumber: null };
const UPS: ShipmentInput = { carrier: 'ups', trackingNumber: '1Z999AA10123456784' };

describe('parseShipmentInput', () => {
  it('accepts an empty body as a valid untracked shipment', () => {
    expect(parseShipmentInput({})).toEqual({ ok: true, input: { carrier: null, trackingNumber: null } });
  });

  it('accepts explicit nulls as a valid untracked shipment', () => {
    expect(parseShipmentInput({ carrier: null, trackingNumber: null })).toEqual({
      ok: true,
      input: { carrier: null, trackingNumber: null },
    });
  });

  it('accepts a full carrier + tracking pair and sanitizes the tracking number', () => {
    expect(parseShipmentInput({ carrier: 'UPS', trackingNumber: '  1Z999AA10123456784 ' })).toEqual({
      ok: true,
      input: { carrier: 'ups', trackingNumber: '1Z999AA10123456784' },
    });
  });

  it('rejects a tracking number with no carrier', () => {
    const result = parseShipmentInput({ trackingNumber: '1Z999AA10123456784' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/carrier/i);
  });

  it('rejects a carrier with no tracking number', () => {
    const result = parseShipmentInput({ carrier: 'ups' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/trackingNumber/i);
  });

  it('rejects an unknown carrier', () => {
    const result = parseShipmentInput({ carrier: 'usps', trackingNumber: '9400111899223197428490' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/carrier/i);
  });

  it('rejects tracking input that sanitizes to nothing or is over-length', () => {
    expect(parseShipmentInput({ carrier: 'ups', trackingNumber: '\u0000\u0001' }).ok).toBe(false);
    expect(
      parseShipmentInput({ carrier: 'ups', trackingNumber: 'A'.repeat(MAX_TRACKING_LENGTH + 1) }).ok,
    ).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(parseShipmentInput(null).ok).toBe(false);
    expect(parseShipmentInput('ups').ok).toBe(false);
    expect(parseShipmentInput([]).ok).toBe(false);
  });

  it('ignores unknown keys rather than trusting them', () => {
    expect(parseShipmentInput({ status: 'shipped', shipped_at: '2020-01-01', trackingUrl: 'http://evil' })).toEqual({
      ok: true,
      input: { carrier: null, trackingNumber: null },
    });
  });
});

describe('shipmentDataEqual', () => {
  it('compares tracking numbers case-insensitively and carriers exactly', () => {
    expect(shipmentDataEqual(UPS, { carrier: 'ups', trackingNumber: '1z999aa10123456784' })).toBe(true);
    expect(shipmentDataEqual(UPS, { carrier: 'fedex', trackingNumber: '1Z999AA10123456784' })).toBe(false);
    expect(shipmentDataEqual(UPS, { carrier: 'ups', trackingNumber: '1Z999AA10123456785' })).toBe(false);
  });

  it('treats two untracked shipments as equal', () => {
    expect(shipmentDataEqual(UNTRACKED, { carrier: null, trackingNumber: null })).toBe(true);
    expect(shipmentDataEqual(UNTRACKED, UPS)).toBe(false);
  });
});

describe('decideShipment', () => {
  it('ships a paid processing order', () => {
    expect(decideShipment(snapshot(), UPS)).toEqual({ kind: 'ship' });
    expect(decideShipment(snapshot(), UNTRACKED)).toEqual({ kind: 'ship' });
  });

  it('refuses a processing order that is not paid', () => {
    expect(decideShipment(snapshot({ payment_status: 'pending' }), UPS)).toEqual({
      kind: 'not_fulfillable',
      status: 'processing',
      paymentStatus: 'pending',
    });
    expect(decideShipment(snapshot({ payment_status: null }), UPS)).toEqual({
      kind: 'not_fulfillable',
      status: 'processing',
      paymentStatus: null,
    });
  });

  it('refuses pending, delivered, cancelled, and refunded orders', () => {
    for (const status of ['pending', 'delivered', 'cancelled', 'refunded']) {
      expect(decideShipment(snapshot({ status }), UPS)).toEqual({
        kind: 'not_fulfillable',
        status,
        paymentStatus: 'paid',
      });
    }
  });

  it('is idempotent for a shipped order with identical data', () => {
    const shipped = snapshot({
      status: 'shipped',
      shipping_carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    });
    expect(decideShipment(shipped, UPS)).toEqual({ kind: 'idempotent' });
    expect(decideShipment(shipped, { carrier: 'ups', trackingNumber: '1z999aa10123456784' })).toEqual({
      kind: 'idempotent',
    });
  });

  it('is idempotent for a shipped untracked order retried untracked', () => {
    expect(decideShipment(snapshot({ status: 'shipped' }), UNTRACKED)).toEqual({ kind: 'idempotent' });
  });

  it('normalizes a legacy stored carrier before comparing', () => {
    const shipped = snapshot({
      status: 'shipped',
      shipping_carrier: 'UPS Ground',
      tracking_number: '1Z999AA10123456784',
    });
    expect(decideShipment(shipped, UPS)).toEqual({ kind: 'idempotent' });
  });

  it('conflicts for a shipped order with different data', () => {
    const shipped = snapshot({
      status: 'shipped',
      shipping_carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    });
    expect(decideShipment(shipped, { carrier: 'fedex', trackingNumber: '123456789012' })).toEqual({
      kind: 'conflict',
    });
    expect(decideShipment(shipped, UNTRACKED)).toEqual({ kind: 'conflict' });
  });
});

describe('canEditTracking', () => {
  it('allows tracking correction only after shipment', () => {
    expect(canEditTracking(snapshot({ status: 'shipped' }))).toBe(true);
    expect(canEditTracking(snapshot({ status: 'processing' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'delivered' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'cancelled' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'refunded' }))).toBe(false);
    expect(canEditTracking(snapshot({ status: 'pending' }))).toBe(false);
  });
});

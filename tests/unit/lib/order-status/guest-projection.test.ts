/**
 * BMC-216E — the guest order-status projection IS the allowlist.
 *
 * A guest reaches /order-status/<id> with a bearer token in a URL that lands in
 * browser history, shared screenshots, and (absent our no-referrer policy) the
 * Referer header of an outbound carrier link. So the projection must expose the
 * bare minimum: order number, dates, status, shipment, item names + quantities.
 * These tests assert the forbidden fields are STRUCTURALLY ABSENT — a future
 * "just add the total" edit fails here, not in a code review.
 */
import { describe, it, expect } from 'vitest';
import { buildGuestOrderProjection } from '@/lib/order-status/guest-projection';

const EXPECTED_KEYS = [
  'carrier',
  'carrierLabel',
  'items',
  'orderNumber',
  'placedAt',
  'shippedAt',
  'status',
  'trackingNumber',
  'trackingUrl',
];

// Deliberately rich: every field here that is NOT in EXPECTED_KEYS is something
// the projection must drop.
const fullOrder = {
  id: 'WEB-GUEST-1753900000000',
  customer_id: null,
  status: 'shipped',
  payment_status: 'paid',
  payment_method: 'stripe',
  total_amount: { amount: 4200, currency: 'USD' },
  currency_code: 'USD',
  shipping_address: {
    line1: '1 Secret St',
    city: 'Portland',
    region: 'OR',
    postal_code: '97201',
    country: 'US',
    email: 'guest@example.com',
  },
  billing_address: { line1: '1 Secret St', city: 'Portland' },
  items: [
    { product_id: 'p1', sku: 'MB-1', product_name: 'Morning Blend', quantity: 2, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 4200, currency: 'USD' } },
    { product_id: 'p2', sku: 'EB-1', product_name: 'Evening Blend', quantity: 1, unit_price: { amount: 2100, currency: 'USD' }, total_price: { amount: 2100, currency: 'USD' } },
  ],
  shipping_method: 'standard',
  notes: 'INTERNAL: customer called about a refund',
  external_references: { payment_intent_id: 'pi_secret_123' },
  extensions: { email: 'guest@example.com', refundLedger: [{ amount: 100 }], carrier: 'USPS' },
  shipping_carrier: 'ups',
  tracking_number: '1Z999AA10123456784',
  shipped_at: '2026-07-28T18:00:00.000Z',
  delivered_at: null,
  created_at: '2026-07-25T12:00:00.000Z',
  updated_at: '2026-07-28T18:00:00.000Z',
};

describe('buildGuestOrderProjection — allowlist', () => {
  it('exposes exactly the allowed keys and nothing else', () => {
    const view = buildGuestOrderProjection(fullOrder);
    expect(Object.keys(view).sort()).toEqual(EXPECTED_KEYS);
  });

  it('omits addresses, totals, payment data, notes and extensions structurally', () => {
    const view = buildGuestOrderProjection(fullOrder) as unknown as Record<string, unknown>;
    for (const forbidden of [
      'shipping_address',
      'billing_address',
      'total_amount',
      'currency_code',
      'payment_method',
      'payment_status',
      'notes',
      'extensions',
      'external_references',
      'customer_id',
      'shipping_method',
    ]) {
      expect(view).not.toHaveProperty(forbidden);
    }
  });

  it('leaks no forbidden VALUES through the serialized projection', () => {
    const serialized = JSON.stringify(buildGuestOrderProjection(fullOrder));
    for (const secret of ['Secret St', 'Portland', '97201', 'guest@example.com', 'pi_secret_123', 'INTERNAL', 'refundLedger', '4200', 'MB-1']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('projects items down to name + quantity only', () => {
    const view = buildGuestOrderProjection(fullOrder);
    expect(view.items).toEqual([
      { name: 'Morning Blend', quantity: 2 },
      { name: 'Evening Blend', quantity: 1 },
    ]);
    expect(Object.keys(view.items[0]).sort()).toEqual(['name', 'quantity']);
  });
});

describe('buildGuestOrderProjection — shipment fields', () => {
  it('derives a UPS tracking link from the shipping_carrier column', () => {
    const view = buildGuestOrderProjection(fullOrder);
    expect(view.carrier).toBe('ups');
    expect(view.carrierLabel).toBe('UPS');
    expect(view.trackingNumber).toBe('1Z999AA10123456784');
    expect(view.trackingUrl).toContain('ups.com');
    expect(view.trackingUrl).toContain('1Z999AA10123456784');
  });

  it('derives a FedEx tracking link', () => {
    const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'fedex', tracking_number: '794611131' });
    expect(view.carrierLabel).toBe('FedEx');
    expect(view.trackingUrl).toContain('fedex.com');
  });

  it('derives a USPS tracking link', () => {
    const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'usps', tracking_number: '9400111899223197428490' });
    expect(view.carrier).toBe('usps');
    expect(view.carrierLabel).toBe('USPS');
    expect(view.trackingUrl).toContain('usps.com');
  });

  it('shows an "other" carrier tracking number with NO link', () => {
    const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'other', tracking_number: 'DHL-123' });
    expect(view.carrier).toBe('other');
    expect(view.carrierLabel).toBe('Other');
    expect(view.trackingNumber).toBe('DHL-123');
    expect(view.trackingUrl).toBeNull();
  });

  it('normalizes a legacy free-text carrier that escaped the 0022 backfill', () => {
    // Per the BMC-216 interface contract, normalizeLegacyCarrier does a
    // compact-token PREFIX match, so "UPS Ground" resolves to "ups" (and keeps
    // its deep link) rather than degrading to "other".
    const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'UPS Ground' });
    expect(view.carrier).toBe('ups');
    expect(view.carrierLabel).toBe('UPS');
    expect(view.trackingUrl).toContain('ups.com');
  });

  it('degrades an unmappable legacy carrier to "other" with no link', () => {
    const view = buildGuestOrderProjection({ ...fullOrder, shipping_carrier: 'DHL Express' });
    expect(view.carrier).toBe('other');
    expect(view.carrierLabel).toBe('Other');
    expect(view.trackingUrl).toBeNull();
  });

  it('never reads extensions.carrier or extensions.trackingUrl', () => {
    // Hoisted to a variable so the forbidden `extensions` key is carried on a
    // non-fresh value — GuestProjectionOrder does not declare it, and that is
    // the point: the projection must ignore it, not accept it.
    const orderWithLegacyExtensions = {
      ...fullOrder,
      shipping_carrier: null,
      extensions: { carrier: 'ups', trackingUrl: 'https://evil.example.com/track' },
    };
    const view = buildGuestOrderProjection(orderWithLegacyExtensions);
    expect(view.carrier).toBeNull();
    expect(view.carrierLabel).toBeNull();
    expect(view.trackingUrl).toBeNull();
  });

  it('returns null shipment fields for an order that never shipped', () => {
    const view = buildGuestOrderProjection({
      ...fullOrder,
      status: 'processing',
      shipping_carrier: null,
      tracking_number: null,
      shipped_at: null,
    });
    expect(view.shippedAt).toBeNull();
    expect(view.carrier).toBeNull();
    expect(view.trackingNumber).toBeNull();
    expect(view.trackingUrl).toBeNull();
    expect(view.status).toBe('processing');
  });

  it('tolerates a sparse order row without throwing', () => {
    const view = buildGuestOrderProjection({ status: 'pending' });
    expect(view.orderNumber).toBe('');
    expect(view.placedAt).toBeNull();
    expect(view.items).toEqual([]);
  });

  it('strips a bidi override embedded in the tracking number before rendering', () => {
    // A legacy row's tracking_number is not guaranteed to have passed through
    // sanitizeTrackingNumber (only the new fulfillment write path enforces
    // it) — this is a bearer-token page a stranger can load, so the
    // projection must never hand back an unsanitized value.
    const view = buildGuestOrderProjection({
      ...fullOrder,
      tracking_number: '1Z999‮48765432101AA999Z1',
    });
    expect(view.trackingNumber).toBe('1Z99948765432101AA999Z1');
  });

  it('nulls an over-length tracking number rather than truncating it', () => {
    const view = buildGuestOrderProjection({ ...fullOrder, tracking_number: 'X'.repeat(101) });
    expect(view.trackingNumber).toBeNull();
    expect(view.trackingUrl).toBeNull();
  });
});

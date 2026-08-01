/**
 * BMC-216D: the admin queue's view-model. All row-state / tab / list-update
 * logic lives here (rather than inside JSX) so it is unit-testable — the repo
 * has no component-rendering test library and this ticket does not add one.
 */
import { describe, it, expect } from 'vitest';
import {
  QUEUE_VIEWS,
  QUEUE_VIEW_LABELS,
  CARRIER_LABELS,
  deriveQueueRowState,
  formatTabCount,
  buildQueueQueryString,
  applyShipmentResult,
  mergeFulfillmentFields,
  type QueueOrderLike,
} from '@/lib/fulfillment/queue-view';

const base: QueueOrderLike = {
  id: 'WEB-1',
  status: 'processing',
  payment_status: 'paid',
  shipping_carrier: null,
  tracking_number: null,
  shipped_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
};

describe('queue views', () => {
  it('exposes the four contracted views with labels', () => {
    expect([...QUEUE_VIEWS]).toEqual(['awaiting', 'shipped', 'cancelled', 'all']);
    expect(QUEUE_VIEW_LABELS.awaiting).toBe('Awaiting shipment');
    expect(QUEUE_VIEW_LABELS.cancelled).toBe('Cancelled / refunded');
  });
});

describe('deriveQueueRowState', () => {
  it('offers Mark shipped only for a paid processing order', () => {
    expect(deriveQueueRowState(base).action).toBe('mark_shipped');
    expect(deriveQueueRowState({ ...base, payment_status: 'pending' }).action).toBe('none');
    expect(deriveQueueRowState({ ...base, status: 'pending' }).action).toBe('none');
  });

  it('offers Edit tracking for a shipped order and nothing for terminal states', () => {
    expect(deriveQueueRowState({ ...base, status: 'shipped' }).action).toBe('edit_tracking');
    expect(deriveQueueRowState({ ...base, status: 'delivered' }).action).toBe('none');
    expect(deriveQueueRowState({ ...base, status: 'refunded' }).action).toBe('none');
  });

  it('derives the carrier label and tracking link from stored carrier data', () => {
    const state = deriveQueueRowState({
      ...base,
      status: 'shipped',
      shipping_carrier: 'ups',
      tracking_number: ' 1Z999AA1 ',
      shipped_at: '2026-07-03T12:00:00.000Z',
    });
    expect(state.carrier).toBe('ups');
    expect(state.carrierLabel).toBe(CARRIER_LABELS.ups);
    expect(state.trackingNumber).toBe('1Z999AA1');
    expect(state.trackingUrl).toContain('ups.com');
    expect(state.shippedAt).toBe('2026-07-03T12:00:00.000Z');
  });

  it('supports every carrier the fulfillment domain ships with', () => {
    const usps = deriveQueueRowState({
      ...base,
      status: 'shipped',
      shipping_carrier: 'usps',
      tracking_number: '9400111',
    });
    expect(usps.carrierLabel).toBe(CARRIER_LABELS.usps);
    expect(usps.trackingUrl).toContain('usps.com');
  });

  it('renders an "other" carrier as a bare tracking number with no link', () => {
    const state = deriveQueueRowState({
      ...base,
      status: 'shipped',
      shipping_carrier: 'other',
      tracking_number: 'ABC123',
    });
    expect(state.carrierLabel).toBe('Other');
    expect(state.trackingUrl).toBeNull();
  });

  it('reports no tracking when the stored number is blank', () => {
    const state = deriveQueueRowState({ ...base, status: 'shipped', tracking_number: '   ' });
    expect(state.trackingNumber).toBeNull();
    expect(state.trackingUrl).toBeNull();
  });
});

describe('formatTabCount', () => {
  it('formats plain counts and caps at 99+', () => {
    expect(formatTabCount(0)).toBe('0');
    expect(formatTabCount(7)).toBe('7');
    expect(formatTabCount(99)).toBe('99');
    expect(formatTabCount(1200)).toBe('99+');
    expect(formatTabCount(Number.NaN)).toBe('0');
  });
});

describe('buildQueueQueryString', () => {
  it('always sends view/limit/offset and omits an empty search', () => {
    expect(buildQueueQueryString({ view: 'awaiting', limit: 20, offset: 0 })).toBe(
      'view=awaiting&limit=20&offset=0',
    );
    expect(buildQueueQueryString({ view: 'all', q: '  ada  ', limit: 20, offset: 40 })).toBe(
      'view=all&q=ada&limit=20&offset=40',
    );
  });
});

describe('applyShipmentResult', () => {
  const rows: QueueOrderLike[] = [base, { ...base, id: 'WEB-2' }];

  it('removes a newly shipped order from the awaiting queue', () => {
    const updated = { ...base, status: 'shipped', shipped_at: '2026-07-03T00:00:00.000Z' };
    const next = applyShipmentResult(rows, 'awaiting', updated);
    expect(next.map((r) => r.id)).toEqual(['WEB-2']);
  });

  it('replaces the row in place on every non-awaiting view', () => {
    const updated = { ...base, status: 'shipped', tracking_number: '1Z' };
    const next = applyShipmentResult(rows, 'all', updated);
    expect(next.map((r) => r.id)).toEqual(['WEB-1', 'WEB-2']);
    expect(next[0].status).toBe('shipped');
    expect(next[0].tracking_number).toBe('1Z');
  });
});

describe('mergeFulfillmentFields', () => {
  // The queue row holds the MACH wire shape (major units). Since BMC-233 the
  // ship/tracking routes emit that same shape, but the merge stays narrow on
  // purpose: a response's money must never overwrite the row's, whatever shape
  // the response arrives in.
  const wireRow = {
    ...base,
    total_amount: { amount: 25, currency: 'USD', precision: 2 },
    currency_code: 'USD',
    items: [{ product_name: 'Morning Blend', quantity: 1 }],
    shipping_address: { recipient: 'Ada Lovelace' },
  };

  it('keeps the row total even if a response order carries minor-unit money', () => {
    const merged = mergeFulfillmentFields(wireRow, {
      id: 'WEB-1',
      status: 'shipped',
      payment_status: 'paid',
      shipping_carrier: 'ups',
      tracking_number: '1Z999',
      shipped_at: '2026-07-03T00:00:00.000Z',
      // Pre-BMC-233 shape, kept as the adversarial input: a naive wholesale
      // replace would carry this 2500 into the row and render $2,500.00.
      ...({ total_amount: { amount: 2500, currency: 'USD' } } as Record<string, unknown>),
    } as never);

    expect(merged.total_amount).toEqual({ amount: 25, currency: 'USD', precision: 2 });
    expect(merged.status).toBe('shipped');
    expect(merged.shipping_carrier).toBe('ups');
    expect(merged.tracking_number).toBe('1Z999');
    expect(merged.shipped_at).toBe('2026-07-03T00:00:00.000Z');
    expect(merged.shipping_address?.recipient).toBe('Ada Lovelace');
  });

  it('clears carrier/tracking when the response cleared them', () => {
    const shipped = { ...wireRow, shipping_carrier: 'ups', tracking_number: '1Z999' };
    const merged = mergeFulfillmentFields(shipped, {
      id: 'WEB-1',
      status: 'shipped',
      shipping_carrier: null,
      tracking_number: null,
    });
    expect(merged.shipping_carrier).toBeNull();
    expect(merged.tracking_number).toBeNull();
  });

  it('returns the row untouched when there is no response order', () => {
    expect(mergeFulfillmentFields(wireRow, undefined)).toBe(wireRow);
  });
});

// tests/unit/lib/fulfillment/types.test.ts
//
// Pins the fulfillment vocabulary (BMC-216A). These constants are the contract
// between the migration backfill, the transition matrix, the audit table, and
// the admin UI — a silent rename or reordering breaks all of them at once.

import { describe, it, expect } from 'vitest';
import {
  CARRIERS,
  ORDER_EVENT_TYPES,
  type Carrier,
  type OrderEventType,
  type ActorType,
  type Actor,
  type ShipmentInput,
} from '@/lib/fulfillment/types';

describe('fulfillment types', () => {
  it('exposes exactly the four application carriers', () => {
    expect(CARRIERS).toEqual(['ups', 'fedex', 'usps', 'other']);
  });

  it('exposes exactly the five initial order event types', () => {
    expect(ORDER_EVENT_TYPES).toEqual([
      'shipment_created',
      'tracking_updated',
      'shipping_email_sent',
      'shipping_email_failed',
      'shipping_email_resent',
    ]);
  });

  it('types derive from the constant arrays', () => {
    const carrier: Carrier = 'ups';
    const eventType: OrderEventType = 'shipment_created';
    const actorType: ActorType = 'admin';
    expect(CARRIERS).toContain(carrier);
    expect(ORDER_EVENT_TYPES).toContain(eventType);
    expect(['admin', 'service', 'system']).toContain(actorType);
  });

  it('models an admin actor, a service actor, and a system actor', () => {
    const admin: Actor = { type: 'admin', id: 'user_123' };
    const service: Actor = { type: 'service', id: 'api-token' };
    const system: Actor = { type: 'system', id: null };
    expect([admin.type, service.type, system.type]).toEqual(['admin', 'service', 'system']);
    expect(system.id).toBeNull();
  });

  it('models tracked and untracked shipment input', () => {
    const untracked: ShipmentInput = { carrier: null, trackingNumber: null };
    const tracked: ShipmentInput = { carrier: 'fedex', trackingNumber: '123456789012' };
    expect(untracked.carrier).toBeNull();
    expect(tracked.trackingNumber).toBe('123456789012');
  });
});

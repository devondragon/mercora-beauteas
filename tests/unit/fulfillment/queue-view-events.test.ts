/**
 * BMC-216D: email retry/resend state + the audit timeline's human-readable
 * rendering. The spec forbids showing raw event JSON, so that is asserted here.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveEmailState,
  formatFulfillmentEvent,
  formatFulfillmentTimeline,
  type FulfillmentEventLike,
} from '@/lib/fulfillment/queue-view';

const event = (
  overrides: Partial<FulfillmentEventLike> & Pick<FulfillmentEventLike, 'id' | 'type'>,
): FulfillmentEventLike => ({
  actorType: 'admin',
  actorId: 'user_admin',
  fromStatus: null,
  toStatus: null,
  details: null,
  createdAt: '2026-07-03T12:00:00.000Z',
  ...overrides,
});

describe('deriveEmailState', () => {
  it('reports the never-attempted state with a retry-mode action', () => {
    const state = deriveEmailState([event({ id: 'e1', type: 'shipment_created' })]);
    expect(state.kind).toBe('never_attempted');
    expect(state.mode).toBe('retry');
  });

  it('shows a retry action and the error after a failed send', () => {
    const state = deriveEmailState([
      event({ id: 'e1', type: 'shipment_created' }),
      event({ id: 'e2', type: 'shipping_email_failed', details: { error: 'resend 500' } }),
    ]);
    expect(state.kind).toBe('failed');
    expect(state.mode).toBe('retry');
    expect(state.actionLabel).toBe('Retry email');
    expect(state.lastError).toBe('resend 500');
  });

  it('switches to resend mode once a send has succeeded', () => {
    const state = deriveEmailState([
      event({ id: 'e1', type: 'shipping_email_failed', details: { error: 'boom' } }),
      event({ id: 'e2', type: 'shipping_email_sent', details: { idempotencyKey: 'k' } }),
    ]);
    expect(state.kind).toBe('sent');
    expect(state.mode).toBe('resend');
    expect(state.actionLabel).toBe('Resend email');
    expect(state.lastError).toBeNull();
  });

  it('stays in resend mode when a later resend fails, but shows failed — not a stale sent', () => {
    const state = deriveEmailState([
      event({ id: 'e1', type: 'shipping_email_sent' }),
      event({ id: 'e2', type: 'shipping_email_failed', details: { error: 'later boom' } }),
    ]);
    // The mode must still be resend (server's hasSuccessfulSend rule), but the
    // banner must reflect the LATEST attempt, which failed — a UI that only
    // checked "was any send ever successful" would wrongly show green "sent".
    expect(state.mode).toBe('resend');
    expect(state.kind).toBe('failed');
    expect(state.lastError).toBe('later boom');
  });

  it('shows sent again after a resend succeeds following an earlier failure', () => {
    const state = deriveEmailState([
      event({ id: 'e1', type: 'shipping_email_sent' }),
      event({ id: 'e2', type: 'shipping_email_failed', details: { error: 'boom' } }),
      event({ id: 'e3', type: 'shipping_email_resent' }),
    ]);
    expect(state.kind).toBe('sent');
    expect(state.mode).toBe('resend');
    expect(state.lastError).toBeNull();
  });
});

describe('formatFulfillmentEvent', () => {
  it('renders shipment_created with carrier, tracking and the status move', () => {
    const entry = formatFulfillmentEvent(
      event({
        id: 'e1',
        type: 'shipment_created',
        fromStatus: 'processing',
        toStatus: 'shipped',
        details: { carrier: 'ups', trackingNumber: '1Z999', trackingUrl: 'https://ups' },
      }),
    );
    expect(entry.title).toBe('Marked shipped');
    expect(entry.tone).toBe('success');
    expect(entry.details).toContain('Carrier: UPS');
    expect(entry.details).toContain('Tracking: 1Z999');
    expect(entry.details).toContain('Status: processing → shipped');
  });

  it('renders tracking_updated with old and new carrier + tracking', () => {
    const entry = formatFulfillmentEvent(
      event({
        id: 'e2',
        type: 'tracking_updated',
        details: {
          previous: { carrier: 'ups', trackingNumber: '1Z111' },
          next: { carrier: 'fedex', trackingNumber: '7777' },
        },
      }),
    );
    expect(entry.title).toBe('Tracking updated');
    expect(entry.details).toContain('Carrier: UPS → FedEx');
    expect(entry.details).toContain('Tracking: 1Z111 → 7777');
  });

  it('describes an absent previous carrier in words, not as null', () => {
    const entry = formatFulfillmentEvent(
      event({
        id: 'e3',
        type: 'tracking_updated',
        details: { previous: {}, next: { carrier: 'ups', trackingNumber: '1Z' } },
      }),
    );
    expect(entry.details).toContain('Carrier: no carrier → UPS');
    expect(entry.details).toContain('Tracking: no tracking number → 1Z');
  });

  it('flags a failed email with its error and an error tone', () => {
    const entry = formatFulfillmentEvent(
      event({ id: 'e4', type: 'shipping_email_failed', details: { error: 'resend 500' } }),
    );
    expect(entry.title).toBe('Shipping email failed');
    expect(entry.tone).toBe('error');
    expect(entry.details).toContain('Error: resend 500');
  });

  it('names the actor', () => {
    const entry = formatFulfillmentEvent(
      event({ id: 'e5', type: 'shipping_email_sent', actorType: 'service', actorId: 'api-token' }),
    );
    expect(entry.actor).toBe('Service token (api-token)');
  });

  it('never leaks raw event JSON into the rendered strings', () => {
    const entries = formatFulfillmentTimeline([
      event({
        id: 'e1',
        type: 'shipment_created',
        details: { carrier: 'ups', trackingNumber: '1Z', trackingUrl: 'https://ups' },
      }),
      event({ id: 'e2', type: 'shipping_email_sent', details: { idempotencyKey: 'k/initial' } }),
    ]);
    const rendered = entries.flatMap((entry) => [entry.title, entry.actor, ...entry.details]).join(' ');
    expect(rendered).not.toContain('{');
    expect(rendered).not.toContain('idempotencyKey');
    expect(rendered).not.toContain('trackingUrl');
  });

  it('degrades gracefully on an unknown event type', () => {
    const entry = formatFulfillmentEvent(event({ id: 'e9', type: 'something_new' }));
    expect(entry.title).toBe('Fulfillment update');
    expect(entry.tone).toBe('info');
  });
});

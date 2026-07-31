/**
 * BMC-216C — sendInitialShippingEmail seam.
 *
 * The ship route calls this AFTER the shipment has already committed, so the
 * contract is: never throw, never mutate order state, always record an audit
 * event for an attempted send, and use the stable `initial` idempotency key so
 * a duplicated call cannot double-send.
 *
 * D1 is never touched: the fulfillment service is mocked, the Resend transport
 * is mocked, and the pure token/tracking/email-resolution modules run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMock, recordEmailEventMock, shipOrderMock, updateTrackingMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
  recordEmailEventMock: vi.fn().mockResolvedValue('evt-1'),
  shipOrderMock: vi.fn(),
  updateTrackingMock: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock('@/lib/fulfillment/service', () => ({
  recordEmailEvent: recordEmailEventMock,
  shipOrder: shipOrderMock,
  updateTracking: updateTrackingMock,
  listOrderEvents: vi.fn().mockResolvedValue([]),
}));

import { sendInitialShippingEmail } from '@/lib/fulfillment/shipping-email';
import type { Order } from '@/lib/types/order';
import type { Actor } from '@/lib/fulfillment/types';

type TestOrder = Order & { shipping_carrier?: string | null };

const ACTOR: Actor = { type: 'admin', id: 'user_admin_1' };

/**
 * ORDER_STATUS_SECRET is rejected below 32 chars by lib/order-status/token.ts
 * (MIN_SECRET_LENGTH) — a shorter fixture would silently make every guest-link
 * assertion pass for the wrong reason (unconfigured, not signed).
 */
const TEST_SECRET = 'unit-test-order-status-secret-0123456789';

function baseOrder(overrides: Partial<TestOrder> = {}): TestOrder {
  return {
    id: 'ORD-1',
    status: 'shipped',
    payment_status: 'paid',
    currency_code: 'USD',
    total_amount: { amount: 2500, currency: 'USD', precision: 2 },
    items: [
      {
        product_id: 'p1',
        sku: 'SKU-1',
        quantity: 2,
        unit_price: { amount: 1250, currency: 'USD', precision: 2 },
        total_price: { amount: 2500, currency: 'USD', precision: 2 },
        product_name: 'Morning Blend',
      },
    ],
    shipping_address: {
      line1: '1 Tea Lane',
      city: 'Denver',
      region: 'CO',
      postal_code: '80202',
      country: 'US',
      recipient: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    extensions: {},
    shipping_carrier: 'ups',
    tracking_number: '1Z999AA10123456784',
    ...overrides,
  } as unknown as TestOrder;
}

function sentPayload(): { html: string; to: string[] } {
  return sendMock.mock.calls.at(-1)?.[0];
}

function sentKey(): string | undefined {
  return sendMock.mock.calls.at(-1)?.[1]?.idempotencyKey;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  recordEmailEventMock.mockResolvedValue('evt-1');
  process.env.ORDER_STATUS_SECRET = TEST_SECRET;
});

afterEach(() => {
  delete process.env.ORDER_STATUS_SECRET;
});

describe('sendInitialShippingEmail', () => {
  it('sends with the stable initial idempotency key and records shipping_email_sent', async () => {
    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res).toEqual({ attempted: true, success: true, eventId: 'evt-1' });
    expect(sentKey()).toBe('shipping-confirmation/ORD-1/initial');
    expect(sentPayload().to).toEqual(['ada@example.com']);
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_sent',
      ACTOR,
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );
  });

  it('uses the same key on a second call (stable initial key)', async () => {
    await sendInitialShippingEmail(baseOrder(), ACTOR);
    const first = sentKey();
    await sendInitialShippingEmail(baseOrder(), ACTOR);
    const second = sentKey();

    expect(first).toBe('shipping-confirmation/ORD-1/initial');
    expect(second).toBe(first);
  });

  it('links a registered customer to their account order page', async () => {
    await sendInitialShippingEmail(baseOrder({ customer_id: 'user_42' }), ACTOR);

    expect(sentPayload().html).toContain('/account/orders/ORD-1');
    expect(sentPayload().html).not.toContain('/order-status/');
  });

  it('links a guest customer to a signed order-status URL', async () => {
    await sendInitialShippingEmail(baseOrder({ customer_id: undefined }), ACTOR);

    const html = sentPayload().html;
    expect(html).toContain('/order-status/ORD-1?token=');
    expect(html).not.toContain('/account/orders/');
  });

  it('still sends, without a status button, when ORDER_STATUS_SECRET is unset', async () => {
    delete process.env.ORDER_STATUS_SECRET;

    const res = await sendInitialShippingEmail(baseOrder({ customer_id: undefined }), ACTOR);

    expect(res.attempted).toBe(true);
    expect(res.success).toBe(true);
    expect(sentPayload().html).not.toContain('View your order');
  });

  it('renders a derived UPS tracking link, never a stored one', async () => {
    await sendInitialShippingEmail(baseOrder(), ACTOR);

    const html = sentPayload().html;
    expect(html).toContain('ups.com');
    expect(html).toContain('1Z999AA10123456784');
  });

  it('sends an untracked shipment with no tracking block', async () => {
    await sendInitialShippingEmail(
      baseOrder({ shipping_carrier: null, tracking_number: undefined }),
      ACTOR,
    );

    const html = sentPayload().html;
    expect(html).toContain('Your order has shipped');
    expect(html).not.toContain('Track with');
  });

  it('does not attempt a send when no customer email resolves', async () => {
    const res = await sendInitialShippingEmail(
      baseOrder({
        extensions: {},
        shipping_address: {
          line1: '1 Tea Lane',
          city: 'Denver',
          region: 'CO',
          postal_code: '80202',
          country: 'US',
          recipient: 'Ada Lovelace',
        },
      } as Partial<TestOrder>),
      ACTOR,
    );

    expect(res).toEqual({ attempted: false, success: false });
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordEmailEventMock).not.toHaveBeenCalled();
  });

  it('sends no email for a processing order (no processing emails)', async () => {
    const res = await sendInitialShippingEmail(baseOrder({ status: 'processing' }), ACTOR);

    expect(res).toEqual({ attempted: false, success: false });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends no email for a delivered order (no manual delivered emails)', async () => {
    const res = await sendInitialShippingEmail(baseOrder({ status: 'delivered' }), ACTOR);

    expect(res).toEqual({ attempted: false, success: false });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('records shipping_email_failed and reports failure when the send fails', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    recordEmailEventMock.mockResolvedValueOnce('evt-fail-1');

    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res).toEqual({
      attempted: true,
      success: false,
      error: 'domain not verified',
      eventId: 'evt-fail-1',
    });
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      'ORD-1',
      'shipping_email_failed',
      ACTOR,
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial', error: 'domain not verified' },
    );
  });

  it('a failed send never reverts the shipment', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(shipOrderMock).not.toHaveBeenCalled();
    expect(updateTrackingMock).not.toHaveBeenCalled();
    // The only write is the append-only audit event.
    expect(recordEmailEventMock).toHaveBeenCalledTimes(1);
    expect(recordEmailEventMock.mock.calls[0][1]).toBe('shipping_email_failed');
  });

  it('never throws when the audit write itself fails', async () => {
    recordEmailEventMock.mockRejectedValueOnce(new Error('d1 unavailable'));

    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res.attempted).toBe(true);
    expect(res.success).toBe(false);
    expect(res.error).toBe('d1 unavailable');
  });

  it('never throws when the transport throws', async () => {
    sendMock.mockRejectedValueOnce(new Error('network down'));

    const res = await sendInitialShippingEmail(baseOrder(), ACTOR);

    expect(res.attempted).toBe(true);
    expect(res.success).toBe(false);
  });
});

/**
 * BMC-216C — shipping confirmation email template contract.
 *
 * Pins: tracked UPS / tracked FedEx / untracked rendering, that an untracked
 * shipment emits no empty tracking block or dead button, that the BeauTeas
 * order-status button is omitted when no status URL resolves, that the item
 * preview is capped at 5 lines, that every customer-controlled string is HTML
 * escaped, and that the Resend idempotency key is passed as the second arg.
 * The Resend transport is mocked so the rendered HTML can be inspected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import {
  sendShippingConfirmationEmail,
  type ShippingConfirmationData,
} from '@/lib/utils/email';

function baseData(overrides: Partial<ShippingConfirmationData> = {}): ShippingConfirmationData {
  return {
    orderNumber: 'ORD-1',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    items: [
      { name: 'Morning Blend', quantity: 2 },
      { name: 'Evening Blend', quantity: 1 },
    ],
    carrier: 'ups',
    trackingNumber: '1Z999AA10123456784',
    trackingUrl: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784',
    orderStatusUrl: 'https://www.beauteas.com/account/orders/ORD-1',
    ...overrides,
  };
}

function payload(): { html: string; subject: string; to: string[] } {
  return sendMock.mock.calls.at(-1)?.[0];
}

function options(): { idempotencyKey?: string } | undefined {
  return sendMock.mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
});

describe('sendShippingConfirmationEmail', () => {
  it('renders a tracked UPS shipment with a carrier button', async () => {
    const res = await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(res.success).toBe(true);
    const { html, subject, to } = payload();
    expect(to).toEqual(['ada@example.com']);
    expect(subject).toContain('ORD-1');
    expect(html).toContain('Your order has shipped');
    expect(html).toContain('UPS');
    expect(html).toContain('1Z999AA10123456784');
    expect(html).toContain('https://www.ups.com/track?loc=en_US&amp;tracknum=1Z999AA10123456784');
    expect(html).toContain('Track with UPS');
    expect(html).toContain('Morning Blend');
    expect(html).toContain('Evening Blend');
    // Positive control for the untracked test below: the tracking PANEL (not
    // just the button) is only present when there is something to track.
    expect(html).toContain("font-family: 'Courier New', monospace");
  });

  it('renders a tracked FedEx shipment with a FedEx button', async () => {
    await sendShippingConfirmationEmail(
      baseData({
        carrier: 'fedex',
        trackingNumber: '789012345678',
        trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=789012345678',
      }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).toContain('FedEx');
    expect(html).toContain('789012345678');
    expect(html).toContain('https://www.fedex.com/fedextrack/?trknbr=789012345678');
    expect(html).toContain('Track with FedEx');
    expect(html).not.toContain('UPS');
  });

  it('renders a tracked USPS shipment with a USPS button', async () => {
    await sendShippingConfirmationEmail(
      baseData({
        carrier: 'usps',
        trackingNumber: '9400111899223197428490',
        trackingUrl:
          'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490',
      }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).toContain('USPS');
    expect(html).toContain('9400111899223197428490');
    expect(html).toContain('Track with USPS');
  });

  it('renders an "other" carrier as a labelled tracking number with no dead button', async () => {
    await sendShippingConfirmationEmail(
      baseData({ carrier: 'other', trackingNumber: 'XYZ-123', trackingUrl: null }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).toContain('XYZ-123');
    expect(html).not.toContain('Track with');
    expect(html).not.toContain('href=""');
  });

  it('renders an untracked shipment with no tracking block and no dead button', async () => {
    const res = await sendShippingConfirmationEmail(
      baseData({ carrier: null, trackingNumber: null, trackingUrl: null }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    expect(res.success).toBe(true);
    const { html } = payload();
    expect(html).toContain('Your order has shipped');
    expect(html).not.toContain('Track with');
    // Discriminating assertions: what actually proves the tracking PANEL is
    // absent — not merely the button — is the panel's own markup: its
    // monospace tracking-number style and its carrier/"Shipment" label (see
    // this file's tracked-carrier tests for the positive control). A
    // `trackingBlock` made unconditional would fail these.
    expect(html).not.toContain("font-family: 'Courier New', monospace");
    expect(html).not.toContain('>Shipment<');
    // No empty anchor left behind by an omitted tracking URL.
    expect(html).not.toContain('href=""');
  });

  it('omits the BeauTeas order-status button when no status URL resolves', async () => {
    await sendShippingConfirmationEmail(baseData({ orderStatusUrl: null }), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    const { html } = payload();
    expect(html).not.toContain('View your order');
    expect(html).not.toContain('href=""');
  });

  it('caps the item preview at 5 lines', async () => {
    await sendShippingConfirmationEmail(
      baseData({
        items: [
          { name: 'Item A', quantity: 1 },
          { name: 'Item B', quantity: 1 },
          { name: 'Item C', quantity: 1 },
          { name: 'Item D', quantity: 1 },
          { name: 'Item E', quantity: 1 },
          { name: 'Item F', quantity: 1 },
          { name: 'Item G', quantity: 1 },
        ],
      }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).toContain('Item E');
    expect(html).not.toContain('Item F');
    expect(html).not.toContain('Item G');
  });

  it('escapes customer, item, and tracking content', async () => {
    await sendShippingConfirmationEmail(
      baseData({
        customerName: '<script>alert("name")</script>',
        items: [{ name: '<img src=x onerror=alert(1)>', quantity: 3 }],
        trackingNumber: '<script>alert("track")</script>',
        trackingUrl: 'https://www.ups.com/track?x="><script>alert(1)</script>',
        orderStatusUrl: 'https://www.beauteas.com/order-status/ORD-1?token="><script>x</script>',
      }),
      { idempotencyKey: 'shipping-confirmation/ORD-1/initial' },
    );

    const { html } = payload();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('never leaks internal fields the contract excludes', async () => {
    const { html } = await (async () => {
      await sendShippingConfirmationEmail(baseData(), {
        idempotencyKey: 'shipping-confirmation/ORD-1/initial',
      });
      return payload();
    })();

    expect(html.toLowerCase()).not.toContain('payment');
    expect(html.toLowerCase()).not.toContain('paymentintent');
    expect(html.toLowerCase()).not.toContain('internal note');
    expect(html.toLowerCase()).not.toContain('estimated delivery');
  });

  it('passes the idempotency key as the Resend second argument', async () => {
    await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(options()).toEqual({ idempotencyKey: 'shipping-confirmation/ORD-1/initial' });
  });

  it('returns a typed failure when Resend reports an error', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });

    const res = await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('domain not verified');
    expect(res.errorCode).toBeUndefined();
  });

  it('surfaces the Resend error name as errorCode so callers can tell failure classes apart', async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Concurrent requests with the same idempotency key.',
        name: 'concurrent_idempotent_requests',
      },
    });

    const res = await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(res).toEqual({
      success: false,
      error: 'Concurrent requests with the same idempotency key.',
      errorCode: 'concurrent_idempotent_requests',
    });
  });

  it('returns a typed failure instead of throwing when the transport throws', async () => {
    sendMock.mockRejectedValueOnce(new Error('network down'));

    const res = await sendShippingConfirmationEmail(baseData(), {
      idempotencyKey: 'shipping-confirmation/ORD-1/initial',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('network down');
  });
});

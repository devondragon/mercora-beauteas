/**
 * BMC-216F — the legacy order-status email template must escape every
 * interpolated value and must no longer emit the stored trackingUrl as a
 * link. The refund route keeps this template alive for cancellation/refund
 * emails, so the refunded shape must still render.
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

import { sendOrderStatusUpdateEmail, type OrderStatusUpdateData } from '@/lib/utils/email';

const XSS = '<script>alert(1)</script>';

function baseData(overrides: Partial<OrderStatusUpdateData> = {}): OrderStatusUpdateData {
  return {
    orderNumber: 'WEB-1',
    customerName: 'Ada',
    customerEmail: 'ada@example.com',
    status: 'shipped',
    items: [{ productId: 'p1', name: 'Morning Blend', price: 1250, quantity: 1 }],
    shippingAddress: {
      street: '1 Tea Ln',
      city: 'Denver',
      state: 'CO',
      zipCode: '80202',
      country: 'US',
    },
    ...overrides,
  };
}

async function renderedHtml(data: OrderStatusUpdateData): Promise<string> {
  sendMock.mockClear();
  const result = await sendOrderStatusUpdateEmail(data);
  expect(result.success).toBe(true);
  return sendMock.mock.calls[0][0].html as string;
}

beforeEach(() => {
  sendMock.mockClear();
});

describe('generateOrderStatusUpdateHTML escaping (BMC-216F)', () => {
  it('escapes a <script>-bearing customer name', async () => {
    const html = await renderedHtml(baseData({ customerName: XSS }));
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a <script>-bearing tracking number and carrier', async () => {
    const html = await renderedHtml(
      baseData({ carrier: `UPS${XSS}`, trackingNumber: `1Z${XSS}` })
    );
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;');
  });

  it('never renders the stored trackingUrl — no link, no raw value', async () => {
    const html = await renderedHtml(
      baseData({
        carrier: 'ups',
        trackingNumber: '1Z999',
        trackingUrl: 'https://evil.example/phish"><script>alert(1)</script>',
      })
    );
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('Track Your Package');
  });

  it('escapes notes, item names, and shipping address fields', async () => {
    const html = await renderedHtml(
      baseData({
        notes: `note ${XSS}`,
        items: [{ productId: 'p1', name: `Tea ${XSS}`, price: 1250, quantity: 1 }],
        shippingAddress: {
          street: `1 ${XSS} Ln`,
          city: `Denver${XSS}`,
          state: 'CO',
          zipCode: '80202',
          country: 'US',
        },
      })
    );
    expect(html).not.toContain(XSS);
  });

  it('escapes the cancellation reason on the cancelled template', async () => {
    const html = await renderedHtml(
      baseData({ status: 'cancelled', cancellationReason: `oops ${XSS}` })
    );
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;');
  });

  it('the refund-route shape still renders (template stays alive for refund emails)', async () => {
    const html = await renderedHtml(
      baseData({
        status: 'refunded',
        refundAmount: '$25.00',
        orderCancelled: true,
        trackingUrl: 'https://www.ups.com/track?tracknum=1Z', // refund route still passes it
      })
    );
    expect(html).toContain('$25.00');
    expect(html).toContain('will not be shipped');
    expect(html).not.toContain('ups.com/track'); // ignored, not rendered
  });
});

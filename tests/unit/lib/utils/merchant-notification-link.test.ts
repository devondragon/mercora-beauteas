/**
 * BMC-216C — the merchant new-order notification must deep-link to the
 * specific admin order, not the unfiltered order list. With a fulfillment
 * queue in place, "Manage this order" landing on /admin/orders makes the
 * operator hunt for the order the email is about.
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

import { sendNewOrderMerchantNotification, type OrderData } from '@/lib/utils/email';

function baseOrderData(overrides: Partial<OrderData> = {}): OrderData {
  return {
    orderNumber: 'WEB-GUEST-123',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    items: [
      {
        productId: 'p1',
        name: 'Morning Blend',
        price: '$12.50',
        lineTotal: '$25.00',
        quantity: 2,
      },
    ],
    subtotal: '$25.00',
    shipping: '$5.00',
    tax: '$1.00',
    total: '$31.00',
    shippingAddress: {
      street: '1 Tea Lane',
      city: 'Denver',
      state: 'CO',
      zipCode: '80202',
      country: 'US',
    },
    ...overrides,
  };
}

function payload(): { html: string; text: string } {
  return sendMock.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
});

describe('sendNewOrderMerchantNotification — admin deep link', () => {
  it('links to the per-order admin page in both HTML and text', async () => {
    const res = await sendNewOrderMerchantNotification(baseOrderData());

    expect(res.success).toBe(true);
    const { html, text } = payload();
    expect(html).toContain('/admin/orders/WEB-GUEST-123');
    expect(text).toContain('/admin/orders/WEB-GUEST-123');
  });

  it('does not link to the bare unfiltered order list', async () => {
    await sendNewOrderMerchantNotification(baseOrderData());

    const { html } = payload();
    expect(html).not.toContain('href="https://www.beauteas.com/admin/orders"');
    expect(html).not.toMatch(/\/admin\/orders"/);
  });

  it('URL-encodes an order number containing URL-significant characters', async () => {
    await sendNewOrderMerchantNotification(baseOrderData({ orderNumber: 'ORD 1/2?x=1' }));

    const { html } = payload();
    expect(html).toContain('/admin/orders/ORD%201%2F2%3Fx%3D1');
    expect(html).not.toContain('/admin/orders/ORD 1/2?x=1');
  });
});

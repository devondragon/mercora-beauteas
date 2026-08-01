/**
 * BMC-230 — the order-confirmation email template must escape every
 * interpolated value, matching the sister status-update template
 * (tests/unit/lib/utils/order-status-email-escaping.test.ts).
 *
 * The attribute cases are the sharp ones: `item.name` renders into `alt="…"`
 * and the resolved image URL into `src="…"`, where an unescaped `"` breaks out
 * of the attribute and can inject arbitrary markup (e.g. a fake tracking link)
 * next to legitimate order content.
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

import { sendOrderConfirmationEmail, type OrderData } from '@/lib/utils/email';

const XSS = '<script>alert(1)</script>';

function baseData(overrides: Partial<OrderData> = {}): OrderData {
  return {
    orderNumber: 'WEB-1',
    customerName: 'Ada',
    customerEmail: 'ada@example.com',
    items: [
      {
        productId: 'p1',
        name: 'Morning Blend',
        price: '$12.50',
        lineTotal: '$12.50',
        quantity: 1,
      },
    ],
    subtotal: '$12.50',
    shipping: '$0.00',
    tax: '$0.00',
    total: '$12.50',
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

async function renderedHtml(data: OrderData): Promise<string> {
  sendMock.mockClear();
  const result = await sendOrderConfirmationEmail(data);
  expect(result.success).toBe(true);
  return sendMock.mock.calls[0][0].html as string;
}

beforeEach(() => {
  sendMock.mockClear();
});

describe('generateOrderConfirmationHTML escaping (BMC-230)', () => {
  it('escapes a <script>-bearing customer name', async () => {
    const html = await renderedHtml(baseData({ customerName: XSS }));
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes the order number and estimated delivery', async () => {
    const html = await renderedHtml(
      baseData({ orderNumber: `WEB-1${XSS}`, estimatedDelivery: `Aug 3 ${XSS}` })
    );
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes item names in both the alt attribute and the item row', async () => {
    const html = await renderedHtml(
      baseData({
        items: [
          {
            productId: 'p1',
            name: 'Tea" onload="alert(1)',
            price: '$12.50',
            lineTotal: '$12.50',
            quantity: 1,
            imageUrl: '/products/tea.jpg',
          },
        ],
      })
    );
    // The raw quote must not survive into the alt="…" attribute.
    expect(html).not.toContain('alt="Tea" onload=');
    expect(html).toContain('&quot;');
  });

  it('escapes an absolute image URL that carries an attribute breakout', async () => {
    const html = await renderedHtml(
      baseData({
        items: [
          {
            productId: 'p1',
            name: 'Morning Blend',
            price: '$12.50',
            lineTotal: '$12.50',
            quantity: 1,
            // Already absolute, so getAbsoluteImageUrl returns it verbatim.
            imageUrl: 'https://img.example/x.jpg"><a href="https://evil.example">Track</a><img src="',
          },
        ],
      })
    );
    expect(html).not.toContain('<a href="https://evil.example">');
  });

  it('escapes shipping address fields', async () => {
    const html = await renderedHtml(
      baseData({
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

  it('still renders ordinary order content unchanged', async () => {
    const html = await renderedHtml(
      baseData({ giftCard: '$5.00', amountCharged: '$7.50', estimatedDelivery: 'Aug 3' })
    );
    expect(html).toContain('Morning Blend');
    expect(html).toContain('$12.50');
    expect(html).toContain('$5.00');
    expect(html).toContain('$7.50');
    expect(html).toContain('Estimated delivery: Aug 3');
  });
});

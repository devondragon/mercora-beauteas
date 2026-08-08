/**
 * The order-confirmation email hardcoded the closing-sale sentence, so
 * `sale.final_sale` governed Chai but not the receipt. It now reads
 * `OrderData.finalSale`.
 *
 * The omitted-field case is the important one: the field is optional, and it
 * must default to sending the disclosure. A receipt that silently drops a
 * no-returns statement is the expensive direction — the customer has already
 * been charged by a business that is closing.
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

const FINAL_SALE_COPY = 'this order is final sale';

function baseData(overrides: Partial<OrderData> = {}): OrderData {
  return {
    orderNumber: 'WEB-1',
    customerName: 'Ada',
    customerEmail: 'ada@example.com',
    items: [
      { productId: 'p1', name: 'Morning Blend', price: '$12.50', lineTotal: '$12.50', quantity: 1 },
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

describe('order-confirmation final-sale line', () => {
  it('includes the closing-sale line when finalSale is true', async () => {
    expect(await renderedHtml(baseData({ finalSale: true }))).toContain(FINAL_SALE_COPY);
  });

  it('omits it when finalSale is explicitly false', async () => {
    const html = await renderedHtml(baseData({ finalSale: false }));
    expect(html).not.toContain(FINAL_SALE_COPY);
    expect(html).not.toContain('closing sale');
    // The surrounding paragraph must survive intact.
    expect(html).toContain('Thank you for your order, truly.');
  });

  it('includes it when the field is omitted entirely', async () => {
    expect(await renderedHtml(baseData())).toContain(FINAL_SALE_COPY);
  });
});

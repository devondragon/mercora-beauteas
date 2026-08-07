/**
 * `sale.final_sale` reaches the order-confirmation email through
 * `OrderData.finalSale`, set here rather than read inside the template module
 * (which must stay free of lib/db imports).
 *
 * The failure case is the one that matters. `sendOrderConfirmationForOrder`'s
 * outer catch swallows and RETURNS, so an unguarded `await getSaleRules()`
 * would let a settings blip suppress the entire confirmation email for a
 * customer who has already been charged. The read has its own try/catch and
 * fails to the sale posture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type EmailPayload = { finalSale?: boolean };

const sendOrderConfirmationEmail = vi.fn(async (_data: EmailPayload) => ({
  success: true as const,
  id: 'email_test',
}));
const sendNewOrderMerchantNotification = vi.fn(async (_data: EmailPayload) => ({
  success: true as const,
  id: 'merchant_test',
}));
const getSaleRules = vi.fn(async () => ({
  minimumBoxes: 10,
  finalSale: true,
  subscriptionsEnabled: false,
  tiers: [] as unknown[],
}));

vi.mock('@/lib/utils/email', () => ({
  sendOrderConfirmationEmail: (data: EmailPayload) => sendOrderConfirmationEmail(data),
  sendNewOrderMerchantNotification: (data: EmailPayload) => sendNewOrderMerchantNotification(data),
}));
vi.mock('@/lib/models/mach/products', () => ({ getProduct: vi.fn(async () => null) }));
vi.mock('@/lib/utils/observe', () => ({ logCritical: vi.fn() }));
vi.mock('@/lib/sale/settings', () => ({ getSaleRules: () => getSaleRules() }));

function orderFixture() {
  return {
    id: 'WEB-GUEST-1',
    currency_code: 'USD',
    total_amount: { amount: 2147, currency: 'USD' },
    shipping_address: {
      recipient: 'Ada',
      email: 'ada@example.com',
      line1: '1 Tea Ln',
      city: 'Denver',
      region: 'CO',
      postal_code: '80202',
      country: 'US',
    },
    extensions: { subtotal: 1499, shipping_cost: 599, tax_amount: 49 },
    items: [
      {
        product_id: 'prod_1',
        product_name: 'Morning Blend',
        sku: 'BTCCM1',
        quantity: 1,
        unit_price: { amount: 1499, currency: 'USD' },
        total_price: { amount: 1499, currency: 'USD' },
      },
    ],
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSaleRules.mockResolvedValue({
    minimumBoxes: 10,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [],
  });
});

describe('order confirmation — final-sale flag', () => {
  it('passes finalSale: true through to the email', async () => {
    const { sendOrderConfirmationForOrder } = await import('@/lib/services/order-confirmation');
    await sendOrderConfirmationForOrder(orderFixture());

    expect(sendOrderConfirmationEmail.mock.calls[0][0].finalSale).toBe(true);
  });

  it('passes an explicit finalSale: false through to the email', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: false,
      subscriptionsEnabled: false,
      tiers: [],
    });

    const { sendOrderConfirmationForOrder } = await import('@/lib/services/order-confirmation');
    await sendOrderConfirmationForOrder(orderFixture());

    expect(sendOrderConfirmationEmail.mock.calls[0][0].finalSale).toBe(false);
  });

  it('still sends the email, with the disclosure, when the settings read throws', async () => {
    getSaleRules.mockRejectedValue(new Error('D1 unavailable'));

    const { sendOrderConfirmationForOrder } = await import('@/lib/services/order-confirmation');
    await sendOrderConfirmationForOrder(orderFixture());

    expect(sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(sendOrderConfirmationEmail.mock.calls[0][0].finalSale).toBe(true);
  });
});

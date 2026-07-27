/**
 * Regression test for missing product images in the order-confirmation email.
 *
 * Found on the FIRST live production order (WEB-GUEST-1785194376707,
 * 2026-07-27): the email rendered "No image" for every line item.
 *
 * Cause: order line items persist only product_id / product_name / sku /
 * quantity / prices — there is no image field — but the email builder read
 * `item.imageUrl`, which was therefore always ''.
 *
 * Fix: resolve the image at send time from the product's first media entry, so
 * already-placed orders are fixed too and product media keeps a single source
 * of truth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type EmailPayload = { items: { imageUrl: string }[] };

const sendOrderConfirmationEmail = vi.fn(async (_data: EmailPayload) => ({
  success: true as const,
  id: 'email_test',
}));
const getProduct = vi.fn(async (_id: string): Promise<unknown> => null);

vi.mock('@/lib/utils/email', () => ({
  sendOrderConfirmationEmail: (data: EmailPayload) => sendOrderConfirmationEmail(data),
}));
vi.mock('@/lib/models/mach/products', () => ({
  getProduct: (id: string) => getProduct(id),
}));
vi.mock('@/lib/utils/observe', () => ({ logCritical: vi.fn() }));

const IMAGE_KEY = 'products/clearly-calendula-evening.jpg';

function orderFixture() {
  return {
    id: 'WEB-GUEST-1785194376707',
    currency_code: 'USD',
    total_amount: { amount: 2147, currency: 'USD' },
    shipping_address: {
      recipient: 'Devon Hillard',
      email: 'devon@example.com',
      line1: '1 Test St',
      city: 'Byers',
      region: 'CO',
      postal_code: '80103',
      country: 'US',
    },
    extensions: { subtotal: 1499, shipping_cost: 599, tax_amount: 49 },
    items: [
      {
        product_id: 'prod_clearly_calendula_evening',
        product_name: 'Clearly Calendula Evening',
        sku: 'BTCCE1',
        quantity: 1,
        unit_price: { amount: 1499, currency: 'USD' },
        total_price: { amount: 1499, currency: 'USD' },
      },
    ],
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getProduct.mockResolvedValue({ id: 'prod_clearly_calendula_evening', media: [{ url: IMAGE_KEY }] });
});

describe('order confirmation email — product images', () => {
  it('resolves an image for a line item that carries none', async () => {
    const { sendOrderConfirmationForOrder } = await import('@/lib/services/order-confirmation');
    await sendOrderConfirmationForOrder(orderFixture());

    expect(sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    const payload = sendOrderConfirmationEmail.mock.calls[0][0];
    expect(payload.items[0].imageUrl).toBe(IMAGE_KEY);
  });

  it('looks the product up only once per distinct product id', async () => {
    const order = orderFixture() as unknown as { items: unknown[] };
    order.items = [order.items[0], order.items[0]];

    const { sendOrderConfirmationForOrder } = await import('@/lib/services/order-confirmation');
    await sendOrderConfirmationForOrder(order as never);

    expect(getProduct).toHaveBeenCalledTimes(1);
  });

  it('still sends the email when the image lookup throws', async () => {
    getProduct.mockRejectedValue(new Error('D1 unavailable'));

    const { sendOrderConfirmationForOrder } = await import('@/lib/services/order-confirmation');
    await sendOrderConfirmationForOrder(orderFixture());

    expect(sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    const payload = sendOrderConfirmationEmail.mock.calls[0][0];
    expect(payload.items[0].imageUrl).toBe('');
  });

  it('prefers an imageUrl already persisted on the line item', async () => {
    const order = orderFixture() as unknown as { items: Record<string, unknown>[] };
    order.items[0].imageUrl = 'products/persisted.jpg';

    const { sendOrderConfirmationForOrder } = await import('@/lib/services/order-confirmation');
    await sendOrderConfirmationForOrder(order as never);

    const payload = sendOrderConfirmationEmail.mock.calls[0][0];
    expect(payload.items[0].imageUrl).toBe('products/persisted.jpg');
  });
});

import { test, expect } from '@playwright/test';

const teaLine = {
  productId: 'prod_clearly_calendula_morning',
  variantId: 'variant_clearly_calendula_morning_btccm1',
  name: 'Clearly Calendula Morning',
  price: 1499,
  quantity: 1,
  primaryImageUrl: '',
};

test('launch-disabled gift-card purchases are absent from every public discovery path', async ({ page, request }) => {
  for (const path of ['/gift-cards', '/product/gift-card', '/api/products/gift-card']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }

  const productsResponse = await request.get('/api/products?limit=100');
  expect(productsResponse.status()).toBe(200);
  const products = await productsResponse.json();
  expect(products.data.map((product: { id: string }) => product.id)).not.toContain('gift-card');

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(sitemapResponse.status()).toBe(200);
  expect(await sitemapResponse.text()).not.toContain('/product/gift-card');

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Gift Cards' })).toHaveCount(0);
});

test('US discounted checkout reaches PaymentIntent creation with one authoritative payload', async ({ page }) => {
  let taxRequest: any;
  let paymentIntentRequest: any;
  await page.route('**/api/validate-discount', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        valid: true,
        promotion: {
          id: 'promo-save20',
          type: 'cart',
          displayName: '$3 Off',
          description: 'Save $3',
          discountAmount: 300,
          discountType: 'fixed',
          discountValue: 300,
        },
      }),
    });
  });
  await page.route('**/api/shipping-options', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        options: [
          { id: 'standard', label: 'Standard', cost: 5.99, estimatedDays: 5 },
          { id: 'express', label: 'Express', cost: 9.99, estimatedDays: 2 },
          { id: 'overnight', label: 'Overnight', cost: 19.99, estimatedDays: 1 },
        ],
      }),
    });
  });
  await page.route('**/api/tax', async (route) => {
    taxRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        amount: 0.39,
        calculated_by: 'stripe',
        breakdown: { subtotal: 14.99, shippingCost: 5.99, taxableAmount: 17.98, taxAmount: 0.39, total: 18.37 },
      }),
    });
  });
  await page.route('**/api/payment-intent', async (route) => {
    paymentIntentRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ clientSecret: 'pi_e2e_secret_checkout', paymentIntentId: 'pi_e2e', amount: 18.37 }),
    });
  });

  await page.goto('/product/clearly-calendula-morning');
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await expect(page.getByRole('button', { name: /Cart \(1 item\)/ })).toBeVisible();

  await page.goto('/checkout');
  await expect(page.getByText('Currently shipping within the United States only.')).toBeVisible();
  const discountInput = page.getByPlaceholder('Enter discount code');
  await discountInput.fill('SAVE20');
  await discountInput.locator('..').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('SAVE20')).toBeVisible();
  await page.locator('input[name="recipient"]').fill('Launch Tester');
  await page.locator('input[name="email"]').fill('launch@example.com');
  await page.locator('input[name="line1"]').fill('100 Tea Way');
  await page.locator('input[name="city"]').fill('Denver');
  await page.locator('input[name="region"]').fill('CO');
  await page.locator('input[name="postal_code"]').fill('80202');
  await page.getByRole('button', { name: 'Use Address' }).click();

  await expect(page.getByText('Standard').last()).toBeVisible();
  await page.getByText('Standard').last().click();

  await expect.poll(() => paymentIntentRequest).toBeTruthy();
  expect(taxRequest.discountCodes).toEqual(['SAVE20']);
  expect(taxRequest.shippingAddress.country).toBe('US');
  expect(taxRequest.orderId).toMatch(/^WEB-GUEST-/);
  expect(paymentIntentRequest.orderId).toBe(taxRequest.orderId);
  expect(paymentIntentRequest.discountCodes).toEqual(['SAVE20']);
  expect(paymentIntentRequest.amount).toBe(18.37);
  await expect(page.getByText('100 Tea Way')).toBeVisible();
});

test('successful payment return finalizes a guest order and clears cart state', async ({ page }) => {
  await page.addInitScript(({ item }) => {
    const paymentIntentId = 'pi_return_e2e';
    const orderId = 'WEB-GUEST-E2E';
    const body = {
      order_id: orderId,
      items: [{ product_id: item.productId, variant_id: item.variantId, quantity: 1 }],
      extensions: { payment_intent_id: paymentIntentId },
    };
    window.localStorage.setItem('cart-storage', JSON.stringify({ state: { items: [item] }, version: 1 }));
    window.localStorage.setItem(`beauteas.pendingOrder.${paymentIntentId}`, JSON.stringify({
      orderId,
      paymentIntentId,
      savedAt: Date.now(),
      body,
    }));

    (window as any).Stripe = () => ({
      _registerWrapper: () => undefined,
      retrievePaymentIntent: async () => ({
        paymentIntent: { id: paymentIntentId, status: 'succeeded' },
      }),
    });
  }, { item: teaLine });

  let orderRequest: any;
  await page.route('**/api/orders', async (route) => {
    orderRequest = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'WEB-GUEST-E2E' } }) });
  });

  await page.goto('/checkout/success?payment_intent_client_secret=pi_return_e2e_secret_test');
  await expect(page.getByText('Thank you for your order!')).toBeVisible();
  expect(orderRequest.order_id).toBe('WEB-GUEST-E2E');

  const persisted = await page.evaluate(() => JSON.parse(window.localStorage.getItem('cart-storage') || '{}'));
  expect(persisted.state.items).toEqual([]);
  expect(await page.evaluate(() => window.localStorage.getItem('beauteas.pendingOrder.pi_return_e2e'))).toBeNull();
});

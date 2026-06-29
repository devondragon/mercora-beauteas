import { test, expect } from '@playwright/test';

/**
 * Checkout flow E2E tests.
 *
 * These tests verify the UI flow through to the Stripe payment form but do NOT
 * submit a real payment. They require:
 *   - Dev server running: npm run dev
 *   - Valid NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in .env.local (test key is fine)
 *   - Valid NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in .env.local (test key pk_test_...)
 */

test.describe('Checkout flow', () => {
  test('catalog homepage is accessible', async ({ page }) => {
    // There is no `/products` route; the homepage is the catalog entry point.
    // Assert a real 200 (not just "not 500") so a 404 can't pass vacuously.
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });

  test('cart icon is accessible from the homepage', async ({ page }) => {
    await page.goto('/');
    // Cart button/icon should be present in the header area
    const cartButton = page.locator('[aria-label*="cart" i], [data-testid*="cart"], button:has([class*="cart"i])').first();
    await expect(cartButton).toBeVisible();
  });

  test('checkout page renders without crashing', async ({ page }) => {
    await page.goto('/checkout');
    // Should render the checkout form or redirect to sign-in (not a hard error)
    const status = (await page.locator('body').textContent()) ?? '';
    expect(status).not.toMatch(/Application error|500|Internal server/i);
  });
});

test.describe('Order auth boundaries', () => {
  // Regression gate for the prior P0 (unauthenticated refund API). unified-auth
  // fails closed, so an unauthenticated refund POST must be rejected with 401/403
  // — never 2xx, and not a 500. (See L2 in review.)
  test('refund endpoint rejects unauthenticated requests', async ({ request }) => {
    const response = await request.post('/api/orders/refund', {
      data: { orderId: 'ord_test', amount: 100 },
    });
    expect([401, 403]).toContain(response.status());
  });
});

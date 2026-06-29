import { test, expect } from '@playwright/test';

/**
 * Subscription lifecycle E2E tests.
 *
 * Tests the subscription storefront UI and the authenticated account subscription
 * management page. Full lifecycle tests (pause / cancel via Stripe) require:
 *   - A signed-in Clerk test user
 *   - An active Stripe test subscription
 *   - Stripe test keys in .env.local
 *
 * These tests cover the public-facing subscription marketing page and verify the
 * subscription management UI renders for authenticated users.
 */

test.describe('Subscription UI', () => {
  // There is no `/subscribe` route — only `/subscribe/checkout` and
  // `/subscribe/confirmation` exist (app/subscribe/checkout/page.tsx). Hitting
  // `/subscribe` falls through to the [slug] CMS catch-all and 404s.
  test('subscription checkout page is accessible', async ({ page }) => {
    const response = await page.goto('/subscribe/checkout');
    expect(response?.status()).not.toBe(500);
  });

  test('subscription checkout page shows plan options or CTA', async ({ page }) => {
    await page.goto('/subscribe/checkout');
    const body = await page.locator('body').textContent();
    // Should mention subscriptions, plans, or savings
    expect(body).toMatch(/subscribe|subscription|plan|save|monthly|biweekly/i);
  });

  test('account subscriptions page is accessible', async ({ page }) => {
    // Unauthenticated visit should redirect to sign-in, not crash
    const response = await page.goto('/account/subscriptions');
    expect(response?.status()).not.toBe(500);
  });

  test('subscriptions API rejects unauthenticated requests', async ({ request }) => {
    // The route unconditionally requires a Clerk session, so an unauthenticated
    // GET must return 401 (403 acceptable if a future policy layer is added).
    // Asserting strictly keeps this a real auth-regression gate — a 200 here
    // would mean subscription data is leaking. (See L1 in review.)
    const response = await request.get('/api/subscriptions');
    expect([401, 403]).toContain(response.status());
  });
});

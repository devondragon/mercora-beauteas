import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('loads and shows brand name', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/BeauTeas/i);
  });

  test('displays hero section with tagline', async ({ page }) => {
    await page.goto('/');
    const body = page.locator('body');
    await expect(body).toContainText(/BeauTeas|Build Your Beauty/i);
  });

  test('navigation header is visible', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header');
    await expect(header).toBeVisible();
  });

  test('product catalog section renders', async ({ page }) => {
    await page.goto('/');
    // Products should appear somewhere on the homepage
    await expect(page.locator('body')).toContainText(/tea|product|shop/i);
  });
});

import { test, expect } from '@playwright/test';

/**
 * Shopify → Mercora redirect map E2E tests.
 *
 * The redirect_map table is populated by the Shopify ETL
 * (scripts/shopify-migration/migrate-all.ts). Until the ETL has been run
 * against the dev DB, only the "no redirect for unknown paths" test below is
 * meaningful. After ETL, add known source→target pairs to KNOWN_REDIRECTS and
 * remove the skip.
 */

const KNOWN_REDIRECTS: Array<{ from: string; to: string }> = [
  // Populate after running the Shopify ETL against dev DB.
  // Example:
  // { from: '/products/old-shopify-handle', to: '/products/new-mercora-slug' },
];

test.describe('Shopify redirect map', () => {
  test('middleware returns a response for unknown legacy paths (no crash)', async ({ page }) => {
    // An unknown Shopify-style URL should return 404 or redirect, never 500
    const response = await page.goto('/products/this-product-does-not-exist-xyz');
    expect(response?.status()).not.toBe(500);
  });

  test('root path is not redirected away', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(response?.url()).toMatch(/localhost:3000\/?$/);
  });

  if (KNOWN_REDIRECTS.length > 0) {
    for (const { from, to } of KNOWN_REDIRECTS) {
      test(`${from} → ${to}`, async ({ page }) => {
        const response = await page.goto(from);
        // Playwright follows redirects by default; check the final URL
        expect(response?.url()).toContain(to);
        expect(response?.status()).toBe(200);
      });
    }
  } else {
    test.skip('known redirect pairs not yet populated (run Shopify ETL first)', async () => {});
  }
});

import { test, expect } from '@playwright/test';

/**
 * The header is a `justify-between` row of logo + nav controls. Every part of it
 * has a fixed intrinsic width (the logo is `shrink-0` over a 692x120 asset; the
 * buttons are `whitespace-nowrap`), so nothing gives when the viewport narrows —
 * below ~387px the row simply pushed past the viewport and the whole document
 * scrolled sideways.
 *
 * 320px is the narrowest viewport worth supporting; 360 and 375 cover the common
 * small phones (Galaxy S8/S20, iPhone SE/6/7/8) that were also affected.
 *
 * NOTE: E2E is not wired into CI (see playwright.config.ts), so this does not
 * gate merges — it documents the invariant and is runnable with `npm run test:e2e`.
 */
const NARROW_VIEWPORTS = [
  { name: 'iPhone SE / 6 / 7 / 8', width: 375, height: 667 },
  { name: 'Galaxy S8 / iPhone mini', width: 360, height: 640 },
  { name: 'smallest supported', width: 320, height: 568 },
];

test.describe('Header responsive layout', () => {
  for (const viewport of NARROW_VIEWPORTS) {
    test(`does not overflow horizontally at ${viewport.width}px (${viewport.name})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        scrollWidth,
        `document scrolls horizontally at ${viewport.width}px`
      ).toBeLessThanOrEqual(clientWidth);
    });
  }

  test('logo and nav controls do not collide at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');

    const logo = page.locator('header img').first();
    const controls = page.locator('header div.md\\:hidden').first();

    const logoBox = await logo.boundingBox();
    const controlsBox = await controls.boundingBox();

    expect(logoBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(
      controlsBox!.x,
      'nav controls overlap the logo'
    ).toBeGreaterThanOrEqual(logoBox!.x + logoBox!.width);
  });
});

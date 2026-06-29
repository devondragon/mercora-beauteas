import { defineConfig, devices } from '@playwright/test';

// NOTE: E2E is intentionally NOT wired into the CI workflow (.github/workflows/ci.yml)
// yet — it needs a running dev server with local Cloudflare bindings plus test
// Clerk/Stripe keys. The `process.env.CI` branches below are for when it is added.
// When wiring E2E into CI, do NOT upload `test-results/` traces as artifacts: on
// retry they capture Clerk session cookies and Stripe tokens. Traces are disabled
// under CI for that reason (see `trace` below).
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    // Off in CI to avoid capturing session cookies / auth tokens in trace zips.
    trace: process.env.CI ? 'off' : 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

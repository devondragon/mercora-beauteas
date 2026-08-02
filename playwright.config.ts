import { defineConfig, devices } from '@playwright/test';

// The checkout browser suite is part of the launch-readiness CI gate. Do not
// upload `test-results/` traces as artifacts: retries can capture Clerk session
// cookies and Stripe tokens. Traces are disabled under CI for that reason.
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
    baseURL: 'http://localhost:3217',
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
    // Use the actual Worker preview so D1/R2 bindings match production runtime.
    command: 'npm run preview:dev',
    url: 'http://localhost:3217',
    // A different app on the checkout port must never satisfy the release gate.
    reuseExistingServer: false,
    // Fresh GitHub runners compile both Next.js and the OpenNext Worker from a
    // cold cache. Keep local feedback fast, but give CI enough time to finish
    // that startup before Playwright decides the server is unavailable.
    timeout: process.env.CI ? 240_000 : 120_000,
  },
});

import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Separate vitest config for integration tests that run inside the Workers runtime.
// Uses @cloudflare/vitest-pool-workers / miniflare — gives real D1 behaviour
// (SQLite batch atomicity, UNIQUE constraints, conditional UPDATE) without hitting
// the remote dev database. Tests must mock @opennextjs/cloudflare so model
// functions can reach the test env.DB binding (see tests/integration/).
export default defineConfig({
  plugins: [
    cloudflareTest({
      // Use miniflare directly instead of wrangler.jsonc because wrangler.jsonc
      // references .open-next/worker.js (the OpenNext build artefact) which is
      // never present during local development / CI. We only need the D1 binding
      // named DB, matching what getCloudflareContext returns at runtime.
      miniflare: {
        compatibilityDate: '2024-12-01',
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        d1Databases: ['DB'],
      },
    }),
  ],
  test: {
    include: ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': __dirname },
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Only pick up unit tests. These must import pure modules with NO Cloudflare
    // binding dependencies — anything calling getCloudflareContext() (lib/db,
    // lib/models, API route handlers) needs the Workers runtime and belongs in
    // E2E or @cloudflare/vitest-pool-workers, not here.
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'tests/**',
        '.next/**',
        '*.config.*',
        'migrations/**',
        'scripts/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});

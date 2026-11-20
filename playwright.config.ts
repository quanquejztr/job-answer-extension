import { defineConfig } from '@playwright/test';

// Browser tests load the unpacked extension from .output/chrome-mv3 (built by
// `npm run test:e2e`) against local fixtures only, never real employer sites.
// Extensions need a persistent context; see tests/e2e/fixtures.ts. The fixture
// server below is for tests only; the product has no local server.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: { trace: 'off' },
  webServer: {
    command: 'node tests/fixtures/serve.mjs',
    url: 'http://127.0.0.1:4310/basic-question.html',
    reuseExistingServer: false,
    timeout: 10_000,
  },
});

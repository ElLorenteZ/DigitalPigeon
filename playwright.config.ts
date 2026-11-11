import { defineConfig } from '@playwright/test';

// E2e drives the built local server (dist/server/main.mjs) in the installed Chrome (channel 'chrome', the author's
// browser; ADR 0002), so no browser is downloaded. `npm run test:e2e` builds first (`npm run build`), so the specs run
// against the production UI, which the server serves with the CSP header. Each spec file launches its own server
// on a free port against its own dp_test_* database (e2e/support.ts).
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  use: { channel: 'chrome' },
});

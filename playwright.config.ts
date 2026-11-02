import { defineConfig } from '@playwright/test';

// E2e drives the Electron app, not a browser, so there are no browser projects and no
// `playwright install`. `npm run test:e2e` builds first (`npm run package`), so the specs run
// against the production Vite output in .vite/, which carries the CSP.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
});

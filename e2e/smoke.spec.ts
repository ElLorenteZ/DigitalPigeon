// Smoke: the built app opens its window and carries the production CSP. Launched against a
// throwaway database so no e2e run connects to real history (review F2, send-and-record).
import { expect, test } from '@playwright/test';
import { type TestApp, launchWithTestDatabase } from './support';

let testApp: TestApp;

test.beforeAll(async () => {
  testApp = await launchWithTestDatabase();
});

test.afterAll(async () => {
  await testApp?.close();
});

test('the app window renders the React root', async () => {
  await expect(testApp.window.locator('#root h1')).toHaveText('DigitalPigeon');
});

test('the production build carries a Content-Security-Policy meta tag', async () => {
  const csp = testApp.window.locator(
    'meta[http-equiv="Content-Security-Policy"]',
  );
  await expect(csp).toHaveCount(1);
  await expect(csp).toHaveAttribute('content', /script-src 'self'/);
});

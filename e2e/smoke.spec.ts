// Smoke: the built app opens in Chrome and is served with the production CSP as a response header (ADR 0002).
// Launched against a throwaway database so no e2e run connects to real history (review F2, send-and-record).
import { expect, test } from '@playwright/test';
import {
  type TestApp,
  cspViolations,
  expectNoCspViolations,
  launchWithTestDatabase,
} from './support';

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

test('the built UI is served with a Content-Security-Policy header', async () => {
  const response = await testApp.window.request.get(testApp.origin);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-security-policy']).toMatch(
    /script-src 'self'/,
  );
  await expect(
    testApp.window.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveCount(0);
});

// The console does not report CSP violations (spike-browser-host.md), so specs read them from the
// securitypolicyviolation recorder in support.ts. This shows the recorder sees one: an inline script is blocked.
test('the CSP blocks an inline script, and the violation is recorded', async () => {
  const { window } = testApp;
  await expectNoCspViolations(window);
  await window
    .addScriptTag({ content: 'window.__ranInline = true;' })
    .catch(() => undefined);
  await expect.poll(() => cspViolations(window)).toHaveLength(1);
  expect(await cspViolations(window)).toEqual([
    expect.stringMatching(/^script-src-elem blocked inline/),
  ]);
  expect(
    await window.evaluate(
      () => (window as unknown as { __ranInline?: boolean }).__ranInline,
    ),
  ).toBeUndefined();
});

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  expect,
  test,
} from '@playwright/test';

// Launches the repo root as the app directory: package.json `main` points at
// .vite/build/main.cjs, so the app name and userData are DigitalPigeon's rather than "Electron".
// The packaged .app is not used: its fuses disable the inspector Playwright attaches through
// (context/changes/test-harness/plan.md).
let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'] });
});

test.afterAll(async () => {
  await app?.close();
});

// DevTools opens when the app is not packaged (src/main.ts), so select the app window by URL.
// Polled rather than matched on the 'window' event: a window can be created at about:blank and
// only then navigate to index.html, which a one-shot predicate on creation would miss.
async function appWindow(): Promise<Page> {
  const isAppWindow = (page: Page) =>
    page.url().endsWith('main_window/index.html');
  let found: Page | undefined;
  await expect
    .poll(() => (found = app.windows().find(isAppWindow)), {
      message: 'an Electron window showing main_window/index.html',
      timeout: 30_000,
    })
    .toBeDefined();
  return found as Page;
}

test('the app window renders the React root', async () => {
  const window = await appWindow();
  await expect(window.locator('#root h1')).toHaveText('DigitalPigeon');
});

test('the production build carries a Content-Security-Policy meta tag', async () => {
  const window = await appWindow();
  const csp = window.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  await expect(csp).toHaveAttribute('content', /script-src 'self'/);
});

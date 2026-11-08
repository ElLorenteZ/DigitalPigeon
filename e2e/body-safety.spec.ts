// T1.8 — a response body is untrusted input and must never run as script or open a page. Only the production
// build carries the CSP, and only a real renderer shows whether markup in a body executes, so this runs on the
// built app. The console is recorded too: a CSP violation or a blocked worker is an error a reader would not see.
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  type TestApp,
  bodyLines,
  launchWithTestDatabase,
  showBodyView,
} from './support';

let capture: CaptureServer;
let testApp: TestApp;
let consoleErrors: string[] = [];

// Each part sets a page-level flag if it ever runs.
const MARKUP = [
  `<script>window.__pwned = 'script'</script>`,
  `<img src="x" onerror="window.__pwned = 'img'">`,
  `<svg onload="window.__pwned = 'svg'"><circle r="1"/></svg>`,
  `<a href="javascript:window.__pwned = 'link'">open-me</a>`,
].join('');
const URL_IN_BODY = 'https://example.com/from-a-body';

// The URL sits on a line of its own in each view, so a wrapped line never splits the text clicked.
const bodies: [type: string, body: string, hasSwitch: boolean][] = [
  ['text/html', `<html><body>${MARKUP}\n${URL_IN_BODY}\n</body></html>`, false],
  ['application/xml', `<r>${MARKUP}<u>\n${URL_IN_BODY}\n</u></r>`, true],
  [
    'application/json',
    JSON.stringify({ url: URL_IN_BODY, html: MARKUP }),
    true,
  ],
  ['text/plain', `${MARKUP}\n${URL_IN_BODY}\n`, false],
];

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  testApp.window.on('console', (message) => {
    if (
      message.type() === 'error' ||
      message.text().includes('Content Security Policy')
    ) {
      consoleErrors.push(message.text());
    }
  });
  testApp.window.on('pageerror', (error) => consoleErrors.push(error.message));
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

const flag = () =>
  testApp.window.evaluate(
    () => (window as unknown as { __pwned?: string }).__pwned ?? null,
  );

for (const [type, body, hasSwitch] of bodies) {
  test(`a ${type} body holding markup shows as text, runs nothing and opens nothing`, async () => {
    const { app, window } = testApp;
    consoleErrors = [];
    capture.respondWith({
      status: 200,
      headers: { 'Content-Type': type },
      body: Buffer.from(body),
    });
    const history = window.getByTestId('history').getByRole('listitem');
    const before = await history.count();
    await window.getByLabel('Method').selectOption('GET');
    await window.getByLabel('URL').fill(`${capture.url}/markup`);
    await window.getByLabel('Body type').selectOption('none');
    await window.getByRole('button', { name: 'Send' }).click();
    await expect(history).toHaveCount(before + 1);

    const result = window.getByTestId('result');
    const shown = result.getByTestId('response-body');
    const pageUrl = window.url();
    const windows = app.windows().length;

    for (const view of hasSwitch ? (['Pretty', 'Raw'] as const) : [null]) {
      if (view) await showBodyView(result, 'response-body', view);
      // The markup is drawn as characters a reader can see. A long line wraps into several drawn lines, each
      // continuation indented, so the checks look for short pieces.
      await expect
        .poll(async () => (await bodyLines(shown)).join(''))
        .toContain('open-me');
      expect((await bodyLines(shown)).join('')).toContain('<script>');

      // Cmd+click on the URL: links are off, and main denies new windows.
      await shown
        .locator('.view-line')
        .getByText('example.com', { exact: false })
        .first()
        .click({ modifiers: ['Meta'] });
      // A round trip to main and one frame let any window or navigation the clicks caused take effect.
      await window.evaluate(async () => {
        await (
          window as unknown as { pigeon: { dbStatus: () => Promise<unknown> } }
        ).pigeon.dbStatus();
        await new Promise(requestAnimationFrame);
      });

      expect(await flag()).toBeNull();
      expect(app.windows()).toHaveLength(windows);
      expect(window.url()).toBe(pageUrl);
    }
    expect(consoleErrors).toEqual([]);
  });
}

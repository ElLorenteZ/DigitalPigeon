// T2.7 — a request typed in the window is sent, its response is shown, and every send appears in
// history as its own row. Each piece is tested below this layer; only the assembled app shows that
// renderer, preload and main connect.
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  containing,
  expectBodyText,
  launchWithTestDatabase,
  rowName,
  showBodyView,
  showRequest,
  showRequestTab,
  showSidebarTab,
  type TestApp,
} from './support';

let capture: CaptureServer;
let testApp: TestApp;

test.beforeAll(async () => {
  capture = await startCaptureServer();
  capture.respondWith({
    status: 201,
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from('{"id":7}'),
  });
  testApp = await launchWithTestDatabase();
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

// Each test starts on the request form with History shown (slice 6: the shell keeps one view at a time).
test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
});

test('each send shows its response and adds its own row to history', async () => {
  const { window } = testApp;
  await showSidebarTab(window, 'History');
  const history = window.getByTestId('history').getByRole('listitem');

  await expect(window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
  await expect(history).toHaveCount(0);

  await window.getByLabel('URL').fill(`${capture.url}/orders`);
  await showRequestTab(window, 'Headers');
  await window.getByRole('button', { name: 'Add header' }).click();
  await window.getByLabel('Header name 1').fill('Authorization');
  await window.getByLabel('Header value 1').fill('Bearer t');
  await window.getByRole('button', { name: 'Send' }).click();

  await expect(window.getByTestId('response-status')).toContainText('201');
  await showBodyView(window, 'response-body', 'Raw');
  await expectBodyText(window.getByTestId('response-body'), '{"id":7}');
  await expect(history).toHaveCount(1);
  await expect(rowName(history.first())).toHaveAccessibleName(
    containing(`GET ${capture.url}/orders — 201`),
  );

  await window.getByRole('button', { name: 'Send' }).click();

  await expect(history).toHaveCount(2);
  await expect(rowName(history.nth(0))).toHaveAccessibleName(
    containing(`GET ${capture.url}/orders — 201`),
  );
  await expect(rowName(history.nth(1))).toHaveAccessibleName(
    containing(`GET ${capture.url}/orders — 201`),
  );
});

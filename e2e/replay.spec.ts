// T2.7, replay half — a past call opened from history can be replayed: a new row appears, the server
// receives the same request again, and the original still shows what it recorded. Replay itself is
// tested below this layer; only the assembled app shows the panel connecting to it.
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

let capture: CaptureServer;
let testApp: TestApp;

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

test('replaying a past call adds a row and leaves the original as recorded', async () => {
  const { window } = testApp;
  const history = window.getByTestId('history').getByRole('listitem');
  const panel = window.getByTestId('call-panel');
  const button = (name: string) =>
    window.getByRole('button', { name, exact: true });

  await expect(window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );

  capture.respondWith({ status: 200, body: Buffer.from('first response') });
  await window.getByLabel('URL').fill(`${capture.url}/orders?filter[a]=1`);
  await button('Add header').click();
  await window.getByLabel('Header name 1').fill('Authorization');
  await window.getByLabel('Header value 1').fill('Bearer t');
  await button('Send').click();
  await expect(history).toHaveCount(1);

  await history.first().getByRole('button').click();
  await expect(panel.getByTestId('call-request-headers')).toContainText(
    'Authorization: Bearer t',
  );
  await expect(panel.getByTestId('response-body')).toHaveText('first response');
  const originalRequest = await panel
    .getByTestId('call-request-line')
    .innerText();

  capture.respondWith({ status: 202, body: Buffer.from('second response') });
  await button('Replay').click();

  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText(
    `GET ${capture.url}/orders?filter[a]=1 — 202`,
  );
  expect(capture.requests).toHaveLength(2);
  expect(capture.requests[1]?.url).toBe(capture.requests[0]?.url);
  expect(capture.requests[1]?.rawHeaders).toEqual(
    capture.requests[0]?.rawHeaders,
  );

  // Opening the replay shows its own response, so the panel is reading what was stored.
  await history.first().getByRole('button').click();
  await expect(panel.getByTestId('response-body')).toHaveText(
    'second response',
  );

  await history.nth(1).getByRole('button').click();
  await expect(panel.getByTestId('response-body')).toHaveText('first response');
  await expect(panel.getByTestId('call-request-line')).toHaveText(
    originalRequest,
  );
  await expect(history.nth(1)).toContainText(' — 200');
});

test('opening a call brings its panel into view, even from a long history', async () => {
  const { window } = testApp;
  const history = window.getByTestId('history').getByRole('listitem');
  const send = window.getByRole('button', { name: 'Send', exact: true });

  capture.respondWith({ status: 200, body: Buffer.from('ok') });
  await window.getByLabel('URL').fill(`${capture.url}/long`);
  const before = await history.count();
  // Longer than the window: the panel renders below the list, past the fold.
  for (let sent = 1; sent <= 30; sent += 1) {
    await send.click();
    await expect(history).toHaveCount(before + sent);
  }

  await history.first().getByRole('button').click();

  await expect(
    window.getByTestId('call-panel').getByRole('heading', { name: 'Call' }),
  ).toBeInViewport();
});

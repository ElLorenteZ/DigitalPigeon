// Slice 7 (responses-strip): every response a request has received, same method and URL path, newest first. The
// strip sits under the response; the call record lists the other responses of its request. Only the assembled app shows
// which response is selected and what picking one shows (test-strategy E2E).
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { channels } from '../src/shared/ipc-contract';
import {
  type TestApp,
  expectBodyText,
  gate,
  launchWithTestDatabase,
  settle,
  showRequest,
  showSidebarTab,
  stubOperation,
} from './support';

let capture: CaptureServer;
let testApp: TestApp;

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
});

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const strip = () => testApp.window.getByTestId('responses-strip');
const chips = () => strip().getByRole('button');

async function sendWith(url: string, status: number, body: string) {
  capture.respondWith({ status, body: Buffer.from(body) });
  await testApp.window.getByLabel('URL').fill(url);
  await button('Send').click();
  await expect(testApp.window.getByTestId('result')).toContainText(
    String(status),
  );
}

test('the same method and path sent three times shows three responses, newest selected, and picking one shows it', async () => {
  const { window } = testApp;
  await sendWith(`${capture.url}/orders?n=1`, 201, 'first');
  await sendWith(`${capture.url}/orders?n=2`, 500, 'second');
  await sendWith(`${capture.url}/orders`, 200, 'third');

  await expect(strip()).toContainText('Responses to this request');
  await expect(strip()).toContainText('3 kept');
  await expect(chips()).toHaveCount(3);
  await expect(chips().nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(chips().nth(0)).toContainText('200');
  await expect(chips().nth(1)).toContainText('500');
  await expect(chips().nth(2)).toContainText('201');

  await chips().nth(2).click();
  await expect(chips().nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(chips().nth(0)).toHaveAttribute('aria-pressed', 'false');
  const result = window.getByTestId('result');
  await expectBodyText(result.getByTestId('response-body'), 'first');
  await expect(result.getByTestId('response-status')).toContainText('201');
});

test('a send to another path has a strip of its own, with one response', async () => {
  await sendWith(`${capture.url}/elsewhere`, 204, '');
  await expect(chips()).toHaveCount(1);
  await expect(strip()).toContainText('1 kept');
});

test('a call opened from History lists the other responses of its request, and one can be opened from there', async () => {
  const { window } = testApp;
  await window
    .getByTestId('history')
    .getByRole('button', { name: /^GET .*\/orders\?n=2 — 500/ })
    .click();
  const panel = window.getByTestId('call-panel');
  const others = panel.getByTestId('other-responses');
  await expect(others).toContainText('Other responses to GET /orders');
  await expect(others.getByRole('button')).toHaveCount(2);

  await others.getByRole('button', { name: /201/ }).click();
  await expect(panel.getByTestId('call-request-line')).toContainText(
    '/orders?n=1',
  );
  await expect(others.getByRole('button')).toHaveCount(2);
  await expect(others.getByRole('button', { name: /500/ })).toBeVisible();
});

// Code review of responses-strip (2026-11-21), findings 2 and 7.
test("while a call's other responses load, the previous call's are not shown under its name", async () => {
  const { window } = testApp;
  const history = window.getByTestId('history');
  await history
    .getByRole('button', { name: /^GET .*\/orders\?n=2 — 500/ })
    .click();
  const others = window
    .getByTestId('call-panel')
    .getByTestId('other-responses');
  await expect(others.getByRole('button')).toHaveCount(2);

  const held = gate();
  const stub = await stubOperation(
    window,
    channels.listResponses,
    async (_input, real) => {
      const answer = await real();
      await held.wait();
      return answer;
    },
  );
  await history
    .getByRole('button', { name: /^GET .*\/elsewhere — 204/ })
    .click();
  await expect(
    window.getByTestId('call-panel').getByTestId('call-request-line'),
  ).toContainText('/elsewhere');
  await expect(others).toHaveCount(0);
  held.release();
  await settle(window);
  await stub.restore();
});

test('responses that cannot be listed say so', async () => {
  const stub = await stubOperation(
    testApp.window,
    channels.listResponses,
    () => ({
      ok: false,
      message: 'listing failed',
    }),
  );
  await sendWith(`${capture.url}/fails-to-list`, 200, 'x');
  await expect(testApp.window.getByTestId('responses-error')).toContainText(
    'listing failed',
  );
  await stub.restore();
});

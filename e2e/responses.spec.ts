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
  showRequestTab,
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
// The chips that pick a response; each sits beside its delete button (slice 8). The strip also holds the Split by auth
// toggle (history-grouping).
const chips = () =>
  strip().getByRole('button', { name: /^(?!Delete |Split by auth$)/ });

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

// history-grouping, phase 3: "Split by auth" narrows the strip and the call record's other responses to the calls sent
// with the same Authorization, otherwise Cookie, value, and the choice survives a reload. This file shares one browser
// and one database, so the scenario uses its own path and clears the stored choice when it ends.
test('Split by auth keeps only the responses sent with the same auth, here and on the call record, after a reload too', async () => {
  const { window } = testApp;
  const url = `${capture.url}/split-by-auth`;
  const history = window.getByTestId('history');
  const row = (status: number) =>
    history.getByRole('button', {
      name: new RegExp(`^GET .*/split-by-auth — ${status}`),
    });
  try {
    await showRequestTab(window, 'Headers');
    await button('Add header').click();
    await window.getByLabel('Header name 1').fill('Authorization');
    await window.getByLabel('Header value 1').fill('Bearer A');
    await sendWith(url, 200, 'a1');
    await sendWith(url, 201, 'a2');
    await window.getByLabel('Header value 1').fill('Bearer B');
    await sendWith(url, 202, 'b');
    await window.getByLabel('Header name 1').fill('Cookie');
    await window.getByLabel('Header value 1').fill('session=x');
    await sendWith(url, 203, 'cookie');
    await expect(strip()).toContainText('4 kept');

    const split = strip().getByRole('button', { name: 'Split by auth' });
    await expect(split).toHaveAttribute('aria-pressed', 'false');
    await split.click();
    await expect(split).toHaveAttribute('aria-pressed', 'true');
    await expect(chips()).toHaveCount(1);
    await expect(strip()).toContainText('1 kept');
    await expect(strip()).toContainText('Cookie: session=x');
    await expect(strip()).toBeInViewport();

    await row(200).click();
    const others = window
      .getByTestId('call-panel')
      .getByTestId('other-responses');
    await expect(others).toContainText('Authorization: Bearer A');
    await expect(others.getByRole('button')).toHaveCount(1);
    await expect(others.getByRole('button', { name: /201/ })).toBeVisible();

    await window.reload();
    await expect(window.getByTestId('db-status')).toContainText('up');
    await showSidebarTab(window, 'History');
    await row(202).click();
    // Bearer B was sent once: with the split kept, it has no other responses.
    await expect(
      window.getByTestId('call-panel').getByTestId('call-request-line'),
    ).toContainText('/split-by-auth');
    await expect(
      window.getByTestId('call-panel').getByTestId('other-responses'),
    ).toHaveCount(0);
    await row(201).click();
    await expect(others.getByRole('button')).toHaveCount(1);
    await expect(others.getByRole('button', { name: /200/ })).toBeVisible();
  } finally {
    await window.evaluate(() => localStorage.removeItem('dp.splitByAuth'));
    await window.reload();
    await expect(window.getByTestId('db-status')).toContainText('up');
  }
});

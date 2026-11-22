// Slice 9 (history-search): screen 04. Search text and facets in the History tab narrow a results table in the main
// area; each facet option shows its count; a selection can be resent (new records, originals unchanged) or deleted
// with Undo; an empty result says so. Only the assembled app shows the table, the counts and the selection.
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  type TestApp,
  callOperation,
  launchWithTestDatabase,
  showRequest,
  showRequestTab,
  showSidebarTab,
  stubOperation,
} from './support';

let capture: CaptureServer;
let testApp: TestApp;

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const searchBox = () => testApp.window.getByLabel('Search history');
const results = () => testApp.window.getByTestId('search-results');
const resultRows = () =>
  results()
    .getByRole('row')
    .filter({ has: testApp.window.getByRole('checkbox') });
const facet = (section: string, option: string) =>
  testApp.window
    .getByRole('group', { name: section })
    .getByRole('checkbox', { name: new RegExp(`^${option}\\b`) });

async function send(method: string, path: string) {
  const { window } = testApp;
  capture.respondWith({ status: 200, body: Buffer.from(`${method} ${path}`) });
  await window.getByLabel('Method').selectOption(method);
  await window.getByLabel('URL').fill(`${capture.url}${path}`);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');
}

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
  await send('POST', '/orders');
  await send('POST', '/orders?again=1');
  await send('GET', '/orders/7');
  await send('GET', '/customers');
  await send('PUT', '/orders/7');
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
  const clearAll = button('Clear all');
  if (await clearAll.isVisible()) await clearAll.click();
});

test('text and a method narrow the results, each option shows its count, and Clear all returns to the request', async () => {
  const { window } = testApp;
  await searchBox().fill('orders');
  await expect(results()).toContainText('4 calls match');
  await expect(resultRows()).toHaveCount(4);
  await expect(facet('Method', 'POST')).toBeVisible();
  await expect(facet('Method', 'POST')).toHaveAccessibleName(/^POST\s*2$/);

  await facet('Method', 'POST').check();
  await expect(results()).toContainText('2 calls match');
  await expect(resultRows()).toHaveCount(2);
  // Method counts ignore the method filter: GET still counts its 1 match.
  await expect(facet('Method', 'GET')).toHaveAccessibleName(/^GET\s*1$/);

  await button('Clear all').click();
  await expect(results()).toBeHidden();
  await expect(window.getByLabel('URL')).toBeVisible();
  await expect(searchBox()).toHaveValue('');
});

test('an empty result says so and offers to clear the filters', async () => {
  await searchBox().fill('nothing-is-called-this');
  await expect(results()).toContainText('No calls match');
  await results().getByRole('button', { name: 'Clear filters' }).click();
  await expect(results()).toBeHidden();
});

test('a selection of two is resent as two new records, and the originals are unchanged', async () => {
  const { window } = testApp;
  await searchBox().fill('/orders/7');
  await expect(resultRows()).toHaveCount(2);
  const before = (await callOperation(window, channels.listCalls)) as {
    calls: { send: { _id: string } }[];
  };
  const ids = before.calls.slice(0, 5).map((c) => c.send._id);
  const originals = await Promise.all(
    ids.map((id) => callOperation(window, channels.getCall, id)),
  );

  for (const row of await resultRows().all()) {
    await row.getByRole('checkbox').check();
  }
  await expect(results()).toContainText('2 selected');
  await button('Resend 2').click();
  await expect(resultRows()).toHaveCount(4);
  expect(
    capture.requests
      .slice(-2)
      .map((r) => r.url)
      .sort(),
  ).toEqual(['/orders/7', '/orders/7']);
  const after = await Promise.all(
    ids.map((id) => callOperation(window, channels.getCall, id)),
  );
  expect(after).toEqual(originals);
});

test('a selection of two is deleted with Undo, and after the window only those two are gone', async () => {
  const { window } = testApp;
  await button('Filters').click();
  await facet('Method', 'POST').check();
  await expect(resultRows()).toHaveCount(2);
  for (const row of await resultRows().all()) {
    await row.getByRole('checkbox').check();
  }
  await button('Delete 2').click();
  await expect(resultRows()).toHaveCount(0);
  await expect(window.getByRole('status', { name: 'Deleted' })).toHaveCount(2);
  await expect
    .poll(
      async () =>
        (
          (await callOperation(window, channels.searchCalls, {
            methods: ['POST'],
          })) as { total: number }
        ).total,
      { timeout: 15_000 },
    )
    .toBe(0);
  const remaining = (await callOperation(window, channels.searchCalls, {})) as {
    total: number;
  };
  expect(remaining.total).toBeGreaterThanOrEqual(5);
});

// Code review of history-search (2026-11-21), findings 2 and 5.
test('deleting a call opened from the results keeps the results on screen', async () => {
  const { window } = testApp;
  await searchBox().fill('/customers');
  await expect(resultRows()).toHaveCount(1);
  await resultRows()
    .first()
    .getByRole('button', { name: /^\S+\/customers$/ })
    .click();
  await expect(window.getByTestId('call-panel')).toBeVisible();
  await button('Back to the results').click();
  await resultRows()
    .first()
    .getByRole('button', { name: /^Delete / })
    .click();
  await expect(results()).toBeVisible();
  await expect(results()).toContainText('No calls match');
  await window
    .getByRole('status', { name: 'Deleted' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(resultRows()).toHaveCount(1);
});

test('a resend that fails says so', async () => {
  const stub = await stubOperation(testApp.window, channels.replay, () => ({
    ok: false,
    error: { kind: 'unexpected', message: 'replay refused' },
  }));
  await searchBox().fill('/customers');
  await expect(resultRows()).toHaveCount(1);
  await resultRows().first().getByRole('button', { name: 'Resend' }).click();
  await expect(results()).toContainText('replay refused');
  await stub.restore();
});

// history-grouping, phase 1: a call sent with a Cookie and no Authorization is filed under its Cookie, and every
// place that shows the value says it is a Cookie.
test('a call sent with only a Cookie is labelled Cookie in the facet, the table and the summary', async () => {
  const { window } = testApp;
  await showRequest(window);
  capture.respondWith({ status: 200, body: Buffer.from('me') });
  await window.getByLabel('Method').selectOption('GET');
  await window.getByLabel('URL').fill(`${capture.url}/me`);
  await showRequestTab(window, 'Headers');
  await button('Add header').click();
  await window.getByLabel('Header name 1').fill('Cookie');
  await window.getByLabel('Header value 1').fill('session=abc123');
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');

  await showSidebarTab(window, 'History');
  await searchBox().fill('/me');
  await expect(resultRows()).toHaveCount(1);
  const option = facet('Auth header', 'Cookie: session=abc123');
  await expect(option).toBeVisible();
  await expect(resultRows().first()).toContainText('Cookie: session=abc123');

  await option.check();
  await expect(results()).toContainText('Cookie: session=abc123');
  await expect(results()).not.toContainText('Authorization: session');
});

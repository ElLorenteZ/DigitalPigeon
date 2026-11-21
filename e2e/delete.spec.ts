// Slice 8 (delete-with-undo): one call is deleted from History, a response chip or the call record. It disappears at
// once, Undo brings it back within 8 s, and after that it is gone for good. During the window the store is not touched
// (author 2026-11-11: "held in the app"). Only the assembled app shows what disappears and what Undo restores.
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
  showSidebarTab,
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
const toast = () => testApp.window.getByRole('status', { name: 'Deleted' });
const row = (path: string) =>
  testApp.window
    .getByTestId('history')
    .getByRole('button', { name: new RegExp(`^GET \\S*${path} — `) });

async function sendTo(path: string): Promise<string> {
  capture.respondWith({ status: 200, body: Buffer.from(path) });
  await testApp.window.getByLabel('URL').fill(`${capture.url}${path}`);
  await button('Send').click();
  await expect(testApp.window.getByTestId('result')).toContainText('200');
  await expect(row(path).first()).toBeVisible();
  const listed = (await callOperation(testApp.window, channels.listCalls)) as {
    calls: { send: { _id: string; request: { url: string } } }[];
  };
  const found = listed.calls.find((c) => c.send.request.url.endsWith(path));
  if (!found) throw new Error(`no call to ${path}`);
  return found.send._id;
}

const stored = async (sendId: string) =>
  (
    (await callOperation(testApp.window, channels.getCall, sendId)) as {
      call: unknown;
    }
  ).call !== null;

test('a call deleted from History disappears, and Undo brings it back without the store being touched', async () => {
  const id = await sendTo('/del-history');
  await testApp.window
    .getByRole('button', { name: /^Delete GET \S*\/del-history$/ })
    .click();
  await expect(row('/del-history')).toHaveCount(0);
  await expect(toast()).toContainText('Call deleted');
  expect(await stored(id)).toBe(true);

  await toast().getByRole('button', { name: 'Undo' }).click();
  await expect(row('/del-history')).toHaveCount(1);
  await expect(toast()).toHaveCount(0);
  // Past the window: nothing is deleted after an Undo.
  await expect
    .poll(async () => stored(id), { timeout: 12_000, intervals: [9_000] })
    .toBe(true);
});

test('a response deleted from the strip is gone for good once the window passes', async () => {
  await sendTo('/del-strip');
  const second = await sendTo('/del-strip');
  const strip = testApp.window.getByTestId('responses-strip');
  await expect(
    strip.getByRole('button', { name: /^Delete response/ }),
  ).toHaveCount(2);

  await strip
    .getByRole('button', { name: /^Delete response/ })
    .first()
    .click();
  await expect(
    strip.getByRole('button', { name: /^Delete response/ }),
  ).toHaveCount(1);
  await expect(toast()).toContainText('Call deleted');
  await expect
    .poll(async () => stored(second), { timeout: 15_000 })
    .toBe(false);
  await expect(toast()).toHaveCount(0);
  await expect(row('/del-strip')).toHaveCount(1);
});

test('a call deleted from its record returns to the request, and Undo restores its row', async () => {
  const id = await sendTo('/del-record');
  await row('/del-record').click();
  const panel = testApp.window.getByTestId('call-panel');
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(testApp.window.getByLabel('URL')).toBeVisible();
  await expect(row('/del-record')).toHaveCount(0);

  await toast().getByRole('button', { name: 'Undo' }).click();
  await expect(row('/del-record')).toHaveCount(1);
  expect(await stored(id)).toBe(true);
});

// Code review of delete-with-undo, 2 and 4.
test('deleting the response on screen says so, and Undo shows it again', async () => {
  await sendTo('/del-shown');
  const result = testApp.window.getByTestId('result');
  const strip = testApp.window.getByTestId('responses-strip');
  await strip.getByRole('button', { name: /^Delete response/ }).click();
  await expect(result).toContainText('This response was deleted');
  await expect(result.getByTestId('response-body')).toHaveCount(0);
  await toast().getByRole('button', { name: 'Undo' }).click();
  await expect(result.getByTestId('response-body')).toBeVisible();
});

test('two deletes in a row can each be undone', async () => {
  await sendTo('/del-one');
  await sendTo('/del-two');
  const deleteRow = (path: string) =>
    testApp.window.getByRole('button', {
      name: new RegExp(`^Delete GET \\S*${path}$`),
    });
  await deleteRow('/del-one').click();
  await deleteRow('/del-two').click();
  await expect(toast()).toHaveCount(2);
  await toast()
    .filter({ hasText: '/del-one' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(row('/del-one')).toHaveCount(1);
  await expect(row('/del-two')).toHaveCount(0);
  await toast()
    .filter({ hasText: '/del-two' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(row('/del-two')).toHaveCount(1);
  await expect(toast()).toHaveCount(0);
});

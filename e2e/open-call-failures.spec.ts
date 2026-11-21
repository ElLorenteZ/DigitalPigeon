// Code review, F7 and F8: what the panel shows when opening a call fails, and when two opens overlap.
// A failing database and response order cannot be arranged from outside, so the server's answer to get-call is
// replaced at the network layer for this page only (support.ts, stubOperation). Bad clicks here lead to a replay of the wrong
// call, which only the assembled panel shows.
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  expectBodyText,
  gate,
  launchWithTestDatabase,
  settle,
  showRequest,
  showSidebarTab,
  stubOperation,
  type TestApp,
} from './support';

type Reply =
  | {
      call: string;
      hold?: boolean;
      requestBody?: { fileId: string; length: number };
    }
  | { failed: string }
  | { rejected: string };

let capture: CaptureServer;
let testApp: TestApp;

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  const { window } = testApp;
  await expect(window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
  await window.getByLabel('URL').fill(`${capture.url}/seed`);
  await showSidebarTab(window, 'History');
  const history = window.getByTestId('history').getByRole('listitem');
  for (let sent = 1; sent <= 2; sent += 1) {
    await window.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(history).toHaveCount(sent);
  }
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

let held = gate();

const stubGetCall = (replies: Reply[]) => {
  held = gate();
  return stubOperation(testApp.window, channels.getCall, async () => {
    const reply = replies.shift() as Reply;
    if ('rejected' in reply) throw new Error(reply.rejected);
    if ('failed' in reply) return { ok: false, message: reply.failed };
    if (reply.hold) await held.wait();
    return {
      ok: true,
      call: {
        state: 'completed',
        completion: null,
        send: {
          _id: reply.call,
          schemaVersion: 1,
          sentAt: new Date(),
          request: {
            method: 'GET',
            url: reply.call,
            headers: [],
            body: reply.requestBody ?? null,
          },
        },
      },
    };
  });
};

const row = (index: number) =>
  testApp.window
    .getByTestId('history')
    .getByRole('listitem')
    .nth(index)
    .getByRole('button')
    .first();
const requestLine = () => testApp.window.getByTestId('call-request-line');

test.describe('a failed open does not leave the previous call acting as the opened one', () => {
  for (const [label, failure] of [
    ['the database query fails', { failed: 'database down' }],
    ['the call to main rejects', { rejected: 'server went away' }],
  ] as [string, Reply][]) {
    test(label, async () => {
      await stubGetCall([{ call: 'http://a.test/' }, failure]);

      await row(0).click();
      await expect(requestLine()).toContainText('http://a.test/');

      await row(1).click();
      await expect(testApp.window.getByTestId('open-error')).toBeVisible();
      await expect(testApp.window.getByTestId('call-panel')).toHaveCount(0);
    });
  }
});

test('when two opens overlap, the last click wins whichever answer arrives last', async () => {
  await stubGetCall([
    { call: 'http://first-click.test/', hold: true },
    { call: 'http://second-click.test/' },
  ]);

  await row(0).click();
  await row(1).click();
  await expect(requestLine()).toContainText('http://second-click.test/');

  held.release();
  // The held answer reaches the page, then a later round trip and a frame let React commit it.
  await settle(testApp.window);

  await expect(requestLine()).toContainText('http://second-click.test/');
});

// T2.10: a page requested for one body must not appear under the next call. The answers are arranged at the
// network layer, because their order cannot be arranged from outside.
test('a page read for a body no longer shown is ignored', async () => {
  const stored = (fileId: string) => ({ fileId, length: 3 * 1024 * 1024 });
  await stubGetCall([
    { call: 'http://a.test/', requestBody: stored('file-a') },
    { call: 'http://b.test/', requestBody: stored('file-b') },
  ]);
  const readHeld = gate();
  held = readHeld;
  await stubOperation(testApp.window, channels.readBody, async (input) => {
    const { fileId, offset } = input as { fileId: string; offset: number };
    if (fileId === 'file-a' && offset > 0) await readHeld.wait();
    return {
      ok: true,
      bytes: new TextEncoder().encode(`[${fileId}@${offset}]`),
    };
  });
  const body = testApp.window.getByTestId('call-request-body');
  const loadMore = testApp.window.getByRole('button', { name: 'Load more' });

  await row(0).click();
  await expectBodyText(body, '[file-a@0]');
  await loadMore.click();
  await expect(loadMore).toBeDisabled();

  await row(1).click();
  await expectBodyText(body, '[file-b@0]');

  held.release();
  // The held answer reaches the page, then a later round trip and a frame let React commit it.
  await settle(testApp.window);
  await expectBodyText(body, '[file-b@0]');

  // The new body's own Load more is not blocked by the old read, and continues from its own offset.
  await expect(loadMore).toBeEnabled();
  await loadMore.click();
  await expectBodyText(body, '[file-b@0][file-b@10]');
});

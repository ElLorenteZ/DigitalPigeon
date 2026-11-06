// Code review, F7 and F8: what the panel shows when opening a call fails, and when two opens overlap.
// A failing database and response order cannot be arranged from outside, so the main process's
// get-call handler is replaced in this launched app only. Bad clicks here lead to a replay of the wrong
// call, which only the assembled panel shows.
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

type Reply =
  | { call: string; hold?: boolean }
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

const stubGetCall = (replies: Reply[]) =>
  testApp.app.evaluate(
    ({ ipcMain }, { channel, replies }) => {
      const scope = globalThis as unknown as { releaseHeld?: () => void };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async () => {
        const reply = replies.shift() as Reply;
        if ('rejected' in reply) throw new Error(reply.rejected);
        if ('failed' in reply) return { ok: false, message: reply.failed };
        if (reply.hold) {
          await new Promise<void>((resolve) => {
            scope.releaseHeld = resolve;
          });
        }
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
                body: null,
              },
            },
          },
        };
      });
    },
    { channel: channels.getCall, replies },
  );

const row = (index: number) =>
  testApp.window
    .getByTestId('history')
    .getByRole('listitem')
    .nth(index)
    .getByRole('button');
const requestLine = () => testApp.window.getByTestId('call-request-line');

test.describe('a failed open does not leave the previous call acting as the opened one', () => {
  for (const [label, failure] of [
    ['the database query fails', { failed: 'database down' }],
    ['the call to main rejects', { rejected: 'main went away' }],
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

  await testApp.app.evaluate(() => {
    (globalThis as unknown as { releaseHeld: () => void }).releaseHeld();
  });
  // A later round trip to main returns after the held answer, then a frame lets React commit it.
  await testApp.window.evaluate(async () => {
    const { pigeon } = window as unknown as {
      pigeon: { dbStatus: () => Promise<unknown> };
    };
    await pigeon.dbStatus();
    await new Promise(requestAnimationFrame);
  });

  await expect(requestLine()).toContainText('http://second-click.test/');
});

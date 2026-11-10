// Plan phase 6, R1: Edit on a stored multipart call reads the body one page at a time. Only the latest Edit
// may load the form (T2.10), and a failed read must leave the form as it was. Answer order and a failing
// read cannot be arranged from outside, so main's read-body handler is replaced in this launched app only,
// as e2e/open-call-failures.spec.ts does for get-call. The replacement serves the bytes the capture server
// received, which are the stored bytes (phase 1, T1.3).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

let capture: CaptureServer;
let testApp: TestApp;
let dir: string;

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const history = () =>
  testApp.window.getByTestId('history').getByRole('listitem');

// Sends a stored multipart call whose only field holds `value`, and returns its file id and body.
async function sendStored(value: string) {
  const { window } = testApp;
  const path = join(dir, `${value}.txt`);
  await writeFile(path, Buffer.alloc(1536 * 1024, 'x'));
  const rowsBefore = await history().count();
  await window.getByLabel('Method').selectOption('POST');
  await window.getByLabel('URL').fill(`${capture.url}/${value}`);
  await window.getByLabel('Body type').selectOption('multipart');
  // The form keeps parts from the previous send; start from none.
  while ((await window.getByRole('button', { name: 'Remove' }).count()) > 0) {
    await window.getByRole('button', { name: 'Remove' }).first().click();
  }
  await button('Add field').click();
  await window.getByLabel('Part name 1').fill('which');
  await window.getByLabel('Part value 1').fill(value);
  await button('Add file').click();
  await window.getByLabel('Part name 2').fill('upload');
  await window.getByLabel('Part file 2').setInputFiles(path);
  await expect(window.getByTestId('part-file-2')).toContainText(`${value}.txt`);
  await button('Send').click();
  await expect(history()).toHaveCount(rowsBefore + 1, { timeout: 30_000 });

  const fileId = await window.evaluate(async (url) => {
    const { pigeon } = window as unknown as {
      pigeon: {
        listCalls: () => Promise<{
          calls: { send: { _id: string; request: { url: string } } }[];
        }>;
        getCall: (id: string) => Promise<{
          call: { send: { request: { body: { fileId: string } } } };
        }>;
      };
    };
    const listed = await pigeon.listCalls();
    const sent = listed.calls.find((c) => c.send.request.url === url);
    const got = await pigeon.getCall(sent?.send._id ?? '');
    return got.call.send.request.body.fileId;
  }, `${capture.url}/${value}`);
  const body = capture.requests.at(-1)?.body ?? Buffer.alloc(0);
  return { fileId, body: [...body] };
}

// Serves pages from the given bodies; holds the first page of `holdFileId` until released, and fails every read of
// `failFileId`.
const stubReadBody = (
  bodies: Record<string, number[]>,
  options: { holdFileId?: string; failFileId?: string },
) =>
  testApp.app.evaluate(
    ({ ipcMain }, { channel, bodies, options }) => {
      const scope = globalThis as unknown as { releaseHeld?: () => void };
      ipcMain.removeHandler(channel);
      ipcMain.handle(
        channel,
        async (
          _event,
          input: { fileId: string; offset: number; length: number },
        ) => {
          if (input.fileId === options.failFileId) {
            return {
              ok: false,
              message: `The stored body ${input.fileId} is missing`,
            };
          }
          if (input.fileId === options.holdFileId && input.offset === 0) {
            await new Promise<void>((resolve) => {
              scope.releaseHeld = resolve;
            });
          }
          const all = bodies[input.fileId] ?? [];
          return {
            ok: true,
            bytes: new Uint8Array(
              all.slice(input.offset, input.offset + input.length),
            ),
          };
        },
      );
    },
    { channel: channels.readBody, bodies, options },
  );

// A later round trip to main returns after the held answer, then a frame lets React commit it.
const settle = () =>
  testApp.window.evaluate(async () => {
    const { pigeon } = window as unknown as {
      pigeon: { dbStatus: () => Promise<unknown> };
    };
    await pigeon.dbStatus();
    await new Promise(requestAnimationFrame);
  });

test.beforeAll(async () => {
  capture = await startCaptureServer();
  dir = await mkdtemp(join(tmpdir(), 'dp-multipart-edit-'));
  testApp = await launchWithTestDatabase();
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
  await rm(dir, { recursive: true, force: true });
});

test('when two Edits overlap, the form holds the later one whichever read finishes last', async () => {
  const a = await sendStored('from-a');
  const b = await sendStored('from-b');
  await stubReadBody(
    { [a.fileId]: a.body, [b.fileId]: b.body },
    { holdFileId: a.fileId },
  );
  const { window } = testApp;
  const panel = window.getByTestId('call-panel');
  await window.getByLabel('URL').fill('http://untouched.test/');

  // History lists newest first: B, then A.
  await history().nth(1).getByRole('button').click();
  await expect(panel.getByTestId('call-request-line')).toContainText('/from-a');
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();

  await history().nth(0).getByRole('button').click();
  await expect(panel.getByTestId('call-request-line')).toContainText('/from-b');
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(window.getByLabel('Part value 1')).toHaveValue('from-b');

  await testApp.app.evaluate(() => {
    (globalThis as unknown as { releaseHeld: () => void }).releaseHeld();
  });
  await settle();

  await expect(window.getByLabel('Part value 1')).toHaveValue('from-b');
  await expect(window.getByLabel('URL')).toHaveValue(`${capture.url}/from-b`);
});

test('a failed read during Edit shows the reason and leaves the form as it was', async () => {
  const c = await sendStored('from-c');
  await stubReadBody({}, { failFileId: c.fileId });
  const { window } = testApp;
  const panel = window.getByTestId('call-panel');
  await window.getByLabel('Body type').selectOption('json');
  await window.getByLabel('URL').fill('http://untouched.test/');

  await history().nth(0).getByRole('button').click();
  await expect(panel.getByTestId('call-request-line')).toContainText('/from-c');
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();

  await expect(panel.getByTestId('call-edit-error')).toContainText(
    `The stored body ${c.fileId} is missing`,
  );
  await expect(panel.getByTestId('call-edit-error')).toBeInViewport();
  await expect(window.getByLabel('URL')).toHaveValue('http://untouched.test/');
  await expect(window.getByLabel('Body type')).toHaveValue('json');
});

// Code review, 2: while Edit reads a stored body the panel says so, and a change to the form ends the pending Edit.
test('a change to the form while Edit reads a stored body keeps the change', async () => {
  const d = await sendStored('from-d');
  await stubReadBody({ [d.fileId]: d.body }, { holdFileId: d.fileId });
  const { window } = testApp;
  const panel = window.getByTestId('call-panel');

  await history().nth(0).getByRole('button').click();
  await expect(panel.getByTestId('call-request-line')).toContainText('/from-d');
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(panel.getByTestId('call-edit-status')).toHaveText(
    'Loading the call into the form…',
  );

  await window.getByLabel('URL').fill('http://typed-meanwhile.test/');
  await expect(panel.getByTestId('call-edit-status')).toHaveCount(0);
  await testApp.app.evaluate(() => {
    (globalThis as unknown as { releaseHeld: () => void }).releaseHeld();
  });
  await settle();

  await expect(window.getByLabel('URL')).toHaveValue(
    'http://typed-meanwhile.test/',
  );
});

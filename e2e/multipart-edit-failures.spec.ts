// Plan phase 6, R1: Edit on a stored multipart call reads the body one page at a time. Only the latest Edit
// may load the form (T2.10), and a failed read must leave the form as it was. Answer order and a failing
// read cannot be arranged from outside, so the server's read-body answer is replaced at the network layer for this
// page only, as e2e/open-call-failures.spec.ts does for get-call. The replacement serves the bytes the capture server
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
import {
  type TestApp,
  callOperation,
  gate,
  launchWithTestDatabase,
  settle,
  stubOperation,
} from './support';

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

  const url = `${capture.url}/${value}`;
  const listed = (await callOperation(window, channels.listCalls)) as {
    calls: { send: { _id: string; request: { url: string } } }[];
  };
  const sent = listed.calls.find((c) => c.send.request.url === url);
  const got = (await callOperation(
    window,
    channels.getCall,
    sent?.send._id ?? '',
  )) as { call: { send: { request: { body: { fileId: string } } } } };
  const fileId = got.call.send.request.body.fileId;
  const body = capture.requests.at(-1)?.body ?? Buffer.alloc(0);
  return { fileId, body: [...body] };
}

// Serves pages from the given bodies; holds the first page of `holdFileId` until released, and fails every read of
// `failFileId`.
let held = gate();

const stubReadBody = (
  bodies: Record<string, number[]>,
  options: { holdFileId?: string; failFileId?: string },
) => {
  held = gate();
  return stubOperation(testApp.window, channels.readBody, async (input) => {
    const { fileId, offset, length } = input as {
      fileId: string;
      offset: number;
      length: number;
    };
    if (fileId === options.failFileId) {
      return { ok: false, message: `The stored body ${fileId} is missing` };
    }
    if (fileId === options.holdFileId && offset === 0) await held.wait();
    const all = bodies[fileId] ?? [];
    return {
      ok: true,
      bytes: new Uint8Array(all.slice(offset, offset + length)),
    };
  });
};

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

  held.release();
  // The held answer reaches the page, then a later round trip and a frame let React commit it.
  await settle(testApp.window);

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
  held.release();
  // The held answer reaches the page, then a later round trip and a frame let React commit it.
  await settle(testApp.window);

  await expect(window.getByLabel('URL')).toHaveValue(
    'http://typed-meanwhile.test/',
  );
});

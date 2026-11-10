// Slice 4 — a multipart request with a file picked from disk is sent, and replaying it after the file is deleted
// sends the same bytes (roadmap.md, slice 4; test-strategy.md T2.7, T1.4). Encoding and recording are tested
// below this layer; only the assembled app shows the file input, the form state and the real send handler
// connecting. Console errors and uncaught page errors are recorded together (lessons.md, 2026-11-08).
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

let capture: CaptureServer;
let testApp: TestApp;
let dir: string;
const errors: string[] = [];

test.beforeAll(async () => {
  capture = await startCaptureServer();
  dir = await mkdtemp(join(tmpdir(), 'dp-multipart-e2e-'));
  testApp = await launchWithTestDatabase();
  testApp.window.on('console', (message) => {
    if (
      message.type() === 'error' ||
      message.text().includes('Content Security Policy')
    ) {
      errors.push(message.text());
    }
  });
  testApp.window.on('pageerror', (error) => errors.push(error.message));
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

test.beforeEach(() => {
  capture.requests.length = 0;
  errors.length = 0;
});

// Fills the form with a text field and a file part picked from `path`, then sends it.
async function sendMultipart(path: string, url: string) {
  const { window } = testApp;
  const button = (name: string) =>
    window.getByRole('button', { name, exact: true });
  await window.getByLabel('Method').selectOption('POST');
  await window.getByLabel('URL').fill(url);
  await window.getByLabel('Body type').selectOption('multipart');
  await button('Add field').click();
  await window.getByLabel('Part name 1').fill('note');
  await window.getByLabel('Part value 1').fill('zażółć');
  await button('Add file').click();
  await window.getByLabel('Part name 2').fill('upload');
  await window.getByLabel('Part file 2').setInputFiles(path);
  await expect(window.getByTestId('part-file-2')).toContainText(
    path.split('/').at(-1) ?? '',
  );
  await button('Send').click();
}

test('a picked file is sent, deleted from disk, and replayed with the same bytes', async () => {
  const { window } = testApp;
  const history = window.getByTestId('history').getByRole('listitem');
  const path = join(dir, 'upload.bin');
  const file = randomBytes(64 * 1024);
  await writeFile(path, file);
  const rowsBefore = await history.count();

  await sendMultipart(path, `${capture.url}/upload`);
  await expect(history).toHaveCount(rowsBefore + 1);
  await expect(history.first()).toContainText(
    `POST ${capture.url}/upload — 200`,
  );
  expect(capture.requests).toHaveLength(1);
  const first = capture.requests[0];
  expect(first?.body.includes(file)).toBe(true);
  expect(first?.body.includes(Buffer.from('zażółć'))).toBe(true);

  await rm(path);
  expect(existsSync(path)).toBe(false);

  await history.first().getByRole('button').click();
  await window.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(history).toHaveCount(rowsBefore + 2);
  await expect(history.first()).toContainText(
    `POST ${capture.url}/upload — 200`,
  );

  expect(capture.requests).toHaveLength(2);
  const second = capture.requests[1];
  expect(second?.rawHeaders).toEqual(first?.rawHeaders);
  expect(second?.body.equals(first?.body ?? Buffer.alloc(1))).toBe(true);
  expect(errors).toEqual([]);
});

test('a 17 MiB file goes through the form and the send handler in full', async () => {
  const { window } = testApp;
  const history = window.getByTestId('history').getByRole('listitem');
  const path = join(dir, 'large.bin');
  const file = randomBytes(17 * 1024 * 1024);
  await writeFile(path, file);
  const rowsBefore = await history.count();

  await sendMultipart(path, `${capture.url}/large`);
  await expect(history).toHaveCount(rowsBefore + 1, { timeout: 30_000 });
  await expect(history.first()).toContainText(
    `POST ${capture.url}/large — 200`,
  );
  expect(capture.requests).toHaveLength(1);
  const received = capture.requests[0]?.body ?? Buffer.alloc(0);
  expect(received.length).toBeGreaterThan(file.length);
  expect(received.includes(file)).toBe(true);
  expect(errors).toEqual([]);
});

// Plan phase 6: the panel lists the parts, and Edit then Send resends the same body (T2.12 at the
// assembled app; T2.9 for what an action brings into view).
for (const [label, size, unit] of [
  ['inline', 1024, '1.0 KiB'],
  ['stored', 3 * 1024 * 1024, '3.0 MiB'],
] as const) {
  test(`${label}: the panel lists the parts, and Edit then Send resends the same body`, async () => {
    const { window } = testApp;
    const history = window.getByTestId('history').getByRole('listitem');
    const panel = window.getByTestId('call-panel');
    const path = join(dir, `notes-${label}.txt`);
    await writeFile(path, Buffer.alloc(size, 'n'));
    const rowsBefore = await history.count();

    await sendMultipart(path, `${capture.url}/edit-${label}`);
    await expect(history).toHaveCount(rowsBefore + 1, { timeout: 30_000 });
    await rm(path);

    await history.first().getByRole('button').click();
    const parts = panel.getByTestId('call-request-parts').getByRole('listitem');
    await expect(parts).toHaveText([
      'note · text · 10 B',
      `upload · notes-${label}.txt · text/plain · ${unit}`,
    ]);
    await expect(panel.getByTestId('call-request-parts')).toBeInViewport();

    await panel.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(window.getByLabel('Part value 1')).toHaveValue('zażółć');
    await expect(window.getByTestId('part-file-2')).toContainText(
      `notes-${label}.txt`,
    );
    await expect(window.getByLabel('Part name 1')).toBeInViewport();

    await window.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(history).toHaveCount(rowsBefore + 2, { timeout: 30_000 });
    expect(capture.requests).toHaveLength(2);
    const [first, second] = capture.requests;
    expect(second?.rawHeaders).toEqual(first?.rawHeaders);
    expect(second?.body.equals(first?.body ?? Buffer.alloc(1))).toBe(true);
    expect(errors).toEqual([]);
  });
}

// Code review of multipart-with-file-copies, #1 and #7: the parts editor while a file is read, and after a row
// is removed. The read is held by wrapping File.prototype.arrayBuffer in the page, to arrange timing only.
test.describe('the parts editor', () => {
  const holdReads = () =>
    testApp.window.evaluate(() => {
      const scope = window as unknown as {
        originalArrayBuffer?: () => Promise<ArrayBuffer>;
        releaseRead?: () => void;
      };
      scope.originalArrayBuffer = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function (this: File) {
        return new Promise<ArrayBuffer>((resolve) => {
          scope.releaseRead = () =>
            resolve(scope.originalArrayBuffer?.call(this) as never);
        });
      };
    });
  const releaseRead = () =>
    testApp.window.evaluate(() => {
      const scope = window as unknown as {
        originalArrayBuffer: () => Promise<ArrayBuffer>;
        releaseRead: () => void;
      };
      scope.releaseRead();
      File.prototype.arrayBuffer = scope.originalArrayBuffer;
    });

  const startMultipart = async () => {
    const { window } = testApp;
    await window.getByLabel('Body type').selectOption('multipart');
    const remove = window.getByRole('button', { name: 'Remove' });
    while ((await remove.count()) > 0) await remove.first().click();
  };
  const button = (name: string) =>
    testApp.window.getByRole('button', { name, exact: true });

  test('edits made while a file is read are kept, and the file lands in its own row', async () => {
    const { window } = testApp;
    const path = join(dir, 'held.txt');
    await writeFile(path, 'held');
    await startMultipart();
    await button('Add file').click();
    await window.getByLabel('Part name 1').fill('upload');
    await holdReads();
    await window.getByLabel('Part file 1').setInputFiles(path);

    await window.getByLabel('Part name 1').fill('renamed');
    await button('Add field').click();
    await window.getByLabel('Part name 2').fill('later');
    await releaseRead();

    await expect(window.getByTestId('part-file-1')).toContainText('held.txt');
    await expect(window.getByLabel('Part name 1')).toHaveValue('renamed');
    await expect(window.getByLabel('Part name 2')).toHaveValue('later');
  });

  test('a file read for a row removed meanwhile lands nowhere', async () => {
    const { window } = testApp;
    const path = join(dir, 'removed.txt');
    await writeFile(path, 'removed');
    await startMultipart();
    await button('Add file').click();
    await button('Add field').click();
    await window.getByLabel('Part name 2').fill('kept');
    await holdReads();
    await window.getByLabel('Part file 1').setInputFiles(path);

    await window.getByRole('button', { name: 'Remove' }).first().click();
    await releaseRead();
    await testApp.window.evaluate(() => new Promise(requestAnimationFrame));

    await expect(window.getByLabel('Part name 1')).toHaveValue('kept');
    await expect(window.getByLabel('Part value 1')).toBeVisible();
    await expect(window.getByTestId('part-file-1')).toHaveCount(0);
  });

  test('after a row is removed, no file input shows the removed row’s file', async () => {
    const { window } = testApp;
    const a = join(dir, 'first.txt');
    const b = join(dir, 'second.txt');
    await writeFile(a, 'a');
    await writeFile(b, 'b');
    await startMultipart();
    await button('Add file').click();
    await window.getByLabel('Part file 1').setInputFiles(a);
    await expect(window.getByTestId('part-file-1')).toContainText('first.txt');
    await button('Add file').click();
    await window.getByLabel('Part file 2').setInputFiles(b);
    await expect(window.getByTestId('part-file-2')).toContainText('second.txt');

    await window.getByRole('button', { name: 'Remove' }).first().click();

    await expect(window.getByTestId('part-file-1')).toContainText('second.txt');
    expect(await window.getByLabel('Part file 1').inputValue()).not.toContain(
      'first.txt',
    );
  });
});

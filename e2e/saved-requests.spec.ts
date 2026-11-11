// Slice 5, phase 4: saved requests in the app (plan.md). Save the form under a name, find it in the list, open it, save
// over it or as new, delete it; a call sent from it links back. Storage is tested below this layer (phase 3); only the
// assembled app shows the list, the form's link and the call panel connecting (test-strategy.md T2.7, T2.9, T2.10).
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
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
let other: CaptureServer;
let testApp: TestApp;
let dir: string;
const errors: string[] = [];

test.beforeAll(async () => {
  capture = await startCaptureServer();
  other = await startCaptureServer();
  dir = await mkdtemp(join(tmpdir(), 'dp-saved-e2e-'));
  testApp = await launchWithTestDatabase();
  testApp.window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
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
  await other?.close();
  await rm(dir, { recursive: true, force: true });
});

test.beforeEach(() => {
  capture.requests.length = 0;
  other.requests.length = 0;
  errors.length = 0;
});

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const saved = () =>
  testApp.window.getByTestId('saved-requests').getByRole('listitem');
const history = () =>
  testApp.window.getByTestId('history').getByRole('listitem');

// Wraps main's real handler for a channel so its first answer waits for release(); restore() puts the real one back.
// Reads Electron's private ipcMain._invokeHandlers, as the overlap scenario below does.
async function holdFirstAnswer(channel: string) {
  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as Record<string, unknown>;
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
      }
    )._invokeHandlers;
    const original = handlers.get(channel);
    scope[`original:${channel}`] = original;
    // The gate exists before any call arrives, so release() works whenever it is called.
    const gate = new Promise<void>((resolve) => {
      scope[`release:${channel}`] = resolve;
    });
    let held = false;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      const answer = await original?.(event, ...args);
      if (!held) {
        held = true;
        await gate;
      }
      return answer;
    });
  }, channel);
  return {
    release: async () => {
      await testApp.app.evaluate((_electron, channel) => {
        const scope = globalThis as unknown as Record<string, () => void>;
        scope[`release:${channel}`]?.();
      }, channel);
      // A later round trip to main returns after the held answer, then a frame lets React commit it.
      await testApp.window.evaluate(async () => {
        const { pigeon } = window as unknown as {
          pigeon: { dbStatus: () => Promise<unknown> };
        };
        await pigeon.dbStatus();
        await new Promise(requestAnimationFrame);
      });
    },
    restore: () =>
      testApp.app.evaluate(({ ipcMain }, channel) => {
        const scope = globalThis as unknown as Record<
          string,
          (...a: unknown[]) => unknown
        >;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, scope[`original:${channel}`] as never);
      }, channel),
  };
}

test('save, find, open, save over, save as new, send with a link back, and delete', async () => {
  const { window } = testApp;
  const panel = window.getByTestId('call-panel');
  const url = `${capture.url}/orders`;

  await button('New').click();
  await window.getByLabel('URL').fill(url);
  await button('Add header').click();
  await window.getByLabel('Header name 1').fill('X-Version');
  await window.getByLabel('Header value 1').fill('one');
  await window.getByLabel('Saved request name').fill('Get orders');
  await button('Save').click();
  await expect(saved()).toHaveText([`Get orders — GET ${url}Delete`]);
  await expect(window.getByTestId('saved-request-link')).toHaveText(
    'Editing saved request: Get orders',
  );

  // Save over it, then open it from an empty form.
  await window.getByLabel('Header value 1').fill('two');
  await button('Save').click();
  await button('New').click();
  await expect(window.getByLabel('URL')).toHaveValue('');
  await expect(window.getByTestId('saved-request-link')).toHaveCount(0);
  await saved()
    .first()
    .getByRole('button', { name: /^Get orders/ })
    .click();
  await expect(window.getByLabel('URL')).toHaveValue(url);
  await expect(window.getByLabel('Header value 1')).toHaveValue('two');
  await expect(window.getByLabel('URL')).toBeInViewport();

  // Save as new keeps the original and links the form to the copy.
  await window.getByLabel('Saved request name').fill('Get orders copy');
  await button('Save as new').click();
  await expect(saved()).toHaveCount(2);
  await expect(window.getByTestId('saved-request-link')).toHaveText(
    'Editing saved request: Get orders copy',
  );

  // A call sent from a saved request links back to it.
  await saved()
    .first()
    .getByRole('button', { name: /^Get orders —/ })
    .click();
  await button('Send').click();
  await expect(history().first()).toContainText(`GET ${url} — 200`);
  await history().first().getByRole('button').click();
  await expect(panel.getByTestId('call-saved-request')).toHaveText(
    'From saved request: Get orders',
  );

  // Deleting it leaves the call, which now says its saved request was deleted.
  await saved()
    .filter({ hasText: /^Get orders — / })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(saved()).toHaveCount(1);
  await expect(saved().first()).toBeInViewport();
  await history().first().getByRole('button').click();
  await expect(panel.getByTestId('call-saved-request')).toHaveText(
    'From a deleted saved request',
  );
  expect(errors).toEqual([]);
});

// Review R2: the form still names a saved request deleted since it was opened. The send goes out and records no link.
test('a send from a saved request deleted after it was opened records no link', async () => {
  const { window } = testApp;
  const panel = window.getByTestId('call-panel');
  await button('New').click();
  await window.getByLabel('URL').fill(`${capture.url}/r2`);
  await window.getByLabel('Saved request name').fill('Soon gone');
  await button('Save').click();
  await saved()
    .filter({ hasText: /^Soon gone — / })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(saved().filter({ hasText: /^Soon gone/ })).toHaveCount(0);

  await button('Send').click();
  await expect(history().first()).toContainText(`GET ${capture.url}/r2 — 200`);
  await history().first().getByRole('button').click();
  await expect(panel.getByTestId('call-request-line')).toContainText('/r2');
  await expect(panel.getByTestId('call-saved-request')).toHaveCount(0);
});

test('a saved request with a 17 MiB file sends the same bytes after the file is deleted from disk', async () => {
  const { window } = testApp;
  const path = join(dir, 'upload.bin');
  const file = randomBytes(17 * 1024 * 1024);
  await writeFile(path, file);

  await button('New').click();
  await window.getByLabel('Method').selectOption('POST');
  await window.getByLabel('URL').fill(`${capture.url}/upload`);
  await window.getByLabel('Body type').selectOption('multipart');
  await button('Add file').click();
  await window.getByLabel('Part name 1').fill('upload');
  await window.getByLabel('Part file 1').setInputFiles(path);
  await expect(window.getByTestId('part-file-1')).toContainText('upload.bin');
  await window.getByLabel('Saved request name').fill('Upload');
  await button('Save').click();
  await expect(saved().filter({ hasText: /^Upload — / })).toHaveCount(1, {
    timeout: 30_000,
  });

  await rm(path);
  expect(existsSync(path)).toBe(false);
  await button('New').click();
  await saved()
    .filter({ hasText: /^Upload — / })
    .getByRole('button', { name: /^Upload/ })
    .click();
  await expect(window.getByTestId('part-file-1')).toContainText('upload.bin', {
    timeout: 30_000,
  });
  await button('Send').click();
  await expect(history().first()).toContainText(`POST ${capture.url}/upload`, {
    timeout: 30_000,
  });
  const received = capture.requests[0]?.body ?? Buffer.alloc(0);
  expect(received.includes(file)).toBe(true);
  expect(errors).toEqual([]);
});

// Plan phase 5, the slice outcome (roadmap.md slice 5): one saved request with a path, two environments; switching
// sends the same saved request to the other baseUrl; each call names its environment and links back; Replay keeps
// both; Edit loads an unlinked form with the path restored, and saving it leaves the original unchanged.
test('one saved request goes to whichever environment is chosen, and calls keep where they went and where they came from', async () => {
  const { window } = testApp;
  const panel = window.getByTestId('call-panel');
  const select = window.getByLabel('Environment', { exact: true });
  const addEnvironment = async (name: string, baseUrl: string) => {
    await window.getByLabel('New environment name').fill(name);
    await window.getByLabel('New environment base address').fill(baseUrl);
    await button('Add environment').click();
    await expect(
      select.getByRole('option', { name: `${name} — ${baseUrl}` }),
    ).toHaveCount(1);
  };
  await addEnvironment('first', `${capture.url}/v1`);
  await addEnvironment('second', `${other.url}/v2`);

  await button('New').click();
  await window.getByLabel('URL').fill('/orders');
  await window.getByLabel('Saved request name').fill('Orders');
  await button('Save').click();
  const orders = () =>
    saved()
      .filter({ hasText: /^Orders — GET \/orders/ })
      .getByRole('button', { name: /^Orders/ });

  await select.selectOption({ label: `first — ${capture.url}/v1` });
  await orders().click();
  await button('Send').click();
  await expect(history().first()).toContainText(
    `GET ${capture.url}/v1/orders — 200`,
  );

  await select.selectOption({ label: `second — ${other.url}/v2` });
  await orders().click();
  await button('Send').click();
  await expect(history().first()).toContainText(
    `GET ${other.url}/v2/orders — 200`,
  );
  expect(capture.requests.map((q) => q.url)).toEqual(['/v1/orders']);
  expect(other.requests.map((q) => q.url)).toEqual(['/v2/orders']);

  // Each call names the environment it went to and links to the saved request.
  await history().nth(1).getByRole('button').click();
  await expect(panel.getByTestId('call-environment')).toHaveText(
    `Environment: first — ${capture.url}/v1`,
  );
  await expect(panel.getByTestId('call-saved-request')).toHaveText(
    'From saved request: Orders',
  );

  // Replay of the first call goes where it went, and keeps both.
  await button('Replay').click();
  await expect(history().first()).toContainText(
    `GET ${capture.url}/v1/orders — 200`,
  );
  expect(capture.requests).toHaveLength(2);
  await history().first().getByRole('button').click();
  await expect(panel.getByTestId('call-environment')).toHaveText(
    `Environment: first — ${capture.url}/v1`,
  );
  await expect(panel.getByTestId('call-saved-request')).toHaveText(
    'From saved request: Orders',
  );

  // Edit of the first call: unlinked, path restored; saved as a new request that follows the environment.
  await history().nth(2).getByRole('button').click();
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(window.getByLabel('URL')).toHaveValue('/orders');
  await expect(window.getByTestId('saved-request-link')).toHaveCount(0);
  await button('Add header').click();
  await window.getByLabel('Header name 1').fill('X-Edited');
  await window.getByLabel('Header value 1').fill('yes');
  await window.getByLabel('Saved request name').fill('Orders edited');
  await button('Save').click();
  await expect(window.getByTestId('saved-request-link')).toHaveText(
    'Editing saved request: Orders edited',
  );
  await button('Send').click();
  await expect(history().first()).toContainText(
    `GET ${other.url}/v2/orders — 200`,
  );
  expect(other.requests).toHaveLength(2);

  // The original saved request is unchanged.
  await orders().click();
  await expect(window.getByLabel('URL')).toHaveValue('/orders');
  await expect(window.getByLabel('Header name 1')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Code review of saved-requests-and-environments, #1: a save that finishes after New must not link the new form.
test('a save that finishes after New leaves the new form unlinked', async () => {
  const { window } = testApp;
  await button('New').click();
  await window.getByLabel('URL').fill(`${capture.url}/cr1`);
  await window.getByLabel('Saved request name').fill('CR1');
  const save = await holdFirstAnswer(channels.saveSavedRequest);
  await button('Save').click();
  await button('New').click();
  await save.release();
  await save.restore();

  await expect(saved().filter({ hasText: /^CR1 — / })).toHaveCount(1);
  await expect(window.getByTestId('saved-request-link')).toHaveCount(0);
  await expect(window.getByLabel('URL')).toHaveValue('');
});

// Second code review, #1: a second Save while the first is in flight must not create a second saved request.
test('Save is unavailable while a save is in flight, so one press makes one saved request', async () => {
  const { window } = testApp;
  await button('New').click();
  await window.getByLabel('URL').fill(`${capture.url}/double`);
  await window.getByLabel('Saved request name').fill('Double');
  const save = await holdFirstAnswer(channels.saveSavedRequest);
  await button('Save').click();
  if (await button('Save').isEnabled()) await button('Save').click();
  await expect(button('Save')).toBeDisabled();
  await save.release();
  await save.restore();

  await expect(button('Save')).toBeEnabled();
  await expect(saved().filter({ hasText: /^Double — / })).toHaveCount(1);
});

// Code review #2: an open that answers after the form changed must not replace it.
test('typing while a saved request opens keeps what was typed', async () => {
  const { window } = testApp;
  await button('New').click();
  await window.getByLabel('URL').fill(`${capture.url}/cr2`);
  await window.getByLabel('Saved request name').fill('CR2');
  await button('Save').click();
  await expect(saved().filter({ hasText: /^CR2 — / })).toHaveCount(1);
  await button('New').click();

  const open = await holdFirstAnswer(channels.getSavedRequest);
  await saved()
    .filter({ hasText: /^CR2 — / })
    .getByRole('button', { name: /^CR2/ })
    .click();
  await window.getByLabel('URL').fill('http://typed-meanwhile.test/');
  await open.release();
  await open.restore();

  await expect(window.getByLabel('URL')).toHaveValue(
    'http://typed-meanwhile.test/',
  );
  await expect(window.getByTestId('saved-request-link')).toHaveCount(0);
});

// Code review #4: a call whose saved request is missing from a list that failed to load is not called deleted.
test('a call linked to a saved request the list could not load is not called deleted', async () => {
  const { window } = testApp;
  const panel = window.getByTestId('call-panel');
  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope[`original:${channel}`] = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
      }
    )._invokeHandlers.get(channel);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => ({ ok: false, message: 'list unavailable' }));
  }, channels.listSavedRequests);

  await button('New').click();
  await window.getByLabel('URL').fill(`${capture.url}/cr4`);
  await window.getByLabel('Saved request name').fill('CR4');
  await button('Save').click();
  await expect(window.getByTestId('saved-requests-error')).toContainText(
    'list unavailable',
  );
  await button('Send').click();
  await expect(history().first()).toContainText(`GET ${capture.url}/cr4 — 200`);
  await history().first().getByRole('button').click();
  await expect(panel.getByTestId('call-saved-request')).toHaveText(
    'From a saved request',
  );

  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, scope[`original:${channel}`] as never);
  }, channels.listSavedRequests);
});

// T2.10: opening one saved request and then another, the form holds the later one whichever answer arrives last. The
// get handler is replaced to hold the first answer, so this runs last.
test('when two opens overlap, the form holds the later saved request', async () => {
  const { window } = testApp;
  await button('New').click();
  await window.getByLabel('URL').fill(`${capture.url}/first`);
  await window.getByLabel('Saved request name').fill('Overlap first');
  await button('Save').click();
  await button('New').click();
  await window.getByLabel('URL').fill(`${capture.url}/second`);
  await window.getByLabel('Saved request name').fill('Overlap second');
  await button('Save').click();
  await expect(saved().filter({ hasText: /^Overlap/ })).toHaveCount(2);

  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as {
      releaseHeld?: () => void;
      heldOnce?: boolean;
    };
    const original = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
      }
    )._invokeHandlers.get(channel);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, id) => {
      const answer = await original?.(event, id);
      if (!scope.heldOnce) {
        scope.heldOnce = true;
        await new Promise<void>((resolve) => {
          scope.releaseHeld = resolve;
        });
      }
      return answer;
    });
  }, channels.getSavedRequest);

  await button('New').click();
  await saved()
    .filter({ hasText: /^Overlap first/ })
    .getByRole('button', { name: /^Overlap first/ })
    .click();
  await saved()
    .filter({ hasText: /^Overlap second/ })
    .getByRole('button', { name: /^Overlap second/ })
    .click();
  await expect(window.getByLabel('URL')).toHaveValue(`${capture.url}/second`);

  await testApp.app.evaluate(() => {
    (globalThis as unknown as { releaseHeld: () => void }).releaseHeld();
  });
  await window.evaluate(async () => {
    const { pigeon } = window as unknown as {
      pigeon: { dbStatus: () => Promise<unknown> };
    };
    await pigeon.dbStatus();
    await new Promise(requestAnimationFrame);
  });
  await expect(window.getByLabel('URL')).toHaveValue(`${capture.url}/second`);
  await expect(window.getByTestId('saved-request-link')).toHaveText(
    'Editing saved request: Overlap second',
  );
});

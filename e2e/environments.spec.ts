// Slice 5, phase 2: environments in the app (plan.md). A path typed in the form goes to the environment the select
// shows; switching and sending at once goes to the new one (plan revision 2, B1); each call names the environment it
// was sent against, as it was then. Composition and recording are tested below this layer (phase 1); only the
// assembled app shows the select, the send handler and the panel connecting (test-strategy.md T2.7, T2.9).
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

let a: CaptureServer;
let b: CaptureServer;
let testApp: TestApp;
const errors: string[] = [];

test.beforeAll(async () => {
  a = await startCaptureServer();
  b = await startCaptureServer();
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
  await a?.close();
  await b?.close();
});

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });

// The row number of the saved environment with this name (rows are listed by name).
async function rowOf(name: string): Promise<number> {
  const names = testApp.window
    .getByTestId('environments')
    .getByLabel(/^Environment name \d+$/);
  const values = await names.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
  const index = values.indexOf(name);
  if (index === -1) throw new Error(`no environment named ${name}`);
  return index + 1;
}

async function addEnvironment(name: string, baseUrl: string) {
  const { window } = testApp;
  await window.getByLabel('New environment name').fill(name);
  await window.getByLabel('New environment base address').fill(baseUrl);
  await button('Add environment').click();
}

test('a path goes to the chosen environment, a switch takes effect at once, and calls keep the environment they used', async () => {
  const { window } = testApp;
  const history = window.getByTestId('history').getByRole('listitem');
  const panel = window.getByTestId('call-panel');
  const select = window.getByLabel('Environment', { exact: true });

  await addEnvironment('alpha', `${a.url}/api`);
  await addEnvironment('beta', `${b.url}/api/`);
  await expect(select.getByRole('option')).toHaveText([
    'None',
    `alpha — ${a.url}/api`,
    `beta — ${b.url}/api/`,
  ]);

  await select.selectOption({ label: `alpha — ${a.url}/api` });
  await window.getByLabel('URL').fill('/orders?x=1');
  await button('Send').click();
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText(`GET ${a.url}/api/orders?x=1`);
  expect(a.requests.map((r) => r.url)).toEqual(['/api/orders?x=1']);

  // B1: no wait between the switch and the send.
  await select.selectOption({ label: `beta — ${b.url}/api/` });
  await button('Send').click();
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText(`GET ${b.url}/api/orders?x=1`);
  expect(b.requests.map((r) => r.url)).toEqual(['/api/orders?x=1']);
  expect(a.requests).toHaveLength(1);

  await history.nth(1).getByRole('button').click();
  await expect(panel.getByTestId('call-environment')).toHaveText(
    `Environment: alpha — ${a.url}/api`,
  );

  // Editing alpha leaves the earlier call as it was recorded.
  const alpha = await rowOf('alpha');
  await window
    .getByLabel(`Environment base address ${alpha}`)
    .fill(`${a.url}/v2`);
  await window.getByLabel(`Environment name ${alpha}`).fill('alpha2');
  await button(`Save environment ${alpha}`).click();
  await expect(select.getByRole('option')).toContainText([
    `alpha2 — ${a.url}/v2`,
  ]);
  await history.first().getByRole('button').click();
  await history.nth(1).getByRole('button').click();
  await expect(panel.getByTestId('call-environment')).toHaveText(
    `Environment: alpha — ${a.url}/api`,
  );

  // Copy as curl from the form composes with the environment the select shows.
  await select.selectOption({ label: `alpha2 — ${a.url}/v2` });
  await button('Copy as curl').click();
  await expect(window.getByTestId('form-curl')).toContainText(
    `${a.url}/v2/orders?x=1`,
  );
  expect(errors).toEqual([]);
});

test('a refused base URL says why, and deleting the chosen environment leaves None, so a path is refused in view', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  const history = window.getByTestId('history').getByRole('listitem');

  await addEnvironment('bad', 'https://a.test/v1?x=1');
  await expect(window.getByTestId('environments-error')).toContainText(
    'cannot have a query',
  );

  await addEnvironment('gone', `${b.url}/gone`);
  await select.selectOption({ label: `gone — ${b.url}/gone` });
  await button(`Delete environment ${await rowOf('gone')}`).click();
  await expect(select).toHaveValue('');

  const rowsBefore = await history.count();
  await window.getByLabel('URL').fill('/orders');
  await button('Send').click();
  const result = window.getByTestId('result');
  await expect(result).toContainText('Not sent');
  await expect(result).toContainText('choose an environment');
  await expect(result).toBeInViewport();
  await expect(history).toHaveCount(rowsBefore);

  // Copy as curl refuses the path for the same reason (plan phase 2; review F1).
  await button('Copy as curl').click();
  await expect(window.getByTestId('form-curl-error')).toContainText(
    'choose an environment',
  );
  expect(errors).toEqual([]);
});

// Code review #5: the startup choice is stored in the order the choices were made.
test('two quick choices store the later one for startup', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await addEnvironment('early', `${a.url}/early`);
  await addEnvironment('late', `${b.url}/late`);

  // Hold the first save of the choice in main, as the B1 scenario below does, but wrap the real handler.
  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as Record<string, unknown>;
    const original = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
      }
    )._invokeHandlers.get(channel);
    scope.originalSetActive = original;
    let held = false;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, id) => {
      if (held) return original?.(event, id);
      held = true;
      await new Promise<void>((resolve) => {
        scope.releaseFirstChoice = resolve;
      });
      const answer = await original?.(event, id);
      (scope.firstChoiceStored as () => void)();
      return answer;
    });
    scope.firstChoiceDone = new Promise<void>((resolve) => {
      scope.firstChoiceStored = resolve;
    });
  }, channels.setActiveEnvironment);

  await select.selectOption({ label: `early — ${a.url}/early` });
  await select.selectOption({ label: `late — ${b.url}/late` });
  const lateId = await select.inputValue();
  await testApp.app.evaluate(() => {
    (
      globalThis as unknown as { releaseFirstChoice: () => void }
    ).releaseFirstChoice();
  });
  // The held first choice has now been stored; anything queued behind it has had its turn too.
  await testApp.app.evaluate(
    () =>
      (globalThis as unknown as { firstChoiceDone: Promise<void> })
        .firstChoiceDone,
  );
  await expect
    .poll(() =>
      window.evaluate(async () => {
        const { pigeon } = window as unknown as {
          pigeon: {
            listEnvironments: () => Promise<{ activeId?: string | null }>;
          };
        };
        return (await pigeon.listEnvironments()).activeId;
      }),
    )
    .toBe(lateId);

  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as { originalSetActive: never };
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, scope.originalSetActive);
  }, channels.setActiveEnvironment);
});

// Second code review, #5: one failed save of the choice does not stop later choices from being saved.
test('after one choice fails to be stored, a later choice is stored', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await addEnvironment('fails', `${a.url}/fails`);
  await addEnvironment('recovers', `${b.url}/recovers`);

  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as Record<string, unknown>;
    const original = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
      }
    )._invokeHandlers.get(channel);
    scope.originalSetActive = original;
    let failed = false;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, id) => {
      if (!failed) {
        failed = true;
        throw new Error('store refused once');
      }
      return original?.(event, id);
    });
  }, channels.setActiveEnvironment);

  await select.selectOption({ label: `fails — ${a.url}/fails` });
  await expect(window.getByTestId('environments-error')).toContainText(
    'store refused once',
  );
  await select.selectOption({ label: `recovers — ${b.url}/recovers` });
  const recoversId = await select.inputValue();
  await expect
    .poll(() =>
      window.evaluate(async () => {
        const { pigeon } = window as unknown as {
          pigeon: {
            listEnvironments: () => Promise<{ activeId?: string | null }>;
          };
        };
        return (await pigeon.listEnvironments()).activeId;
      }),
    )
    .toBe(recoversId);

  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as { originalSetActive: never };
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, scope.originalSetActive);
  }, channels.setActiveEnvironment);
});

// B1, made deterministic: the switch's save is held in main while the send runs. A send that read the stored setting
// would go to the old environment; one that names its environment goes to the new one. Replaces the handler for the
// rest of this launch, so it runs last.
test('a send while the switch is still being saved goes to the environment the select shows', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  const history = window.getByTestId('history').getByRole('listitem');
  await addEnvironment('first', `${a.url}/first`);
  await addEnvironment('second', `${b.url}/second`);
  await select.selectOption({ label: `first — ${a.url}/first` });
  await expect(select).toHaveValue(/.+/);
  // Wait until main has stored "first" as active, so the held save below is the only one pending.
  const firstId = await select.inputValue();
  await expect
    .poll(() =>
      window.evaluate(async () => {
        const { pigeon } = window as unknown as {
          pigeon: {
            listEnvironments: () => Promise<{ activeId?: string | null }>;
          };
        };
        return (await pigeon.listEnvironments()).activeId;
      }),
    )
    .toBe(firstId);

  await testApp.app.evaluate(({ ipcMain }, channel) => {
    const scope = globalThis as unknown as { releaseHeld?: () => void };
    ipcMain.removeHandler(channel);
    ipcMain.handle(
      channel,
      () =>
        new Promise((resolve) => {
          scope.releaseHeld = () => resolve({ ok: true });
        }),
    );
  }, channels.setActiveEnvironment);

  const rowsBefore = await history.count();
  b.requests.length = 0;
  await select.selectOption({ label: `second — ${b.url}/second` });
  await window.getByLabel('URL').fill('/held');
  await button('Send').click();
  await expect(history).toHaveCount(rowsBefore + 1);
  expect(b.requests.map((r) => r.url)).toEqual(['/second/held']);

  await testApp.app.evaluate(() => {
    (globalThis as unknown as { releaseHeld: () => void }).releaseHeld();
  });
});

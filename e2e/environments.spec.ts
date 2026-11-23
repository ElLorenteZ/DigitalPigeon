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
import {
  callOperation,
  containing,
  gate,
  launchWithTestDatabase,
  openEnvironments,
  rowName,
  settle,
  showRequest,
  showSidebarTab,
  stubOperation,
  type TestApp,
} from './support';

const activeId = async () =>
  (
    (await callOperation(testApp.window, channels.listEnvironments)) as {
      activeId?: string | null;
    }
  ).activeId;

let a: CaptureServer;
let b: CaptureServer;
let c: CaptureServer;
let testApp: TestApp;
const errors: string[] = [];

test.beforeAll(async () => {
  a = await startCaptureServer();
  b = await startCaptureServer();
  c = await startCaptureServer();
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
  await c?.close();
});

// Each test starts on the request form with History shown (slice 6: the shell keeps one view at a time).
test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
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
  await openEnvironments(window);
  await window.getByLabel('New environment name').fill(name);
  await window.getByLabel('New environment base address').fill(baseUrl);
  await button('Add environment').click();
}

test('a path goes to the chosen environment, a switch takes effect at once, and calls keep the environment they used', async () => {
  const { window } = testApp;
  await showSidebarTab(window, 'History');
  const history = window.getByTestId('history').getByRole('listitem');
  const panel = window.getByTestId('call-panel');
  const select = window.getByLabel('Environment', { exact: true });

  await addEnvironment('alpha', `${a.url}/api`);
  await addEnvironment('beta', `${b.url}/api/`);
  await expect(select.getByRole('option')).toHaveText([
    'All',
    `alpha — ${a.url}/api`,
    `beta — ${b.url}/api/`,
  ]);

  await select.selectOption({ label: `alpha — ${a.url}/api` });
  await window.getByLabel('URL').fill('/orders?x=1');
  await button('Send').click();
  await expect(history).toHaveCount(1);
  await expect(rowName(history.first())).toHaveAccessibleName(
    containing(`GET ${a.url}/api/orders?x=1`),
  );
  expect(a.requests.map((r) => r.url)).toEqual(['/api/orders?x=1']);

  // B1: no wait between the switch and the send.
  await select.selectOption({ label: `beta — ${b.url}/api/` });
  await button('Send').click();
  // History lists the chosen environment's calls (environment-aware-history).
  await expect(rowName(history.first())).toHaveAccessibleName(
    containing(`GET ${b.url}/api/orders?x=1`),
  );
  await expect(history).toHaveCount(1);
  expect(b.requests.map((r) => r.url)).toEqual(['/api/orders?x=1']);
  expect(a.requests).toHaveLength(1);
  await select.selectOption({ label: 'All' });
  await expect(history).toHaveCount(2);

  await history.nth(1).getByRole('button').first().click();
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
  await history.first().getByRole('button').first().click();
  await history.nth(1).getByRole('button').first().click();
  await expect(panel.getByTestId('call-environment')).toHaveText(
    `Environment: alpha — ${a.url}/api`,
  );

  // Copy as curl from the form composes with the environment the select shows.
  await select.selectOption({ label: `alpha2 — ${a.url}/v2` });
  await showRequest(window);
  await button('Copy as curl').click();
  await expect(window.getByTestId('form-curl')).toContainText(
    `${a.url}/v2/orders?x=1`,
  );
  expect(errors).toEqual([]);
});

test('a refused base URL says why, and deleting the chosen environment leaves All, so a path is refused in view', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await showSidebarTab(window, 'History');
  const history = window.getByTestId('history').getByRole('listitem');

  await addEnvironment('bad', 'https://a.test/v1?x=1');
  await expect(window.getByTestId('environments-error')).toContainText(
    'cannot have a query',
  );

  await addEnvironment('gone', `${b.url}/gone`);
  await select.selectOption({ label: `gone — ${b.url}/gone` });
  await button(`Delete environment ${await rowOf('gone')}`).click();
  await expect(select).toHaveValue('');
  // environment-aware-history, phase 3: "All" replaces "None"; a path is still refused with it.
  await expect(select.locator('option:checked')).toHaveText('All');

  // The select now shows All: wait for History to list every call before counting (environment-aware-history).
  const all = (await callOperation(window, channels.listCalls)) as {
    calls: unknown[];
  };
  await expect(history).toHaveCount(all.calls.length);
  const rowsBefore = await history.count();
  await window.getByLabel('URL').fill('/orders');
  await button('Send').click();
  const result = window.getByTestId('result');
  await expect(result).toContainText('Not sent');
  await expect(result).toContainText('choose an environment');
  await expect(result).toBeInViewport();
  await expect(history).toHaveCount(rowsBefore);

  // Copy as curl refuses the path for the same reason (plan phase 2; review F1).
  await showRequest(window);
  await button('Copy as curl').click();
  await expect(window.getByTestId('form-curl-error')).toContainText(
    'choose an environment',
  );
  expect(errors).toEqual([]);
});

// environment-aware-history, phase 3: a full URL is recorded under the environment whose base address it starts with,
// and the select moves to that environment; a URL under none leaves the select as it was; a choice made while the send
// is in flight is kept. Matching itself is tested in url.test.ts and environment-store.int.test.ts.
test('a full URL under an environment moves the select to it and records it; a URL under none leaves the select', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await showSidebarTab(window, 'History');
  const history = window.getByTestId('history').getByRole('listitem');
  const panel = window.getByTestId('call-panel');
  await addEnvironment('detected', `${c.url}/det`);
  await select.selectOption({ label: 'All' });

  await window.getByLabel('URL').fill(`${c.url}/det/orders`);
  await button('Send').click();
  await expect(select.locator('option:checked')).toHaveText(
    `detected — ${c.url}/det`,
  );
  const detectedId = await select.inputValue();
  await expect(rowName(history.first())).toHaveAccessibleName(
    containing(`GET ${c.url}/det/orders`),
  );
  await history.first().getByRole('button').first().click();
  await expect(panel.getByTestId('call-environment')).toHaveText(
    `Environment: detected — ${c.url}/det`,
  );

  // The choice is stored like a manual one: a reload opens on it.
  await expect.poll(() => activeId()).toBe(detectedId);
  await window.reload();
  await expect(window.getByTestId('db-status')).toContainText('up', {
    timeout: 15_000,
  });
  await expect(select).toHaveValue(detectedId);

  // A URL under no environment: recorded with none, and the select stays.
  await showRequest(window);
  await window.getByLabel('URL').fill(`${c.url}/elsewhere`);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');
  await expect(select).toHaveValue(detectedId);
  expect(errors).toEqual([]);
});

test('a choice made while a full-URL send is in flight is kept when the send is recorded', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await showSidebarTab(window, 'History');
  const history = window.getByTestId('history').getByRole('listitem');
  const panel = window.getByTestId('call-panel');
  await addEnvironment('heldmatch', `${c.url}/held`);
  await addEnvironment('picked', `${b.url}/picked`);
  await select.selectOption({ label: 'All' });

  const held = gate();
  const send = await stubOperation(window, channels.send, async (_i, real) => {
    await held.wait();
    return real();
  });
  try {
    await window.getByLabel('URL').fill(`${c.url}/held/x`);
    await button('Send').click();
    await select.selectOption({ label: `picked — ${b.url}/picked` });
    const pickedId = await select.inputValue();
    held.release();
    await expect(window.getByTestId('result')).toContainText('200');
    await settle(window);
    await expect(select).toHaveValue(pickedId);
    // The call is still recorded under the environment its URL starts with; History lists it under All.
    await select.selectOption({ label: 'All' });
    await history.first().getByRole('button').first().click();
    await expect(panel.getByTestId('call-environment')).toHaveText(
      `Environment: heldmatch — ${c.url}/held`,
    );
  } finally {
    held.release();
    await send.restore();
  }
});

// Code review #5: the startup choice is stored in the order the choices were made.
test('two quick choices store the later one for startup', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await addEnvironment('early', `${a.url}/early`);
  await addEnvironment('late', `${b.url}/late`);

  // Hold the first save of the choice, as the B1 scenario below does, but answer with the server's own result.
  const firstChoice = gate();
  let firstChoiceStored!: () => void;
  const firstChoiceDone = new Promise<void>((resolve) => {
    firstChoiceStored = resolve;
  });
  let held = false;
  const choice = await stubOperation(
    window,
    channels.setActiveEnvironment,
    async (_input, real) => {
      if (held) return real();
      held = true;
      await firstChoice.wait();
      const answer = await real();
      firstChoiceStored();
      return answer;
    },
  );

  await select.selectOption({ label: `early — ${a.url}/early` });
  await select.selectOption({ label: `late — ${b.url}/late` });
  const lateId = await select.inputValue();
  firstChoice.release();
  // The held first choice has now been stored; anything queued behind it has had its turn too.
  await firstChoiceDone;
  await expect.poll(() => activeId()).toBe(lateId);

  await choice.restore();
});

// Second code review, #5: one failed save of the choice does not stop later choices from being saved.
test('after one choice fails to be stored, a later choice is stored', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await addEnvironment('fails', `${a.url}/fails`);
  await addEnvironment('recovers', `${b.url}/recovers`);

  let failed = false;
  const choice = await stubOperation(
    window,
    channels.setActiveEnvironment,
    async (_input, real) => {
      if (!failed) {
        failed = true;
        throw new Error('store refused once');
      }
      return real();
    },
  );

  await select.selectOption({ label: `fails — ${a.url}/fails` });
  await expect(window.getByTestId('environments-error')).toContainText(
    'store refused once',
  );
  await select.selectOption({ label: `recovers — ${b.url}/recovers` });
  const recoversId = await select.inputValue();
  await expect.poll(() => activeId()).toBe(recoversId);

  await choice.restore();
});

// B1, made deterministic: the switch's save is held while the send runs. A send that read the stored setting
// would go to the old environment; one that names its environment goes to the new one. Replaces the answer for the
// rest of this launch, so it runs last.
test('a send while the switch is still being saved goes to the environment the select shows', async () => {
  const { window } = testApp;
  const select = window.getByLabel('Environment', { exact: true });
  await showSidebarTab(window, 'History');
  const history = window.getByTestId('history').getByRole('listitem');
  await addEnvironment('first', `${a.url}/first`);
  await addEnvironment('second', `${b.url}/second`);
  await select.selectOption({ label: `first — ${a.url}/first` });
  await expect(select).toHaveValue(/.+/);
  // Wait until the server has stored "first" as active, so the held save below is the only one pending.
  const firstId = await select.inputValue();
  await expect.poll(() => activeId()).toBe(firstId);

  const save = gate();
  await stubOperation(window, channels.setActiveEnvironment, async () => {
    await save.wait();
    return { ok: true };
  });

  b.requests.length = 0;
  await select.selectOption({ label: `second — ${b.url}/second` });
  await window.getByLabel('URL').fill('/held');
  await button('Send').click();
  // History lists second's calls (environment-aware-history): second was created above, so this send is its only one.
  await expect(history).toHaveCount(1);
  expect(b.requests.map((r) => r.url)).toEqual(['/second/held']);

  save.release();
});

// environment-aware-history, phase 5: History, the responses strips and search follow the environment the select shows;
// "All" shows every call. Only the assembled app shows which list is on screen after a switch, a held answer or a send
// (T2.10). Which calls an environment holds is tested in the store (call-store.int.test.ts, "environment filter").
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  type TestApp,
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
} from './support';

let x: CaptureServer;
let y: CaptureServer;
let z: CaptureServer;
let testApp: TestApp;
const errors: string[] = [];

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const select = () => testApp.window.getByLabel('Environment', { exact: true });
const history = () =>
  testApp.window.getByTestId('history').getByRole('listitem');
const strip = () => testApp.window.getByTestId('responses-strip');
const searchBox = () => testApp.window.getByLabel('Search history');
const results = () => testApp.window.getByTestId('search-results');
const resultRows = () =>
  results()
    .getByRole('row')
    .filter({ has: testApp.window.getByRole('checkbox') });
const xLabel = () => `X — ${x.url}/api`;
const yLabel = () => `Y — ${y.url}/api`;

async function choose(label: string) {
  await select().selectOption({ label });
  await expect(select().locator('option:checked')).toHaveText(label);
}

async function send(url: string) {
  const { window } = testApp;
  await showRequest(window);
  await window.getByLabel('URL').fill(url);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');
}

// Every History row's URL starts with this.
async function expectRowsAllAt(origin: string, count: number) {
  await expect(history()).toHaveCount(count);
  for (const row of await history().all()) {
    await expect(rowName(row)).toHaveAccessibleName(
      containing(`GET ${origin}/`),
    );
  }
}

test.beforeAll(async () => {
  x = await startCaptureServer();
  y = await startCaptureServer();
  z = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  const { window } = testApp;
  window.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  window.on('pageerror', (e) => errors.push(e.message));
  await expect(window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
  await openEnvironments(window);
  for (const [name, base] of [
    ['X', `${x.url}/api`],
    ['Y', `${y.url}/api`],
  ]) {
    await window.getByLabel('New environment name').fill(name as string);
    await window
      .getByLabel('New environment base address')
      .fill(base as string);
    await button('Add environment').click();
  }
  await expect(select().getByRole('option')).toHaveCount(3);
  // One call to each: a path sent to X, a full URL under Y (detected), a full URL under no environment.
  await choose(xLabel());
  await send('/orders');
  await choose('All');
  await send(`${y.url}/api/orders`);
  await expect(select().locator('option:checked')).toHaveText(yLabel());
  await choose('All');
  await send(`${z.url}/api/orders`);
});

test.afterAll(async () => {
  await testApp?.close();
  await x?.close();
  await y?.close();
  await z?.close();
});

test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
});

test('All lists every call; an environment lists its own calls, by day and by request', async () => {
  const { window } = testApp;
  await choose('All');
  await expect(history()).toHaveCount(3);
  await expect(window.getByTestId('history-count')).toHaveText('3 calls');

  await choose(xLabel());
  await expectRowsAllAt(x.url, 1);
  await expect(window.getByTestId('history-count')).toHaveText('1 call');

  const by = window.getByRole('group', { name: 'Group history by' });
  await by.getByRole('button', { name: 'By request' }).click();
  await expect(
    window
      .getByTestId('history-groups')
      .getByRole('button', { name: /^GET \/api\/orders — \d+ calls?$/ }),
  ).toHaveAccessibleName(/— 1 call$/);
  await choose('All');
  await expect(
    window
      .getByTestId('history-groups')
      .getByRole('button', { name: /^GET \/api\/orders — \d+ calls?$/ }),
  ).toHaveAccessibleName(/— 3 calls$/);
  await by.getByRole('button', { name: 'By day' }).click();
  await expect(history()).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a full URL under Y moves the select to Y, and History lists the calls recorded under Y', async () => {
  await choose('All');
  await send(`${y.url}/api/orders?again=1`);
  await expect(select().locator('option:checked')).toHaveText(yLabel());
  await expectRowsAllAt(y.url, 2);
});

test('the strip and Other responses list the selected environment only; a call outside it is named in the label', async () => {
  const { window } = testApp;
  await choose(yLabel());
  await send(`${y.url}/api/orders`);
  await expect(strip()).toContainText(`${await responsesCount(true)} kept`);
  await expect(strip()).not.toContainText('this call is not in');

  // The opened call's other responses: Y's only.
  await history().first().getByRole('button').first().click();
  const others = window
    .getByTestId('call-panel')
    .getByTestId('other-responses');
  await expect(others.getByRole('button')).toHaveCount(
    (await responsesCount(true)) - 1,
  );

  // A URL under no environment, with Y selected: the select stays, and the strip says the call is not in Y.
  await send(`${z.url}/api/orders`);
  await expect(select().locator('option:checked')).toHaveText(yLabel());
  await expect(strip()).toContainText('Y — this call is not in Y');
  await expect(strip()).toBeInViewport();
  await choose('All');
  await expect(strip()).not.toContainText('this call is not in');
  await expect(strip()).toContainText(`${await responsesCount(false)} kept`);
});

// The responses to GET /api/orders the server lists, under the selected environment or for All.
async function responsesCount(inSelected: boolean): Promise<number> {
  const environmentId = await select().inputValue();
  const listed = (await callOperation(testApp.window, channels.listResponses, {
    method: 'GET',
    path: '/api/orders',
    ...(inSelected && environmentId ? { environmentId } : {}),
  })) as { calls: unknown[] };
  return listed.calls.length;
}

// The number of calls recorded under the selected environment, as the server lists them.
async function yCount(): Promise<number> {
  const listed = (await callOperation(testApp.window, channels.listCalls, {
    environmentId: await select().inputValue(),
  })) as { calls: unknown[] };
  return listed.calls.length;
}

test('selecting an environment does not open search; search starts narrowed to it, and the chip can be removed', async () => {
  const { window } = testApp;
  await choose(xLabel());
  await expect(window.getByLabel('URL')).toBeVisible();
  await expect(results()).toBeHidden();

  await searchBox().fill('api');
  const chip = window.getByRole('button', { name: 'Remove Env X' });
  await expect(chip).toBeVisible();
  await expect(resultRows()).toHaveCount(1);
  await chip.click();
  await expect(resultRows()).toHaveCount(await allCount());

  // Clear, then search again: narrowed to the select again.
  await button('Clear all').click();
  await expect(results()).toBeHidden();
  await searchBox().fill('api');
  await expect(chip).toBeVisible();
  await expect(resultRows()).toHaveCount(1);
  await button('Clear all').click();

  // With no text: the filters panel open, the chip removed, search stays on and lists every environment.
  await button('Filters').click();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(resultRows()).toHaveCount(await allCount());
  await button('Clear all').click();
});

// Every call, as the server lists them.
async function allCount(): Promise<number> {
  const listed = (await callOperation(testApp.window, channels.listCalls)) as {
    calls: unknown[];
  };
  return listed.calls.length;
}

test('with search open and the chip removed, a send outside the environment is in the results when they are shown again', async () => {
  const { window } = testApp;
  await choose(xLabel());
  await searchBox().fill('api');
  await window.getByRole('button', { name: 'Remove Env X' }).click();
  const before = await allCount();
  await expect(resultRows()).toHaveCount(before);
  // While search is open the request form is reached through Edit on a result; the sidebar keeps the filters.
  await resultRows()
    .first()
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await window.getByLabel('URL').fill(`${z.url}/api/after-search`);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');
  await button('Show results').click();
  await expect(resultRows()).toHaveCount(before + 1);
  await button('Clear all').click();
});

test('a list held for X is never shown after switching to Y', async () => {
  const { window } = testApp;
  await choose('All');
  const xId = await select()
    .locator('option', { hasText: xLabel() })
    .getAttribute('value');
  const held = gate();
  const stub = await stubOperation(
    window,
    channels.listCalls,
    async (input, real) => {
      const answer = await real();
      if ((input as { environmentId?: string } | null)?.environmentId === xId) {
        await held.wait();
      }
      return answer;
    },
  );
  try {
    await select().selectOption({ label: xLabel() });
    await choose(yLabel());
    await expectRowsAllAt(y.url, await yCount());
    held.release();
    await settle(window);
    await expectRowsAllAt(y.url, await yCount());
  } finally {
    held.release();
    await stub.restore();
  }
});

test('switching to All after a send under X lists that call', async () => {
  await choose(xLabel());
  await send('/orders?from=x');
  await expect(rowName(history().first())).toHaveAccessibleName(
    containing(`GET ${x.url}/api/orders?from=x`),
  );
  await choose('All');
  await expect(rowName(history().first())).toHaveAccessibleName(
    containing(`GET ${x.url}/api/orders?from=x`),
  );
  await expect(history()).toHaveCount(await allCount());
  expect(errors).toEqual([]);
});

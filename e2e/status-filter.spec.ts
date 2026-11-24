// history-status-filter, phases 3 and 4: a multi-select combo box in the History tab keeps only the calls answered with
// the selected statuses, in the day list, the request groups and search; no selection keeps every call. Which calls
// match is tested in the store (call-store.int.test.ts, search.int.test.ts). Only the assembled app shows the control
// working from mouse and keyboard, the open list in view, the views it refetches, and an earlier selection's answer
// arriving last (T2.9, T2.10).
import { type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type TestApp,
  expectNoCspViolations,
  gate,
  launchWithTestDatabase,
  settle,
  showRequest,
  showSidebarTab,
  stubOperation,
} from './support';

let server: Server;
let serverUrl: string;
// A port nothing listens on: a send there is refused, and records no response.
let refusedUrl: string;
let hold = false;
const held: ServerResponse[] = [];
let testApp: TestApp;
// Calls in History with no status selected: six seeded, plus one per test that sends.
let total = 6;

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const combo = () =>
  testApp.window.getByRole('combobox', { name: 'Filter by status' });
const listbox = () => testApp.window.getByRole('listbox', { name: 'Statuses' });
// An option: "404 · 3 calls", "No response · 1 call".
const option = (label: string) =>
  listbox().getByRole('option', {
    name: new RegExp(`^${label} · \\d+ calls?$`),
  });
const count = () => testApp.window.getByTestId('history-count');
const dayRows = () =>
  testApp.window
    .getByTestId('history')
    .getByRole('button', { name: /^GET https?:\/\/\S+ — / });
const groups = () => testApp.window.getByTestId('history-groups');
const group = (label: string) =>
  groups().getByRole('button', {
    name: new RegExp(`^${label.replace(/\//g, '\\/')} — \\d+ calls?$`),
  });
const byDay = () =>
  testApp.window
    .getByRole('group', { name: 'Group history by' })
    .getByRole('button', { name: 'By day' });
const byRequest = () =>
  testApp.window
    .getByRole('group', { name: 'Group history by' })
    .getByRole('button', { name: 'By request' });

/** Chooses options by clicking them, then closes the list. */
async function choose(...labels: string[]) {
  await combo().click();
  for (const label of labels) await option(label).click();
  await combo().press('Escape');
}

async function clearStatuses() {
  const clear = button('Clear status filter');
  if (await clear.isVisible()) await clear.click();
  await expect(clear).toBeHidden();
}

/** Sends GET <url> from the form and waits until History lists one more call (By day, no status selected). */
async function send(url: string, expected: number) {
  const { window } = testApp;
  await showRequest(window);
  await window.getByLabel('Method').selectOption('GET');
  await window.getByLabel('URL').fill(url);
  await button('Send').click();
  await expect(count()).toHaveText(
    `${expected} ${expected === 1 ? 'call' : 'calls'}`,
  );
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const status = Number(
      new URL(req.url ?? '/', 'http://x').searchParams.get('status') ?? 200,
    );
    res.statusCode = status;
    if (hold) held.push(res);
    else res.end('ok');
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closed = createServer();
  await new Promise<void>((resolve) =>
    closed.listen(0, '127.0.0.1', () => resolve()),
  );
  refusedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/gone`;
  await new Promise<void>((resolve) => closed.close(() => resolve()));

  testApp = await launchWithTestDatabase({ historyGrouping: 'day' });
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
  await showSidebarTab(testApp.window, 'History');
  // /items: 200, 200, 404. /other: 404, 500. One refused call.
  await send(`${serverUrl}/items?status=200`, 1);
  await send(`${serverUrl}/items?status=200`, 2);
  await send(`${serverUrl}/items?status=404`, 3);
  await send(`${serverUrl}/other?status=404`, 4);
  await send(`${serverUrl}/other?status=500`, 5);
  await send(refusedUrl, 6);
});

test.afterAll(async () => {
  for (const res of held.splice(0)) res.end('ok');
  await testApp?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
  await clearStatuses();
  if ((await byDay().getAttribute('aria-pressed')) !== 'true') {
    await byDay().click();
  }
  await expect(count()).toHaveText(`${total} calls`);
});

test('nothing selected lists every call; the options are the statuses present, with counts', async () => {
  await expect(combo()).toHaveAttribute('placeholder', 'All statuses');
  await expect(dayRows()).toHaveCount(6);
  await combo().click();
  await expect(listbox()).toBeInViewport();
  await expect(listbox().getByRole('option')).toHaveText([
    /^200/,
    /^404/,
    /^500/,
    /^No response/,
  ]);
  await expect(option('200')).toHaveAccessibleName('200 · 2 calls');
  await expect(option('No response')).toHaveAccessibleName(
    'No response · 1 call',
  );
  await combo().press('Escape');
  await expect(listbox()).toBeHidden();
});

test('selecting codes keeps only their calls, by day and by request, and × clears the selection', async () => {
  await choose('404');
  await expect(count()).toHaveText('2 calls');
  await expect(dayRows()).toHaveCount(2);
  for (const row of await dayRows().all()) {
    await expect(row).toHaveAccessibleName(/ — 404/);
  }

  await byRequest().click();
  await expect(group('GET /items')).toHaveAccessibleName(/— 1 call$/);
  await expect(group('GET /other')).toHaveAccessibleName(/— 1 call$/);
  await expect(count()).toHaveText('2 calls');
  // An expanded group lists only the selected statuses' calls.
  await group('GET /items').click();
  const rows = groups().getByRole('button', { name: /^GET https?:\/\/\S+ — / });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAccessibleName(/ — 404/);
  await group('GET /items').click();
  await byDay().click();

  await choose('No response');
  await expect(count()).toHaveText('3 calls');
  await expect(
    testApp.window.getByRole('button', { name: 'Remove status 404' }),
  ).toBeVisible();
  await expect(
    testApp.window.getByRole('button', { name: 'Remove status No response' }),
  ).toBeVisible();

  await button('Remove status 404').click();
  await expect(count()).toHaveText('1 call');
  await button('Clear status filter').click();
  await expect(count()).toHaveText(`${total} calls`);
  await expect(combo()).toHaveAttribute('placeholder', 'All statuses');
});

test('the keyboard opens the list, moves, toggles an option and closes it, keeping the selection', async () => {
  await combo().focus();
  await combo().press('ArrowDown');
  await expect(listbox()).toBeVisible();
  // First option active: 200. Down once more: 404.
  await combo().press('ArrowDown');
  await expect(option('404')).toHaveAttribute('aria-selected', 'false');
  await combo().press(' ');
  await expect(option('404')).toHaveAttribute('aria-selected', 'true');
  await combo().press('Escape');
  await expect(listbox()).toBeHidden();
  await expect(combo()).toBeFocused();
  await expect(count()).toHaveText('2 calls');
  // Typing narrows the options.
  await combo().press('ArrowDown');
  await combo().fill('50');
  await expect(listbox().getByRole('option')).toHaveCount(1);
  await expect(option('500')).toBeVisible();
  await combo().press('Enter');
  await expect(count()).toHaveText('3 calls');
  // A space is typed while there is text, so a label with a space narrows the list (code review 4).
  await combo().press('ArrowDown');
  await combo().pressSequentially('no r');
  await expect(combo()).toHaveValue('no r');
  await expect(listbox().getByRole('option')).toHaveCount(1);
  await expect(option('No response')).toHaveAttribute('aria-selected', 'false');
  // Closing the list drops the typed text.
  await combo().press('Escape');
  await expect(combo()).toHaveValue('');
});

test("an earlier selection's answer arriving last does not replace the list for the later one (T2.10)", async () => {
  const { window } = testApp;
  const first = gate();
  const stub = await stubOperation(
    window,
    channels.listCalls,
    async (input, real) => {
      const statuses = (input as { statuses?: string[] } | undefined)?.statuses;
      if (statuses?.join() === '200') await first.wait();
      return real();
    },
  );
  try {
    await combo().click();
    await option('200').click();
    await option('500').click();
    await combo().press('Escape');
    await expect(count()).toHaveText('3 calls');
    first.release();
    await settle(window);
    await expect(count()).toHaveText('3 calls');
    await expect(dayRows()).toHaveCount(3);
  } finally {
    first.release();
    await stub.restore();
  }
});

test('the option counts follow a send in flight that the selection hides, and History keeps its list', async () => {
  const { window } = testApp;
  await choose('404');
  await expect(count()).toHaveText('2 calls');
  await combo().click();
  await expect(option('No response')).toHaveAccessibleName(
    'No response · 1 call',
  );
  await combo().press('Escape');

  hold = true;
  try {
    await window.getByLabel('URL').fill(`${serverUrl}/items?status=200`);
    await button('Send').click();
    await expect(button('Cancel')).toBeVisible();
    // The call in flight has no response yet: counted under No response, and not listed under 404.
    await combo().click();
    await expect(option('No response')).toHaveAccessibleName(
      'No response · 2 calls',
    );
    await combo().press('Escape');
    await expect(count()).toHaveText('2 calls');
  } finally {
    hold = false;
    for (const res of held.splice(0)) res.end('ok');
  }
  await expect(window.getByTestId('result')).toContainText('200');
  total += 1;
  await combo().click();
  await expect(option('200')).toHaveAccessibleName('200 · 3 calls');
  await expect(option('No response')).toHaveAccessibleName(
    'No response · 1 call',
  );
  await combo().press('Escape');
  await expect(count()).toHaveText('2 calls');
  // The responses strip is not filtered: it lists the new 200 call with the request's other calls.
  await expect(window.getByTestId('responses-strip')).toContainText('4 kept');
});

// Phase 4: in search mode the same control narrows the results, and its counts are the search's status facet.
test('in search, a status narrows the results, its counts follow the text, and Clear all keeps the selection', async () => {
  const { window } = testApp;
  const searchBox = () => window.getByLabel('Search history');
  const results = () => window.getByTestId('search-results');
  const resultRows = () =>
    results()
      .getByRole('row')
      .filter({ has: window.getByRole('checkbox') });

  await searchBox().fill('/other');
  await expect(results()).toContainText('2 calls match');
  // Counts under the text: /other has one 404 and one 500; the 200s do not match it.
  await combo().click();
  await expect(option('404')).toHaveAccessibleName('404 · 1 call');
  await expect(option('500')).toHaveAccessibleName('500 · 1 call');
  await expect(option('200')).toHaveAccessibleName('200 · 0 calls');
  await option('500').click();
  await combo().press('Escape');
  await expect(results()).toContainText('1 call matches');
  await expect(resultRows()).toHaveCount(1);
  await expect(resultRows().first()).toContainText('500');
  // The status facet ignores its own selection: 404 still counts its match.
  await combo().click();
  await expect(option('404')).toHaveAccessibleName('404 · 1 call');
  await combo().press('Escape');

  await button('Clear all').click();
  await expect(results()).toBeHidden();
  await expect(
    window.getByRole('button', { name: 'Remove status 500' }),
  ).toBeVisible();
  await expect(count()).toHaveText('1 call');
});

test('when the options or the search fail, the reason shows and the selection can still be cleared (review F1, code review 5)', async () => {
  const { window } = testApp;
  await choose('404');
  await expect(count()).toHaveText('2 calls');

  const search = await stubOperation(window, channels.searchCalls, () => ({
    ok: false,
    message: 'search store down',
  }));
  const codes = await stubOperation(window, channels.listStatusCodes, () => ({
    ok: false,
    message: 'status store down',
  }));
  try {
    // In search, the search's failure is the options' failure.
    await window.getByLabel('Search history').fill('/items');
    await expect(window.getByTestId('status-filter-error')).toHaveText(
      'Statuses could not be loaded: search store down',
    );
    // Leaving search lists History's options again, and that fails too.
    await window.getByLabel('Search history').fill('');
    await expect(window.getByTestId('status-filter-error')).toHaveText(
      'Statuses could not be loaded: status store down',
    );
    await combo().click();
    // With no options, the selected code is still listed, with 0 calls (review F2).
    await expect(listbox().getByRole('option')).toHaveCount(1);
    await expect(option('404')).toHaveAccessibleName('404 · 0 calls');
    await combo().press('Escape');
    await button('Remove status 404').click();
    await expect(count()).toHaveText(`${total} calls`);
  } finally {
    await codes.restore();
    await search.restore();
  }
  // The options are listed again on the next refetch: here, entering and leaving search.
  await window.getByLabel('Search history').fill('/items');
  await window.getByLabel('Search history').fill('');
  await expect(window.getByTestId('status-filter-error')).toHaveCount(0);
});

test('a selection that matches nothing says so, and the selected code stays listed', async () => {
  const { window } = testApp;
  await choose('500');
  await expect(count()).toHaveText('1 call');
  await expect(window.getByTestId('history-status-empty')).toHaveCount(0);
  await dayRows()
    .first()
    .locator('..')
    .getByRole('button', { name: /^Delete GET / })
    .click();
  await expect(window.getByTestId('history-status-empty')).toHaveText(
    'No calls with the selected status',
  );
  await expect(
    window.getByRole('button', { name: 'Remove status 500' }),
  ).toBeVisible();
  await expectNoCspViolations(window);
});

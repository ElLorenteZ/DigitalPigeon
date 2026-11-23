// history-grouping, phase 5: History opens grouped by request (method + URL path) over all of history; By day / By
// request and Split by auth switch it, and both are remembered in this browser. A group expands to its calls. Only the
// assembled app shows the default after a fresh launch, a choice kept across a reload, which group's calls are shown
// and whether they are in view (T2.9, T2.10). The grouping itself is tested in the store (call-store.int.test.ts).
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  type TestApp,
  gate,
  launchWithTestDatabase,
  settle,
  showRequest,
  showRequestTab,
  showSidebarTab,
  stubOperation,
} from './support';

let capture: CaptureServer;
let testApp: TestApp;

const ready = (app: TestApp) =>
  expect(app.window.getByTestId('db-status')).toContainText(
    `up (${app.database})`,
    { timeout: 15_000 },
  );

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const groups = () => testApp.window.getByTestId('history-groups');
// The History title row's controls: By request / By day, and Split by auth.
const controls = () => testApp.window.getByTestId('history-controls');
const splitToggle = () =>
  controls().getByRole('button', { name: 'Split by auth', exact: true });
// A group's own button: "GET /orders — 3 calls", with the auth before the dash when split.
const groupName = (label: string) =>
  new RegExp(`^${label.replace(/[?/]/g, '\\$&')}( · [^—]*)? — \\d+ calls?$`);
const group = (label: string) =>
  groups().getByRole('button', { name: groupName(label) });
// The list item holding that button. `has` is evaluated inside each item, so it names the button from the page.
const groupItem = (label: string) =>
  groups()
    .getByRole('listitem')
    .filter({
      has: testApp.window.getByRole('button', { name: groupName(label) }),
    });
// A call row inside an expanded group, as in the day list: "GET <url> — <outcome> · <time>".
const callRows = (label: string) =>
  groupItem(label).getByRole('button', { name: /^GET https?:\/\/\S+ — / });

async function sendTo(path: string, status = 200, auth?: string) {
  const { window } = testApp;
  if (auth !== undefined) {
    await showRequestTab(window, 'Headers');
    if ((await window.getByLabel('Header name 1').count()) === 0) {
      await button('Add header').click();
    }
    await window.getByLabel('Header name 1').fill('Authorization');
    await window.getByLabel('Header value 1').fill(auth);
  }
  capture.respondWith({ status, body: Buffer.from(path) });
  await window.getByLabel('Method').selectOption('GET');
  await window.getByLabel('URL').fill(`${capture.url}${path}`);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText(String(status));
}

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase({ historyGrouping: 'request' });
  await ready(testApp);
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
});

test('a fresh browser opens History grouped by request', async () => {
  const fresh = await launchWithTestDatabase({ historyGrouping: 'unset' });
  try {
    await ready(fresh);
    await showSidebarTab(fresh.window, 'History');
    const choice = fresh.window.getByRole('group', {
      name: 'Group history by',
    });
    await expect(
      choice.getByRole('button', { name: 'By request' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      choice.getByRole('button', { name: 'By day' }),
    ).toHaveAttribute('aria-pressed', 'false');
    // Empty, so it has no height: attached, and no day list in its place.
    await expect(fresh.window.getByTestId('history-groups')).toHaveCount(1);
    await expect(fresh.window.getByTestId('history')).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});

test('calls to one method and path are one group over all of history; expanding it lists them in view', async () => {
  const { window } = testApp;
  await sendTo('/orders', 200);
  await sendTo('/orders?page=2', 201);
  await sendTo('/orders', 500);
  await sendTo('/orders/1', 200);
  await showSidebarTab(window, 'History');

  await expect(group('GET /orders')).toHaveAccessibleName(/— 3 calls$/);
  await expect(group('GET /orders/1')).toHaveAccessibleName(/— 1 call$/);
  await expect(window.getByTestId('history-count')).toHaveText('4 calls');
  await expect(callRows('GET /orders')).toHaveCount(0);

  await group('GET /orders').click();
  await expect(group('GET /orders')).toHaveAttribute('aria-expanded', 'true');
  await expect(callRows('GET /orders')).toHaveCount(3);
  await expect(callRows('GET /orders').first()).toBeInViewport();
  await expect(callRows('GET /orders').first()).toHaveAccessibleName(/— 500/);

  await callRows('GET /orders').nth(1).click();
  const panel = window.getByTestId('call-panel');
  await expect(panel.getByTestId('call-request-line')).toContainText(
    '/orders?page=2',
  );
  await expect(panel).toBeInViewport();
});

test('Split by auth gives each Authorization value its own group', async () => {
  await sendTo('/accounts', 200, 'Bearer alpha-token');
  await sendTo('/accounts', 200, 'Bearer alpha-token');
  await sendTo('/accounts', 200, 'Bearer beta-token');
  await showSidebarTab(testApp.window, 'History');
  await expect(group('GET /accounts')).toHaveAccessibleName(/— 3 calls$/);

  await expect(splitToggle()).toHaveAttribute('aria-pressed', 'false');
  await splitToggle().click();
  const split = groups().getByRole('button', { name: /^GET \/accounts · / });
  await expect(split).toHaveCount(2);
  await expect(
    groups().getByRole('button', {
      name: /^GET \/accounts · Authorization: Bearer alpha-token — 2 calls$/,
    }),
  ).toBeVisible();
  await expect(
    groups().getByRole('button', {
      name: /^GET \/accounts · Authorization: Bearer beta-token — 1 call$/,
    }),
  ).toBeVisible();
  // Calls with no auth header are a group of their own, named so.
  await expect(
    groups().getByRole('button', {
      name: /^GET \/orders · no auth — 3 calls$/,
    }),
  ).toBeVisible();
});

test('By day shows the dated list, and both choices are kept after a reload', async () => {
  const { window } = testApp;
  const choice = window.getByRole('group', { name: 'Group history by' });
  await choice.getByRole('button', { name: 'By day' }).click();
  await expect(window.getByTestId('history')).toContainText('Today');
  await expect(groups()).toHaveCount(0);

  await window.reload();
  await ready(testApp);
  await showSidebarTab(window, 'History');
  await expect(choice.getByRole('button', { name: 'By day' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(window.getByTestId('history')).toContainText('Today');

  await choice.getByRole('button', { name: 'By request' }).click();
  // Split by auth, chosen in the previous test, is still on.
  await expect(splitToggle()).toHaveAttribute('aria-pressed', 'true');
  await splitToggle().click();
  await expect(group('GET /accounts')).toHaveAccessibleName(/— 3 calls$/);
});

test('a call deleted inside a group disappears at once, and Undo brings it back', async () => {
  await sendTo('/to-delete', 200);
  await sendTo('/to-delete', 201);
  await showSidebarTab(testApp.window, 'History');
  await group('GET /to-delete').click();
  await expect(callRows('GET /to-delete')).toHaveCount(2);

  await groupItem('GET /to-delete')
    .getByRole('button', { name: /^Delete GET / })
    .first()
    .click();
  await expect(callRows('GET /to-delete')).toHaveCount(1);
  const toast = testApp.window.getByRole('status', { name: 'Deleted' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(callRows('GET /to-delete')).toHaveCount(2);
});

test("while a group's calls load, another group's are never shown under it", async () => {
  const { window } = testApp;
  await showSidebarTab(window, 'History');
  const held = gate();
  const stub = await stubOperation(
    window,
    channels.listResponses,
    async (input, real) => {
      const answer = await real();
      if ((input as { path: string }).path === '/orders') await held.wait();
      return answer;
    },
  );
  try {
    await group('GET /orders').click();
    await group('GET /orders/1').click();
    await expect(callRows('GET /orders/1')).toHaveCount(1);
    held.release();
    await settle(window);
    await expect(callRows('GET /orders/1')).toHaveCount(1);
    await expect(callRows('GET /orders')).toHaveCount(0);
    await expect(group('GET /orders')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  } finally {
    held.release();
    await stub.restore();
  }
});

test('a failure to load the groups, or one group, says so', async () => {
  const { window } = testApp;
  await showSidebarTab(window, 'History');
  // A group's calls first, while the groups are on screen; the strip is not shown in this test.
  const failExpand = await stubOperation(
    window,
    channels.listResponses,
    () => ({ ok: false, message: 'calls failed' }),
  );
  try {
    await group('GET /accounts').click();
    await expect(
      groupItem('GET /accounts').getByTestId('group-error'),
    ).toContainText('calls failed');
    await expect(group('GET /orders')).toBeVisible();
  } finally {
    await failExpand.restore();
  }

  const failGroups = await stubOperation(
    window,
    channels.listRequestGroups,
    () => ({ ok: false, message: 'groups failed' }),
  );
  try {
    await sendTo('/after-failure', 200);
    await showSidebarTab(window, 'History');
    await expect(window.getByTestId('history-error')).toContainText(
      'groups failed',
    );
  } finally {
    await failGroups.restore();
  }
});

// T2.9: a user scrolls to the last group of a long list and clicks it where it sits, at the bottom edge of the view; its
// calls open below it and must be brought into view. Playwright's own click would first scroll the group towards the
// middle, hiding the defect, so the scenario scrolls the group to the edge itself and dispatches the click there.
test('expanding the last group of a long list brings its first call into view', async () => {
  for (let n = 1; n <= 24; n += 1) await sendTo(`/fill-${n}`);
  await showSidebarTab(testApp.window, 'History');
  const last = groups()
    .getByRole('button', { name: / — \d+ calls?$/ })
    .last();
  await last.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await expect(last).toBeInViewport();
  await last.dispatchEvent('click');
  await expect(last).toHaveAttribute('aria-expanded', 'true');
  const firstCall = groups()
    .getByRole('listitem')
    .filter({ has: testApp.window.getByRole('button', { expanded: true }) })
    .getByRole('button', { name: /^GET https?:\/\/\S+ — / })
    .first();
  await expect(firstCall).toBeInViewport();
});

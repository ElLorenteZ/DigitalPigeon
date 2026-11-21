// Slice 6, phase 1: the workspace shell of design screens 01 and 02 (plan.md). A title bar with the logo, the name and
// the environment select; a sidebar with Saved and History tabs; the request above the response, or the opened call in
// its place; a status bar. Only the assembled page shows where things are and what is visible (test-strategy E2E).
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { channels } from '../src/shared/ipc-contract';
import {
  type TestApp,
  bodyTypeButton,
  chooseBodyType,
  launchWithTestDatabase,
  openEnvironments,
  showRequestTab,
  stubOperation,
} from './support';

let testApp: TestApp;
let capture: CaptureServer;

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const panel = (name: string) =>
  testApp.window.getByRole('tabpanel', { name, exact: true });
const requestTab = (name: string) =>
  testApp.window
    .getByRole('tablist', { name: 'Request' })
    .getByRole('tab', { name: new RegExp(`^${name}`) });
const tab = (name: string) =>
  testApp.window
    .getByRole('tablist', { name: 'Sidebar' })
    .getByRole('tab', { name: new RegExp(`^${name}`) });

test('the title bar shows the logo, the name and the environment select', async () => {
  const titleBar = testApp.window.getByRole('banner');
  await expect(
    titleBar.getByRole('img', { name: 'DigitalPigeon logo' }),
  ).toBeVisible();
  await expect(
    titleBar.getByRole('heading', { name: 'DigitalPigeon' }),
  ).toBeVisible();
  await expect(
    titleBar.getByLabel('Environment', { exact: true }),
  ).toBeVisible();
});

test('the status bar sits at the bottom of the window, and the page itself does not scroll', async () => {
  const { window } = testApp;
  const footer = window.getByRole('contentinfo');
  await expect(footer.getByTestId('db-status')).toBeVisible();
  const box = await footer.boundingBox();
  const viewport = window.viewportSize();
  expect(box && viewport && Math.round(box.y + box.height)).toBe(
    viewport?.height,
  );
  expect(
    await window.evaluate(
      () => document.documentElement.scrollHeight <= globalThis.innerHeight,
    ),
  ).toBe(true);
});

test('the sidebar opens on History, and Saved switches the list shown', async () => {
  await expect(tab('History')).toHaveAttribute('aria-selected', 'true');
  await expect(panel('History')).toBeVisible();
  await expect(panel('Saved')).toBeHidden();

  await tab('Saved').click();
  await expect(tab('Saved')).toHaveAttribute('aria-selected', 'true');
  await expect(panel('Saved')).toBeVisible();
  await expect(panel('History')).toBeHidden();

  await tab('History').click();
  await expect(panel('History')).toBeVisible();
});

test('a call opened from History takes the place of the request, and Back to the request brings back what was typed', async () => {
  const { window } = testApp;
  await window.getByLabel('URL').fill(`${capture.url}/shell`);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');

  await window.getByLabel('URL').fill(`${capture.url}/typed-after`);
  await window
    .getByTestId('history')
    .getByRole('button', { name: /\/shell/ })
    .first()
    .click();
  await expect(window.getByTestId('call-panel')).toBeVisible();
  await expect(window.getByLabel('URL')).toBeHidden();

  await button('Back to the request').click();
  await expect(window.getByTestId('call-panel')).toBeHidden();
  await expect(window.getByLabel('URL')).toHaveValue(
    `${capture.url}/typed-after`,
  );
});

test('the request opens on Body, Headers shows the header rows, and each tab counts its rows', async () => {
  const { window } = testApp;
  await expect(requestTab('Body')).toHaveAttribute('aria-selected', 'true');
  await expect(window.getByRole('group', { name: 'Body type' })).toBeVisible();
  await expect(button('Add header')).toBeHidden();

  await requestTab('Headers').click();
  await expect(requestTab('Headers')).toHaveText(/^Headers\s*0$/);
  await button('Add header').click();
  await window.getByLabel('Header name 1').fill('X-Shell');
  await expect(requestTab('Headers')).toHaveText(/^Headers\s*1$/);
  await expect(window.getByRole('group', { name: 'Body type' })).toBeHidden();

  await requestTab('Body').click();
  await expect(window.getByLabel('Header name 1')).toBeHidden();
  await requestTab('Headers').click();
  await expect(window.getByLabel('Header name 1')).toHaveValue('X-Shell');
});

// Code review of workspace-shell (2026-11-21), findings 1, 3, 4 and 8.
test('a failed environment choice is shown while the environments editor is closed', async () => {
  const { window } = testApp;
  await openEnvironments(window);
  await window.getByLabel('New environment name').fill('shell-env');
  await window.getByLabel('New environment base address').fill(capture.url);
  await button('Add environment').click();
  await button('Environments').click();
  await expect(window.getByLabel('New environment name')).toBeHidden();

  const stub = await stubOperation(
    window,
    channels.setActiveEnvironment,
    () => {
      throw new Error('not stored');
    },
  );
  await window
    .getByLabel('Environment', { exact: true })
    .selectOption({ label: `shell-env — ${capture.url}/` });
  await expect(window.getByTestId('environments-error')).toBeVisible();
  await expect(window.getByTestId('environments-error')).toContainText(
    'not stored',
  );
  await stub.restore();
});

test('a saved request that cannot be opened while a call is shown says why', async () => {
  const { window } = testApp;
  await window.getByLabel('URL').fill(`${capture.url}/saved-fail`);
  await window.getByLabel('Saved request name').fill('Will fail');
  await button('Save').click();
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');
  await window
    .getByTestId('history')
    .getByRole('button', { name: /\/saved-fail/ })
    .first()
    .click();
  await expect(window.getByTestId('call-panel')).toBeVisible();

  const stub = await stubOperation(window, channels.getSavedRequest, () => ({
    ok: false,
    message: 'gone meanwhile',
  }));
  await tab('Saved').click();
  await window
    .getByTestId('saved-requests')
    .getByRole('button', { name: /^Will fail/ })
    .click();
  await expect(window.getByTestId('saved-requests-error')).toBeVisible();
  await expect(window.getByTestId('saved-requests-error')).toContainText(
    'gone meanwhile',
  );
  await stub.restore();
  await tab('History').click();
});

test('arrow keys on the body type do not throw away what was typed', async () => {
  const { window } = testApp;
  await showRequestTab(window, 'Body');
  await chooseBodyType(window, 'json');
  await window.getByLabel('Body text').fill('{"kept":true}');
  await bodyTypeButton(window, 'json').focus();
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  await expect(bodyTypeButton(window, 'json')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(window.getByLabel('Body text')).toHaveValue('{"kept":true}');
});

test('each call opened shows its response body first, whichever tab the last one was left on', async () => {
  const { window } = testApp;
  await chooseBodyType(window, 'none');
  await window.getByLabel('URL').fill(`${capture.url}/tab-a`);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');
  await window.getByLabel('URL').fill(`${capture.url}/tab-b`);
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('200');

  const rows = window.getByTestId('history');
  await rows
    .getByRole('button', { name: /\/tab-a/ })
    .first()
    .click();
  const responseTabs = window
    .getByTestId('call-panel')
    .getByRole('tablist', { name: 'Response' });
  await responseTabs.getByRole('tab', { name: /^Headers/ }).click();
  await rows
    .getByRole('button', { name: /\/tab-b/ })
    .first()
    .click();
  await expect(
    window.getByTestId('call-panel').getByTestId('call-request-line'),
  ).toContainText('/tab-b');
  await expect(
    responseTabs.getByRole('tab', { name: 'Body', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
});

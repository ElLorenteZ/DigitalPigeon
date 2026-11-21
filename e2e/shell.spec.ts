// Slice 6, phase 1: the workspace shell of design screens 01 and 02 (plan.md). A title bar with the logo, the name and
// the environment select; a sidebar with Saved and History tabs; the request above the response, or the opened call in
// its place; a status bar. Only the assembled page shows where things are and what is visible (test-strategy E2E).
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

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
  await expect(
    window.getByRole('radiogroup', { name: 'Body type' }),
  ).toBeVisible();
  await expect(button('Add header')).toBeHidden();

  await requestTab('Headers').click();
  await expect(requestTab('Headers')).toHaveText(/^Headers\s*0$/);
  await button('Add header').click();
  await window.getByLabel('Header name 1').fill('X-Shell');
  await expect(requestTab('Headers')).toHaveText(/^Headers\s*1$/);
  await expect(
    window.getByRole('radiogroup', { name: 'Body type' }),
  ).toBeHidden();

  await requestTab('Body').click();
  await expect(window.getByLabel('Header name 1')).toBeHidden();
  await requestTab('Headers').click();
  await expect(window.getByLabel('Header name 1')).toHaveValue('X-Shell');
});

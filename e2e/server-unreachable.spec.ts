// When the server stops answering an open tab (stopped, or restarted with a new token), a call rejects instead of
// returning a result (code review 2026-11-20, findings 1 and 2; author decision: catch, no new UI). The status line
// says the server did not answer and Send is unavailable; a failed save, delete or environment change shows its
// reason where that action's other failures show. Nothing is left as an unhandled rejection.
import { expect, test } from '@playwright/test';
import { channels } from '../src/shared/ipc-contract';
import {
  launchWithTestDatabase,
  openEnvironments,
  showRequest,
  showSidebarTab,
  stubOperation,
  type TestApp,
} from './support';

let testApp: TestApp;
const errors: string[] = [];

test.beforeAll(async () => {
  testApp = await launchWithTestDatabase();
  testApp.window.on('pageerror', (error) => errors.push(error.message));
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await testApp?.close();
});

test.beforeEach(async () => {
  await showRequest(testApp.window);
  await showSidebarTab(testApp.window, 'History');
  errors.length = 0;
});

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });

const refused = () => {
  throw new Error('refused');
};

test('a status check the server does not answer says so and makes Send unavailable, until it answers again', async () => {
  const { window } = testApp;
  await window.getByLabel('URL').fill('http://127.0.0.1:1/');
  await expect(button('Send')).toBeEnabled();

  const stub = await stubOperation(window, channels.dbStatus, refused);
  const status = window.getByTestId('db-status');
  await expect(status).toHaveAttribute('data-status', 'unreachable');
  await expect(status).toContainText('the server did not answer');
  await expect(status).toContainText('npm start');
  await expect(button('Send')).toBeDisabled();

  await stub.restore();
  await expect(status).toContainText(`up (${testApp.database})`);
  await expect(button('Send')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('a save the server does not answer shows why, and Save is available again', async () => {
  const { window } = testApp;
  const stub = await stubOperation(window, channels.saveSavedRequest, refused);
  await window.getByLabel('URL').fill('http://127.0.0.1:1/a');
  await window.getByLabel('Saved request name').fill('Not saved');
  await button('Save').click();
  await expect(window.getByTestId('saved-requests-error')).toContainText(
    'refused',
  );
  await expect(button('Save')).toBeEnabled();
  await stub.restore();
  expect(errors).toEqual([]);
});

test('a delete the server does not answer shows why, and the saved request stays listed', async () => {
  const { window } = testApp;
  await window.getByLabel('URL').fill('http://127.0.0.1:1/b');
  await window.getByLabel('Saved request name').fill('Kept');
  await button('Save').click();
  await showSidebarTab(window, 'Saved');
  const saved = window.getByTestId('saved-requests').getByRole('listitem');
  await expect(saved.filter({ hasText: 'Kept' })).toHaveCount(1);

  const stub = await stubOperation(
    window,
    channels.deleteSavedRequest,
    refused,
  );
  await saved
    .filter({ hasText: 'Kept' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(window.getByTestId('saved-requests-error')).toContainText(
    'refused',
  );
  await expect(saved.filter({ hasText: 'Kept' })).toHaveCount(1);
  await stub.restore();
  expect(errors).toEqual([]);
});

test('an environment change the server does not answer shows why', async () => {
  const { window } = testApp;
  const stub = await stubOperation(window, channels.saveEnvironment, refused);
  await openEnvironments(window);
  await window.getByLabel('New environment name').fill('local');
  await window
    .getByLabel('New environment base address')
    .fill('http://127.0.0.1:1');
  await button('Add environment').click();
  await expect(window.getByTestId('environments-error')).toContainText(
    'refused',
  );
  await stub.restore();
  expect(errors).toEqual([]);
});

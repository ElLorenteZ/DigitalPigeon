// Review F2: the Edit and Copy buttons connect the panel to the form and to curl export, and a refused
// header is shown to the user. Their logic is tested below this layer; only the assembled app shows the
// buttons are wired. The clipboard is stubbed so an e2e run does not overwrite the system clipboard.
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

let capture: CaptureServer;
let testApp: TestApp;

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  await testApp.window.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async () => {},
    });
  });
});

test.afterAll(async () => {
  await testApp?.close();
  await capture?.close();
});

test('edit a past call, export it as curl, and see a refused header explained', async () => {
  const { window } = testApp;
  const history = window.getByTestId('history').getByRole('listitem');
  const button = (name: string) =>
    window.getByRole('button', { name, exact: true });
  const url = `${capture.url}/orders?filter[a]=1`;

  await expect(window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );

  await window.getByLabel('URL').fill(url);
  await button('Add header').click();
  await window.getByLabel('Header name 1').fill('X-Zeta');
  await window.getByLabel('Header value 1').fill('original');
  await button('Send').click();
  await expect(history).toHaveCount(1);

  // Clear the form, so that what Edit puts there can only have come from the call.
  await window.getByLabel('URL').fill('');
  await button('Remove').click();
  await history.first().getByRole('button').click();

  await button('Copy call as curl').click();
  const command = window.getByTestId('call-curl');
  await expect(command).toContainText('--globoff');
  await expect(command).toContainText(url);
  await expect(command).toContainText("-H 'X-Zeta: original'");

  await button('Edit').click();
  await expect(window.getByLabel('URL')).toHaveValue(url);
  await expect(window.getByLabel('Header name 1')).toHaveValue('X-Zeta');
  await expect(window.getByLabel('Header value 1')).toHaveValue('original');
  await expect(window.getByLabel('Header name 2')).toHaveCount(0);

  await window.getByLabel('Header value 1').fill('changed');
  await button('Send').click();
  await expect(history).toHaveCount(2);
  await expect(window.getByTestId('call-request-headers')).toContainText(
    'X-Zeta: original',
  );
  await history.first().getByRole('button').click();
  await expect(window.getByTestId('call-request-headers')).toContainText(
    'X-Zeta: changed',
  );

  await window.getByLabel('Header value 1').fill('zażółć');
  await button('Send').click();
  await expect(window.getByTestId('result')).toContainText('Not sent');
  await expect(window.getByTestId('result')).toContainText('X-Zeta');
  await expect(history).toHaveCount(2);

  await button('Copy as curl').click();
  await expect(window.getByTestId('form-curl-error')).toContainText('X-Zeta');
});

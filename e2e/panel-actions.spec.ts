// Code review, F5: the panel renders below the history list, while Cancel, the result and the form are
// above it. Each action must bring into view what it changed, or it appears to do nothing. Only a
// rendered page shows this. The server holds a response on request, to observe a replay in flight.
import { type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { type TestApp, launchWithTestDatabase } from './support';

let server: Server;
let serverUrl: string;
let hold = false;
const held: ServerResponse[] = [];
let testApp: TestApp;

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    if (hold) held.push(res);
    else res.end('ok');
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  testApp = await launchWithTestDatabase();

  const { window } = testApp;
  await expect(window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
  const history = window.getByTestId('history').getByRole('listitem');
  await window.getByLabel('URL').fill(`${serverUrl}/long`);
  // Longer than the window, so the panel opens far below the top of the page.
  for (let sent = 1; sent <= 30; sent += 1) {
    await window.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(history).toHaveCount(sent);
  }
});

test.afterAll(async () => {
  await testApp?.close();
  server?.closeAllConnections();
  server?.close();
});

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });

const openFirstRow = async () => {
  const { window } = testApp;
  await window
    .getByTestId('history')
    .getByRole('listitem')
    .first()
    .getByRole('button')
    .click();
  await expect(
    window.getByTestId('call-panel').getByRole('heading', { name: 'Call' }),
  ).toBeInViewport();
};

test('Replay brings Cancel into view while in flight, and then the result', async () => {
  await openFirstRow();

  hold = true;
  await button('Replay').click();
  await expect(button('Cancel')).toBeInViewport();

  hold = false;
  await expect.poll(() => held.length).toBe(1);
  held.shift()?.end('ok');
  await expect(testApp.window.getByTestId('result')).toBeInViewport();
});

test('the result of a replay comes into view even below a tall form', async () => {
  // Empty rows are not sent. They make the form taller than the window.
  for (let added = 0; added < 25; added += 1)
    await button('Add header').click();
  await openFirstRow();

  await button('Replay').click();

  await expect(testApp.window.getByTestId('result')).toBeInViewport();

  for (let left = 25; left > 0; left -= 1) {
    await button('Remove').first().click();
  }
});

test('Edit brings the loaded form into view', async () => {
  const url = testApp.window.getByLabel('URL');
  await url.fill('');
  await openFirstRow();

  await button('Edit').click();

  await expect(url).toHaveValue(`${serverUrl}/long`);
  await expect(url).toBeInViewport();
});

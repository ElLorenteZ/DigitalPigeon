// T2.7, T2.9: journeys with a request body and a 17 MiB response. The bytes and the storage are tested
// below this layer; only the assembled app shows the form, the panel and Load more connecting to them.
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import { type TestApp, launchWithTestDatabase } from './support';

const MIB = 1024 * 1024;

let capture: CaptureServer;
let testApp: TestApp;

test.beforeAll(async () => {
  capture = await startCaptureServer();
  testApp = await launchWithTestDatabase();
  await expect(testApp.window.getByTestId('db-status')).toContainText(
    `up (${testApp.database})`,
    { timeout: 15_000 },
  );
  await closeDocked(testApp);
  // The Copy presses below must not overwrite the system clipboard (AGENTS.md).
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

// DevTools opens when the app is not packaged (src/main.ts). Docking takes half the window's width some
// time after launch, which reflows long text under a position check. Wait for it, close it, and wait for
// the page to fill the window again.
async function closeDocked({ app, window }: TestApp) {
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) =>
          w.webContents.isDevToolsOpened(),
        ),
      ),
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.closeDevTools();
  });
  await expect
    .poll(async () => {
      const content = await app.evaluate(({ BrowserWindow }) =>
        Math.max(
          ...BrowserWindow.getAllWindows().map(
            (w) => w.getContentBounds().width,
          ),
        ),
      );
      return (await window.evaluate(() => innerWidth)) === content;
    })
    .toBe(true);
}

const button = (name: string) =>
  testApp.window.getByRole('button', { name, exact: true });
const history = () =>
  testApp.window.getByTestId('history').getByRole('listitem');
const panel = () => testApp.window.getByTestId('call-panel');

// Fills the whole request, so no scenario depends on what an earlier one left in the form.
const fillTextRequest = async (
  method: string,
  path: string,
  type: string,
  text: string,
) => {
  const { window } = testApp;
  await window.getByLabel('Method').selectOption(method);
  await window.getByLabel('URL').fill(`${capture.url}${path}`);
  await window.getByLabel('Body type').selectOption(type);
  await window.getByLabel('Body text').fill(text);
};

const sendAndSeeNewRow = async () => {
  const before = await history().count();
  await button('Send').click();
  await expect(history()).toHaveCount(before + 1, { timeout: 30_000 });
};

test('T2.7 — a call with a body can be opened, replayed and edited, and the original keeps its body', async () => {
  const { window } = testApp;
  capture.requests.length = 0;
  capture.respondWith({ status: 200, body: Buffer.from('json response') });
  await fillTextRequest('POST', '/orders', 'json', '{"item":"é"}');
  const before = await history().count();
  await sendAndSeeNewRow();

  await history().first().getByRole('button').click();
  await expect(panel().getByTestId('call-request-body')).toHaveText(
    '{"item":"é"}',
  );
  await expect(panel().getByTestId('response-body')).toHaveText(
    'json response',
  );

  await button('Replay').click();
  await expect.poll(() => capture.requests.length).toBe(2);
  expect(capture.requests[1]?.body).toEqual(capture.requests[0]?.body);
  expect(capture.requests[0]?.body.toString()).toBe('{"item":"é"}');
  expect(capture.requests[1]?.rawHeaders).toEqual(
    capture.requests[0]?.rawHeaders,
  );

  await button('Edit').click();
  const bodyText = window.getByLabel('Body text');
  await expect(bodyText).toHaveValue('{"item":"é"}');
  await expect(window.getByLabel('Body type')).toHaveValue('json');
  await expect(bodyText).toBeInViewport();

  await bodyText.fill('{"item":"changed"}');
  await expect(history()).toHaveCount(before + 2);
  await sendAndSeeNewRow();
  expect(capture.requests[2]?.body.toString()).toBe('{"item":"changed"}');

  await history().nth(2).getByRole('button').click();
  await expect(panel().getByTestId('call-request-body')).toHaveText(
    '{"item":"é"}',
  );
  await history().first().getByRole('button').click();
  await expect(panel().getByTestId('call-request-body')).toHaveText(
    '{"item":"changed"}',
  );
});

test('a Form body typed through rows arrives encoded, and loads back as rows', async () => {
  const { window } = testApp;
  capture.requests.length = 0;
  await window.getByLabel('Method').selectOption('POST');
  await window.getByLabel('URL').fill(`${capture.url}/form`);
  await window.getByLabel('Body type').selectOption('form');
  await expect(window.getByLabel('Form field name 1')).toHaveCount(0);
  await button('Add form field').click();
  await window.getByLabel('Form field name 1').fill('a b');
  await window.getByLabel('Form field value 1').fill('1&2=é');
  await sendAndSeeNewRow();

  expect(capture.requests[0]?.body.toString()).toBe('a+b=1%262%3D%C3%A9');
  const received = capture.requests[0]?.rawHeaders ?? [];
  expect(received[received.findIndex((h) => h === 'content-type') + 1]).toBe(
    'application/x-www-form-urlencoded',
  );

  await window.getByLabel('Form field value 1').fill('other');
  await history().first().getByRole('button').click();
  await expect(panel().getByTestId('call-request-body')).toHaveText(
    'a+b=1%262%3D%C3%A9',
  );
  await button('Edit').click();
  await expect(window.getByLabel('Form field value 1')).toHaveValue('1&2=é');
});

test('T2.9 — a refused HEAD with a body says so in view, and adds no row', async () => {
  const { window } = testApp;
  capture.requests.length = 0;
  await fillTextRequest('HEAD', '/head', 'text', 'not allowed');
  const before = await history().count();

  await button('Send').click();

  const result = window.getByTestId('result');
  await expect(result).toContainText('Not sent');
  await expect(result).toBeInViewport();
  await expect(history()).toHaveCount(before);
  expect(capture.requests).toHaveLength(0);
});

// Read through evaluate: toContainText would carry the whole body across the Playwright bridge on every
// retry (plan.md, phase 6).
test('a 17 MiB response can be read to its end with Load more', async () => {
  const start = 'START-MARKER';
  const end = 'FINAL-MARKER';
  const body = Buffer.concat([
    Buffer.from(start),
    Buffer.alloc(17 * MIB, 0x61),
    Buffer.from(end),
  ]);
  capture.respondWith({ status: 200, body });
  await testApp.window.getByLabel('Method').selectOption('GET');
  await testApp.window.getByLabel('URL').fill(`${capture.url}/large`);
  await testApp.window.getByLabel('Body type').selectOption('none');
  await sendAndSeeNewRow();

  await history().first().getByRole('button').click();
  const text = panel().getByTestId('response-body');
  const remaining = panel().getByTestId('response-body-remaining');
  const loadMore = panel().getByRole('button', { name: 'Load more' });
  await expect(remaining).toHaveAttribute(
    'data-remaining',
    String(body.length - MIB),
  );

  const ends = () =>
    text.evaluate((element) => {
      const content = element.textContent ?? '';
      return {
        length: content.length,
        first: content.slice(0, 12),
        last: content.slice(-12),
      };
    });
  // T2.9: the page Load more adds starts where the button was, inside the viewport.
  const lastPageTopInView = () =>
    text.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.lastChild as Node);
      const { top } = range.getBoundingClientRect();
      return top >= 0 && top < window.innerHeight;
    });

  await expect(ends()).resolves.toMatchObject({ length: MIB, first: start });

  let expected = body.length - MIB;
  while (expected > 0) {
    await loadMore.click();
    const next = Math.max(expected - MIB, 0);
    if (next > 0) {
      await expect(remaining).toHaveAttribute('data-remaining', String(next));
    } else {
      await expect(loadMore).toHaveCount(0);
    }
    expected = next;
    await expect(ends()).resolves.toMatchObject({
      length: body.length - expected,
    });
    await expect.poll(lastPageTopInView).toBe(true);
  }

  await expect(remaining).toHaveCount(0);
  await expect(ends()).resolves.toEqual({
    length: body.length,
    first: start,
    last: end,
  });
});

test('opening the call already shown does not load another page (second review, finding 1)', async () => {
  capture.respondWith({ status: 200, body: Buffer.alloc(3 * MIB, 0x61) });
  await testApp.window.getByLabel('Method').selectOption('GET');
  await testApp.window.getByLabel('URL').fill(`${capture.url}/reopen`);
  await testApp.window.getByLabel('Body type').selectOption('none');
  await sendAndSeeNewRow();
  const row = history().first().getByRole('button');
  const remaining = panel().getByTestId('response-body-remaining');

  await row.click();
  await expect(remaining).toHaveAttribute('data-remaining', String(2 * MIB));

  await row.click();
  // Later round trips to main return after the open's answer and any read it started.
  await testApp.window.evaluate(async () => {
    const { pigeon } = window as unknown as {
      pigeon: {
        getCall: (id: string) => Promise<unknown>;
        dbStatus: () => Promise<unknown>;
      };
    };
    for (let round = 0; round < 3; round += 1) {
      await pigeon.getCall('no-such-call');
      await new Promise(requestAnimationFrame);
    }
    await pigeon.dbStatus();
    await new Promise(requestAnimationFrame);
  });

  await expect(remaining).toHaveAttribute('data-remaining', String(2 * MIB));
});

test('a large typed body pages in the panel, replays the same bytes, and Edit and curl say why not, in view', async () => {
  const text = `${'z'.repeat(2 * MIB)}TAIL`;
  capture.requests.length = 0;
  capture.respondWith({ status: 200, body: Buffer.from('ok') });
  await fillTextRequest('POST', '/large-request', 'text', text);
  await sendAndSeeNewRow();
  expect(capture.requests[0]?.body.toString()).toBe(text);

  await history().first().getByRole('button').click();
  await expect(
    panel().getByTestId('call-request-body-remaining'),
  ).toHaveAttribute('data-remaining', String(MIB + 4));

  await button('Replay').click();
  await expect.poll(() => capture.requests.length).toBe(2);
  expect(
    capture.requests[1]?.body.equals(capture.requests[0]?.body as Buffer),
  ).toBe(true);

  await button('Edit').click();
  const editError = panel().getByTestId('call-edit-error');
  await expect(editError).toContainText('too large to edit');
  await expect(editError).toBeInViewport();
  // The form is left alone.
  await expect(testApp.window.getByLabel('Body text')).toHaveValue(text);

  await button('Copy call as curl').click();
  const curlError = panel().getByTestId('call-curl-error');
  await expect(curlError).toContainText('too long for a shell command');
  await expect(curlError).toBeInViewport();
});

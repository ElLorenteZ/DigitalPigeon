// T2.7, T2.9: journeys with a request body and a 17 MiB response. The bytes and the storage are tested
// below this layer; only the assembled app shows the form, the panel and Load more connecting to them.
import { expect, test } from '@playwright/test';
import {
  type CaptureServer,
  startCaptureServer,
} from '../test-support/capture-server';
import {
  type TestApp,
  bodyEdge,
  bodyLines,
  expectBodyText,
  launchWithTestDatabase,
  showBodyView,
} from './support';

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
  // A JSON body opens Pretty, labelled; Raw shows the recorded text.
  await expect(panel().getByTestId('call-request-body-view')).toHaveAttribute(
    'data-view',
    'pretty',
  );
  await expectBodyText(
    panel().getByTestId('call-request-body'),
    '{\n  "item": "é"\n}',
  );
  await showBodyView(panel(), 'call-request-body', 'Raw');
  await expectBodyText(
    panel().getByTestId('call-request-body'),
    '{"item":"é"}',
  );
  // A body with no JSON or XML type has no switch.
  await expect(panel().getByTestId('response-body-view')).toHaveCount(0);
  await expectBodyText(panel().getByTestId('response-body'), 'json response');

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
  await showBodyView(panel(), 'call-request-body', 'Raw');
  await expectBodyText(
    panel().getByTestId('call-request-body'),
    '{"item":"é"}',
  );
  await history().first().getByRole('button').click();
  await showBodyView(panel(), 'call-request-body', 'Raw');
  await expectBodyText(
    panel().getByTestId('call-request-body'),
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
  await expectBodyText(
    panel().getByTestId('call-request-body'),
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

test('T2.9 — switching a JSON response between Pretty and Raw keeps it in view, and History is one scroll below a 1 MiB response', async () => {
  const { window } = testApp;
  // 1 MiB of JSON that stays inline (just under BODY_PAGE_BYTES), so it opens in the result view.
  const items: string[] = [];
  let size = 2;
  for (let i = 0; size < MIB - 64; i += 1) {
    const item = `{"i":${i}}`;
    items.push(item);
    size += item.length + 1;
  }
  capture.respondWith({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(`[${items.join(',')}]`),
  });
  await window.getByLabel('Method').selectOption('GET');
  await window.getByLabel('URL').fill(`${capture.url}/switch`);
  await window.getByLabel('Body type').selectOption('none');
  await sendAndSeeNewRow();

  const result = window.getByTestId('result');
  const shown = result.getByTestId('response-body');
  await expect(shown).toBeInViewport({ ratio: 0.9 });
  for (const view of ['Raw', 'Pretty'] as const) {
    await showBodyView(result, 'response-body', view);
    await expect(result.getByTestId('response-body-view')).toHaveAttribute(
      'data-view',
      view.toLowerCase(),
    );
    // Most of the body area, not any sliver of it: the page is short, so a scroll can leave an edge in view.
    await expect(shown).toBeInViewport({ ratio: 0.9 });
  }

  // The body scrolls in its own area, so History is at most one page of scrolling below it (T3.10's long scroll).
  await window.evaluate(() => scrollBy(0, innerHeight));
  await expect(
    window.getByRole('heading', { name: 'History', exact: true }),
  ).toBeInViewport();
});

test('a body that could not be shown does not leave its error on the next call opened (code review, finding 1)', async () => {
  const { window } = testApp;
  const respondJson = (text: string) =>
    capture.respondWith({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(text),
    });
  await window.getByLabel('Method').selectOption('GET');
  await window.getByLabel('Body type').selectOption('none');
  respondJson('{"second":2}');
  await window.getByLabel('URL').fill(`${capture.url}/shows`);
  await sendAndSeeNewRow();
  respondJson('{"first":1}');
  await window.getByLabel('URL').fill(`${capture.url}/fails-to-show`);
  await sendAndSeeNewRow();

  // The editor constructs a ResizeObserver for its layout; one that throws makes the next body opened fail to show.
  await window.evaluate(() => {
    const scope = globalThis as unknown as {
      ResizeObserver: unknown;
      __resizeObserver: unknown;
    };
    scope.__resizeObserver = scope.ResizeObserver;
    scope.ResizeObserver = class {
      constructor() {
        throw new Error('forced for this test');
      }
    };
  });
  await history().first().getByRole('button').click();
  await expect(panel().getByTestId('call-request-line')).toContainText(
    '/fails-to-show',
  );
  await expect(panel().getByTestId('response-body-error')).toContainText(
    'forced for this test',
  );

  await window.evaluate(() => {
    const scope = globalThis as unknown as {
      ResizeObserver: unknown;
      __resizeObserver: unknown;
    };
    scope.ResizeObserver = scope.__resizeObserver;
  });
  await history().nth(1).getByRole('button').click();
  await expect(panel().getByTestId('call-request-line')).toContainText(
    '/shows',
  );
  await expect(panel().getByTestId('response-body-error')).toHaveCount(0);
  await showBodyView(panel(), 'response-body', 'Raw');
  await expectBodyText(panel().getByTestId('response-body'), '{"second":2}');
});

test('a stored JSON response loads page by page, formatted, to its final value', async () => {
  const items: string[] = [];
  let size = 2;
  for (let i = 0; size < 2.5 * MIB; i += 1) {
    const item = `{"i":${i},"v":"value-${i}"}`;
    items.push(item);
    size += item.length + 1;
  }
  const last = items.length - 1;
  capture.respondWith({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(`[${items.join(',')}]`),
  });
  await testApp.window.getByLabel('Method').selectOption('GET');
  await testApp.window.getByLabel('URL').fill(`${capture.url}/stored-json`);
  await testApp.window.getByLabel('Body type').selectOption('none');
  await sendAndSeeNewRow();

  await history().first().getByRole('button').click();
  const text = panel().getByTestId('response-body');
  const loadMore = panel().getByRole('button', { name: 'Load more' });
  await expect(panel().getByTestId('response-body-view')).toHaveAttribute(
    'data-view',
    'pretty',
  );
  const remaining = panel().getByTestId('response-body-remaining');
  const total = Buffer.byteLength(`[${items.join(',')}]`);
  let expected = total - MIB;
  await expect(remaining).toHaveAttribute('data-remaining', String(expected));
  while (expected > 0) {
    await loadMore.click();
    expected = Math.max(expected - MIB, 0);
    if (expected > 0) {
      await expect(remaining).toHaveAttribute(
        'data-remaining',
        String(expected),
      );
    } else {
      await expect(loadMore).toHaveCount(0);
    }
  }
  await expect(text).toHaveAttribute('data-loaded-chars', String(total));

  // The last object, indented as the first one is: the formatter kept its depth across every page.
  expect(await bodyEdge(testApp.window, text, 'end')).toBe(']');
  const lines = await bodyLines(text);
  expect(lines.slice(-5)).toEqual([
    '  {',
    `    "i": ${last},`,
    `    "v": "value-${last}"`,
    '  }',
    ']',
  ]);
  // A reader scrolling back a little sees the lines in order.
  const box = await text.boundingBox();
  if (!box) throw new Error('the body is not shown');
  await testApp.window.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await testApp.window.mouse.wheel(0, -90);
  await expect.poll(async () => (await bodyLines(text)).at(-1)).not.toBe(']');
  const shownIs = (await bodyLines(text))
    .map((line) => /"i": (\d+)/.exec(line)?.[1])
    .filter((value) => value !== undefined)
    .map(Number);
  expect(shownIs.length).toBeGreaterThan(1);
  expect(shownIs).toEqual([...shownIs].sort((x, y) => x - y));
});

// The editor draws only the lines in view, so the loaded length comes from data-loaded-chars and the start and end are
// read by moving there with the keyboard (plan.md, phase 3).
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
  await expect(text).toHaveAttribute('data-loaded-chars', String(MIB));
  expect((await bodyEdge(testApp.window, text, 'start')).slice(0, 12)).toBe(
    start,
  );

  let expected = body.length - MIB;
  while (expected > 0) {
    await loadMore.click();
    const next = Math.max(expected - MIB, 0);
    if (next > 0) {
      await expect(remaining).toHaveAttribute('data-remaining', String(next));
      // T2.9: the body scrolls in its own area, so after Load more the area and the remaining count stay in view.
      await expect(text).toBeInViewport({ ratio: 0.9 });
      await expect(remaining).toBeInViewport({ ratio: 1 });
    } else {
      await expect(loadMore).toHaveCount(0);
    }
    expected = next;
    await expect(text).toHaveAttribute(
      'data-loaded-chars',
      String(body.length - expected),
    );
  }

  await expect(remaining).toHaveCount(0);
  expect((await bodyEdge(testApp.window, text, 'end')).slice(-12)).toBe(end);
  expect((await bodyEdge(testApp.window, text, 'start')).slice(0, 12)).toBe(
    start,
  );
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

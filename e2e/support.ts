// Launching the app for e2e: the built local server (dist/server/main.mjs) against a throwaway database
// (test-support/e2e-database.ts), opened in the installed Chrome (plan.md, phase 3; ADR 0002). Answers the server
// cannot be made to give from outside are arranged at the network layer with `stubOperation`, so the server carries
// no test-only code.
import { type ChildProcess, spawn } from 'node:child_process';
import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
  chromium,
  expect,
} from '@playwright/test';
import { decode, encode } from '../src/shared/wire-codec';
import { createE2eDatabase } from '../test-support/e2e-database';

export interface TestApp {
  /** The browser context the app runs in: `app.pages()` counts every open page. */
  app: BrowserContext;
  window: Page;
  database: string;
  /** `http://127.0.0.1:<port>`. */
  origin: string;
  close: () => Promise<void>;
}

// Reads a body shown in the editor. Monaco draws only the lines in view and reuses their elements, so DOM order
// is not reading order: lines are sorted by their top (spike-monaco.md). Spaces are drawn as no-break spaces.
// A model line that wraps is drawn as several lines, so this reads what a reader sees, line by line.
export function bodyLines(body: Locator): Promise<string[]> {
  return body.evaluate((element) =>
    [...element.querySelectorAll<HTMLElement>('.view-line')]
      .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
      .map((line) => (line.textContent ?? '').replace(/\u00a0/g, ' ')),
  );
}

export const expectBodyText = (body: Locator, expected: string) =>
  expect
    .poll(async () => (await bodyLines(body)).join('\n'), {
      message: `the body shown as ${JSON.stringify(expected)}`,
    })
    .toBe(expected);

// Moves to the start or end of a body and returns the first or last line drawn there. The editor takes focus from a
// click on a point inside its text area; a click on the line container scrolls it instead (spike-monaco.md).
export async function bodyEdge(
  page: Page,
  body: Locator,
  edge: 'start' | 'end',
): Promise<string> {
  const box = await body.boundingBox();
  if (!box) throw new Error('the body is not shown');
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  await page.keyboard.press(edge === 'end' ? 'Meta+ArrowDown' : 'Meta+ArrowUp');
  let line = '';
  await expect
    .poll(async () => {
      const lines = await bodyLines(body);
      line = (edge === 'end' ? lines.at(-1) : lines[0]) ?? '';
      return line;
    })
    .not.toBe('');
  // One more frame, so the lines read are the ones drawn after the move.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const lines = await bodyLines(body);
  return (edge === 'end' ? lines.at(-1) : lines[0]) ?? line;
}

// A JSON or XML body opens Pretty; a test that checks the recorded text presses Raw first.
export const showBodyView = (
  scope: Page | Locator,
  testId: string,
  view: 'Pretty' | 'Raw',
) =>
  scope
    .getByTestId(`${testId}-view`)
    .locator('..')
    .getByRole('button', { name: view, exact: true })
    .click();

export async function launchWithTestDatabase(): Promise<TestApp> {
  const db = createE2eDatabase();
  const server = spawn('node', ['dist/server/main.mjs'], {
    env: { ...process.env, ...db.env, DP_PORT: '0', DP_OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let browser: Browser | undefined;
  try {
    const url = await tokenUrl(server);
    browser = await chromium.launch({ channel: 'chrome' });
    // The size the Electron window had, so layout and viewport checks keep their meaning.
    const app = await browser.newContext({
      viewport: { width: 1100, height: 800 },
    });
    await app.addInitScript(recordCspViolations);
    const window = await app.newPage();
    await window.goto(url);
    const opened = browser;
    return {
      app,
      window,
      database: db.database,
      origin: new URL(url).origin,
      close: async () => {
        await opened.close();
        await stop(server);
        await db.drop();
      },
    };
  } catch (error) {
    await browser?.close();
    await stop(server);
    await db.drop();
    throw error;
  }
}

// The server prints one line with its token URL (src/server/main.ts).
function tokenUrl(server: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = '';
    server.stdout?.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      const match = /DigitalPigeon listening: (\S+)/.exec(seen);
      if (match) resolve(match[1] as string);
    });
    server.once('exit', (code) =>
      reject(new Error(`the server exited (${code}) before listening`)),
    );
  });
}

function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
  });
}

// Runs in every page before its scripts. The console does not report CSP violations (spike-browser-host.md,
// surprise 1); the securitypolicyviolation event does.
function recordCspViolations() {
  const seen: string[] = [];
  (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
  document.addEventListener('securitypolicyviolation', (event) => {
    seen.push(
      `${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`,
    );
  });
}

export const cspViolations = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __cspViolations?: string[] }).__cspViolations ??
      [],
  );

export const expectNoCspViolations = async (page: Page) =>
  expect(await cspViolations(page)).toEqual([]);

const operationUrl = (channel: string) =>
  `**/api/${channel.replace(/^pigeon:/, '')}`;

const pendingAnswers = new WeakMap<Page, Set<Promise<void>>>();

/**
 * Replaces the server's answer to one operation for this page. `answer` gets the decoded input and `real()`, which
 * asks the server for its own answer. A thrown error rejects the call in the page, as a thrown handler rejected an
 * IPC call. Returns `restore`, which hands the operation back to the server.
 */
export async function stubOperation(
  page: Page,
  channel: string,
  answer: (input: unknown, real: () => Promise<unknown>) => unknown,
): Promise<{ restore: () => Promise<void> }> {
  const pattern = operationUrl(channel);
  await page.unroute(pattern);
  const pending = pendingAnswers.get(page) ?? new Set();
  pendingAnswers.set(page, pending);
  await page.route(pattern, (route: Route) => {
    const answered = (async () => {
      const text = route.request().postData() ?? '';
      const real = async () => {
        const response = await route.fetch();
        return decode(await response.text());
      };
      try {
        const result = await answer(
          text === '' ? undefined : decode(text),
          real,
        );
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: encode(result ?? null),
        });
      } catch (error) {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: String((error as Error)?.message ?? error),
        });
      }
    })();
    pending.add(answered);
    void answered.finally(() => pending.delete(answered));
    return answered;
  });
  return { restore: () => page.unroute(pattern) };
}

/** A gate a stubbed answer can wait on; `release()` opens it. */
export function gate(): { wait: () => Promise<void>; release: () => void } {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait: () => opened, release };
}

/** One operation, asked from the page as the app asks it; the answer is decoded here. */
export async function callOperation(
  page: Page,
  channel: string,
  input?: unknown,
): Promise<unknown> {
  const text = await page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, { method: 'POST', body });
      return response.text();
    },
    {
      path: `/api/${channel.replace(/^pigeon:/, '')}`,
      body: input === undefined ? '' : encode(input),
    },
  );
  return decode(text);
}

/**
 * Waits until every stubbed answer already released has reached the page, then makes one more round trip and lets
 * a frame pass, so React has committed whatever those answers caused.
 */
export async function settle(page: Page): Promise<void> {
  await Promise.all(pendingAnswers.get(page) ?? []);
  await callOperation(page, 'pigeon:db-status');
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

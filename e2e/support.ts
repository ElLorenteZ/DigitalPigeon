// Launching the app for e2e against a throwaway database (test-support/e2e-database.ts).
// Launches the repo root as the app directory: package.json `main` points at .vite/build/main.cjs,
// so the app name and userData are DigitalPigeon's. The packaged .app is not used: its fuses
// disable the inspector Playwright attaches through (context/archive/test-harness/record.md §3).
import {
  type ElectronApplication,
  type Locator,
  type Page,
  _electron as electron,
  expect,
} from '@playwright/test';
import { createE2eDatabase } from '../test-support/e2e-database';

export interface TestApp {
  app: ElectronApplication;
  window: Page;
  database: string;
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
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, ...db.env },
  });
  const window = await appWindow(app);

  return {
    app,
    window,
    database: db.database,
    close: async () => {
      await app.close();
      await db.drop();
    },
  };
}

// DevTools opens when the app is not packaged (src/main.ts), so select the app window by URL.
// Polled rather than matched on the 'window' event: a window can be created at about:blank and
// only then navigate to index.html, which a one-shot predicate on creation would miss.
async function appWindow(app: ElectronApplication): Promise<Page> {
  const isAppWindow = (page: Page) =>
    page.url().endsWith('main_window/index.html');
  let found: Page | undefined;
  await expect
    .poll(() => (found = app.windows().find(isAppWindow)), {
      message: 'an Electron window showing main_window/index.html',
      timeout: 30_000,
    })
    .toBeDefined();
  return found as Page;
}

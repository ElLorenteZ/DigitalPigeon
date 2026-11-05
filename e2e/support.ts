// Launching the app for e2e against a throwaway database (test-support/e2e-database.ts).
// Launches the repo root as the app directory: package.json `main` points at .vite/build/main.cjs,
// so the app name and userData are DigitalPigeon's. The packaged .app is not used: its fuses
// disable the inspector Playwright attaches through (context/archive/test-harness/record.md §3).
import {
  type ElectronApplication,
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

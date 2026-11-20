// `npm start` / `npm run dev`: the local server (plan.md, phase 3; ADR 0002). Resolves the database credentials as
// the desktop build did, connects with the same retry, generates a per-launch token, serves the UI on 127.0.0.1 and
// opens Chrome at the token URL, which the server exchanges for an HttpOnly cookie.
//
// Environment:
//   DP_PORT          port (default 4380; 0 picks a free one)
//   DP_OPEN_BROWSER  "0" to only print the URL (e2e)
//   DP_DEV           "1" to serve the UI through Vite in middleware mode instead of the built files
//   DP_MONGO_DB, MONGO_ROOT_USER, MONGO_ROOT_PASSWORD — as before (src/core/db-config.ts)
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import {
  mongoClientOptions,
  mongoUri,
  resolveDbConfig,
} from '../core/db-config';
import { createDbConnection } from '../core/db-connection';
import { type ServerOptions, createServer } from './http';

const DEFAULT_PORT = 4380;
const APP_NAME = 'DigitalPigeon';

/** Where the desktop build kept its `userData`, so the same config.json is found (plan.md, A7). */
function userDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', APP_NAME);
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'),
      APP_NAME,
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'),
    APP_NAME,
  );
}

function openInChrome(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', ['-a', 'Google Chrome', url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', 'chrome', url]]
        : ['google-chrome', [url]];
  execFile(command, args, (error) => {
    if (error) {
      console.error(
        `Could not open Chrome (${error.message}). Open the URL above yourself.`,
      );
    }
  });
}

async function devMiddleware(): Promise<ServerOptions['devMiddleware']> {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    configFile: path.resolve('vite.renderer.config.mts'),
    appType: 'spa',
    // No HMR websocket: it would arrive through the `upgrade` event, which the server's Host and cookie checks do not
    // see. A reload picks up changes.
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  return vite.middlewares;
}

async function main(): Promise<void> {
  const configPath = path.join(userDataDir(), 'config.json');
  const resolved = resolveDbConfig({
    env: process.env,
    configPath,
    readFile: (p) => readFileSync(p, 'utf8'),
  });
  const connection = createDbConnection({
    connect:
      resolved.kind === 'configured'
        ? () =>
            new MongoClient(
              mongoUri(resolved.config),
              mongoClientOptions,
            ).connect()
        : undefined,
  });
  void connection.start();

  const dev = process.env.DP_DEV === '1';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const token = randomBytes(32).toString('hex');
  const server = await createServer({
    token,
    port: Number(process.env.DP_PORT ?? DEFAULT_PORT),
    db: () =>
      resolved.kind === 'configured'
        ? connection.client()?.db(resolved.config.database)
        : undefined,
    dbStatus: () => ({
      status: connection.status(),
      configPath,
      ...(resolved.kind === 'configured'
        ? { database: resolved.config.database }
        : {
            detail:
              resolved.reason === 'missing'
                ? `Create ${configPath}`
                : resolved.detail,
          }),
    }),
    ...(dev
      ? { devMiddleware: await devMiddleware() }
      : { staticDir: path.resolve(here, '../ui') }),
  });

  const url = `http://127.0.0.1:${server.port}/?token=${token}`;
  // One line, so e2e can read it from stdout.
  console.log(`DigitalPigeon listening: ${url}`);
  if (process.env.DP_OPEN_BROWSER !== '0') openInChrome(url);

  const stop = () => {
    connection.stop();
    void Promise.all([server.close(), connection.client()?.close()]).finally(
      () => process.exit(0),
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  const { code, port } = error as { code?: string; port?: number };
  if (code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is in use. Is DigitalPigeon already running? Set DP_PORT to use another port.`,
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});

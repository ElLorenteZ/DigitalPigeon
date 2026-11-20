// The local server in front of the operations (plan.md, phase 2; ADR 0002). Bound to 127.0.0.1. Every request must
// carry the server's own Host (stops DNS rebinding). The browser gets a per-port HttpOnly cookie once, from the token
// URL that `npm start` opens; every later request must carry it. A request carrying another Origin is refused
// everywhere; operations are POST /api/<channel> and must carry the server's own Origin (CSRF). Anything refused is refused before a handler runs, so nothing is sent or
// recorded. Values cross as tagged JSON (src/shared/wire-codec.ts).
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  type IncomingMessage,
  type ServerResponse,
  createServer as createHttpServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Db } from 'mongodb';
import { registerIpc } from './ipc';
import type { DbStatusView } from '../shared/ipc-contract';
import { decode, encode } from '../shared/wire-codec';

/** The production policy, formerly a build-time <meta> tag (vite.renderer.config.mts). AGENTS.md fixes it. */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

export interface ServerOptions {
  db: () => Db | undefined;
  dbStatus: () => DbStatusView;
  /** The per-launch token. */
  token: string;
  /** 0 picks a free port. */
  port: number;
  /** The built UI. Without it, only the token exchange and the operations are served. */
  staticDir?: string;
  /**
   * Development only: Vite in middleware mode, called after the Host and cookie checks for every non-API GET. No
   * CSP header in dev, as before (AGENTS.md): React refresh needs an inline script.
   */
  devMiddleware?: (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => void;
}

export interface PigeonServer {
  port: number;
  close: () => Promise<void>;
}

type Handler = (event: unknown, raw?: unknown) => unknown;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const sameSecret = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const cookieValue = (header: string | undefined, name: string) => {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const refuse = (res: ServerResponse, status = 403) => {
  res.writeHead(status);
  res.end();
};

export async function createServer(
  options: ServerOptions,
): Promise<PigeonServer> {
  const handlers = new Map<string, Handler>();
  registerIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db: options.db,
    dbStatus: options.dbStatus,
  });

  let port = 0;
  const cookieName = () => `dp_${port}`;
  const ownOrigin = () => `http://127.0.0.1:${port}`;

  const operation = async (
    req: IncomingMessage,
    res: ServerResponse,
    channel: string,
  ) => {
    const handler = handlers.get(`pigeon:${channel}`);
    if (!handler) return refuse(res, 404);
    let input: unknown;
    try {
      const text = await readBody(req);
      input = text === '' ? undefined : decode(text);
    } catch {
      return refuse(res, 400);
    }
    try {
      const result = await handler(null, input);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(encode(result ?? null));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String((error as Error)?.message ?? error));
    }
  };

  const staticFile = async (res: ServerResponse, pathname: string) => {
    if (pathname === '/favicon.ico') return refuse(res, 204);
    const root = options.staticDir;
    if (!root) return refuse(res, 404);
    const file = path.resolve(
      root,
      `.${pathname === '/' ? '/index.html' : pathname}`,
    );
    if (file !== root && !file.startsWith(root + path.sep))
      return refuse(res, 404);
    let content: Buffer;
    try {
      content = await readFile(file);
    } catch {
      return refuse(res, 404);
    }
    res.writeHead(200, {
      'Content-Type':
        CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': CSP,
    });
    res.end(content);
  };

  const server = createHttpServer((req, res) => {
    void (async () => {
      if (req.headers.host !== `127.0.0.1:${port}`) return refuse(res);
      // Every endpoint refuses an Origin that is not the server's own (ADR 0002). An absent one is allowed outside
      // /api/*: Chrome sends none on navigations and worker scripts (spike-browser-host.md, surprise 3).
      const { origin } = req.headers;
      if (origin !== undefined && origin !== ownOrigin()) return refuse(res);
      const url = new URL(req.url ?? '/', ownOrigin());

      if (url.pathname === '/' && url.searchParams.has('token')) {
        if (!sameSecret(url.searchParams.get('token') ?? '', options.token)) {
          return refuse(res);
        }
        res.writeHead(303, {
          'Set-Cookie': `${cookieName()}=${options.token}; HttpOnly; SameSite=Strict; Path=/`,
          Location: '/',
        });
        return res.end();
      }

      const presented = cookieValue(req.headers.cookie, cookieName());
      if (presented === undefined || !sameSecret(presented, options.token)) {
        return refuse(res);
      }

      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'POST') return refuse(res);
        if (req.headers.origin !== ownOrigin()) return refuse(res);
        return operation(req, res, url.pathname.slice('/api/'.length));
      }

      if (req.method !== 'GET') return refuse(res);
      if (options.devMiddleware && url.pathname !== '/favicon.ico') {
        return options.devMiddleware(req, res, () => refuse(res, 404));
      }
      return staticFile(res, url.pathname);
    })().catch(() => {
      if (!res.headersSent) refuse(res, 500);
      else res.end();
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port, '127.0.0.1', resolve),
  );
  port = (server.address() as AddressInfo).port;

  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

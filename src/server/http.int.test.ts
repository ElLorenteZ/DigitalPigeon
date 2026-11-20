// The local server in front of the operations (plan.md, phase 2; ADR 0002). It answers every operation over HTTP
// and refuses any request that lacks the per-port cookie, the server's own Host, or (for /api/*) its own Origin,
// before anything is sent or recorded. Requests are made with node:http so Host, Origin and Cookie are exact.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { type IncomingHttpHeaders, request } from 'node:http';
import { createServer as createRawServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import {
  type CaptureServer,
  startCaptureServer,
} from '../../test-support/capture-server';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { channels } from '../shared/ipc-contract';
import { decode, encode } from '../shared/wire-codec';
import { type PigeonServer, createServer } from './http';

const TOKEN = 'f'.repeat(64);
// The production policy (vite.renderer.config.mts:7-9), now sent as a header.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

let testDb: TestDb;
let server: PigeonServer;
let capture: CaptureServer;
let staticDir: string;

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface Options {
  method?: string;
  host?: string;
  origin?: string | null;
  cookie?: string | null;
  body?: string | Buffer;
}

function raw(urlPath: string, options: Options = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    host: options.host ?? `127.0.0.1:${server.port}`,
  };
  if (options.origin !== null) {
    headers.origin = options.origin ?? `http://127.0.0.1:${server.port}`;
  }
  if (options.cookie !== null && options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.port,
        path: urlPath,
        method: options.method ?? 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

let cookie: string;

// The token exchange a browser goes through once, at the URL `npm start` opens.
async function login(): Promise<string> {
  const reply = await raw(`/?token=${TOKEN}`, { origin: null });
  const setCookie = reply.headers['set-cookie']?.[0] ?? '';
  return setCookie.split(';')[0] as string;
}

const api = (
  channel: string,
  input?: unknown,
  options: Omit<Options, 'body' | 'method'> & { method?: string } = {},
) =>
  raw(`/api/${channel.replace(/^pigeon:/, '')}`, {
    method: 'POST',
    cookie,
    ...options,
    body: input === undefined ? '' : encode(input),
  });

const call = async (channel: string, input?: unknown) => {
  const reply = await api(channel, input);
  expect(reply.status, reply.body.toString()).toBe(200);
  return decode(reply.body.toString()) as never;
};

const sendInput = (clientRequestId: string, url = `${capture.url}/`) => ({
  clientRequestId,
  method: 'POST',
  url,
  queryRows: [],
  headerRows: [],
  body: { type: 'text', text: 'hello' },
});

const nothingSentOrRecorded = async () => {
  expect(capture.requests).toHaveLength(0);
  expect(await testDb.db.collection('sends').countDocuments()).toBe(0);
};

beforeAll(async () => {
  testDb = await openTestDb();
  staticDir = await mkdtemp(path.join(tmpdir(), 'dp-static-'));
  await writeFile(
    path.join(staticDir, 'index.html'),
    '<!doctype html><p>app</p>',
  );
  await writeFile(path.join(staticDir, 'app.js'), 'export {};');
  server = await createServer({
    db: () => testDb.db,
    dbStatus: () => ({ status: 'up', configPath: '' }),
    token: TOKEN,
    port: 0,
    staticDir,
  });
  cookie = await login();
});

afterAll(async () => {
  await server?.close();
  await testDb?.drop();
});

beforeEach(async () => {
  capture = await startCaptureServer();
  await testDb.db.collection('sends').deleteMany({});
  await testDb.db.collection('completions').deleteMany({});
});

afterEach(async () => {
  await capture.close();
});

describe('the token exchange', () => {
  test('the right token sets an HttpOnly, SameSite=Strict cookie named for the port, and redirects to /', async () => {
    const reply = await raw(`/?token=${TOKEN}`, { origin: null });
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/');
    const setCookie = reply.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(new RegExp(`^dp_${server.port}=${TOKEN};`));
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Strict/i);
    expect(setCookie).toMatch(/;\s*Path=\//i);
  });

  test.each([
    ['a wrong token', `/?token=${'0'.repeat(64)}`],
    ['an empty token', '/?token='],
    ['a token one character short', `/?token=${TOKEN.slice(1)}`],
  ])('%s is refused and sets no cookie', async (_name, url) => {
    const reply = await raw(url, { origin: null });
    expect(reply.status).toBe(403);
    expect(reply.headers['set-cookie']).toBeUndefined();
  });
});

describe('operations over HTTP', () => {
  test('a send is recorded and its result carries bytes and dates', async () => {
    capture.respondWith({ status: 201, body: Buffer.from('created') });
    const result = (await call(channels.send, sendInput('ok-1'))) as {
      ok: boolean;
      send: { sentAt: unknown };
      completion: { response: { status: number; body: unknown } };
    };
    expect(result.ok).toBe(true);
    expect(result.send.sentAt).toBeInstanceOf(Date);
    expect(result.completion.response.status).toBe(201);
    expect(result.completion.response.body).toEqual(
      new Uint8Array(Buffer.from('created')),
    );
    expect(capture.requests).toHaveLength(1);
  });

  test('every operation in the contract answers through HTTP', async () => {
    capture.respondWith({ status: 200, body: Buffer.from('x') });
    const sent = (await call(channels.send, sendInput('all-1'))) as {
      send: { _id: string };
    };
    await call(channels.saveEnvironment, {
      name: 'local',
      baseUrl: capture.url,
    });
    const envs = (await call(channels.listEnvironments)) as {
      ok: true;
      environments: { id: string }[];
    };
    const envId = envs.environments[0]?.id as string;
    const saved = (await call(channels.saveSavedRequest, {
      name: 'r',
      request: {
        method: 'GET',
        url: '/',
        queryRows: [],
        headerRows: [],
      },
    })) as { ok: boolean; id: string };

    const answers: Record<string, unknown> = {
      [channels.send]: sent,
      [channels.cancel]: await call(channels.cancel, 'nothing-in-flight'),
      [channels.listCalls]: await call(channels.listCalls),
      [channels.dbStatus]: await call(channels.dbStatus),
      [channels.getCall]: await call(channels.getCall, sent.send._id),
      [channels.replay]: await call(channels.replay, {
        clientRequestId: 'all-2',
        sendId: sent.send._id,
      }),
      [channels.readBody]: await call(channels.readBody, {
        fileId: '000000000000000000000000',
        offset: 0,
        length: 1,
      }),
      [channels.describeBody]: await call(channels.describeBody, {
        fileId: '000000000000000000000000',
        boundary: 'b',
      }),
      [channels.listEnvironments]: envs,
      [channels.saveEnvironment]: { ok: true },
      [channels.setActiveEnvironment]: await call(
        channels.setActiveEnvironment,
        envId,
      ),
      [channels.deleteEnvironment]: await call(
        channels.deleteEnvironment,
        envId,
      ),
      [channels.listSavedRequests]: await call(channels.listSavedRequests),
      [channels.getSavedRequest]: await call(
        channels.getSavedRequest,
        saved.id,
      ),
      [channels.saveSavedRequest]: saved,
      [channels.deleteSavedRequest]: await call(
        channels.deleteSavedRequest,
        saved.id,
      ),
    };

    expect(Object.keys(answers).sort()).toEqual(Object.values(channels).sort());
    expect(answers[channels.dbStatus]).toEqual({
      status: 'up',
      configPath: '',
    });
    expect(answers[channels.getCall]).toMatchObject({ ok: true });
    expect(answers[channels.replay]).toMatchObject({ ok: true });
    expect(answers[channels.listCalls]).toMatchObject({ ok: true });
    expect(saved.ok).toBe(true);
    expect(answers[channels.getSavedRequest]).toMatchObject({ ok: true });
    expect(capture.requests).toHaveLength(2);
  });

  test('a thrown handler answers 400 with a message, not a crash', async () => {
    const reply = await api(channels.cancel, 42);
    expect(reply.status).toBe(400);
    expect(reply.body.toString()).not.toBe('');
  });

  test('a 17 MiB multipart file is recorded, and its replay delivers the same bytes', async () => {
    const file = new Uint8Array(17 * 1024 * 1024).map((_, i) => i % 253);
    const started = Date.now();
    const sent = (await call(channels.send, {
      ...sendInput('big-1'),
      body: {
        type: 'multipart',
        parts: [
          {
            kind: 'file',
            name: 'upload',
            filename: 'big.bin',
            contentType: 'application/octet-stream',
            bytes: file,
          },
        ],
      },
    })) as { ok: boolean; send: { _id: string } };
    expect(sent.ok).toBe(true);
    const replayed = (await call(channels.replay, {
      clientRequestId: 'big-2',
      sendId: sent.send._id,
    })) as { ok: boolean };
    expect(replayed.ok).toBe(true);
    console.log(`17 MiB send and replay over HTTP: ${Date.now() - started} ms`);

    expect(capture.requests).toHaveLength(2);
    const [first, second] = capture.requests;
    expect(first?.body.equals(second?.body as Buffer)).toBe(true);
    expect(first?.body.includes(Buffer.from(file.subarray(0, 4096)))).toBe(
      true,
    );
  }, 60_000);

  test('a cancel sent as a second request ends a send that is waiting for its response', async () => {
    let arrived!: () => void;
    const waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    // A target that accepts the request and never answers.
    const silent: Server = createRawServer(() => arrived());
    await new Promise<void>((resolve) =>
      silent.listen(0, '127.0.0.1', resolve),
    );
    const port = (silent.address() as AddressInfo).port;
    try {
      const sending = call(
        channels.send,
        sendInput('cancel-1', `http://127.0.0.1:${port}/`),
      );
      await waiting;
      await call(channels.cancel, 'cancel-1');
      expect(await sending).toMatchObject({
        ok: true,
        completion: { error: { code: 'cancelled' } },
      });
    } finally {
      silent.closeAllConnections();
      await new Promise((resolve) => silent.close(resolve));
    }
  });
});

describe('refusals: nothing is sent or recorded', () => {
  const send = () => encode(sendInput('refused'));

  test.each<[string, Options]>([
    ['no cookie', { cookie: null }],
    ['a wrong cookie', { cookie: '' }],
    ['the cookie under another port’s name', { cookie: '' }],
    ['a foreign Host (DNS rebinding)', { host: 'evil.test:PORT' }],
    ['localhost instead of 127.0.0.1 as Host', { host: 'localhost:PORT' }],
    ['a foreign Origin', { origin: 'http://evil.test' }],
    ['no Origin', { origin: null }],
    ['an Origin on another port', { origin: 'http://127.0.0.1:1' }],
  ])('%s → 403', async (name, options) => {
    const resolved: Options = { ...options };
    if (resolved.host)
      resolved.host = resolved.host.replace('PORT', String(server.port));
    if (name === 'a wrong cookie')
      resolved.cookie = `dp_${server.port}=${'0'.repeat(64)}`;
    if (name === 'the cookie under another port’s name') {
      resolved.cookie = cookie.replace(`dp_${server.port}=`, 'dp_1=');
    }
    const reply = await raw('/api/send', {
      method: 'POST',
      cookie,
      ...resolved,
      body: send(),
    });
    expect(reply.status).toBe(403);
    await nothingSentOrRecorded();
  });

  test('a cookie planted under the same name before the real one does not lock the UI out', async () => {
    const reply = await raw('/api/list-calls', {
      method: 'POST',
      cookie: `dp_${server.port}=planted; ${cookie}`,
      body: '',
    });
    expect(reply.status).toBe(200);
  });

  test('a port already in use rejects createServer instead of crashing the process', async () => {
    await expect(
      createServer({
        db: () => testDb.db,
        dbStatus: () => ({ status: 'up', configPath: '' }),
        token: TOKEN,
        port: server.port,
      }),
    ).rejects.toThrow(/EADDRINUSE/);
  });

  test('GET on an operation → 403', async () => {
    const reply = await raw('/api/send', { cookie });
    expect(reply.status).toBe(403);
    await nothingSentOrRecorded();
  });

  test('no response carries a CORS header', async () => {
    const replies = await Promise.all([
      raw('/api/list-calls', { method: 'POST', cookie, body: '' }),
      raw('/api/list-calls', {
        method: 'POST',
        cookie,
        origin: 'http://evil.test',
        body: '',
      }),
      raw('/', { cookie }),
    ]);
    for (const reply of replies) {
      expect(
        Object.keys(reply.headers).filter((h) =>
          h.startsWith('access-control-'),
        ),
      ).toEqual([]);
    }
  });
});

describe('static files', () => {
  test('the UI is served with the CSP as a header', async () => {
    const reply = await raw('/', { cookie, origin: null });
    expect(reply.status).toBe(200);
    expect(reply.body.toString()).toContain('<p>app</p>');
    expect(reply.headers['content-security-policy']).toBe(CSP);
    const script = await raw('/app.js', { cookie, origin: null });
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toMatch(/javascript/);
  });

  test('the favicon answers 204', async () => {
    expect((await raw('/favicon.ico', { cookie, origin: null })).status).toBe(
      204,
    );
  });

  test.each([
    ['the UI without a cookie', '/', { cookie: null }],
    ['a script without a cookie', '/app.js', { cookie: null }],
    [
      'the UI with a foreign Host',
      '/',
      { cookie: 'SET', host: 'evil.test:PORT' },
    ],
    [
      'the favicon with a foreign Host',
      '/favicon.ico',
      { cookie: 'SET', host: 'evil.test:PORT' },
    ],
    [
      'the token exchange with a foreign Host',
      `/?token=${TOKEN}`,
      { cookie: null, host: 'evil.test:PORT' },
    ],
    [
      'a path outside the static directory',
      '/../../etc/passwd',
      { cookie: 'SET' },
    ],
  ])('%s → refused', async (_name, url, options: Options) => {
    const reply = await raw(url, {
      origin: null,
      ...options,
      cookie: options.cookie === 'SET' ? cookie : options.cookie,
      host: options.host?.replace('PORT', String(server.port)),
    });
    expect([403, 404]).toContain(reply.status);
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(reply.body.toString()).not.toContain('<p>app</p>');
  });

  // ADR 0002: every endpoint refuses an Origin that is not the server's own. Outside /api/* an absent Origin is
  // allowed, because Chrome sends none on navigations and worker scripts (spike-browser-host.md, surprise 3).
  test.each([
    ['the UI', '/', 'SET'],
    ['a script', '/app.js', 'SET'],
    ['the favicon', '/favicon.ico', 'SET'],
    ['the token exchange', `/?token=${TOKEN}`, null],
  ])('%s with a foreign Origin → 403', async (_name, url, withCookie) => {
    const reply = await raw(url, {
      origin: 'http://evil.test',
      cookie: withCookie === 'SET' ? cookie : null,
    });
    expect(reply.status).toBe(403);
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(reply.body.toString()).not.toContain('<p>app</p>');
  });

  test('a script requested with the server’s own Origin is served', async () => {
    const reply = await raw('/app.js', { cookie });
    expect(reply.status).toBe(200);
  });
});

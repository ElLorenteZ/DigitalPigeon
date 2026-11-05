import { createServer as createHttpServer } from 'node:http';
import {
  type Server,
  type Socket,
  createServer as createNetServer,
} from 'node:net';
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
import { createCallStore } from './call-store';
import { z } from 'zod';
import {
  DatabaseUnavailableError,
  ResponseNotRecordedError,
  sendAndRecord,
} from './send';

let testDb: TestDb;
let capture: CaptureServer;

beforeAll(async () => {
  testDb = await openTestDb();
});

afterAll(async () => {
  await testDb?.drop();
});

beforeEach(async () => {
  capture = await startCaptureServer();
});

afterEach(async () => {
  await capture.close();
});

const input = (
  method: string,
  extra: Partial<{ headerRows: [string, string][] }> = {},
) => ({
  method,
  url: `${capture.url}/orders?x=1`,
  queryRows: [['q', 'two words']] as [string, string][],
  headerRows: [
    ['X-Zeta', '1'],
    ['accept', '*/*'],
    ['Authorization', 'Bearer t'],
  ] as [string, string][],
  ...extra,
});

const pairs = (raw: string[]) =>
  raw.flatMap((v, i) =>
    i % 2 === 0 ? [[v, raw[i + 1] ?? ''] as [string, string]] : [],
  );

describe('T1.3 — the send document is what reached the wire', () => {
  test.each(['GET', 'HEAD', 'DELETE', 'OPTIONS', 'POST', 'PUT', 'PATCH'])(
    '%s',
    async (method) => {
      const store = createCallStore(testDb.db);
      const call = await sendAndRecord(store, input(method));

      const received = capture.requests.at(-1);
      expect(received?.method).toBe(method);
      expect(call.send.request.url).toBe(`${capture.url}${received?.url}`);
      expect(received?.url).toBe(
        new URL(call.send.request.url).pathname +
          new URL(call.send.request.url).search,
      );
      expect(pairs(received?.rawHeaders ?? [])).toEqual(
        call.send.request.headers,
      );
      expect(received?.body.length).toBe(0);
    },
  );
});

test('T1.3 — a URL with a fragment records only what was sent', async () => {
  const store = createCallStore(testDb.db);
  const call = await sendAndRecord(store, {
    ...input('GET'),
    url: `${capture.url}/orders#top`,
    queryRows: [['page', '2']],
  });

  const received = capture.requests.at(-1);
  expect(received?.url).toBe('/orders?page=2');
  expect(call.send.request.url).toBe(`${capture.url}${received?.url}`);
});

test('T1.1 — the same input sent twice is recorded as two calls', async () => {
  const store = createCallStore(testDb.db);
  const first = await sendAndRecord(store, input('GET'));
  const second = await sendAndRecord(store, input('GET'));

  expect(first.send._id).not.toBe(second.send._id);
  const ids = (await store.listCalls(50, new Set())).flatMap((c) =>
    c.state === 'completed' ? [c.send._id] : [],
  );
  expect(ids).toContain(first.send._id);
  expect(ids).toContain(second.send._id);
});

test('T1.2 — a completed call carries status, headers, body bytes and timing', async () => {
  capture.respondWith({
    status: 201,
    headers: { 'X-B': '2' },
    body: Buffer.from([0x7b, 0x00, 0xff, 0x7d]),
  });
  const store = createCallStore(testDb.db);
  const call = await sendAndRecord(store, input('GET'));

  const completion = call.completion;
  expect(completion && 'response' in completion).toBe(true);
  if (!completion || !('response' in completion)) return;
  expect(completion.response.status).toBe(201);
  expect(completion.response.headers).toContainEqual(['x-b', '2']);
  expect(Array.from(completion.response.body)).toEqual([
    0x7b, 0x00, 0xff, 0x7d,
  ]);
  expect(completion.durationMs).toBeGreaterThanOrEqual(0);
  expect(completion.completedAt.getTime()).toBeGreaterThanOrEqual(
    call.send.sentAt.getTime(),
  );
  expect(completion.sendId).toBe(call.send._id);
});

describe('failures are recorded as error completions', () => {
  let hang: Server;
  let hangUrl: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    hang = createNetServer((socket) => sockets.push(socket)); // accepts, never responds
    await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', resolve));
    const address = hang.address();
    hangUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => hang.close(() => resolve()));
  });

  test('a refused connection is recorded as network', async () => {
    const closed = createHttpServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const address = closed.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(store, {
      ...input('GET'),
      url: `http://127.0.0.1:${port}/`,
    });

    expect(call.completion).toMatchObject({ error: { code: 'network' } });
  });

  test('a server that never responds is recorded as timeout', async () => {
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(
      store,
      { ...input('GET'), url: `${hangUrl}/` },
      { headersTimeoutMs: 200 },
    );

    expect(call.completion).toMatchObject({ error: { code: 'timeout' } });
  });

  test('aborting the signal is recorded as cancelled', async () => {
    const store = createCallStore(testDb.db);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const call = await sendAndRecord(
      store,
      { ...input('GET'), url: `${hangUrl}/` },
      { signal: controller.signal },
    );

    expect(call.completion).toMatchObject({ error: { code: 'cancelled' } });
  });
});

describe('recording comes first', () => {
  test('onSent receives the send document after it is stored and before the response', async () => {
    const store = createCallStore(testDb.db);
    let seen: { id: string; requestsAtThatPoint: number } | undefined;
    const call = await sendAndRecord(store, input('GET'), {
      onSent: (send) => {
        seen = { id: send._id, requestsAtThatPoint: capture.requests.length };
      },
    });

    expect(seen?.id).toBe(call.send._id);
    expect(seen?.requestsAtThatPoint).toBe(0);
    const listed = await store.listCalls(50, new Set([call.send._id]));
    expect(
      listed.some(
        (c) => c.state !== 'unreadable' && c.send._id === call.send._id,
      ),
    ).toBe(true);
  });

  test('a send whose send document cannot be inserted is never dispatched', async () => {
    const real = createCallStore(testDb.db);
    const store = {
      ...real,
      insertSend: async () => {
        throw new Error('database down');
      },
    };

    await expect(sendAndRecord(store, input('GET'))).rejects.toThrow(
      'database down',
    );
    expect(capture.requests).toHaveLength(0);
  });

  test('a schema error from insertSend is not reported as database unavailable', async () => {
    const real = createCallStore(testDb.db);
    const store = {
      ...real,
      insertSend: async () => {
        z.string().parse(1);
      },
    };

    const error = await sendAndRecord(store, input('GET')).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(z.ZodError);
    expect(error).not.toBeInstanceOf(DatabaseUnavailableError);
    expect(capture.requests).toHaveLength(0);
  });

  test('a response whose completion cannot be inserted rejects as not recorded, carrying the response', async () => {
    capture.respondWith({ status: 200, body: Buffer.from('ok') });
    const real = createCallStore(testDb.db);
    const store = {
      ...real,
      insertCompletion: async () => {
        throw new Error('database down');
      },
    };

    const error = await sendAndRecord(store, input('GET')).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ResponseNotRecordedError);
    expect((error as ResponseNotRecordedError).completion).toMatchObject({
      response: { status: 200 },
    });
    expect(capture.requests).toHaveLength(1);
  });
});

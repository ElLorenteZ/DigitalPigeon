import { randomUUID } from 'node:crypto';
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
import { request } from 'undici';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { createCallStore } from './call-store';
import { type Part, encodeMultipart } from './multipart';
import { type BodyInput, InvalidBodyError, InvalidHeaderError } from './wire';
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

describe('T1.3 — a typed Connection records what undici writes', () => {
  test.each([
    'Upgrade',
    'Keep-Alive',
    'foo, bar',
    'close',
    'Close',
    'foo, close',
  ])('%s', async (value) => {
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(
      store,
      input('GET', { headerRows: [['Connection', value]] }),
    );

    expect(pairs(capture.requests.at(-1)?.rawHeaders ?? [])).toEqual(
      call.send.request.headers,
    );
  });
});

test('T1.3 — a user and password in the URL add no header', async () => {
  const store = createCallStore(testDb.db);
  const url = new URL(capture.url);
  url.username = 'u';
  url.password = 'pw';
  const call = await sendAndRecord(store, {
    ...input('GET'),
    url: url.toString(),
    headerRows: [],
  });

  expect(pairs(capture.requests.at(-1)?.rawHeaders ?? [])).toEqual(
    call.send.request.headers,
  );
});

describe('T1.3 — a request with a body is recorded as it reached the wire', () => {
  const bodies: [string, BodyInput, string][] = [
    ['json', { type: 'json', text: '{"a":"zażółć"}' }, '{"a":"zażółć"}'],
    ['xml', { type: 'xml', text: '<a>ż</a>' }, '<a>ż</a>'],
    [
      'text',
      { type: 'text', text: 'line 1\nline 2\r\n' },
      'line 1\nline 2\r\n',
    ],
    ['form', { type: 'form', rows: [['a b', 'ż&=']] }, 'a+b=%C5%BC%26%3D'],
  ];
  const cases = ['GET', 'DELETE', 'OPTIONS', 'POST', 'PUT', 'PATCH'].flatMap(
    (method) =>
      bodies.map(([label, body, sent]) => [method, label, body, sent] as const),
  );

  test.each(cases)('%s, %s', async (method, _label, body, sent) => {
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(store, { ...input(method), body });

    const received = capture.requests.at(-1);
    const recorded = call.send.request;
    expect(received?.method).toBe(recorded.method);
    expect(`${capture.url}${received?.url}`).toBe(recorded.url);
    expect(pairs(received?.rawHeaders ?? [])).toEqual(recorded.headers);
    expect(received?.body).toEqual(Buffer.from(recorded.body as Uint8Array));
    expect(received?.body.toString()).toBe(sent);
  });

  test('a body survives being stored and read back', async () => {
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(store, {
      ...input('POST'),
      body: { type: 'text', text: 'żółć' },
    });

    const read = await store.getCall(call.send._id, new Set());

    expect(read?.state).toBe('completed');
    expect(
      read && read.state !== 'unreadable' && read.send.request.body,
    ).toEqual(Buffer.from('żółć'));
  });

  test('an empty text box sends nothing and generates no Content-Type', async () => {
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(store, {
      ...input('POST'),
      headerRows: [],
      body: { type: 'json', text: '' },
    });

    expect(call.send.request.body).toBeNull();
    expect(pairs(capture.requests.at(-1)?.rawHeaders ?? [])).toEqual(
      call.send.request.headers,
    );
    expect(call.send.request.headers.some(([n]) => n === 'content-type')).toBe(
      false,
    );
  });

  test('T1.2 — HEAD with a body is refused: no send document, nothing sent', async () => {
    const store = createCallStore(testDb.db);
    const url = `${capture.url}/refused-${randomUUID()}`;

    await expect(
      sendAndRecord(store, {
        ...input('HEAD'),
        url,
        body: { type: 'text', text: 'abc' },
      }),
    ).rejects.toThrow(InvalidBodyError);

    const urls = (await store.listCalls(200, new Set())).flatMap((c) =>
      c.state === 'unreadable' ? [] : [c.send.request.url],
    );
    expect(urls.filter((u) => u.startsWith(url))).toEqual([]);
    expect(capture.requests).toHaveLength(0);
  });
});

// Guards the pinned version: wire.ts keeps its own copy of these rules.
describe('T1.2, T1.3 — a multipart request is recorded as it reached the wire', () => {
  const parts: Part[] = [
    { kind: 'field', name: 'note', value: 'zażółć\r\nline 2' },
    {
      kind: 'file',
      name: 'doc',
      filename: 'gęś.bin',
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([0x00, 0x0d, 0x0a, 0xff, 0x2d, 0x2d, 0x41]),
    },
    { kind: 'field', name: 'after', value: '' },
  ];

  test.each(['GET', 'DELETE', 'OPTIONS', 'POST', 'PUT', 'PATCH'])(
    '%s',
    async (method) => {
      const store = createCallStore(testDb.db);
      const call = await sendAndRecord(store, {
        ...input(method),
        body: { type: 'multipart', parts },
      });

      const received = capture.requests.at(-1);
      const recorded = call.send.request;
      expect(received?.method).toBe(recorded.method);
      expect(`${capture.url}${received?.url}`).toBe(recorded.url);
      expect(pairs(received?.rawHeaders ?? [])).toEqual(recorded.headers);
      expect(received?.body).toEqual(Buffer.from(recorded.body as Uint8Array));
      // The body uses the boundary its Content-Type names.
      const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(
        recorded.headers.at(-2)?.[1] ?? '',
      )?.[1];
      expect(recorded.headers.at(-2)?.[0]).toBe('content-type');
      expect(received?.body).toEqual(
        Buffer.from(encodeMultipart(parts, boundary ?? '')),
      );
      expect(call.completion).toHaveProperty('response.status', 200);
    },
  );

  test('the recorded multipart body reads back unchanged', async () => {
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(store, {
      ...input('POST'),
      body: { type: 'multipart', parts },
    });

    const read = await store.getCall(call.send._id, new Set());
    const readBack = read && read.state !== 'unreadable' && read.send.request;
    // The driver returns stored bytes as a Buffer.
    expect(readBack && readBack.headers).toEqual(call.send.request.headers);
    expect(readBack && readBack.body).toEqual(
      Buffer.from(call.send.request.body as Uint8Array),
    );
  });

  test('a typed Content-Type is refused: no send document, nothing sent', async () => {
    const store = createCallStore(testDb.db);
    const url = `${capture.url}/refused-${randomUUID()}`;
    await expect(
      sendAndRecord(store, {
        ...input('POST', {
          headerRows: [['Content-Type', 'multipart/form-data; boundary=x']],
        }),
        url,
        body: { type: 'multipart', parts },
      }),
    ).rejects.toThrow(InvalidBodyError);

    const urls = (await store.listCalls(200, new Set())).flatMap((c) =>
      c.state === 'unreadable' ? [] : [c.send.request.url],
    );
    expect(urls.filter((u) => u.startsWith(url))).toEqual([]);
    expect(capture.requests).toHaveLength(0);
  });
});

describe('undici itself refuses what wire.ts refuses', () => {
  test.each<[string, string, string]>([
    ['Transfer-Encoding', 'chunked', 'UND_ERR_INVALID_ARG'],
    ['Keep-Alive', 'timeout=5', 'UND_ERR_INVALID_ARG'],
    ['Upgrade', 'h2c', 'UND_ERR_INVALID_ARG'],
    ['Connection', '', 'UND_ERR_INVALID_ARG'],
    ['Connection', 'close,', 'UND_ERR_INVALID_ARG'],
    ['Connection', 'a b', 'UND_ERR_INVALID_ARG'],
    ['Expect', '100-continue', 'UND_ERR_NOT_SUPPORTED'],
  ])('%s: "%s"', async (name, value, code) => {
    await expect(
      request(capture.url, { method: 'GET', headers: [name, value] }),
    ).rejects.toMatchObject({ code });
    expect(capture.requests).toHaveLength(0);
  });
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

describe('T1.3 — unusual but valid header values reach the wire as recorded', () => {
  test.each<[string, [string, string][]]>([
    ['an empty value', [['X-E', '']]],
    ['a tab inside a value', [['X-T', 'a\tb']]],
    [
      'duplicate names',
      [
        ['X-D', '1'],
        ['X-D', '2'],
      ],
    ],
    ['a padded value', [['X-P', '  a  ']]],
  ])('%s', async (_label, headerRows) => {
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(store, { ...input('GET'), headerRows });

    expect(pairs(capture.requests.at(-1)?.rawHeaders ?? [])).toEqual(
      call.send.request.headers,
    );
  });
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

  test.each<[string, [string, string]]>([
    ['a non-ASCII value', ['X-V', 'Bearer zażółć']],
    ['a line feed in a value', ['X-V', 'a\nb']],
    ['an invalid name', ['X V', '1']],
    ['Transfer-Encoding', ['Transfer-Encoding', 'chunked']],
    ['Keep-Alive', ['Keep-Alive', 'timeout=5']],
    ['Upgrade', ['Upgrade', 'h2c']],
    ['Expect', ['Expect', '100-continue']],
    ['an empty Connection', ['Connection', '']],
  ])(
    'T1.2 — %s is refused: no send document, nothing sent',
    async (_label, row) => {
      const store = createCallStore(testDb.db);
      const url = `${capture.url}/refused-${randomUUID()}`;

      await expect(
        sendAndRecord(store, { ...input('GET'), url, headerRows: [row] }),
      ).rejects.toThrow(InvalidHeaderError);

      const urls = (await store.listCalls(200, new Set())).flatMap((c) =>
        c.state === 'unreadable' ? [] : [c.send.request.url],
      );
      expect(urls.filter((u) => u.startsWith(url))).toEqual([]);
      expect(capture.requests).toHaveLength(0);
    },
  );

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

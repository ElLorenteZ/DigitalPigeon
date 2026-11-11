// The IPC handlers against a real MongoDB, through a stand-in for ipcMain. Electron is imported only as
// a type by ipc.ts, so this runs in plain Node.
import type { IpcMain } from 'electron';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'vitest';
import {
  type CaptureServer,
  startCaptureServer,
} from '../../test-support/capture-server';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { channels } from '../shared/ipc-contract';
import { registerIpc } from './ipc';

type Handler = (event: unknown, input?: unknown) => unknown;

let testDb: TestDb;
let capture: CaptureServer;
const handlers = new Map<string, Handler>();

const call = (channel: string, input?: unknown) => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, input) as Promise<never>;
};

beforeAll(async () => {
  testDb = await openTestDb();
  registerIpc({
    ipcMain: {
      handle: (channel: string, handler: Handler) =>
        handlers.set(channel, handler),
    } as unknown as IpcMain,
    db: () => testDb.db,
    dbStatus: () => ({ status: 'up', configPath: '' }),
  });
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

const sendInput = (clientRequestId: string, text: string) => ({
  clientRequestId,
  method: 'POST',
  url: `${capture.url}/`,
  queryRows: [],
  headerRows: [],
  body: { type: 'text', text },
});

test('a request body read back from MongoDB leaves main as plain bytes, as the response body does (code review, 8)', async () => {
  capture.respondWith({ status: 200, body: Buffer.from('response') });
  const sent = await call(channels.send, sendInput('plain-bytes', 'request'));
  const { send } = sent as unknown as { send: { _id: string } };

  const opened = (await call(channels.getCall, send._id)) as unknown as {
    call: {
      send: { request: { body: Uint8Array } };
      completion: { response: { body: Uint8Array } };
    };
  };

  expect(Buffer.isBuffer(opened.call.completion.response.body)).toBe(false);
  expect(Buffer.isBuffer(opened.call.send.request.body)).toBe(false);
  expect(Buffer.from(opened.call.send.request.body).toString()).toBe('request');
});

test('a cancel during a large request body says nothing was sent, not an unexpected error (code review, 4)', async () => {
  const sending = call(
    channels.send,
    sendInput('cancel-large', 'a'.repeat(5 * 1024 * 1024)),
  );
  call(channels.cancel, 'cancel-large');

  expect(await sending).toMatchObject({
    ok: false,
    error: { kind: 'cancelled' },
  });
  expect(capture.requests).toHaveLength(0);
});

// Plan phase 6: the parts of a stored multipart body are listed in main, a page at a time.
test('describeBody lists the parts of a stored 17 MiB multipart body', async () => {
  const file = new Uint8Array(17 * 1024 * 1024).fill(0x5a);
  const sent = (await call(channels.send, {
    ...sendInput('describe-large', ''),
    body: {
      type: 'multipart',
      parts: [
        { kind: 'field', name: 'note', value: 'zażółć' },
        {
          kind: 'file',
          name: 'upload',
          filename: 'big.bin',
          contentType: 'application/octet-stream',
          bytes: file,
        },
        { kind: 'field', name: 'after', value: 'x' },
      ],
    },
  })) as unknown as {
    ok: boolean;
    send: {
      request: {
        headers: [string, string][];
        body: { fileId: string; length: number };
      };
    };
  };
  expect(sent.ok).toBe(true);
  const { fileId } = sent.send.request.body;
  const boundary = /boundary=(.+)$/.exec(
    sent.send.request.headers.at(-2)?.[1] ?? '',
  )?.[1];

  const described = await call(channels.describeBody, { fileId, boundary });

  expect(described).toEqual({
    ok: true,
    parts: [
      expect.objectContaining({
        name: 'note',
        length: Buffer.byteLength('zażółć'),
      }),
      expect.objectContaining({
        name: 'upload',
        filename: 'big.bin',
        contentType: 'application/octet-stream',
        length: file.length,
      }),
      expect.objectContaining({ name: 'after', length: 1 }),
    ],
  });
});

test('describeBody reports a missing file, and a body that is not multipart, as messages', async () => {
  expect(
    await call(channels.describeBody, {
      fileId: 'no-such-file',
      boundary: 'B',
    }),
  ).toEqual({ ok: false, message: expect.stringContaining('no-such-file') });

  const sent = (await call(
    channels.send,
    sendInput('describe-text', 'a'.repeat(2 * 1024 * 1024)),
  )) as unknown as { send: { request: { body: { fileId: string } } } };
  expect(
    await call(channels.describeBody, {
      fileId: sent.send.request.body.fileId,
      boundary: 'B',
    }),
  ).toEqual({ ok: false, message: expect.stringContaining('boundary') });
});

test('describeBody refuses input that is not a file id and a boundary', async () => {
  expect(await call(channels.describeBody, { fileId: '' })).toMatchObject({
    ok: false,
  });
});

// Review R2: a send names the saved request its form came from; main records the link only while it still exists.
test('a send records its saved request while it exists, and is sent without the link once it is deleted', async () => {
  const saved = (await call(channels.saveSavedRequest, {
    name: 'R2',
    request: {
      method: 'GET',
      url: `${capture.url}/r2`,
      queryRows: [],
      headerRows: [],
    },
  })) as unknown as { ok: true; id: string };
  expect(saved.ok).toBe(true);

  const first = (await call(channels.send, {
    clientRequestId: 'r2-linked',
    method: 'GET',
    url: `${capture.url}/r2`,
    queryRows: [],
    headerRows: [],
    savedRequestId: saved.id,
  })) as unknown as { ok: true; send: { savedRequestId?: string } };
  expect(first.send.savedRequestId).toBe(saved.id);

  await call(channels.deleteSavedRequest, saved.id);
  const second = (await call(channels.send, {
    clientRequestId: 'r2-deleted',
    method: 'GET',
    url: `${capture.url}/r2`,
    queryRows: [],
    headerRows: [],
    savedRequestId: saved.id,
  })) as unknown as { ok: boolean; send: object };
  expect(second.ok).toBe(true);
  expect(second.send).not.toHaveProperty('savedRequestId');
  expect(capture.requests).toHaveLength(2);
});

// Second code review, #3: the lookups made before a send is recorded report a driver failure as the database being
// unavailable, as the send path does (T1.6), not as an unexpected error.
test('a driver failure while loading the environment for a send reports the database unavailable', async () => {
  const { MongoError } = await import('mongodb');
  const failing = {
    collection: () => ({
      findOne: async () => {
        throw new MongoError('connection lost');
      },
    }),
  } as unknown as import('mongodb').Db;
  const local = new Map<string, Handler>();
  registerIpc({
    ipcMain: {
      handle: (channel: string, handler: Handler) =>
        local.set(channel, handler),
    } as unknown as IpcMain,
    db: () => failing,
    dbStatus: () => ({ status: 'up', configPath: '' }),
  });
  const result = await local.get(channels.send)?.(null, {
    clientRequestId: 'db-lost',
    method: 'GET',
    url: '/orders',
    queryRows: [],
    headerRows: [],
    environmentId: 'env-1',
  });
  expect(result).toMatchObject({
    ok: false,
    error: { kind: 'database-unavailable' },
  });
  expect(capture.requests).toHaveLength(0);
});

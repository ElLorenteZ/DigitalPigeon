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

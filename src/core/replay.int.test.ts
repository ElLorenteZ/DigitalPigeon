// Replay: a past call is sent again exactly as recorded, as a new call (test-strategy T1.3 replay
// half, T1.1). The recorded header list is passed on unchanged, never rebuilt through wire.ts.
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
import type { SendDoc } from './call-schema';
import { createCallStore } from './call-store';
import { formFromCall } from './form-from-call';
import { CallNotReplayableError, replayCall, sendAndRecord } from './send';

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

const input = (method: string) => ({
  method,
  url: `${capture.url}/orders?x=1`,
  queryRows: [['q', 'two words']] as [string, string][],
  headerRows: [
    ['X-Zeta', '1'],
    ['accept', '*/*'],
    ['Authorization', 'Bearer t'],
  ] as [string, string][],
});

// A record as an older version of the app could have written it.
const seeded = (id: string, value: string): SendDoc => ({
  _id: id,
  schemaVersion: 1,
  sentAt: new Date('2026-11-01T00:00:00Z'),
  request: {
    method: 'GET',
    url: `${capture.url}/old`,
    headers: [
      ['host', new URL(capture.url).host],
      ['connection', 'keep-alive'],
      ['X-V', value],
    ],
    body: null,
  },
});

describe('T1.3 — a replay sends what the original sent', () => {
  test.each(['GET', 'HEAD', 'DELETE', 'OPTIONS', 'POST', 'PUT', 'PATCH'])(
    '%s',
    async (method) => {
      const store = createCallStore(testDb.db);
      const original = await sendAndRecord(store, input(method));
      const replay = await replayCall(store, original.send._id);

      expect(capture.requests).toHaveLength(2);
      const [first, second] = capture.requests;
      expect(second?.method).toBe(first?.method);
      expect(second?.url).toBe(first?.url);
      expect(second?.rawHeaders).toEqual(first?.rawHeaders);
      expect(second?.body.equals(first?.body ?? Buffer.alloc(1))).toBe(true);
      expect(replay.send.request).toEqual(original.send.request);
    },
  );
});

test('T1.1 — a replay is a new call and leaves the original unchanged', async () => {
  const store = createCallStore(testDb.db);
  const original = await sendAndRecord(store, input('GET'));
  const before = await store.getCall(original.send._id, new Set());

  const replay = await replayCall(store, original.send._id);

  expect(replay.send._id).not.toBe(original.send._id);
  expect(replay.completion.sendId).toBe(replay.send._id);
  expect(await store.getCall(original.send._id, new Set())).toEqual(before);
  expect(await store.getCall(replay.send._id, new Set())).toMatchObject({
    state: 'completed',
  });
});

test('a replay keeps the recorded list even when wire.ts would build another', async () => {
  const store = createCallStore(testDb.db);
  // Written before values were trimmed; a rebuild through wire.ts would record `a` instead.
  const doc = seeded('old-padded', '  a  ');
  await store.insertSend(doc);

  const replay = await replayCall(store, 'old-padded');

  expect(replay.send.request.headers).toEqual(doc.request.headers);
});

test('T1.1 — edit and send is a new call with the change, and the original is unchanged', async () => {
  const store = createCallStore(testDb.db);
  const original = await sendAndRecord(store, input('GET'));
  const before = await store.getCall(original.send._id, new Set());

  const form = formFromCall(original.send.request);
  const edited = await sendAndRecord(store, {
    ...form,
    headerRows: form.headerRows.map(([name, value]) =>
      name === 'X-Zeta' ? [name, 'changed'] : [name, value],
    ),
  });

  expect(edited.send._id).not.toBe(original.send._id);
  expect(edited.send.request.headers).toContainEqual(['X-Zeta', 'changed']);
  expect(await store.getCall(original.send._id, new Set())).toEqual(before);
  const raw = capture.requests.at(-1)?.rawHeaders ?? [];
  expect(raw[raw.indexOf('X-Zeta') + 1]).toBe('changed');
});

describe('records an older version could have written', () => {
  test('a value undici refuses records invalid-request and sends nothing', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(seeded('old-polish', 'Bearer zażółć'));

    const replay = await replayCall(store, 'old-polish');

    expect(replay.completion).toMatchObject({
      error: { code: 'invalid-request' },
    });
    expect(capture.requests).toHaveLength(0);
  });

  test('an Expect header records invalid-request and sends nothing', async () => {
    const store = createCallStore(testDb.db);
    const old = seeded('old-expect', 'x');
    old.request.headers.push(['Expect', '100-continue']);
    await store.insertSend(old);

    const replay = await replayCall(store, 'old-expect');

    expect(replay.completion).toMatchObject({
      error: { code: 'invalid-request' },
    });
    expect(capture.requests).toHaveLength(0);
  });

  test('a latin1-range value goes out as the same single byte undici always sent', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(seeded('old-cafe', 'café'));

    await replayCall(store, 'old-cafe');

    const raw = capture.requests.at(-1)?.rawHeaders ?? [];
    const value = raw[raw.indexOf('X-V') + 1] ?? '';
    expect(Buffer.from(value, 'latin1').toString('hex')).toBe('636166e9');
  });
});

describe('a call that cannot be replayed', () => {
  test('an unknown id rejects and sends nothing', async () => {
    const store = createCallStore(testDb.db);

    await expect(replayCall(store, 'no-such-call')).rejects.toThrow(
      CallNotReplayableError,
    );
    expect(capture.requests).toHaveLength(0);
  });

  test('an unreadable call rejects and sends nothing', async () => {
    const store = createCallStore(testDb.db);
    await testDb.db.collection('sends').insertOne({
      _id: 'old-bad' as never,
      schemaVersion: 99,
      sentAt: new Date('2020-01-01T00:00:00Z'),
    });

    await expect(replayCall(store, 'old-bad')).rejects.toThrow(
      CallNotReplayableError,
    );
    expect(capture.requests).toHaveLength(0);
  });
});

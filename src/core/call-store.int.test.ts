import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import type { CompletionDoc, SendDoc } from './call-schema';
import type { Call } from './call-store';
import * as callStoreModule from './call-store';
import { createCallStore } from './call-store';

let testDb: TestDb;

// Calls that have a readable send document, by send id.
const readable = (calls: Call[]) =>
  calls.flatMap((c) => (c.state === 'unreadable' ? [] : [c]));

beforeAll(async () => {
  testDb = await openTestDb();
});

afterAll(async () => {
  await testDb?.drop();
});

const request: SendDoc['request'] = {
  method: 'GET',
  url: 'http://127.0.0.1:8080/orders',
  headers: [
    ['host', '127.0.0.1:8080'],
    ['connection', 'keep-alive'],
  ],
  body: null,
};

const send = (id: string, sentAt: string): SendDoc => ({
  _id: id,
  schemaVersion: 1,
  sentAt: new Date(sentAt),
  request,
});

const completion = (
  id: string,
  sendId: string,
  body: number[],
): CompletionDoc => ({
  _id: id,
  schemaVersion: 1,
  sendId,
  completedAt: new Date('2026-11-03T10:05:00Z'),
  durationMs: 12,
  response: {
    status: 200,
    headers: [['content-type', 'text/plain']],
    body: new Uint8Array(body),
  },
});

test('two sends of identical content list as two calls, newest first', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('a-1', '2026-11-03T10:00:00Z'));
  await store.insertSend(send('a-2', '2026-11-03T10:01:00Z'));

  const calls = await store.listCalls(10, new Set());
  const ids = readable(calls)
    .map((c) => c.send._id)
    .filter((id) => id.startsWith('a-'));

  expect(ids).toEqual(['a-2', 'a-1']);
});

test('a completion attaches to its own send, with the body bytes read back as Uint8Array', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('b-1', '2026-11-03T11:00:00Z'));
  await store.insertSend(send('b-2', '2026-11-03T11:01:00Z'));
  await store.insertCompletion(completion('c-1', 'b-1', [0x00, 0xff, 0x7b]));

  const calls = await store.listCalls(10, new Set(), { includeBodies: true });
  const b1 = readable(calls).find((c) => c.send._id === 'b-1');
  const b2 = readable(calls).find((c) => c.send._id === 'b-2');

  expect(b1?.state).toBe('completed');
  expect(b1?.completion?._id).toBe('c-1');
  const body =
    b1?.completion &&
    'response' in b1.completion &&
    'body' in b1.completion.response
      ? b1.completion.response.body
      : null;
  expect(body).toBeInstanceOf(Uint8Array);
  expect(Array.from(body ?? [])).toEqual([0x00, 0xff, 0x7b]);
  expect(b2?.completion).toBeNull();
});

test('by default history rows carry the response status but no body', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('k-1', '2027-04-01T00:00:00Z'));
  await store.insertCompletion(completion('k-c', 'k-1', [1, 2, 3]));

  const row = readable(await store.listCalls(10, new Set())).find(
    (c) => c.send._id === 'k-1',
  );

  expect(
    row?.completion && 'response' in row.completion
      ? row.completion.response.status
      : null,
  ).toBe(200);
  expect(
    row?.completion && 'response' in row.completion
      ? 'body' in row.completion.response
      : null,
  ).toBe(false);
});

test('a send with no completion is in-flight when its id is passed, interrupted otherwise', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('d-1', '2026-11-03T12:00:00Z'));

  const whileRunning = await store.listCalls(10, new Set(['d-1']));
  const afterwards = await store.listCalls(10, new Set());

  expect(readable(whileRunning).find((c) => c.send._id === 'd-1')?.state).toBe(
    'in-flight',
  );
  expect(readable(afterwards).find((c) => c.send._id === 'd-1')?.state).toBe(
    'interrupted',
  );
});

test('listCalls returns at most the requested number of calls', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('e-1', '2026-11-03T13:00:00Z'));
  await store.insertSend(send('e-2', '2026-11-03T13:01:00Z'));

  expect(await store.listCalls(2, new Set())).toHaveLength(2);
});

test('a send document that fails its schema lists as unreadable, and the rest still load', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('f-ok', '2027-01-01T00:00:00Z'));
  await testDb.db.collection('sends').insertOne({
    _id: 'f-bad' as never,
    schemaVersion: 99,
    sentAt: new Date('2027-01-01T00:01:00Z'),
  });

  const calls = await store.listCalls(10, new Set());
  const bad = calls.find((c) => c.state === 'unreadable' && c.id === 'f-bad');

  expect(bad).toMatchObject({ state: 'unreadable', id: 'f-bad' });
  expect(bad && 'error' in bad ? bad.error : '').toMatch(/schemaVersion/);
  expect(readable(calls).some((c) => c.send._id === 'f-ok')).toBe(true);
  await testDb.db.collection('sends').deleteOne({ _id: 'f-bad' as never });
});

test('a completion document that fails its schema makes its call unreadable', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('g-1', '2027-02-01T00:00:00Z'));
  await testDb.db.collection('completions').insertOne({
    _id: 'g-c' as never,
    schemaVersion: 1,
    sendId: 'g-1',
    durationMs: -1,
  });

  const calls = await store.listCalls(10, new Set());

  expect(
    calls.find((c) => c.state === 'unreadable' && c.id === 'g-1'),
  ).toBeDefined();
  await testDb.db.collection('completions').deleteOne({ _id: 'g-c' as never });
});

test('inserting creates indexes on sends.sentAt and completions.sendId', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('h-1', '2027-03-01T00:00:00Z'));
  await store.insertCompletion(completion('h-c', 'h-1', [1]));

  const sendKeys = (
    await testDb.db.collection('sends').listIndexes().toArray()
  ).map((i) => i.key);
  const completionKeys = (
    await testDb.db.collection('completions').listIndexes().toArray()
  ).map((i) => i.key);

  expect(sendKeys).toContainEqual({ sentAt: -1 });
  expect(completionKeys).toContainEqual({ sendId: 1 });
});

describe('getCall', () => {
  test('returns one call with its full response body', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(send('m-1', '2027-05-01T00:00:00Z'));
    await store.insertCompletion(completion('m-c', 'm-1', [0x00, 0xff, 0x7b]));

    const call = await store.getCall('m-1', new Set());

    expect(call).toMatchObject({ state: 'completed' });
    const body =
      call &&
      call.state !== 'unreadable' &&
      call.completion &&
      'response' in call.completion &&
      'body' in call.completion.response
        ? call.completion.response.body
        : null;
    expect(Array.from(body ?? [])).toEqual([0x00, 0xff, 0x7b]);
  });

  test('is in-flight when its id is in the set, interrupted otherwise', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(send('m-2', '2027-05-02T00:00:00Z'));

    expect(await store.getCall('m-2', new Set(['m-2']))).toMatchObject({
      state: 'in-flight',
      completion: null,
    });
    expect(await store.getCall('m-2', new Set())).toMatchObject({
      state: 'interrupted',
      completion: null,
    });
  });

  test('is unreadable when the send document fails its schema', async () => {
    const store = createCallStore(testDb.db);
    await testDb.db.collection('sends').insertOne({
      _id: 'm-bad' as never,
      schemaVersion: 99,
      sentAt: new Date('2020-01-01T00:00:00Z'),
    });

    const call = await store.getCall('m-bad', new Set());

    expect(call).toMatchObject({ state: 'unreadable', id: 'm-bad' });
    await testDb.db.collection('sends').deleteOne({ _id: 'm-bad' as never });
  });

  test('is null for an unknown id', async () => {
    const store = createCallStore(testDb.db);
    expect(await store.getCall('no-such-call', new Set())).toBeNull();
  });
});

test('the store offers no way to update or delete a call', () => {
  const store = createCallStore(testDb.db);

  expect(Object.keys(store).sort()).toEqual([
    'getCall',
    'insertCompletion',
    'insertSend',
    'listCalls',
  ]);
  expect(Object.keys(callStoreModule).sort()).toEqual(['createCallStore']);
});

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import {
  type CompletionDoc,
  CompletionDocSchema,
  type SendDoc,
  SendDocSchema,
} from './call-schema';
import type { Call } from './call-store';
import * as callStoreModule from './call-store';
import { createCallStore } from './call-store';
import { createSavedRequestStore } from './saved-request-store';

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

test('history rows carry no request body, and an opened call does', async () => {
  const store = createCallStore(testDb.db);
  const bytes = new Uint8Array([1, 2, 3]);
  await store.insertSend({
    ...send('rb-1', '2027-05-01T00:00:00Z'),
    request: { ...request, body: bytes },
  });

  const row = readable(await store.listCalls(10, new Set())).find(
    (c) => c.send._id === 'rb-1',
  );
  expect(row).toBeDefined();
  expect('body' in (row?.send.request ?? {})).toBe(false);

  const opened = await store.getCall('rb-1', new Set());
  expect(opened?.state).not.toBe('unreadable');
  expect(
    opened && opened.state !== 'unreadable'
      ? Array.from(opened.send.request.body as Uint8Array)
      : null,
  ).toEqual([1, 2, 3]);
});

test('a document written before bodies existed still lists and opens', async () => {
  const store = createCallStore(testDb.db);
  await store.insertSend(send('old-null', '2027-05-02T00:00:00Z'));

  const row = readable(await store.listCalls(10, new Set())).find(
    (c) => c.send._id === 'old-null',
  );
  expect(row?.state).toBe('interrupted');
  const opened = await store.getCall('old-null', new Set());
  expect(
    opened && opened.state !== 'unreadable' ? opened.send.request.body : 'x',
  ).toBeNull();
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

test('the store offers no way to update a call; deleting one is deleteCall (slice 8)', () => {
  const store = createCallStore(testDb.db);

  expect(Object.keys(store).sort()).toEqual([
    'bodies',
    'deleteCall',
    'getCall',
    'historyMark',
    'insertCompletion',
    'insertSend',
    'listCalls',
    'listRequestGroups',
    'listResponses',
    'listStatusCodes',
    'searchCalls',
    'sweepOrphanBodies',
  ]);
  expect(Object.keys(callStoreModule).sort()).toEqual(['createCallStore']);
});

// Slice 7 (responses-strip): the calls that are responses to one request: same method, same URL path. The query string,
// the fragment and the host are not part of the key (author 2026-11-11; plan.md, screen 01).
describe('listResponses', () => {
  const at = (n: number) =>
    new Date(Date.UTC(2026, 10, 21, 9, 0, n)).toISOString();
  const sendTo = (
    id: string,
    method: string,
    url: string,
    n: number,
  ): SendDoc => ({
    ...send(id, at(n)),
    request: { ...request, method, url },
  });
  const ids = (calls: Call[]) => readable(calls).map((c) => c.send._id);

  test('same method and path match, whatever the query, fragment or host; newest first', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(
      sendTo('rs-a1', 'GET', 'http://a.test/rs/orders', 1),
    );
    await store.insertSend(
      sendTo('rs-a2', 'GET', 'http://a.test/rs/orders?dryRun=false', 2),
    );
    await store.insertSend(
      sendTo('rs-a3', 'GET', 'https://b.test:8443/rs/orders#top', 3),
    );
    await store.insertCompletion(completion('rs-c2', 'rs-a2', [1]));

    const calls = await store.listResponses('GET', '/rs/orders', new Set());
    expect(ids(calls)).toEqual(['rs-a3', 'rs-a2', 'rs-a1']);
    const second = readable(calls)[1];
    expect(second?.state).toBe('completed');
    // History-style rows: no bodies.
    expect(second?.send.request).not.toHaveProperty('body');
  });

  test('another method, a longer path, or a path sharing a prefix does not match', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(
      sendTo('rs-b1', 'GET', 'http://a.test/rs2/orders', 1),
    );
    await store.insertSend(
      sendTo('rs-b2', 'POST', 'http://a.test/rs2/orders', 2),
    );
    await store.insertSend(
      sendTo('rs-b3', 'GET', 'http://a.test/rs2/orders/1', 3),
    );
    await store.insertSend(
      sendTo('rs-b4', 'GET', 'http://a.test/rs2/orders-old', 4),
    );
    await store.insertSend(
      sendTo('rs-b5', 'GET', 'http://a.test/rs2/orders/', 5),
    );

    expect(
      ids(await store.listResponses('GET', '/rs2/orders', new Set())),
    ).toEqual(['rs-b1']);
  });

  test('regular-expression characters in the path are matched literally', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(
      sendTo('rs-c1', 'GET', 'http://a.test/rs3/a.b(c)+', 1),
    );
    await store.insertSend(
      sendTo('rs-c2', 'GET', 'http://a.test/rs3/aXb(c)+', 2),
    );

    expect(
      ids(await store.listResponses('GET', '/rs3/a.b(c)+', new Set())),
    ).toEqual(['rs-c1']);
  });

  test('the root path matches a URL with no path', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(sendTo('rs-d1', 'DELETE', 'http://root.test', 1));
    await store.insertSend(
      sendTo('rs-d2', 'DELETE', 'http://root.test/?x=1', 2),
    );
    await store.insertSend(sendTo('rs-d3', 'DELETE', 'http://root.test/x', 3));

    expect(ids(await store.listResponses('DELETE', '/', new Set()))).toEqual([
      'rs-d2',
      'rs-d1',
    ]);
  });

  test('every response is returned, not only the newest 200, up to the cap of 500', async () => {
    const store = createCallStore(testDb.db);
    for (let n = 0; n < 230; n += 1) {
      await store.insertSend(
        sendTo(`rs-e${n}`, 'PUT', 'http://a.test/rs4/many', n),
      );
    }
    expect(
      await store.listResponses('PUT', '/rs4/many', new Set()),
    ).toHaveLength(230);
  });

  // history-grouping, phase 2: the store and the renderer name a request with one function (requestKeyOf), and the
  // responses can be narrowed to one auth (authOf: Authorization, otherwise Cookie, otherwise none).
  test('a path the URL parser encodes is found by the path the renderer names it with', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(sendTo('rs-f1', 'GET', 'http://a.test/rs5/a b', 1));
    await store.insertSend(
      sendTo('rs-f2', 'GET', 'http://a.test/rs5/a%20b', 2),
    );

    expect(
      ids(await store.listResponses('GET', '/rs5/a%20b', new Set())),
    ).toEqual(['rs-f2', 'rs-f1']);
  });

  test('with an auth, only the calls sent with that auth are returned; "" means none', async () => {
    const store = createCallStore(testDb.db);
    const withHeaders = (
      id: string,
      n: number,
      headers: [string, string][],
    ): SendDoc => {
      const doc = sendTo(id, 'GET', 'http://a.test/rs6/me', n);
      return {
        ...doc,
        request: {
          ...doc.request,
          headers: [...doc.request.headers, ...headers],
        },
      };
    };
    await store.insertSend(
      withHeaders('rs-g1', 1, [['Authorization', 'Bearer A']]),
    );
    await store.insertSend(
      withHeaders('rs-g2', 2, [['authorization', 'Bearer B']]),
    );
    await store.insertSend(
      withHeaders('rs-g3', 3, [
        ['Cookie', 'session=x'],
        ['Authorization', 'Bearer A'],
      ]),
    );
    await store.insertSend(withHeaders('rs-g4', 4, [['Cookie', 'session=x']]));
    await store.insertSend(withHeaders('rs-g5', 5, []));

    const list = async (auth?: string) =>
      ids(await store.listResponses('GET', '/rs6/me', new Set(), auth));
    expect(await list()).toEqual(['rs-g5', 'rs-g4', 'rs-g3', 'rs-g2', 'rs-g1']);
    expect(await list('Bearer A')).toEqual(['rs-g3', 'rs-g1']);
    expect(await list('session=x')).toEqual(['rs-g4']);
    expect(await list('')).toEqual(['rs-g5']);
  });
});

// history-grouping, phase 4: History grouped by request over all of history, not only the newest 200 calls. A request
// is a method and a URL path (requestKeyOf); split by auth, also the Authorization, otherwise Cookie, value (authOf).
// Its own database, so the counts are exact.
describe('listRequestGroups', () => {
  let groupDb: TestDb;
  let store: ReturnType<typeof createCallStore>;
  const at = (n: number) =>
    new Date(Date.UTC(2026, 10, 22, 8, 0, 0) + n * 1000);
  const doc = (
    id: string,
    method: string,
    url: string,
    n: number,
    headers: [string, string][] = [],
  ): SendDoc => ({
    _id: id,
    schemaVersion: 1,
    sentAt: at(n),
    request: {
      ...request,
      method,
      url,
      headers: [...request.headers, ...headers],
    },
  });
  const keyOf = (g: { method: string; path: string; auth: unknown }) =>
    `${g.method} ${g.path}${g.auth ? ` ${JSON.stringify(g.auth)}` : ''}`;

  beforeAll(async () => {
    groupDb = await openTestDb();
    store = createCallStore(groupDb.db);
    // 250 calls: beyond History's 200. 150 to /a on two hosts, with and without a query; 100 to /b.
    for (let n = 0; n < 250; n += 1) {
      const url =
        n < 150
          ? `http://${n % 2 ? 'one' : 'two'}.test/a${n % 3 ? '?x=1' : ''}`
          : 'http://one.test/b';
      await store.insertSend(doc(`g-${n}`, 'GET', url, n));
    }
    await store.insertCompletion(completion('g-c249', 'g-249', [1]));
    // One more request and method, and the auth variants on /me.
    await store.insertSend(doc('p-1', 'POST', 'http://one.test/a', 300));
    await store.insertSend(
      doc('m-1', 'GET', 'http://one.test/me', 301, [
        ['Authorization', 'Bearer A'],
      ]),
    );
    await store.insertSend(
      doc('m-2', 'GET', 'http://one.test/me', 302, [
        ['authorization', 'Bearer A'],
      ]),
    );
    await store.insertSend(
      doc('m-3', 'GET', 'http://one.test/me', 303, [
        ['Authorization', 'Bearer B'],
      ]),
    );
    await store.insertSend(
      doc('m-4', 'GET', 'http://one.test/me', 304, [['Cookie', 'session=x']]),
    );
    await store.insertSend(doc('m-5', 'GET', 'http://one.test/me', 305));
    // A send document no schema reads: in no group.
    await groupDb.db
      .collection('sends')
      .insertOne({ _id: 'bad-1' as never, schemaVersion: 99, sentAt: at(400) });
  });

  afterAll(async () => {
    await groupDb?.drop();
  });

  test('one group per method and path over every call, newest group first, with its newest call', async () => {
    const groups = await store.listRequestGroups(new Set(), {
      splitByAuth: false,
    });
    expect(groups.map(keyOf)).toEqual([
      'GET /me',
      'POST /a',
      'GET /b',
      'GET /a',
    ]);
    const count = (key: string) => groups.find((g) => keyOf(g) === key)?.count;
    expect(count('GET /a')).toBe(150);
    expect(count('GET /b')).toBe(100);
    expect(count('GET /me')).toBe(5);
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(256);
    const b = groups.find((g) => keyOf(g) === 'GET /b');
    expect(b?.latest.send._id).toBe('g-249');
    expect(b?.latest.state).toBe('completed');
    expect(b?.latest.send.request).not.toHaveProperty('body');
    expect(groups.find((g) => keyOf(g) === 'GET /a')?.latest.send._id).toBe(
      'g-149',
    );
  });

  test('split by auth, a path has one group per Authorization, otherwise Cookie, value, and one with none', async () => {
    const groups = await store.listRequestGroups(new Set(), {
      splitByAuth: true,
    });
    const me = groups.filter((g) => g.path === '/me');
    expect(me.map((g) => [g.auth, g.count, g.latest.send._id])).toEqual([
      [null, 1, 'm-5'],
      [{ header: 'Cookie', value: 'session=x' }, 1, 'm-4'],
      [{ header: 'Authorization', value: 'Bearer B' }, 1, 'm-3'],
      [{ header: 'Authorization', value: 'Bearer A' }, 2, 'm-2'],
    ]);
    // Calls with no auth header are one group of their path, as without the split.
    expect(
      groups.find((g) => g.path === '/a' && g.method === 'GET')?.count,
    ).toBe(150);
  });

  // A1: grouping loads every summary, as searchCalls does. Seeded in bulk straight into the throwaway database
  // (inserting one at a time through the store is too slow for the test's own limit); the duration is printed for
  // progress.md. Not a performance gate: T3.5 is manual.
  test('5 000 calls group, and the time it takes is printed', async () => {
    const big = await openTestDb();
    try {
      const paths = ['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h'];
      const sends = Array.from({ length: 5000 }, (_, n) =>
        SendDocSchema.parse(
          doc(`t-${n}`, 'GET', `http://one.test${paths[n % 8]}?n=${n}`, n, [
            ['Authorization', `Bearer ${n % 5}`],
          ]),
        ),
      );
      await big.db.collection<SendDoc>('sends').insertMany(sends);
      await big.db.collection<CompletionDoc>('completions').insertMany(
        sends.map((s) =>
          CompletionDocSchema.parse(
            completion(
              `tc-${s._id}`,
              s._id,
              Array.from({ length: 512 }, () => 120),
            ),
          ),
        ),
      );
      const bigStore = createCallStore(big.db);
      const started = performance.now();
      const groups = await bigStore.listRequestGroups(new Set(), {
        splitByAuth: true,
      });
      const ms = Math.round(performance.now() - started);
      console.log(`[A1] listRequestGroups over 5000 calls: ${ms} ms`);
      expect(groups).toHaveLength(40);
      expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(5000);
    } finally {
      await big.drop();
    }
  }, 60_000);

  test('an empty history has no groups', async () => {
    const empty = await openTestDb();
    try {
      expect(
        await createCallStore(empty.db).listRequestGroups(new Set(), {
          splitByAuth: true,
        }),
      ).toEqual([]);
    } finally {
      await empty.drop();
    }
  });
});

// Slice 8 (delete-with-undo), T1.7: a delete removes exactly one call, its completion and its body files.
// environment-aware-history, phase 4: History, request groups and responses for one environment, by the environment
// recorded on the call. The filter applies before History's limit.
describe('environment filter', () => {
  let envDb: TestDb;
  let store: ReturnType<typeof createCallStore>;
  const at = (n: number) =>
    new Date(Date.UTC(2026, 10, 23, 8, 0, 0) + n * 1000);
  const snapshot = (id: string) => ({
    id,
    name: id,
    baseUrl: `http://${id}.test/`,
  });
  const doc = (
    id: string,
    url: string,
    n: number,
    environmentId?: string,
  ): SendDoc => ({
    _id: id,
    schemaVersion: 1,
    sentAt: at(n),
    request: { ...request, url },
    ...(environmentId ? { environment: snapshot(environmentId) } : {}),
  });
  const ids = (calls: Call[]) => readable(calls).map((c) => c.send._id);

  beforeAll(async () => {
    envDb = await openTestDb();
    store = createCallStore(envDb.db);
    // B's five calls are the oldest: beyond the newest 200, which are A's and the calls with no environment.
    for (let n = 0; n < 5; n += 1) {
      await store.insertSend(
        doc(`b-${n}`, `http://b.test/${n < 3 ? 'a' : 'b'}`, n, 'B'),
      );
    }
    for (let n = 0; n < 250; n += 1) {
      await store.insertSend(doc(`a-${n}`, 'http://a.test/a', 10 + n, 'A'));
    }
    for (let n = 0; n < 5; n += 1) {
      await store.insertSend(doc(`n-${n}`, 'http://x.test/a', 300 + n));
    }
  });

  afterAll(async () => {
    await envDb?.drop();
  });

  test('listCalls with an environment returns its calls only, even beyond the newest 200; without one, every call', async () => {
    expect(
      ids(await store.listCalls(200, new Set(), { environmentId: 'B' })),
    ).toEqual(['b-4', 'b-3', 'b-2', 'b-1', 'b-0']);
    const all = ids(await store.listCalls(200, new Set()));
    expect(all).toHaveLength(200);
    expect(all.slice(0, 6)).toEqual([
      'n-4',
      'n-3',
      'n-2',
      'n-1',
      'n-0',
      'a-249',
    ]);
    expect(
      await store.listCalls(200, new Set(), { environmentId: 'gone' }),
    ).toEqual([]);
  });

  test('listResponses with an environment keeps the calls recorded under it', async () => {
    expect(
      ids(await store.listResponses('GET', '/a', new Set(), undefined, 'B')),
    ).toEqual(['b-2', 'b-1', 'b-0']);
    expect(
      await store.listResponses('GET', '/a', new Set(), undefined, 'A'),
    ).toHaveLength(250);
    expect(await store.listResponses('GET', '/a', new Set())).toHaveLength(258);
  });

  test('listRequestGroups with an environment counts its calls only', async () => {
    const groups = await store.listRequestGroups(new Set(), {
      splitByAuth: false,
      environmentId: 'B',
    });
    expect(groups.map((g) => [g.path, g.count, g.latest.send._id])).toEqual([
      ['/b', 2, 'b-4'],
      ['/a', 3, 'b-2'],
    ]);
    const all = await store.listRequestGroups(new Set(), {
      splitByAuth: false,
    });
    expect(all.map((g) => [g.path, g.count])).toEqual([
      ['/a', 258],
      ['/b', 2],
    ]);
  });
});

describe('deleteCall', () => {
  const files = () => testDb.db.collection('bodies.files');
  const chunks = () => testDb.db.collection('bodies.chunks');

  test('removes the send, its completion and its stored bodies, and nothing else', async () => {
    const store = createCallStore(testDb.db);
    const reqFile = await store.bodies.writeBytes(new Uint8Array(1500).fill(1));
    const resFile = await store.bodies.writeBytes(new Uint8Array(1600).fill(2));
    const keptFile = await store.bodies.writeBytes(
      new Uint8Array(1700).fill(3),
    );
    const target: SendDoc = {
      ...send('del-1', '2026-11-21T10:00:00Z'),
      request: { ...request, url: 'http://a.test/del', body: reqFile },
    };
    const neighbour: SendDoc = {
      ...send('del-2', '2026-11-21T10:00:01Z'),
      request: { ...request, url: 'http://a.test/del', body: keptFile },
    };
    await store.insertSend(target);
    await store.insertSend(neighbour);
    await store.insertCompletion({
      ...completion('del-c1', 'del-1', []),
      response: { status: 200, headers: [], body: resFile },
    });
    await store.insertCompletion(completion('del-c2', 'del-2', [9]));
    const neighbourBefore = await store.getCall('del-2', new Set());

    expect(await store.deleteCall('del-1')).toEqual({ deleted: true });

    expect(await store.getCall('del-1', new Set())).toBeNull();
    expect(
      await testDb.db
        .collection('completions')
        .countDocuments({ sendId: 'del-1' }),
    ).toBe(0);
    for (const fileId of [reqFile.fileId, resFile.fileId]) {
      expect(await files().countDocuments({ _id: fileId as never })).toBe(0);
      expect(await chunks().countDocuments({ files_id: fileId })).toBe(0);
    }
    expect(await store.getCall('del-2', new Set())).toEqual(neighbourBefore);
    expect(
      await files().countDocuments({ _id: keptFile.fileId as never }),
    ).toBe(1);
  });

  test('a call with inline bodies and no completion is deleted too', async () => {
    const store = createCallStore(testDb.db);
    await store.insertSend(send('del-3', '2026-11-21T10:00:02Z'));
    expect(await store.deleteCall('del-3')).toEqual({ deleted: true });
    expect(await store.getCall('del-3', new Set())).toBeNull();
  });

  test('an unknown id deletes nothing', async () => {
    const store = createCallStore(testDb.db);
    const before = await testDb.db.collection('sends').countDocuments();
    expect(await store.deleteCall('no-such-call')).toEqual({ deleted: false });
    expect(await testDb.db.collection('sends').countDocuments()).toBe(before);
  });
});

// T3.9: body files and chunks no call refers to are swept, but only when older than the cutoff, so an upload in
// progress (chunks before its file document) is never touched.
describe('sweepOrphanBodies', () => {
  const files = () => testDb.db.collection('bodies.files');
  const chunks = () => testDb.db.collection('bodies.chunks');

  test('removes old unreferenced files and chunks, and keeps referenced or recent ones', async () => {
    const store = createCallStore(testDb.db);
    const referenced = await store.bodies.writeBytes(
      new Uint8Array(1500).fill(4),
    );
    await store.insertSend({
      ...send('sw-1', '2026-11-21T11:00:00Z'),
      request: { ...request, body: referenced },
    });
    const orphan = await store.bodies.writeBytes(new Uint8Array(1500).fill(5));
    // Chunks left by an upload that never finished: no file document.
    const upload = store.bodies.openUpload();
    await upload.write(new Uint8Array(300 * 1024).fill(6));
    const [loose] = await chunks()
      .find({ files_id: { $nin: (await files().distinct('_id')) as never[] } })
      .toArray();
    expect(
      loose,
      'an unfinished upload leaves chunks with no file',
    ).toBeDefined();
    // A1: the chunk id is an ObjectId made at upload time.
    expect(
      Math.abs(
        (loose!._id as unknown as { getTimestamp(): Date })
          .getTimestamp()
          .getTime() - Date.now(),
      ),
    ).toBeLessThan(60_000);

    // Cutoff now: the orphan file and the loose chunks are older than it.
    const swept = await store.sweepOrphanBodies(new Date(Date.now() + 1000));
    expect(swept.files).toBeGreaterThanOrEqual(1);
    expect(swept.chunks).toBeGreaterThanOrEqual(1);
    expect(await files().countDocuments({ _id: orphan.fileId as never })).toBe(
      0,
    );
    expect(await chunks().countDocuments({ files_id: orphan.fileId })).toBe(0);
    expect(await chunks().countDocuments({ files_id: loose?.files_id })).toBe(
      0,
    );
    expect(
      await files().countDocuments({ _id: referenced.fileId as never }),
    ).toBe(1);
    expect(await store.bodies.readAll(referenced)).toEqual(
      new Uint8Array(1500).fill(4),
    );
    await upload.abort().catch(() => {});
  });

  // Code review of delete-with-undo, 1: saved requests keep large bodies in the same bucket.
  test("keeps a saved request's stored text body and file part", async () => {
    const store = createCallStore(testDb.db);
    const savedStore = createSavedRequestStore(testDb.db);
    const big = 'x'.repeat(1024 * 1024 + 10);
    const { id: textId } = await savedStore.create({
      name: 'big text',
      request: {
        method: 'POST',
        url: 'http://a.test/',
        queryRows: [],
        headerRows: [],
        body: { type: 'text', text: big },
      },
    });
    const { id: partsId } = await savedStore.create({
      name: 'big file',
      request: {
        method: 'POST',
        url: 'http://a.test/',
        queryRows: [],
        headerRows: [],
        body: {
          type: 'multipart',
          parts: [
            {
              kind: 'file',
              name: 'f',
              filename: 'f.bin',
              contentType: 'application/octet-stream',
              bytes: new Uint8Array(1024 * 1024 + 20).fill(8),
            },
          ],
        },
      },
    });

    await store.sweepOrphanBodies(new Date(Date.now() + 1000));

    const text = await savedStore.get(textId);
    expect(text?.request.body).toEqual({ type: 'text', text: big });
    const parts = await savedStore.get(partsId);
    const body = parts?.request.body;
    expect(
      body?.type === 'multipart' && body.parts[0]?.kind === 'file'
        ? body.parts[0].bytes.length
        : 0,
    ).toBe(1024 * 1024 + 20);
  });

  test('keeps unreferenced files and chunks newer than the cutoff', async () => {
    const store = createCallStore(testDb.db);
    const recent = await store.bodies.writeBytes(new Uint8Array(1500).fill(7));
    await store.sweepOrphanBodies(new Date(Date.now() - 60 * 60 * 1000));
    expect(await files().countDocuments({ _id: recent.fileId as never })).toBe(
      1,
    );
    expect(
      await chunks().countDocuments({ files_id: recent.fileId }),
    ).toBeGreaterThan(0);
  });
});

// history-status-filter, phase 1: History, request groups and the status options filtered by the response status. ''
// selects calls with no response: an error completion, a call in flight, a call interrupted. The filter applies
// before History's limit.
describe('status filter', () => {
  let statusDb: TestDb;
  let store: ReturnType<typeof createCallStore>;
  const at = (n: number) =>
    new Date(Date.UTC(2026, 10, 24, 8, 0, 0) + n * 1000);
  const doc = (
    id: string,
    path: string,
    n: number,
    environmentId?: string,
  ): SendDoc => ({
    _id: id,
    schemaVersion: 1,
    sentAt: at(n),
    request: { ...request, url: `http://s.test${path}` },
    ...(environmentId
      ? {
          environment: {
            id: environmentId,
            name: environmentId,
            baseUrl: `http://${environmentId}.test/`,
          },
        }
      : {}),
  });
  const answered = (sendId: string, status: number): CompletionDoc => ({
    ...completion(`c-${sendId}`, sendId, [1]),
    response: {
      status,
      headers: [],
      body: new Uint8Array([1]),
    },
  });
  const failed = (sendId: string): CompletionDoc => ({
    _id: `c-${sendId}`,
    schemaVersion: 1,
    sendId,
    completedAt: at(1000),
    durationMs: 3,
    error: { code: 'network', message: 'connect ECONNREFUSED' },
  });
  const ids = (calls: Call[]) => readable(calls).map((c) => c.send._id);
  // s-flight is in flight; s-gone has no completion and is not: interrupted.
  const inFlight = new Set(['s-flight']);

  beforeAll(async () => {
    statusDb = await openTestDb();
    store = createCallStore(statusDb.db);
    const seed: [string, string, number, number | 'error' | null][] = [
      ['s-200a', '/a', 1, 200],
      ['s-404a', '/a', 2, 404],
      ['s-500b', '/b', 3, 500],
      ['s-err', '/b', 4, 'error'],
      ['s-200b', '/a', 5, 200],
      ['s-gone', '/a', 6, null],
      ['s-flight', '/b', 7, null],
      ['s-404b', '/a', 8, 404],
    ];
    for (const [id, path, n, outcome] of seed) {
      await store.insertSend(doc(id, path, n));
      if (outcome === 'error') await store.insertCompletion(failed(id));
      else if (outcome !== null)
        await store.insertCompletion(answered(id, outcome));
    }
    // An environment's own calls: one 404, one 201.
    await store.insertSend(doc('e-404', '/a', 20, 'E'));
    await store.insertCompletion(answered('e-404', 404));
    await store.insertSend(doc('e-201', '/a', 21, 'E'));
    await store.insertCompletion(answered('e-201', 201));
  });

  afterAll(async () => {
    await statusDb?.drop();
  });

  test('listCalls keeps the calls answered with a selected status, newest first', async () => {
    expect(
      ids(await store.listCalls(200, inFlight, { statuses: ['404'] })),
    ).toEqual(['e-404', 's-404b', 's-404a']);
    expect(
      ids(await store.listCalls(200, inFlight, { statuses: ['200', '500'] })),
    ).toEqual(['s-200b', 's-500b', 's-200a']);
  });

  test("'' selects the calls with no response: an error, in flight and interrupted", async () => {
    const calls = readable(
      await store.listCalls(200, inFlight, { statuses: [''] }),
    );
    expect(calls.map((c) => [c.send._id, c.state])).toEqual([
      ['s-flight', 'in-flight'],
      ['s-gone', 'interrupted'],
      ['s-err', 'completed'],
    ]);
  });

  test('a code and No response together select both; an empty selection selects every call', async () => {
    expect(
      ids(
        await store.listCalls(200, inFlight, {
          statuses: ['404', ''],
          environmentId: undefined,
        }),
      ),
    ).toEqual(['e-404', 's-404b', 's-flight', 's-gone', 's-err', 's-404a']);
    expect(await store.listCalls(200, inFlight, { statuses: [] })).toHaveLength(
      10,
    );
    expect(await store.listCalls(200, inFlight)).toHaveLength(10);
  });

  test('the status filter applies before the limit', async () => {
    expect(
      ids(await store.listCalls(1, inFlight, { statuses: ['200'] })),
    ).toEqual(['s-200b']);
  });

  test('the status filter combines with the environment', async () => {
    expect(
      ids(
        await store.listCalls(200, inFlight, {
          environmentId: 'E',
          statuses: ['404', ''],
        }),
      ),
    ).toEqual(['e-404']);
  });

  test('listRequestGroups counts only the calls with a selected status, and the newest of them is latest', async () => {
    const groups = await store.listRequestGroups(inFlight, {
      splitByAuth: false,
      statuses: ['404'],
    });
    expect(groups.map((g) => [g.path, g.count, g.latest.send._id])).toEqual([
      ['/a', 3, 'e-404'],
    ]);
    const noResponse = await store.listRequestGroups(inFlight, {
      splitByAuth: false,
      statuses: [''],
    });
    expect(noResponse.map((g) => [g.path, g.count, g.latest.send._id])).toEqual(
      [
        ['/b', 2, 's-flight'],
        ['/a', 1, 's-gone'],
      ],
    );
  });

  test('listStatusCodes lists each status present with its count, codes ascending and No response last', async () => {
    expect(await store.listStatusCodes(inFlight)).toEqual([
      { value: '200', label: '200', count: 2 },
      { value: '201', label: '201', count: 1 },
      { value: '404', label: '404', count: 3 },
      { value: '500', label: '500', count: 1 },
      { value: '', label: 'No response', count: 3 },
    ]);
    expect(
      await store.listStatusCodes(inFlight, { environmentId: 'E' }),
    ).toEqual([
      { value: '201', label: '201', count: 1 },
      { value: '404', label: '404', count: 1 },
    ]);
  });

  test('a status selection never lists an unreadable record, whose status is unknown (code review 2)', async () => {
    const own = await openTestDb();
    try {
      const ownStore = createCallStore(own.db);
      await ownStore.insertSend(doc('u-ok', '/a', 1));
      await ownStore.insertCompletion(answered('u-ok', 404));
      // A send no schema reads, with no completion; and a readable send whose completion no schema reads.
      await own.db
        .collection('sends')
        .insertOne({ _id: 'u-bad' as never, schemaVersion: 99, sentAt: at(2) });
      await ownStore.insertSend(doc('u-badc', '/a', 3));
      await own.db.collection('completions').insertOne({
        _id: 'c-u-badc' as never,
        schemaVersion: 99,
        sendId: 'u-badc',
        response: { status: 404 },
      });
      const states = async (statuses: string[]) =>
        (await ownStore.listCalls(200, new Set(), { statuses })).map((c) =>
          c.state === 'unreadable' ? `unreadable ${c.id}` : c.send._id,
        );
      expect(await states([''])).toEqual([]);
      expect(await states(['404'])).toEqual(['u-ok']);
      // Without a selection, unreadable rows are listed as before.
      expect(await states([])).toHaveLength(3);
    } finally {
      await own.drop();
    }
  });

  test('listResponses with statuses filters before its 500-call limit (code review 3)', async () => {
    const own = await openTestDb();
    try {
      const ownStore = createCallStore(own.db);
      // 501 calls to GET /many: the oldest answered 500, the 500 newer ones 200.
      await own.db.collection('sends').insertMany(
        Array.from({ length: 501 }, (_, n) => ({
          _id: `r-${n}` as never,
          schemaVersion: 1,
          sentAt: at(n),
          request: { ...request, url: 'http://s.test/many' },
        })),
      );
      await own.db.collection('completions').insertMany(
        Array.from({ length: 501 }, (_, n) => ({
          _id: `c-r-${n}` as never,
          schemaVersion: 1,
          sendId: `r-${n}`,
          completedAt: at(n),
          durationMs: 1,
          response: {
            status: n === 0 ? 500 : 200,
            headers: [],
            body: new Uint8Array([1]),
          },
        })),
      );
      expect(
        ids(
          await ownStore.listResponses(
            'GET',
            '/many',
            new Set(),
            undefined,
            undefined,
            ['500'],
          ),
        ),
      ).toEqual(['r-0']);
      expect(
        await ownStore.listResponses('GET', '/many', new Set()),
      ).toHaveLength(500);
    } finally {
      await own.drop();
    }
  });

  test('historyMark changes with every new call, including one the status selection would hide', async () => {
    const markDb = await openTestDb();
    try {
      const markStore = createCallStore(markDb.db);
      const empty = await markStore.historyMark(new Set());
      await markStore.insertSend(doc('m-1', '/a', 1));
      await markStore.insertCompletion(answered('m-1', 404));
      const one = await markStore.historyMark(new Set());
      // A 200 call: a list filtered to 404 is unchanged by it, and the mark still moves.
      await markStore.insertSend(doc('m-2', '/a', 2));
      const before = ids(
        await markStore.listCalls(200, new Set(), { statuses: ['404'] }),
      );
      const flying = await markStore.historyMark(new Set(['m-2']));
      await markStore.insertCompletion(answered('m-2', 200));
      const landed = await markStore.historyMark(new Set());
      expect(
        ids(await markStore.listCalls(200, new Set(), { statuses: ['404'] })),
      ).toEqual(before);
      expect(new Set([empty, one, flying, landed]).size).toBe(4);
      // In an environment with no calls, the mark does not move.
      expect(
        await markStore.historyMark(new Set(), { environmentId: 'none' }),
      ).toBe(await markStore.historyMark(new Set(), { environmentId: 'none' }));
    } finally {
      await markDb.drop();
    }
  });
});

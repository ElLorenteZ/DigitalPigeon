// Slice 9 (history-search): search over all of History. Filters combine across facets (AND) and within a facet (OR);
// text matches the URL, request header values and inline bodies; each facet option counts the calls that match every
// other active filter. Its own database, so counts are exact.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import type { CompletionDoc, SendDoc } from './call-schema';
import { type Call, createCallStore } from './call-store';

let testDb: TestDb;
let store: ReturnType<typeof createCallStore>;

const sentAt = (day: number, hour = 10) =>
  new Date(Date.UTC(2026, 10, day, hour, 0, 0));

interface Seed {
  id: string;
  method: string;
  url: string;
  day: number;
  auth?: string;
  env?: { id: string; name: string; baseUrl: string };
  saved?: string;
  requestBody?: string;
  responseBody?: string;
  status?: number;
}

const seeds: Seed[] = [
  {
    id: 's1',
    method: 'POST',
    url: 'http://staging.test/api/orders',
    day: 20,
    auth: 'Bearer aaa1',
    env: { id: 'e-st', name: 'staging', baseUrl: 'http://staging.test' },
    saved: 'sr-1',
    requestBody: '{"sku":"PGN-01"}',
    status: 201,
  },
  {
    id: 's2',
    method: 'PUT',
    url: 'http://staging.test/api/orders/7',
    day: 20,
    auth: 'Bearer aaa1',
    env: { id: 'e-st', name: 'staging', baseUrl: 'http://staging.test' },
    status: 200,
  },
  {
    id: 's3',
    method: 'GET',
    url: 'http://local.test/api/customers',
    day: 19,
    auth: 'Basic xyz',
    env: { id: 'e-lo', name: 'local', baseUrl: 'http://local.test' },
    responseBody: 'customer ORDERS listed',
    status: 200,
  },
  {
    id: 's4',
    method: 'GET',
    url: 'http://other.test/health',
    day: 18,
    status: 500,
  },
  {
    id: 's5',
    method: 'POST',
    url: 'http://staging.test/api/carts',
    day: 17,
    auth: 'Bearer bbb2',
    env: { id: 'e-st', name: 'staging', baseUrl: 'http://staging.test' },
    status: 409,
  },
];

const bytes = (text: string) => new TextEncoder().encode(text);

beforeAll(async () => {
  testDb = await openTestDb();
  store = createCallStore(testDb.db);
  for (const seed of seeds) {
    const send: SendDoc = {
      _id: seed.id,
      schemaVersion: 1,
      sentAt: sentAt(seed.day),
      ...(seed.env ? { environment: seed.env } : {}),
      ...(seed.saved ? { savedRequestId: seed.saved } : {}),
      request: {
        method: seed.method,
        url: seed.url,
        headers: [
          ['host', new URL(seed.url).host],
          ...(seed.auth
            ? ([['authorization', seed.auth]] as [string, string][])
            : []),
        ],
        body: seed.requestBody ? bytes(seed.requestBody) : null,
      },
    };
    await store.insertSend(send);
    const completion: CompletionDoc = {
      _id: `c-${seed.id}`,
      schemaVersion: 1,
      sendId: seed.id,
      completedAt: sentAt(seed.day, 11),
      durationMs: 5,
      response: {
        status: seed.status ?? 200,
        headers: [],
        body: bytes(seed.responseBody ?? ''),
      },
    };
    await store.insertCompletion(completion);
  }
});

afterAll(async () => {
  await testDb?.drop();
});

const ids = (calls: Call[]) =>
  calls.flatMap((c) => (c.state === 'unreadable' ? [] : [c.send._id]));
const count = (options: { value: string; count: number }[], value: string) =>
  options.find((o) => o.value === value)?.count ?? 0;

describe('searchCalls', () => {
  test('no filter returns every call, newest first, with totals', async () => {
    const found = await store.searchCalls({}, new Set());
    expect(ids(found.calls)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(found.total).toBe(5);
    expect(found.of).toBe(5);
  });

  test('methods combine with OR, and with the environment with AND', async () => {
    const found = await store.searchCalls(
      { methods: ['POST', 'PUT'], environmentIds: ['e-st'] },
      new Set(),
    );
    expect(ids(found.calls)).toEqual(['s1', 's2', 's5']);
  });

  test('each facet option counts the calls matching every other filter', async () => {
    const found = await store.searchCalls(
      { methods: ['POST'], environmentIds: ['e-st'] },
      new Set(),
    );
    // Method counts ignore the method filter but keep the environment one.
    expect(count(found.facets.method, 'POST')).toBe(2);
    expect(count(found.facets.method, 'PUT')).toBe(1);
    expect(count(found.facets.method, 'GET')).toBe(0);
    // Environment counts ignore the environment filter but keep the method one.
    expect(count(found.facets.environment, 'e-st')).toBe(2);
    expect(count(found.facets.environment, '')).toBe(0);
    expect(
      found.facets.environment.find((o) => o.value === 'e-st')?.label,
    ).toBe('staging');
    // Auth counts keep both.
    expect(count(found.facets.auth, 'Bearer aaa1')).toBe(1);
    expect(count(found.facets.auth, 'Bearer bbb2')).toBe(1);
  });

  test('"" selects calls with no environment, no Authorization header or no saved request', async () => {
    expect(
      ids((await store.searchCalls({ environmentIds: [''] }, new Set())).calls),
    ).toEqual(['s4']);
    expect(
      ids((await store.searchCalls({ auths: [''] }, new Set())).calls),
    ).toEqual(['s4']);
    expect(
      ids(
        (await store.searchCalls({ savedRequestIds: ['sr-1'] }, new Set()))
          .calls,
      ),
    ).toEqual(['s1']);
  });

  test('text matches the URL, a request header value, and inline bodies, ignoring case', async () => {
    expect(
      ids((await store.searchCalls({ text: 'ORDERS' }, new Set())).calls),
    ).toEqual(['s1', 's2', 's3']);
    expect(
      ids((await store.searchCalls({ text: 'basic XYZ' }, new Set())).calls),
    ).toEqual(['s3']);
    expect(
      ids((await store.searchCalls({ text: 'pgn-01' }, new Set())).calls),
    ).toEqual(['s1']);
    expect(
      ids(
        (await store.searchCalls({ text: 'nothing like this' }, new Set()))
          .calls,
      ),
    ).toEqual([]);
  });

  test('a date range keeps calls sent on or between its days', async () => {
    const found = await store.searchCalls(
      { from: sentAt(18, 0).toISOString(), to: sentAt(19, 23).toISOString() },
      new Set(),
    );
    expect(ids(found.calls)).toEqual(['s3', 's4']);
  });

  test('calls carry their completion state for the table', async () => {
    const found = await store.searchCalls({ methods: ['GET'] }, new Set());
    const s4 = found.calls.find(
      (c) => c.state !== 'unreadable' && c.send._id === 's4',
    );
    expect(s4?.state).toBe('completed');
  });
});

// history-grouping, phase 1: the Auth facet follows the author's rule — Authorization, otherwise Cookie, otherwise
// none — and each option names the header its value came from. Its own database, so the counts above stay exact.
describe('searchCalls auth facet with Cookie', () => {
  let cookieDb: TestDb;
  let cookieStore: ReturnType<typeof createCallStore>;
  const send = (
    id: string,
    day: number,
    headers: [string, string][],
  ): SendDoc => ({
    _id: id,
    schemaVersion: 1,
    sentAt: sentAt(day),
    request: {
      method: 'GET',
      url: 'http://a.test/me',
      headers: [['host', 'a.test'], ...headers],
      body: null,
    },
  });

  beforeAll(async () => {
    cookieDb = await openTestDb();
    cookieStore = createCallStore(cookieDb.db);
    await cookieStore.insertSend(
      send('k1', 20, [['Cookie', 'session=abc; theme=dark']]),
    );
    await cookieStore.insertSend(
      send('k2', 19, [
        ['Cookie', 'session=zzz'],
        ['Authorization', 'Bearer t1'],
      ]),
    );
    await cookieStore.insertSend(send('k3', 18, []));
  });

  afterAll(async () => {
    await cookieDb?.drop();
  });

  test('a Cookie-only call is counted under its Cookie value, labelled Cookie', async () => {
    const found = await cookieStore.searchCalls({}, new Set());
    const cookie = found.facets.auth.find(
      (o) => o.value === 'session=abc; theme=dark',
    );
    expect(cookie?.count).toBe(1);
    expect(cookie?.detail).toBe('Cookie');
    const bearer = found.facets.auth.find((o) => o.value === 'Bearer t1');
    expect(bearer?.count).toBe(1);
    expect(bearer?.detail).toBe('Authorization');
    // The Cookie of a call that has an Authorization header is not an option.
    expect(
      found.facets.auth.find((o) => o.value === 'session=zzz'),
    ).toBeUndefined();
    expect(count(found.facets.auth, '')).toBe(1);
  });

  test('filtering by a Cookie value returns the calls sent with it', async () => {
    const found = await cookieStore.searchCalls(
      { auths: ['session=abc; theme=dark'] },
      new Set(),
    );
    expect(ids(found.calls)).toEqual(['k1']);
    const none = await cookieStore.searchCalls({ auths: [''] }, new Set());
    expect(ids(none.calls)).toEqual(['k3']);
  });
});

// history-status-filter, phase 2: search narrows by status like any facet, and the status facet's counts leave out the
// status selection itself.
describe('searchCalls by status', () => {
  test('text and a status combine with AND', async () => {
    const found = await store.searchCalls(
      { text: 'staging', statuses: ['200'] },
      new Set(),
    );
    expect(ids(found.calls)).toEqual(['s2']);
    expect(found.total).toBe(1);
  });

  test('statuses combine with OR', async () => {
    const found = await store.searchCalls(
      { statuses: ['500', '409'] },
      new Set(),
    );
    expect(ids(found.calls)).toEqual(['s4', 's5']);
  });

  test('the status facet counts under the other filters and ignores its own selection', async () => {
    const found = await store.searchCalls(
      { methods: ['POST', 'PUT'], statuses: ['201'] },
      new Set(),
    );
    expect(ids(found.calls)).toEqual(['s1']);
    expect(count(found.facets.status, '201')).toBe(1);
    expect(count(found.facets.status, '200')).toBe(1);
    expect(count(found.facets.status, '409')).toBe(1);
    // s3 (200) and s4 (500) are GETs: outside the method filter.
    expect(count(found.facets.status, '500')).toBe(0);
    expect(found.facets.status.map((o) => o.label)).toContain('500');
    // The method facet counts under the status selection.
    expect(count(found.facets.method, 'POST')).toBe(1);
    expect(count(found.facets.method, 'PUT')).toBe(0);
  });

  test("'' matches calls with no response: an error and a call in flight", async () => {
    const own = await openTestDb();
    try {
      const ownStore = createCallStore(own.db);
      const at = new Date(Date.UTC(2026, 10, 24, 9, 0, 0));
      const send = (id: string, minutes: number): SendDoc => ({
        _id: id,
        schemaVersion: 1,
        sentAt: new Date(at.getTime() + minutes * 60_000),
        request: {
          method: 'GET',
          url: 'http://x.test/a',
          headers: [['host', 'x.test']],
          body: null,
        },
      });
      await ownStore.insertSend(send('ok', 1));
      await ownStore.insertCompletion({
        _id: 'c-ok',
        schemaVersion: 1,
        sendId: 'ok',
        completedAt: at,
        durationMs: 1,
        response: { status: 200, headers: [], body: bytes('') },
      });
      await ownStore.insertSend(send('err', 2));
      await ownStore.insertCompletion({
        _id: 'c-err',
        schemaVersion: 1,
        sendId: 'err',
        completedAt: at,
        durationMs: 1,
        error: { code: 'timeout', message: 'timed out' },
      });
      await ownStore.insertSend(send('flying', 3));
      const found = await ownStore.searchCalls(
        { statuses: [''] },
        new Set(['flying']),
      );
      expect(ids(found.calls)).toEqual(['flying', 'err']);
      expect(found.facets.status).toEqual([
        { value: '200', label: '200', count: 1 },
        { value: '', label: 'No response', count: 2 },
      ]);
    } finally {
      await own.drop();
    }
  });
});

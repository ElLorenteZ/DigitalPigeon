import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import type { CompletionDoc, SendDoc } from './call-schema';
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
    'insertCompletion',
    'insertSend',
    'listCalls',
    'listResponses',
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
});

// Slice 8 (delete-with-undo), T1.7: a delete removes exactly one call, its completion and its body files.
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

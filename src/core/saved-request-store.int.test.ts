// Saved requests against a real MongoDB (plan.md, phase 3): every body type reads back as saved, content over the
// inline limit goes to the `bodies` bucket, and no saved-request operation touches a call document (T1.1).
import { createHash, randomBytes } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { createCallStore } from './call-store';
import {
  InvalidSavedRequestError,
  createSavedRequestStore,
} from './saved-request-store';
import type { BodyInput, WireInput } from './wire';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await openTestDb();
});

afterAll(async () => {
  await testDb?.drop();
});

beforeEach(async () => {
  await testDb.db.collection('savedRequests').deleteMany({});
});

const store = () => createSavedRequestStore(testDb.db);
const MIB = 1024 * 1024;

const form = (body?: BodyInput): WireInput => ({
  method: 'POST',
  url: '/orders?x=1',
  queryRows: [['q', 'two words']],
  headerRows: [
    ['Authorization', 'Bearer t'],
    ['X-D', '1'],
    ['X-D', '2'],
  ],
  ...(body ? { body } : {}),
});

const file = (name: string, bytes: Uint8Array<ArrayBuffer>) => ({
  kind: 'file' as const,
  name,
  filename: `${name}.bin`,
  contentType: 'application/octet-stream',
  bytes,
});

// Large values are compared by length and SHA-256: a failing toEqual prints the whole value, and at 17 MiB that
// exhausts the worker's heap instead of failing (archive/multipart-with-file-copies/record.md §4).
const digest = (bytes: Uint8Array | string) => ({
  length: typeof bytes === 'string' ? bytes.length : bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

const rawDoc = (id: string) =>
  testDb.db.collection('savedRequests').findOne({ _id: id as never });

describe('a saved request reads back as it was saved', () => {
  test.each<[string, BodyInput | undefined]>([
    ['no body', undefined],
    ['the None type', { type: 'none' }],
    ['JSON', { type: 'json', text: '{"a":"zażółć"}' }],
    ['XML', { type: 'xml', text: '<a>ż</a>' }],
    [
      'text with a byte order mark and CRLF',
      { type: 'text', text: '﻿line 1\r\nline 2' },
    ],
    [
      'form rows',
      {
        type: 'form',
        rows: [
          ['a b', 'ż&='],
          ['a b', 'dup'],
        ],
      },
    ],
    [
      'multipart with a field, a small file and a boundary carried from Edit',
      {
        type: 'multipart',
        boundary: '----dpcarried',
        parts: [
          { kind: 'field', name: 'note', value: 'zażółć' },
          file('small', new Uint8Array([0, 13, 10, 255])),
        ],
      },
    ],
  ])('%s', async (_label, body) => {
    const saved = await store().create({
      name: 'Get order',
      request: form(body),
    });
    expect(await store().get(saved.id)).toEqual({
      id: saved.id,
      name: 'Get order',
      request: form(body),
    });
  });

  test('a 17 MiB text body is stored as a file, and the document stays small', async () => {
    const text = 'a'.repeat(17 * MIB);
    const saved = await store().create({
      name: 'big text',
      request: form({ type: 'text', text }),
    });
    const raw = await rawDoc(saved.id);
    expect(JSON.stringify(raw).length).toBeLessThan(64 * 1024);
    const read = (await store().get(saved.id))?.request.body;
    expect(read?.type).toBe('text');
    expect(digest(read && 'text' in read ? read.text : '')).toEqual(
      digest(text),
    );
  });

  test('a 17 MiB file part is stored as a file, and reads back byte for byte', async () => {
    const bytes = new Uint8Array(randomBytes(17 * MIB));
    const saved = await store().create({
      name: 'big file',
      request: form({ type: 'multipart', parts: [file('big', bytes)] }),
    });
    const raw = await rawDoc(saved.id);
    expect(JSON.stringify(raw).length).toBeLessThan(64 * 1024);
    const read = (await store().get(saved.id))?.request.body;
    const part = read?.type === 'multipart' ? read.parts[0] : undefined;
    expect(part?.kind === 'file' && part.filename).toBe('big.bin');
    expect(
      digest(part?.kind === 'file' ? part.bytes : new Uint8Array()),
    ).toEqual(digest(bytes));
    expect(part?.kind === 'file' && part.bytes.constructor.name).toBe(
      'Uint8Array',
    );
  });

  test('inline content is capped at 1 MiB in total: the second of two 600 KiB files goes to a file', async () => {
    const first = new Uint8Array(600 * 1024).fill(1);
    const second = new Uint8Array(600 * 1024).fill(2);
    const saved = await store().create({
      name: 'two files',
      request: form({
        type: 'multipart',
        parts: [file('first', first), file('second', second)],
      }),
    });
    const raw = (await rawDoc(saved.id)) as unknown as {
      request: { body: { parts: { bytes: unknown }[] } };
    };
    const [a, b] = raw.request.body.parts;
    expect(a?.bytes).not.toHaveProperty('fileId');
    expect(b?.bytes).toHaveProperty('fileId');
    expect((await store().get(saved.id))?.request.body).toEqual({
      type: 'multipart',
      parts: [file('first', first), file('second', second)],
    });
  });
});

describe('the list', () => {
  test('by name, with each entry’s method and URL; names may repeat (plan revision 2, W2)', async () => {
    const b = await store().create({ name: 'b', request: form() });
    const a2 = await store().create({
      name: 'a',
      request: { ...form(), method: 'GET', url: 'https://x.test/2' },
    });
    const a1 = await store().create({
      name: 'a',
      request: { ...form(), method: 'GET', url: 'https://x.test/1' },
    });
    expect(await store().list()).toEqual([
      { id: a1.id, name: 'a', method: 'GET', url: 'https://x.test/1' },
      { id: a2.id, name: 'a', method: 'GET', url: 'https://x.test/2' },
      { id: b.id, name: 'b', method: 'POST', url: '/orders?x=1' },
    ]);
  });

  test('a blank name is refused, and nothing is stored', async () => {
    await expect(
      store().create({ name: '  ', request: form() }),
    ).rejects.toThrow(InvalidSavedRequestError);
    expect(await store().list()).toEqual([]);
  });
});

describe('saving over and deleting', () => {
  test('update replaces the name and the request', async () => {
    const saved = await store().create({ name: 'old', request: form() });
    const changed = { ...form({ type: 'json', text: '{}' }), method: 'PUT' };
    expect(
      await store().update(saved.id, { name: 'new', request: changed }),
    ).toEqual({
      id: saved.id,
      name: 'new',
    });
    expect(await store().get(saved.id)).toEqual({
      id: saved.id,
      name: 'new',
      request: changed,
    });
  });

  test('an unknown id updates nothing, and deleting it reports false', async () => {
    expect(
      await store().update('no-such-id', { name: 'x', request: form() }),
    ).toBeNull();
    expect(await store().delete('no-such-id')).toBe(false);
  });

  test('delete removes it from get and from the list', async () => {
    const saved = await store().create({ name: 'gone', request: form() });
    expect(await store().delete(saved.id)).toBe(true);
    expect(await store().get(saved.id)).toBeNull();
    expect(await store().list()).toEqual([]);
  });
});

// T1.1 — saved requests are mutable; calls are not. No saved-request operation may write a call document.
test('T1.1 — creating, saving over and deleting saved requests leaves every call document unchanged', async () => {
  const calls = createCallStore(testDb.db);
  await calls.insertSend({
    _id: 't11-send',
    schemaVersion: 1,
    sentAt: new Date('2026-11-01T00:00:00Z'),
    savedRequestId: 'will-be-the-same',
    request: {
      method: 'GET',
      url: 'https://a.test/x',
      headers: [['host', 'a.test']],
      body: null,
    },
  });
  await calls.insertCompletion({
    _id: 't11-completion',
    schemaVersion: 1,
    sendId: 't11-send',
    completedAt: new Date('2026-11-01T00:00:01Z'),
    durationMs: 5,
    response: { status: 200, headers: [], body: new Uint8Array([1]) },
  });
  const snapshot = async () => ({
    sends: await testDb.db
      .collection('sends')
      .find()
      .sort({ _id: 1 })
      .toArray(),
    completions: await testDb.db
      .collection('completions')
      .find()
      .sort({ _id: 1 })
      .toArray(),
  });
  const before = await snapshot();

  const saved = await store().create({ name: 'x', request: form() });
  await store().update(saved.id, {
    name: 'y',
    request: form({
      type: 'multipart',
      parts: [file('f', new Uint8Array(2 * MIB))],
    }),
  });
  await store().delete(saved.id);

  expect(await snapshot()).toEqual(before);
});

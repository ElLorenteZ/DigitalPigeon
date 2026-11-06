// The `bodies` GridFS bucket against a real MongoDB (spike-gridfs-streaming.md): range reads, aborts, and
// no way to remove a finished file.
import { createHash } from 'node:crypto';
import { GridFSBucket, type ObjectId } from 'mongodb';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { BodyFileMissingError, createBodyStore } from './body-store';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await openTestDb();
});

afterAll(async () => {
  await testDb?.drop();
});

beforeEach(async () => {
  await testDb.db.collection('bodies.files').deleteMany({});
  await testDb.db.collection('bodies.chunks').deleteMany({});
});

const CHUNK = 261_120; // The driver's default chunk size (spike-gridfs-streaming.md).
const patterned = (length: number) =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + (i >> 8)) % 251);
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const counts = async () => ({
  files: await testDb.db.collection('bodies.files').countDocuments(),
  chunks: await testDb.db.collection('bodies.chunks').countDocuments(),
});
const store = () => createBodyStore(testDb.db);

describe('reading a range', () => {
  const body = patterned(CHUNK * 2 + 1000);
  let fileId: string;

  beforeEach(async () => {
    ({ fileId } = await store().writeBytes(body));
  });

  test.each([
    ['the start', 0, 10],
    ['inside one chunk', 100, 1000],
    ['across a chunk boundary', CHUNK - 5, 10],
    ['across two boundaries', CHUNK - 5, CHUNK + 10],
    ['the last bytes', body.length - 10, 10],
  ])('%s', async (_name, offset, length) => {
    const bytes = await store().readRange({ fileId, offset, length });
    expect(sha(bytes)).toBe(sha(body.subarray(offset, offset + length)));
    expect(bytes).toHaveLength(length);
  });

  test('a range past the end stops at the end', async () => {
    const bytes = await store().readRange({
      fileId,
      offset: body.length - 10,
      length: 1000,
    });
    expect(sha(bytes)).toBe(sha(body.subarray(body.length - 10)));
  });

  test.each([
    ['at the end', 0],
    ['past the end', 5000],
  ])('a read %s returns nothing', async (_name, past) => {
    const bytes = await store().readRange({
      fileId,
      offset: body.length + past,
      length: 10,
    });
    expect(bytes).toHaveLength(0);
  });

  test('a read of no bytes returns nothing', async () => {
    const bytes = await store().readRange({ fileId, offset: 5, length: 0 });
    expect(bytes).toHaveLength(0);
  });

  test('an unknown file is an error', async () => {
    await expect(
      store().readRange({ fileId: 'no-such-file', offset: 0, length: 10 }),
    ).rejects.toBeInstanceOf(BodyFileMissingError);
  });

  test('a file whose chunks are gone is reported as missing', async () => {
    await testDb.db.collection('bodies.chunks').deleteMany({});
    await expect(
      store().readRange({ fileId, offset: 0, length: 10 }),
    ).rejects.toBeInstanceOf(BodyFileMissingError);
  });
});

describe('an upload', () => {
  test('written in parts reads back whole, with its length', async () => {
    const body = patterned(CHUNK + 5000);
    const upload = store().openUpload();
    await upload.write(body.subarray(0, 100));
    await upload.write(body.subarray(100));
    const ref = await upload.finish();

    expect(ref.length).toBe(body.length);
    expect(sha(await store().readAll(ref))).toBe(sha(body));
  });

  test('aborted, leaves no file and no chunks, and other files stand', async () => {
    const kept = await store().writeBytes(patterned(CHUNK + 1));
    const before = await counts();

    const upload = store().openUpload();
    await upload.write(patterned(CHUNK * 3));
    expect((await counts()).chunks).toBeGreaterThan(before.chunks);
    await upload.abort();

    expect(await counts()).toEqual(before);
    expect(await store().readAll(kept)).toHaveLength(CHUNK + 1);
  });

  test('has no file document until it is finished', async () => {
    const upload = store().openUpload();
    await upload.write(patterned(CHUNK * 2));
    expect((await counts()).files).toBe(0);
    await upload.abort();
  });
});

describe('an upload that fails while finishing leaves nothing (code review, 1)', () => {
  const refuseIn = (collection: string, validator: object) =>
    testDb.db.command({ collMod: collection, validator });

  beforeEach(async () => {
    for (const name of ['bodies.chunks', 'bodies.files']) {
      await testDb.db.createCollection(name).catch(() => {});
    }
  });
  afterEach(async () => {
    await refuseIn('bodies.chunks', {});
    await refuseIn('bodies.files', {});
  });

  test('when the last chunk is refused', async () => {
    await refuseIn('bodies.chunks', { n: { $lt: 2 } });
    const upload = store().openUpload();
    await upload.write(patterned(CHUNK * 2 + 10));
    expect((await counts()).chunks).toBe(2);

    await expect(upload.finish()).rejects.toThrow();
    await upload.abort();

    expect(await counts()).toEqual({ files: 0, chunks: 0 });
  });

  test('when the file document is refused', async () => {
    await refuseIn('bodies.files', { length: { $lt: 0 } });
    const upload = store().openUpload();
    await upload.write(patterned(CHUNK + 10));

    await expect(upload.finish()).rejects.toThrow();
    await upload.abort();

    expect(await counts()).toEqual({ files: 0, chunks: 0 });
  });

  test('and aborting a finished upload still removes nothing', async () => {
    const upload = store().openUpload();
    await upload.write(patterned(CHUNK + 10));
    const ref = await upload.finish();

    await upload.abort();

    expect(await store().readAll(ref)).toHaveLength(CHUNK + 10);
  });
});

describe('a cancel stops work on a stored body (code review, 4)', () => {
  // Says aborted from the given check on: the moment is exact, where a timer would race the database.
  const abortedFromCheck = (check: number) => {
    let checks = 0;
    return {
      throwIfAborted: () => {
        checks += 1;
        if (checks >= check) throw new DOMException('Aborted', 'AbortError');
      },
    } as unknown as AbortSignal;
  };

  test('a write in progress stops, and leaves nothing', async () => {
    const write = store().writeBytes(
      patterned(CHUNK * 20),
      abortedFromCheck(4),
    );

    await expect(write).rejects.toMatchObject({ name: 'AbortError' });
    expect(await counts()).toEqual({ files: 0, chunks: 0 });
  });

  test('a whole read in progress stops', async () => {
    const ref = await store().writeBytes(patterned(CHUNK * 5));

    await expect(
      store().readAll(ref, abortedFromCheck(2)),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

test('a whole read reports a file shorter than its reference as missing', async () => {
  const ref = await store().writeBytes(patterned(1000));
  await expect(
    store().readAll({ ...ref, length: ref.length + 1 }),
  ).rejects.toBeInstanceOf(BodyFileMissingError);
});

test('a written file holds exactly the bytes, read by another client of the bucket', async () => {
  const body = patterned(CHUNK * 2 + 7);
  const { fileId, length } = await store().writeBytes(body);

  const parts: Uint8Array[] = [];
  const bucket = new GridFSBucket(testDb.db, { bucketName: 'bodies' });
  for await (const part of bucket.openDownloadStream(
    fileId as unknown as ObjectId,
  )) {
    parts.push(part as Uint8Array);
  }

  expect(length).toBe(body.length);
  expect(sha(Buffer.concat(parts))).toBe(sha(body));
});

test('the body store offers no way to remove a finished file', async () => {
  expect(Object.keys(store()).sort()).toEqual([
    'openUpload',
    'readAll',
    'readRange',
    'writeBytes',
  ]);
  const ref = await store().writeBytes(patterned(CHUNK));
  expect(ref.length).toBe(CHUNK);
  const upload = store().openUpload();
  await upload.write(patterned(10));
  const finished = await upload.finish();
  await upload.abort().catch(() => {});
  expect(await store().readAll(finished)).toHaveLength(10);
});

// T1.5: a body over MongoDB's 16 MB limit is stored in full. A file is written before the document that
// refers to it, and no document ever refers to a partial file (plan.md, phase 4).
import { createHash } from 'node:crypto';
import { type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GridFSBucket, type ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type CaptureServer,
  startCaptureServer,
} from '../../test-support/capture-server';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { createCallStore } from './call-store';
import {
  CallNotReplayableError,
  DatabaseUnavailableError,
  ResponseNotRecordedError,
  SendCancelledError,
  replayCall,
  sendAndRecord,
} from './send';

const MIB = 1024 * 1024;
const LARGE = 17 * MIB;

let testDb: TestDb;
let capture: CaptureServer;

beforeEach(async () => {
  testDb = await openTestDb();
  capture = await startCaptureServer();
});

afterEach(async () => {
  await capture.close();
  await testDb.drop();
});

const patterned = (length: number) => {
  const bytes = Buffer.alloc(length);
  for (let i = 0; i + 4 <= length; i += 4096) {
    bytes.writeUInt32LE(i >>> 0, i);
  }
  return bytes;
};
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

const textOfLength = (length: number) => 'a'.repeat(length);

const input = (url: string, text?: string) => ({
  method: 'POST',
  url,
  queryRows: [] as [string, string][],
  headerRows: [] as [string, string][],
  ...(text === undefined ? {} : { body: { type: 'text' as const, text } }),
});

type StoredRef = { fileId: string; length: number };
const isRef = (body: unknown): body is StoredRef =>
  typeof body === 'object' && body !== null && 'fileId' in body;

const fileBytes = async (fileId: string) => {
  const parts: Uint8Array[] = [];
  const bucket = new GridFSBucket(testDb.db, { bucketName: 'bodies' });
  for await (const part of bucket.openDownloadStream(
    fileId as unknown as ObjectId,
  )) {
    parts.push(part as Uint8Array);
  }
  return Buffer.concat(parts);
};

const counts = async () => ({
  files: await testDb.db.collection('bodies.files').countDocuments(),
  chunks: await testDb.db.collection('bodies.chunks').countDocuments(),
});

const removeFiles = async () => {
  await testDb.db.collection('bodies.files').deleteMany({});
  await testDb.db.collection('bodies.chunks').deleteMany({});
};

const documentSize = async (collection: string, _id: string) => {
  const [row] = await testDb.db
    .collection(collection)
    .aggregate<{ size: number }>([
      { $match: { _id: _id as never } },
      { $project: { size: { $bsonSize: '$$ROOT' } } },
    ])
    .toArray();
  return row?.size;
};

const responseBodyOf = (call: Awaited<ReturnType<typeof sendAndRecord>>) => {
  const { completion } = call;
  if (!('response' in completion)) {
    throw new Error(`expected a response: ${JSON.stringify(completion)}`);
  }
  return completion.response.body;
};

// Sends part of a response, then holds the connection until told otherwise.
async function startHeldResponse(sentBytes: number) {
  let held: ServerResponse | undefined;
  let closedWith: (finished: boolean) => void = () => {};
  const closed = new Promise<boolean>((resolve) => {
    closedWith = resolve;
  });
  const server: Server = createServer((_req, res) => {
    held = res;
    res.on('close', () => closedWith(res.writableFinished));
    res.writeHead(200, { 'content-length': String(sentBytes * 4) });
    res.write(patterned(sentBytes));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    die: () => held?.socket?.destroy(),
    /** Resolves when the connection closes; true only if the server finished the response. */
    closed,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const chunksExist = () =>
  vi.waitFor(
    async () => {
      expect((await counts()).chunks).toBeGreaterThan(0);
    },
    { timeout: 10_000, interval: 20 },
  );

describe('T1.5 — a body over 16 MB is stored in full', () => {
  test('a 17 MiB response reads back byte for byte, and its document stays small', async () => {
    const body = patterned(LARGE);
    capture.respondWith({ status: 200, body });

    const call = await sendAndRecord(
      createCallStore(testDb.db),
      input(`${capture.url}/`),
    );

    const stored = responseBodyOf(call);
    expect(isRef(stored)).toBe(true);
    expect(stored).toMatchObject({ length: LARGE });
    expect(sha(await fileBytes((stored as StoredRef).fileId))).toBe(sha(body));
    expect(await documentSize('completions', call.completion._id)).toBeLessThan(
      64 * 1024,
    );
  });

  test('a 17 MiB request body reaches the server and reads back byte for byte', async () => {
    const text = textOfLength(LARGE);
    const call = await sendAndRecord(
      createCallStore(testDb.db),
      input(`${capture.url}/`, text),
    );

    const stored = call.send.request.body;
    expect(isRef(stored)).toBe(true);
    expect(stored).toMatchObject({ length: LARGE });
    const expected = sha(Buffer.from(text));
    expect(sha(await fileBytes((stored as StoredRef).fileId))).toBe(expected);
    expect(sha(capture.requests[0]?.body ?? Buffer.alloc(0))).toBe(expected);
    expect(await documentSize('sends', call.send._id)).toBeLessThan(64 * 1024);
  });

  test('getCall returns the references, for a call that opens and parses', async () => {
    capture.respondWith({ status: 200, body: patterned(2 * MIB) });
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(
      store,
      input(`${capture.url}/`, textOfLength(2 * MIB)),
    );

    const opened = await store.getCall(call.send._id, new Set());

    expect(opened).toMatchObject({
      state: 'completed',
      send: {
        request: { body: { fileId: expect.any(String), length: 2 * MIB } },
      },
      completion: {
        response: { body: { fileId: expect.any(String), length: 2 * MIB } },
      },
    });
  });
});

describe('T1.5 — an uploaded file over 16 MB', () => {
  test('a 17 MiB file part is stored in full, reaches the server, and replays with the same bytes', async () => {
    const store = createCallStore(testDb.db);
    const file = patterned(LARGE);
    const call = await sendAndRecord(store, {
      ...input(`${capture.url}/upload`),
      body: {
        type: 'multipart',
        parts: [
          { kind: 'field', name: 'note', value: 'big' },
          {
            kind: 'file',
            name: 'upload',
            filename: 'big.bin',
            contentType: 'application/octet-stream',
            bytes: new Uint8Array(file),
          },
        ],
      },
    });

    const stored = call.send.request.body;
    expect(isRef(stored)).toBe(true);
    const sent = capture.requests[0]?.body ?? Buffer.alloc(0);
    expect(sent.length).toBeGreaterThan(LARGE);
    expect((stored as StoredRef).length).toBe(sent.length);
    expect(sha(await fileBytes((stored as StoredRef).fileId))).toBe(sha(sent));
    expect(sent.includes(file)).toBe(true);
    expect(await documentSize('sends', call.send._id)).toBeLessThan(64 * 1024);

    await replayCall(store, call.send._id);
    expect(sha(capture.requests[1]?.body ?? Buffer.alloc(0))).toBe(sha(sent));
  });
});

describe('the threshold', () => {
  test.each([
    ['exactly 1 MiB stays in the document', MIB, false],
    ['1 MiB + 1 goes to a file', MIB + 1, true],
  ])('a response of %s', async (_name, length, inFile) => {
    capture.respondWith({ status: 200, body: patterned(length) });
    const call = await sendAndRecord(
      createCallStore(testDb.db),
      input(`${capture.url}/`),
    );
    expect(isRef(responseBodyOf(call))).toBe(inFile);
    expect((await counts()).files).toBe(inFile ? 1 : 0);
  });

  test.each([
    ['exactly 1 MiB stays in the document', MIB, false],
    ['1 MiB + 1 goes to a file', MIB + 1, true],
  ])('a request of %s', async (_name, length, inFile) => {
    const call = await sendAndRecord(
      createCallStore(testDb.db),
      input(`${capture.url}/`, textOfLength(length)),
    );
    expect(isRef(call.send.request.body)).toBe(inFile);
    expect((await counts()).files).toBe(inFile ? 1 : 0);
    expect(capture.requests[0]?.body).toHaveLength(length);
  });
});

describe('a transfer that does not finish leaves no file', () => {
  test('a cancel mid-body removes the chunks and records cancelled', async () => {
    const server = await startHeldResponse(3 * MIB);
    try {
      const controller = new AbortController();
      const sending = sendAndRecord(
        createCallStore(testDb.db),
        input(server.url),
        { signal: controller.signal },
      );
      await chunksExist();
      controller.abort();

      const call = await sending;
      expect(call.completion).toMatchObject({ error: { code: 'cancelled' } });
      expect(await counts()).toEqual({ files: 0, chunks: 0 });
    } finally {
      await server.close();
    }
  });

  test('a server dying mid-body removes the chunks and records network', async () => {
    const server = await startHeldResponse(3 * MIB);
    try {
      const sending = sendAndRecord(
        createCallStore(testDb.db),
        input(server.url),
      );
      await chunksExist();
      server.die();

      const call = await sending;
      expect(call.completion).toMatchObject({ error: { code: 'network' } });
      expect(await counts()).toEqual({ files: 0, chunks: 0 });
    } finally {
      await server.close();
    }
  });

  test('a timeout mid-body removes the chunks and records timeout', async () => {
    const server = await startHeldResponse(3 * MIB);
    try {
      const call = await sendAndRecord(
        createCallStore(testDb.db),
        input(server.url),
        { bodyTimeoutMs: 500 },
      );
      expect(call.completion).toMatchObject({ error: { code: 'timeout' } });
      expect(await counts()).toEqual({ files: 0, chunks: 0 });
    } finally {
      await server.close();
    }
  });
});

describe('a storage failure', () => {
  // A real server-side failure: MongoDB refuses chunks after the first few.
  const refuseChunksFrom = (n: number) =>
    testDb.db.createCollection('bodies.chunks', {
      validator: { n: { $lt: n } },
    });

  test('T1.6 — a failed request-body upload dispatches nothing and reports the database', async () => {
    await refuseChunksFrom(0);

    await expect(
      sendAndRecord(
        createCallStore(testDb.db),
        input(`${capture.url}/`, textOfLength(2 * MIB)),
      ),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);

    expect(capture.requests).toHaveLength(0);
    expect(await testDb.db.collection('sends').countDocuments()).toBe(0);
    expect(await counts()).toEqual({ files: 0, chunks: 0 });
  });

  test('mid-response records storage, stops the transfer, and removes the chunks', async () => {
    await refuseChunksFrom(3);
    const server = await startHeldResponse(3 * MIB);
    try {
      const call = await sendAndRecord(
        createCallStore(testDb.db),
        input(server.url),
      );

      expect(call.completion).toMatchObject({ error: { code: 'storage' } });
      expect(await server.closed).toBe(false);
      expect(await counts()).toEqual({ files: 0, chunks: 0 });
    } finally {
      await server.close();
    }
  });

  test('at the end of a response records storage and removes the chunks (code review, 1)', async () => {
    // Five full chunks are accepted; the sixth, written only when the upload finishes, is refused.
    const CHUNK = 261_120;
    await refuseChunksFrom(5);
    capture.respondWith({ status: 200, body: patterned(CHUNK * 5 + 5) });

    const call = await sendAndRecord(
      createCallStore(testDb.db),
      input(`${capture.url}/`),
    );

    expect(call.completion).toMatchObject({ error: { code: 'storage' } });
    expect(await counts()).toEqual({ files: 0, chunks: 0 });
  });

  test('a completion that cannot be stored still carries the file reference', async () => {
    capture.respondWith({ status: 200, body: patterned(2 * MIB) });
    const store = createCallStore(testDb.db);
    const failing = {
      ...store,
      insertCompletion: async () => {
        throw new Error('completion refused');
      },
    };

    const error = await sendAndRecord(failing, input(`${capture.url}/`)).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ResponseNotRecordedError);
    expect((error as ResponseNotRecordedError).completion).toMatchObject({
      response: { body: { fileId: expect.any(String), length: 2 * MIB } },
    });
  });
});

describe('T1.1 — a replay of a large request', () => {
  test('sends the same bytes from its own file, and the original is unchanged', async () => {
    const store = createCallStore(testDb.db);
    const text = textOfLength(2 * MIB);
    const original = await sendAndRecord(store, input(`${capture.url}/`, text));
    const before = await store.getCall(original.send._id, new Set());
    const originalRef = original.send.request.body as StoredRef;

    const replay = await replayCall(store, original.send._id);

    const replayRef = replay.send.request.body as StoredRef;
    expect(isRef(replayRef)).toBe(true);
    expect(replayRef.fileId).not.toBe(originalRef.fileId);
    expect(replayRef.length).toBe(originalRef.length);
    expect(sha(capture.requests[1]?.body ?? Buffer.alloc(0))).toBe(
      sha(Buffer.from(text)),
    );
    expect(capture.requests[1]?.rawHeaders).toEqual(
      capture.requests[0]?.rawHeaders,
    );
    expect(await store.getCall(original.send._id, new Set())).toEqual(before);
    expect(sha(await fileBytes(originalRef.fileId))).toBe(
      sha(Buffer.from(text)),
    );
    expect(sha(await fileBytes(replayRef.fileId))).toBe(sha(Buffer.from(text)));
  });

  test('whose stored file is gone rejects, and sends and records nothing', async () => {
    const store = createCallStore(testDb.db);
    const original = await sendAndRecord(
      store,
      input(`${capture.url}/`, textOfLength(2 * MIB)),
    );
    await removeFiles();
    const sends = await testDb.db.collection('sends').countDocuments();

    await expect(replayCall(store, original.send._id)).rejects.toBeInstanceOf(
      CallNotReplayableError,
    );

    expect(capture.requests).toHaveLength(1);
    expect(await testDb.db.collection('sends').countDocuments()).toBe(sends);
  });
});

describe('a cancel before anything is recorded (code review, 4)', () => {
  const cancelled = () => {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  };

  test('a large request sends and records nothing', async () => {
    await expect(
      sendAndRecord(
        createCallStore(testDb.db),
        input(`${capture.url}/`, textOfLength(2 * MIB)),
        { signal: cancelled() },
      ),
    ).rejects.toBeInstanceOf(SendCancelledError);

    expect(capture.requests).toHaveLength(0);
    expect(await testDb.db.collection('sends').countDocuments()).toBe(0);
    expect(await counts()).toEqual({ files: 0, chunks: 0 });
  });

  test('a replay of a large request copies, sends and records nothing', async () => {
    const store = createCallStore(testDb.db);
    const original = await sendAndRecord(
      store,
      input(`${capture.url}/`, textOfLength(2 * MIB)),
    );
    const before = await counts();

    await expect(
      replayCall(store, original.send._id, { signal: cancelled() }),
    ).rejects.toBeInstanceOf(SendCancelledError);

    expect(capture.requests).toHaveLength(1);
    expect(await testDb.db.collection('sends').countDocuments()).toBe(1);
    expect(await counts()).toEqual(before);
  });

  test('a small request is still recorded as cancelled, as before', async () => {
    const call = await sendAndRecord(
      createCallStore(testDb.db),
      input(`${capture.url}/`, 'small'),
      { signal: cancelled() },
    );

    expect(call.completion).toMatchObject({ error: { code: 'cancelled' } });
  });
});

describe('reading calls never reads file contents', () => {
  test('getCall and listCalls work with the files gone', async () => {
    capture.respondWith({ status: 200, body: patterned(2 * MIB) });
    const store = createCallStore(testDb.db);
    const call = await sendAndRecord(
      store,
      input(`${capture.url}/`, textOfLength(2 * MIB)),
    );
    await removeFiles();

    expect(await store.getCall(call.send._id, new Set())).toMatchObject({
      state: 'completed',
    });
    const [listed] = await store.listCalls(10, new Set());
    expect(listed).toMatchObject({ state: 'completed' });
    expect(listed).not.toHaveProperty('send.request.body');
    expect(listed).not.toHaveProperty('completion.response.body');
  });
});

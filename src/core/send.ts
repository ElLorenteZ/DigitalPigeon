// Sends one request and records it as a call: the send document is inserted BEFORE the request is
// dispatched, so nothing reaches the wire unrecorded (plan.md; test-strategy.md T1.2, T1.6).
// No `electron` import: integration tests run this in plain Node.
import { randomUUID } from 'node:crypto';
import { MongoError } from 'mongodb';
import { request } from 'undici';
import {
  BodyFileMissingError,
  type BodyUpload,
  INLINE_BODY_LIMIT,
  concatBytes,
} from './body-store';
import type {
  CompletionDoc,
  CompletionError,
  SendDoc,
  StoredBody,
} from './call-schema';
import type { createCallStore } from './call-store';
import { type WireInput, type WireRequest, buildWireRequest } from './wire';

type CallStore = Pick<
  ReturnType<typeof createCallStore>,
  'insertSend' | 'insertCompletion' | 'bodies'
>;

export class ResponseNotRecordedError extends Error {
  constructor(
    readonly completion: CompletionDoc,
    readonly cause: unknown,
  ) {
    super('Response received but not recorded');
  }
}

/** The send document could not be inserted, so the request was not sent (T1.6). */
export class DatabaseUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super(
      `Database unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/** A response body could not be written. Recorded as the error code `storage`. */
class BodyStorageError extends Error {
  constructor(readonly cause: unknown) {
    super(
      `The response body could not be stored: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/** Cancelled while a large body was being stored or read: nothing was sent and no call exists. */
export class SendCancelledError extends Error {
  constructor() {
    super('Cancelled before anything was sent');
  }
}

const MIB = 1024 * 1024;
// About 8 Mbit/s. A slower link still records `timeout`, which is what happened.
const UPLOAD_MS_PER_MIB = 1000;

const isAbort = (cause: unknown) => (cause as Error)?.name === 'AbortError';

export interface SendOptions {
  signal?: AbortSignal;
  /** Called once the send document is stored, before the request is dispatched. */
  onSent?: (send: SendDoc) => void;
  headersTimeoutMs?: number;
  bodyTimeoutMs?: number;
}

export interface RecordedCall {
  send: SendDoc;
  completion: CompletionDoc;
}

export async function sendAndRecord(
  store: CallStore,
  input: WireInput,
  options: SendOptions = {},
): Promise<RecordedCall> {
  return sendWireAndRecord(store, buildWireRequest(input), options);
}

// Records then dispatches a request already in wire form. Used for a typed request and for a replay,
// which passes the recorded list unchanged.
async function sendWireAndRecord(
  store: CallStore,
  wire: WireRequest,
  {
    signal,
    onSent,
    headersTimeoutMs = 30_000,
    bodyTimeoutMs = 30_000,
  }: SendOptions,
): Promise<RecordedCall> {
  let send: SendDoc;
  try {
    // The file first: no document refers to bytes that are not stored.
    const body =
      wire.body && wire.body.length > INLINE_BODY_LIMIT
        ? await store.bodies.writeBytes(wire.body, signal)
        : wire.body;
    send = {
      _id: randomUUID(),
      schemaVersion: 1,
      sentAt: new Date(),
      request: { ...wire, body },
    };
    await store.insertSend(send);
  } catch (cause) {
    if (isAbort(cause)) throw new SendCancelledError();
    // Only a driver error means the database is unavailable; anything else (a schema error, a bug)
    // surfaces as itself.
    if (cause instanceof MongoError) throw new DatabaseUnavailableError(cause);
    throw cause;
  }
  onSent?.(send);

  const started = performance.now();
  const base = {
    _id: randomUUID(),
    schemaVersion: 1 as const,
    sendId: send._id,
  };
  let completion: CompletionDoc;
  try {
    const res = await request(wire.url, {
      method: wire.method as never,
      headers: wire.headers.flat(),
      body: wire.body ?? undefined,
      signal,
      // undici's headers timer runs during the upload, so a large body gets longer to reach the server.
      headersTimeout:
        headersTimeoutMs +
        Math.floor((wire.body?.length ?? 0) / MIB) * UPLOAD_MS_PER_MIB,
      bodyTimeout: bodyTimeoutMs,
    });
    const body = await storedResponseBody(res.body, store.bodies);
    completion = {
      ...base,
      completedAt: new Date(),
      durationMs: performance.now() - started,
      response: {
        status: res.statusCode,
        headers: headerPairs(res.headers),
        body,
      },
    };
  } catch (error) {
    completion = {
      ...base,
      completedAt: new Date(),
      durationMs: performance.now() - started,
      error: {
        code: classifySendError(error, signal),
        message: String((error as Error)?.message ?? error),
      },
    };
  }

  try {
    await store.insertCompletion(completion);
  } catch (cause) {
    throw new ResponseNotRecordedError(completion, cause);
  }
  return { send, completion };
}

// Holds a response in memory up to the limit, then moves it to a file, so main's memory stays bounded at
// any size. One loop: leaving a `for await` destroys undici's body, which a storage failure wants, since
// the transfer stops. pipeline leaves the chunks on a failure, so every failure aborts explicitly
// (spike-gridfs-streaming.md).
async function storedResponseBody(
  source: AsyncIterable<Uint8Array>,
  bodies: CallStore['bodies'],
): Promise<StoredBody> {
  const storing = <T>(step: () => Promise<T>) =>
    step().catch((cause: unknown) => {
      throw new BodyStorageError(cause);
    });

  let held: Uint8Array[] = [];
  let heldBytes = 0;
  let upload: BodyUpload | undefined;
  try {
    for await (const chunk of source) {
      if (!upload && heldBytes + chunk.length <= INLINE_BODY_LIMIT) {
        held.push(chunk);
        heldBytes += chunk.length;
        continue;
      }
      if (!upload) {
        const opened = bodies.openUpload();
        upload = opened;
        for (const part of held) await storing(() => opened.write(part));
        held = [];
      }
      const current = upload;
      await storing(() => current.write(chunk));
    }
    const current = upload;
    return current ? await storing(() => current.finish()) : concatBytes(held);
  } catch (error) {
    await upload?.abort();
    throw error;
  }
}

/** The call is unknown or its documents fail their schema, so there is nothing to send. */
export class CallNotReplayableError extends Error {
  constructor(readonly sendId: string) {
    super(`Call ${sendId} cannot be replayed`);
  }
}

/**
 * Sends a past call again as a new call. The recorded list is passed on unchanged rather than rebuilt
 * through wire.ts, so a replay still sends what was recorded after wire.ts changes.
 */
export async function replayCall(
  store: CallStore & Pick<ReturnType<typeof createCallStore>, 'getCall'>,
  sendId: string,
  options: SendOptions = {},
): Promise<RecordedCall> {
  let call: Awaited<ReturnType<typeof store.getCall>>;
  try {
    call = await store.getCall(sendId, new Set());
  } catch (cause) {
    if (cause instanceof MongoError) throw new DatabaseUnavailableError(cause);
    throw cause;
  }
  if (!call || call.state === 'unreadable') {
    throw new CallNotReplayableError(sendId);
  }
  const { body } = call.send.request;
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    // A replay owns its bytes: a stored body is written again as a new file, so slice 7 can delete a
    // call without counting references.
    bytes =
      body && 'fileId' in body
        ? await store.bodies.readAll(body, options.signal)
        : ((body ?? null) as Uint8Array<ArrayBuffer> | null);
  } catch (cause) {
    if (isAbort(cause)) throw new SendCancelledError();
    if (cause instanceof BodyFileMissingError) {
      throw new CallNotReplayableError(sendId);
    }
    if (cause instanceof MongoError) throw new DatabaseUnavailableError(cause);
    throw cause;
  }
  return sendWireAndRecord(
    store,
    { ...call.send.request, body: bytes },
    options,
  );
}

function headerPairs(
  headers: Record<string, string | string[] | undefined>,
): [string, string][] {
  return Object.entries(headers).flatMap(([name, value]) =>
    value === undefined
      ? []
      : Array.isArray(value)
        ? value.map((v) => [name, v] as [string, string])
        : [[name, value]],
  );
}

export function classifySendError(
  error: unknown,
  signal: AbortSignal | undefined,
): CompletionError['code'] {
  if (signal?.aborted) return 'cancelled';
  if (error instanceof BodyStorageError) return 'storage';
  const code = (error as { code?: string })?.code;
  if (
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  )
    return 'timeout';
  // undici refused the request before writing it; nothing reached the wire.
  if (
    code === 'UND_ERR_INVALID_ARG' ||
    code === 'UND_ERR_NOT_SUPPORTED' ||
    code === 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH'
  )
    return 'invalid-request';
  return 'network';
}

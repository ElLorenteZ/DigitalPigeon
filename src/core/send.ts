// Sends one request and records it as a call: the send document is inserted BEFORE the request is
// dispatched, so nothing reaches the wire unrecorded (plan.md; test-strategy.md T1.2, T1.6).
// No `electron` import: integration tests run this in plain Node.
import { randomUUID } from 'node:crypto';
import { MongoError } from 'mongodb';
import { request } from 'undici';
import type { CompletionDoc, SendDoc } from './call-schema';
import type { createCallStore } from './call-store';
import { type WireInput, type WireRequest, buildWireRequest } from './wire';

type CallStore = Pick<
  ReturnType<typeof createCallStore>,
  'insertSend' | 'insertCompletion'
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
  const send: SendDoc = {
    _id: randomUUID(),
    schemaVersion: 1,
    sentAt: new Date(),
    request: { ...wire, body: null },
  };
  try {
    await store.insertSend(send);
  } catch (cause) {
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
      signal,
      headersTimeout: headersTimeoutMs,
      bodyTimeout: bodyTimeoutMs,
    });
    const body = new Uint8Array(await res.body.arrayBuffer());
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
  const { method, url, headers } = call.send.request;
  return sendWireAndRecord(store, { method, url, headers }, options);
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
): 'timeout' | 'cancelled' | 'network' | 'invalid-request' {
  if (signal?.aborted) return 'cancelled';
  const code = (error as { code?: string })?.code;
  if (
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  )
    return 'timeout';
  // undici refused the request before writing it; nothing reached the wire.
  if (code === 'UND_ERR_INVALID_ARG' || code === 'UND_ERR_NOT_SUPPORTED')
    return 'invalid-request';
  return 'network';
}

// Sends one request and records it as a call: the send document is inserted BEFORE the request is
// dispatched, so nothing reaches the wire unrecorded (plan.md; test-strategy.md T1.2, T1.6).
// No `electron` import: integration tests run this in plain Node.
import { randomUUID } from 'node:crypto';
import { MongoError } from 'mongodb';
import { request } from 'undici';
import type { CompletionDoc, SendDoc } from './call-schema';
import type { createCallStore } from './call-store';
import { type WireInput, buildWireRequest } from './wire';

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
  {
    signal,
    onSent,
    headersTimeoutMs = 30_000,
    bodyTimeoutMs = 30_000,
  }: SendOptions = {},
): Promise<RecordedCall> {
  const wire = buildWireRequest(input);
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
): 'timeout' | 'cancelled' | 'network' {
  if (signal?.aborted) return 'cancelled';
  const code = (error as { code?: string })?.code;
  if (
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  )
    return 'timeout';
  return 'network';
}

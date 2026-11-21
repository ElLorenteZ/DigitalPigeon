// Insert-only store for call documents. There is deliberately no update or delete function:
// a call record does not change after it is written (PRD; test-strategy.md T1.1).
import { type Db, type Filter, ObjectId } from 'mongodb';
import { z } from 'zod';
import { createBodyStore } from './body-store';
import {
  type CompletionDoc,
  CompletionDocSchema,
  type CompletionSummary,
  CompletionSummarySchema,
  type SendDoc,
  SendDocSchema,
  type SendSummary,
  SendSummarySchema,
} from './call-schema';

export type Call<Send extends SendDoc | SendSummary = SendDoc | SendSummary> =
  | {
      state: 'completed' | 'in-flight' | 'interrupted';
      /** Without the request body unless listed with `includeBodies`. */
      send: Send;
      /** Without the response body unless listed with `includeBodies`. */
      completion: CompletionDoc | CompletionSummary | null;
    }
  | { state: 'unreadable'; id: string; error: string };

export function createCallStore(db: Db) {
  const sends = db.collection<SendDoc>('sends');
  const completions = db.collection<CompletionDoc>('completions');
  // Created once per store, on the first insert; createIndex is a no-op when the index exists.
  let indexes: Promise<unknown> | undefined;
  // A failed attempt is not cached: the next insert tries again (review #8).
  const ensureIndexes = () =>
    (indexes ??= Promise.all([
      sends.createIndex({ sentAt: -1 }),
      completions.createIndex({ sendId: 1 }),
    ]).catch((error: unknown) => {
      indexes = undefined;
      throw error;
    }));

  const bodies = createBodyStore(db);
  return {
    /** Files for bodies over the inline limit. Holds no call document. */
    bodies,

    insertSend: async (doc: SendDoc): Promise<void> => {
      await ensureIndexes();
      await sends.insertOne(SendDocSchema.parse(doc));
    },

    insertCompletion: async (doc: CompletionDoc): Promise<void> => {
      await ensureIndexes();
      await completions.insertOne(CompletionDocSchema.parse(doc));
    },

    /** One call with its full response body; `null` for an unknown id. */
    getCall: async (
      sendId: string,
      inFlight: ReadonlySet<string>,
    ): Promise<Call<SendDoc> | null> => {
      const rawSend = await sends.findOne(
        { _id: sendId },
        { promoteBuffers: true },
      );
      if (!rawSend) return null;
      const rawCompletion = await completions.findOne(
        { sendId },
        { promoteBuffers: true },
      );
      return toCall(
        rawSend,
        rawCompletion,
        inFlight,
        SendDocSchema,
        CompletionDocSchema,
      );
    },

    /** Newest first. Sends whose ids are in `inFlight` are still running in this process. */
    listCalls: (
      limit: number,
      inFlight: ReadonlySet<string>,
      { includeBodies = false }: { includeBodies?: boolean } = {},
    ): Promise<Call[]> => list({}, limit, inFlight, includeBodies),

    /**
     * The responses to one request: every call with this method and URL path, newest first, without bodies (slice 7).
     * The query string, fragment and host are not part of the key. At most RESPONSES_LIMIT calls.
     */
    listResponses: (
      method: string,
      path: string,
      inFlight: ReadonlySet<string>,
    ): Promise<Call[]> =>
      list(
        {
          'request.method': method,
          'request.url': { $regex: pathPattern(path) },
        },
        RESPONSES_LIMIT,
        inFlight,
        false,
      ),

    /**
     * Deletes one call for good (slice 8): its send, its completions and every body file they refer to. Nothing else is
     * touched (T1.7). `deleted` is false for an unknown id.
     */
    deleteCall: async (sendId: string): Promise<{ deleted: boolean }> => {
      const rawSend = await sends.findOne({ _id: sendId });
      if (!rawSend) return { deleted: false };
      const rawCompletions = await completions.find({ sendId }).toArray();
      const fileIds = [
        (rawSend as { request?: { body?: unknown } }).request?.body,
        ...rawCompletions.map(
          (c) => (c as { response?: { body?: unknown } }).response?.body,
        ),
      ].flatMap((body) => (isStoredFile(body) ? [body.fileId] : []));
      await completions.deleteMany({ sendId });
      await sends.deleteOne({ _id: sendId });
      for (const fileId of fileIds) await bodies.remove(fileId);
      return { deleted: true };
    },

    /**
     * T3.9: removes body files no send or completion refers to, and chunks whose file document is missing, when they
     * are older than `cutoff`. An upload in progress has chunks before its file document, so the cutoff must be well
     * before now.
     */
    sweepOrphanBodies: async (
      cutoff: Date,
    ): Promise<{ files: number; chunks: number }> => {
      const referenced = [
        ...(await sends.distinct('request.body.fileId')),
        ...(await completions.distinct('response.body.fileId')),
      ].filter((id): id is string => typeof id === 'string');
      const fileDocs = db.collection('bodies.files');
      const orphans = await fileDocs
        .find(
          { uploadDate: { $lt: cutoff }, _id: { $nin: referenced as never[] } },
          { projection: { _id: 1 } },
        )
        .toArray();
      for (const orphan of orphans) await bodies.remove(String(orphan._id));
      const existing = await fileDocs.distinct('_id');
      const { deletedCount } = await db.collection('bodies.chunks').deleteMany({
        files_id: { $nin: existing },
        _id: {
          $lt: ObjectId.createFromTime(Math.floor(cutoff.getTime() / 1000)),
        },
      });
      return { files: orphans.length, chunks: deletedCount };
    },
  };

  async function list(
    filter: Filter<SendDoc>,
    limit: number,
    inFlight: ReadonlySet<string>,
    includeBodies: boolean,
  ): Promise<Call[]> {
    const rawSends = await sends
      .find(filter, {
        promoteBuffers: true,
        ...(includeBodies ? {} : { projection: { 'request.body': 0 } }),
      })
      .sort({ sentAt: -1 })
      .limit(limit)
      .toArray();
    const ids = rawSends.map((s) => String(s._id));
    const rawCompletions = await completions
      .find(
        { sendId: { $in: ids } },
        {
          promoteBuffers: true,
          ...(includeBodies ? {} : { projection: { 'response.body': 0 } }),
        },
      )
      .toArray();
    const completionBySend = new Map(
      rawCompletions.map((c) => [String(c.sendId), c]),
    );

    return rawSends.map((rawSend) =>
      toCall(
        rawSend,
        completionBySend.get(String(rawSend._id)),
        inFlight,
        includeBodies ? SendDocSchema : SendSummarySchema,
        includeBodies ? CompletionDocSchema : CompletionSummarySchema,
      ),
    );
  }
}

const RESPONSES_LIMIT = 500;

const isStoredFile = (body: unknown): body is { fileId: string } =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as { fileId?: unknown }).fileId === 'string';

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches an absolute URL whose path is exactly `path`; `/` also matches a URL with no path. */
function pathPattern(path: string): string {
  const root = path === '' || path === '/';
  const pathPart = root ? '/?' : escapeRegExp(path);
  return `^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*${pathPart}(?:[?#]|$)`;
}

function toCall<Send extends SendDoc | SendSummary>(
  rawSend: unknown,
  rawCompletion: unknown,
  inFlight: ReadonlySet<string>,
  sendSchema: z.ZodType<Send>,
  completionSchema: typeof CompletionDocSchema | typeof CompletionSummarySchema,
): Call<Send> {
  const id = String((rawSend as { _id: unknown })._id);
  const sendResult = sendSchema.safeParse(rawSend);
  if (!sendResult.success) {
    return {
      state: 'unreadable',
      id,
      error: z.prettifyError(sendResult.error),
    };
  }
  if (!rawCompletion) {
    return {
      state: inFlight.has(id) ? 'in-flight' : 'interrupted',
      send: sendResult.data,
      completion: null,
    };
  }
  const completionResult = completionSchema.safeParse(rawCompletion);
  if (!completionResult.success) {
    return {
      state: 'unreadable',
      id,
      error: z.prettifyError(completionResult.error),
    };
  }
  return {
    state: 'completed',
    send: sendResult.data,
    completion: completionResult.data,
  };
}

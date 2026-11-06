// Insert-only store for call documents. There is deliberately no update or delete function:
// a call record does not change after it is written (PRD; test-strategy.md T1.1).
import type { Db } from 'mongodb';
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

  return {
    /** Files for bodies over the inline limit. Holds no call document. */
    bodies: createBodyStore(db),

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
    listCalls: async (
      limit: number,
      inFlight: ReadonlySet<string>,
      { includeBodies = false }: { includeBodies?: boolean } = {},
    ): Promise<Call[]> => {
      const rawSends = await sends
        .find(
          {},
          {
            promoteBuffers: true,
            ...(includeBodies ? {} : { projection: { 'request.body': 0 } }),
          },
        )
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
    },
  };
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

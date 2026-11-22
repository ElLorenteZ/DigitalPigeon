// Store for call documents. There is deliberately no update function: a call record does not change after it is
// written (PRD; test-strategy.md T1.1). A call is removed only whole, by deleteCall (slice 8, T1.7); body files are
// removed with it or, when nothing refers to them, by sweepOrphanBodies (T3.9). Anything new that refers to a file in
// the `bodies` bucket must be added to the sweep's references.
import { type Db, type Filter, ObjectId } from 'mongodb';
import { z } from 'zod';
import { createBodyStore } from './body-store';
import { type Auth, authOf } from './headers';
import { requestKeyOf } from './request-key';
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
     * The query string, fragment and host are not part of the key; the path is compared as `requestKeyOf` writes it,
     * the function the renderer names requests with. With `auth`, only calls sent with that auth (`authOf`'s value;
     * `''` for none) are kept (history-grouping). At most RESPONSES_LIMIT calls.
     */
    listResponses: async (
      method: string,
      path: string,
      inFlight: ReadonlySet<string>,
      auth?: string,
    ): Promise<Call[]> => {
      const ids: string[] = [];
      for await (const raw of sends
        .find(
          { 'request.method': method },
          { projection: { 'request.url': 1, 'request.headers': 1, sentAt: 1 } },
        )
        .sort({ sentAt: -1 })) {
        if (ids.length >= RESPONSES_LIMIT) break;
        const { url, headers } =
          (raw as { request?: Partial<SendDoc['request']> }).request ?? {};
        if (
          typeof url !== 'string' ||
          requestKeyOf(method, url).path !== path
        ) {
          continue;
        }
        if (
          auth !== undefined &&
          (!Array.isArray(headers) || (authOf(headers)?.value ?? '') !== auth)
        ) {
          continue;
        }
        ids.push(String(raw._id));
      }
      return list({ _id: { $in: ids } }, 0, inFlight, false);
    },

    /**
     * History grouped by request (history-grouping): one group per method and URL path (`requestKeyOf`), and per auth
     * value (`authOf`) when `splitByAuth`, over every call, not only the newest 200. Each group has its count and its
     * newest call, without bodies; groups are ordered by that call, newest first. Unreadable calls have no key and are
     * in no group.
     */
    listRequestGroups: async (
      inFlight: ReadonlySet<string>,
      { splitByAuth }: { splitByAuth: boolean },
    ): Promise<RequestGroup[]> => {
      const groups = new Map<string, RequestGroup>();
      for (const call of await list({}, 0, inFlight, false)) {
        if (call.state === 'unreadable') continue;
        const { method, url, headers } = call.send.request;
        const { path } = requestKeyOf(method, url);
        const auth = splitByAuth ? (authOf(headers) ?? null) : null;
        const key = JSON.stringify([method, path, auth?.value ?? null]);
        const group = groups.get(key);
        if (group) {
          group.count += 1;
        } else {
          // Calls arrive newest first, so the first call of a group is its newest.
          groups.set(key, { method, path, auth, count: 1, latest: call });
        }
      }
      return [...groups.values()];
    },

    /**
     * Slice 9: search over every call. Filters combine across facets (AND) and within one (OR); text matches the URL,
     * request header values and inline bodies, ignoring case (bodies stored as files are not searched). Each facet
     * option counts the calls that match every other active filter. Newest first, at most SEARCH_LIMIT calls.
     */
    searchCalls: async (
      query: SearchQuery,
      inFlight: ReadonlySet<string>,
    ): Promise<SearchResult> => {
      const all = await list({}, 0, inFlight, false);
      const readable = all.filter(
        (c): c is Exclude<Call, { state: 'unreadable' }> =>
          c.state !== 'unreadable',
      );
      const facts = readable.map((call) => factsOf(call));
      const text = query.text?.trim().toLowerCase() ?? '';
      let textHits: ReadonlySet<string> | null = null;
      if (text !== '') {
        const hits = new Set<string>();
        for (const f of facts) {
          if (
            f.url.toLowerCase().includes(text) ||
            f.headerValues.some((v) => v.toLowerCase().includes(text))
          ) {
            hits.add(f.id);
          }
        }
        const rest = facts.map((f) => f.id).filter((id) => !hits.has(id));
        const decoder = new TextDecoder();
        const bodyHit = (body: unknown) =>
          body instanceof Uint8Array &&
          decoder.decode(body).toLowerCase().includes(text);
        for await (const doc of sends.find(
          { _id: { $in: rest }, 'request.body': { $type: 'binData' } },
          { projection: { 'request.body': 1 }, promoteBuffers: true },
        )) {
          if (bodyHit(doc.request.body)) hits.add(String(doc._id));
        }
        for await (const doc of completions.find(
          { sendId: { $in: rest }, 'response.body': { $type: 'binData' } },
          {
            projection: { sendId: 1, 'response.body': 1 },
            promoteBuffers: true,
          },
        )) {
          if (
            bodyHit((doc as { response?: { body?: unknown } }).response?.body)
          ) {
            hits.add(String(doc.sendId));
          }
        }
        textHits = hits;
      }
      const from = query.from ? new Date(query.from).getTime() : null;
      const to = query.to ? new Date(query.to).getTime() : null;
      const within = (selected: string[] | undefined, value: string) =>
        !selected || selected.length === 0 || selected.includes(value);
      const matches = (f: CallFacts, except?: FacetName) =>
        (except === 'method' || within(query.methods, f.method)) &&
        (except === 'environment' ||
          within(query.environmentIds, f.environmentId)) &&
        (except === 'auth' || within(query.auths, f.auth)) &&
        (except === 'savedRequest' ||
          within(query.savedRequestIds, f.savedRequestId)) &&
        (from === null || f.sentAt >= from) &&
        (to === null || f.sentAt <= to) &&
        (textHits === null || textHits.has(f.id));

      const facet = (
        name: FacetName,
        valueOf: (f: CallFacts) => string,
        labelOf: (f: CallFacts) => { label: string; detail?: string },
      ): FacetOption[] => {
        const options = new Map<string, FacetOption>();
        for (const f of facts) {
          const value = valueOf(f);
          if (!options.has(value)) {
            options.set(value, { value, ...labelOf(f), count: 0 });
          }
          if (matches(f, name)) {
            const option = options.get(value) as FacetOption;
            option.count += 1;
          }
        }
        return [...options.values()];
      };

      const matched = readable.filter((_call, index) =>
        matches(facts[index] as CallFacts),
      );
      return {
        calls: matched.slice(0, SEARCH_LIMIT),
        total: matched.length,
        of: all.length,
        facets: {
          method: facet(
            'method',
            (f) => f.method,
            (f) => ({ label: f.method }),
          ),
          environment: facet(
            'environment',
            (f) => f.environmentId,
            (f) =>
              f.environmentId === ''
                ? { label: 'No environment' }
                : { label: f.environmentName, detail: f.environmentBaseUrl },
          ),
          auth: facet(
            'auth',
            (f) => f.auth,
            (f) =>
              f.auth === ''
                ? { label: 'No auth header' }
                : { label: f.auth, detail: f.authHeader },
          ),
          savedRequest: facet(
            'savedRequest',
            (f) => f.savedRequestId,
            (f) => ({
              label:
                f.savedRequestId === '' ? 'No saved request' : f.savedRequestId,
            }),
          ),
        },
      };
    },

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
      // The send first: once it is gone the call is gone, whatever happens next (code review of delete-with-undo, 7).
      await sends.deleteOne({ _id: sendId });
      await completions.deleteMany({ sendId });
      // A file that cannot be removed now is left for the sweep; the call is deleted either way (code review, 6).
      for (const fileId of fileIds) {
        await bodies.remove(fileId).catch(() => undefined);
      }
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
      // Every document that can refer to a body file: calls, and saved requests' text bodies and file parts (code
      // review of delete-with-undo, 1).
      const savedRequests = db.collection('savedRequests');
      const referenced = [
        ...(await sends.distinct('request.body.fileId')),
        ...(await completions.distinct('response.body.fileId')),
        ...(await savedRequests.distinct('request.body.text.fileId')),
        ...(await savedRequests.distinct('request.body.parts.bytes.fileId')),
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
const SEARCH_LIMIT = 500;

/** One request in History grouped by request (history-grouping). `auth` is set only when grouped by auth too. */
export interface RequestGroup {
  method: string;
  path: string;
  auth: Auth | null;
  count: number;
  latest: Exclude<Call, { state: 'unreadable' }>;
}

/** Slice 9: what the History search filters on. `""` in a list means "none" (no environment, no header, …). */
export interface SearchQuery {
  text?: string;
  methods?: string[];
  environmentIds?: string[];
  auths?: string[];
  savedRequestIds?: string[];
  /** ISO date-times, inclusive. */
  from?: string;
  to?: string;
}

type FacetName = 'method' | 'environment' | 'auth' | 'savedRequest';

export interface FacetOption {
  value: string;
  label: string;
  detail?: string;
  count: number;
}

export interface SearchResult {
  calls: Call[];
  total: number;
  of: number;
  facets: Record<FacetName, FacetOption[]>;
}

interface CallFacts {
  id: string;
  method: string;
  url: string;
  headerValues: string[];
  environmentId: string;
  environmentName: string;
  environmentBaseUrl: string;
  auth: string;
  /** The header `auth` came from; `''` when there is none. */
  authHeader: '' | 'Authorization' | 'Cookie';
  savedRequestId: string;
  sentAt: number;
}

function factsOf(call: Exclude<Call, { state: 'unreadable' }>): CallFacts {
  const { send } = call;
  const auth = authOf(send.request.headers);
  return {
    id: send._id,
    method: send.request.method,
    url: send.request.url,
    headerValues: send.request.headers.map(([, value]) => value),
    environmentId: send.environment?.id ?? '',
    environmentName: send.environment?.name ?? '',
    environmentBaseUrl: send.environment?.baseUrl ?? '',
    auth: auth?.value ?? '',
    authHeader: auth?.header ?? '',
    savedRequestId: send.savedRequestId ?? '',
    sentAt: send.sentAt.getTime(),
  };
}

const isStoredFile = (body: unknown): body is { fileId: string } =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as { fileId?: unknown }).fileId === 'string';

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

// IPC handlers: validate input with the contract, call the core, validate output.
// The only Electron-facing code that touches sending and storage (AGENTS.md).
// Handlers return results rather than rejecting, so the renderer always has something to show.
import type { IpcMain } from 'electron';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { CompletionDoc, SendDoc, StoredBody } from '../core/call-schema';
import { type Call, createCallStore } from '../core/call-store';
import {
  CallNotReplayableError,
  DatabaseUnavailableError,
  type RecordedCall,
  ResponseNotRecordedError,
  SendCancelledError,
  type SendOptions,
  replayCall,
  sendAndRecord,
} from '../core/send';
import {
  EnvironmentNotFoundError,
  createEnvironmentStore,
  resolveEnvironment,
} from '../core/environment-store';
import { createPartScanner } from '../core/multipart';
import { createSavedRequestStore } from '../core/saved-request-store';
import { InvalidPathError, NoActiveEnvironmentError } from '../core/url';
import { MongoError } from 'mongodb';
import { InvalidBodyError, InvalidHeaderError } from '../core/wire';
import {
  type CallView,
  CancelInputSchema,
  type DbStatusView,
  DbStatusViewSchema,
  type GetCallResult,
  GetCallInputSchema,
  GetCallResultSchema,
  type ListCallsResult,
  ListCallsResultSchema,
  BODY_PAGE_BYTES,
  ActiveEnvironmentInputSchema,
  type GetSavedRequestResult,
  GetSavedRequestResultSchema,
  type ListSavedRequestsResult,
  ListSavedRequestsResultSchema,
  SaveSavedRequestInputSchema,
  type SaveSavedRequestResult,
  SaveSavedRequestResultSchema,
  DescribeBodyInputSchema,
  IdSchema,
  type MutationResult,
  type ListEnvironmentsResult,
  ListEnvironmentsResultSchema,
  SaveEnvironmentInputSchema,
  type DescribeBodyResult,
  DescribeBodyResultSchema,
  ReadBodyInputSchema,
  type ReadBodyResult,
  ReadBodyResultSchema,
  ReplayInputSchema,
  SendInputSchema,
  type SendResult,
  SendResultSchema,
  channels,
} from '../shared/ipc-contract';

const HISTORY_LIMIT = 200;

export interface IpcDeps {
  ipcMain: IpcMain;
  /** The database to record in, when status is `up`. */
  db: () => Db | undefined;
  dbStatus: () => DbStatusView;
}

type CallStore = ReturnType<typeof createCallStore>;

const message = (error: unknown) => String((error as Error)?.message ?? error);

// Structured clone would turn a Buffer into a Uint8Array anyway; copy explicitly so the contract
// holds in main as well as in the renderer.
const plainBody = (body: StoredBody): StoredBody =>
  'fileId' in body ? body : new Uint8Array(body);

const plainBytes = (completion: CompletionDoc): CompletionDoc =>
  'response' in completion
    ? {
        ...completion,
        response: {
          ...completion.response,
          body: plainBody(completion.response.body),
        },
      }
    : completion;

const plainSend = (send: SendDoc): SendDoc => ({
  ...send,
  request: {
    ...send.request,
    body: send.request.body && plainBody(send.request.body),
  },
});

// History rows never carry bodies: listCalls projects them out (review #9).
const toView = (call: Call): CallView =>
  call.state === 'unreadable'
    ? call
    : {
        ...call,
        completion:
          call.completion &&
          'response' in call.completion &&
          'body' in call.completion.response
            ? {
                ...call.completion,
                response: {
                  status: call.completion.response.status,
                  headers: call.completion.response.headers,
                },
              }
            : call.completion,
      };

// An opened call keeps its bodies. getCall always reads with them; the plain copies keep the contract.
const toDetail = (call: Call): unknown =>
  call.state === 'unreadable'
    ? call
    : {
        ...call,
        send: plainSend(call.send as SendDoc),
        completion:
          call.completion && plainBytes(call.completion as CompletionDoc),
      };

export function registerIpc({ ipcMain, db, dbStatus }: IpcDeps): void {
  const controllers = new Map<string, AbortController>();
  const inFlightSendIds = new Set<string>();
  // One store per connected database, so index creation runs once, not on every call (review #8).
  const stores = new WeakMap<Db, CallStore>();
  const storeFor = (database: Db): CallStore => {
    let store = stores.get(database);
    if (!store) {
      store = createCallStore(database);
      stores.set(database, store);
    }
    return store;
  };

  // Send and replay share everything after their first step: cancel, in-flight tracking and the
  // mapping of failures to results.
  const recorded = async (
    clientRequestId: string,
    run: (database: Db, options: SendOptions) => Promise<RecordedCall>,
  ): Promise<SendResult> => {
    const database = db();
    if (!database || dbStatus().status !== 'up') {
      return {
        ok: false,
        error: {
          kind: 'database-unavailable',
          message: 'Database not running',
        },
      };
    }

    const controller = new AbortController();
    controllers.set(clientRequestId, controller);
    let sendId: string | undefined;
    try {
      const call = await run(database, {
        signal: controller.signal,
        onSent: (send) => {
          sendId = send._id;
          inFlightSendIds.add(send._id);
        },
      });
      return SendResultSchema.parse({
        ok: true,
        send: plainSend(call.send),
        completion: plainBytes(call.completion),
      });
    } catch (error) {
      if (error instanceof ResponseNotRecordedError) {
        return SendResultSchema.parse({
          ok: false,
          error: {
            kind: 'not-recorded',
            message: 'Response received but not recorded',
          },
          completion: plainBytes(error.completion),
        });
      }
      if (
        error instanceof InvalidHeaderError ||
        error instanceof InvalidBodyError ||
        error instanceof CallNotReplayableError ||
        error instanceof NoActiveEnvironmentError ||
        error instanceof InvalidPathError ||
        error instanceof EnvironmentNotFoundError
      ) {
        return {
          ok: false,
          error: { kind: 'invalid-input', message: error.message },
        };
      }
      if (error instanceof SendCancelledError) {
        return {
          ok: false,
          error: { kind: 'cancelled', message: error.message },
        };
      }
      if (error instanceof DatabaseUnavailableError) {
        return {
          ok: false,
          error: { kind: 'database-unavailable', message: error.message },
        };
      }
      return {
        ok: false,
        error: { kind: 'unexpected', message: message(error) },
      };
    } finally {
      controllers.delete(clientRequestId);
      if (sendId) inFlightSendIds.delete(sendId);
    }
  };

  const invalidInput = (error: z.ZodError): SendResult => ({
    ok: false,
    error: { kind: 'invalid-input', message: z.prettifyError(error) },
  });

  ipcMain.handle(
    channels.send,
    async (_event, raw: unknown): Promise<SendResult> => {
      const parsed = SendInputSchema.safeParse(raw);
      if (!parsed.success) return invalidInput(parsed.error);
      const { clientRequestId, environmentId, savedRequestId, ...input } =
        parsed.data;
      return recorded(clientRequestId, async (database, options) => {
        // Loaded by the id the select showed, from the store: never a baseUrl from the renderer (plan revision 2, B1).
        // A saved request deleted since the form opened it is not linked: the call records what happened (review R2).
        const [environment, linked] = await Promise.all([
          resolveEnvironment(
            createEnvironmentStore(database),
            environmentId ?? null,
            input.url,
          ),
          savedRequestId === undefined
            ? false
            : createSavedRequestStore(database).exists(savedRequestId),
        ]).catch((cause: unknown) => {
          // Before anything is recorded, a driver failure is the database being unavailable, as in sendAndRecord
          // (second code review, 3).
          throw cause instanceof MongoError
            ? new DatabaseUnavailableError(cause)
            : cause;
        });
        return sendAndRecord(storeFor(database), input, {
          ...options,
          ...(environment ? { environment } : {}),
          ...(linked ? { savedRequestId } : {}),
        });
      });
    },
  );

  ipcMain.handle(
    channels.replay,
    async (_event, raw: unknown): Promise<SendResult> => {
      const parsed = ReplayInputSchema.safeParse(raw);
      if (!parsed.success) return invalidInput(parsed.error);
      const { clientRequestId, sendId } = parsed.data;
      return recorded(clientRequestId, (database, options) =>
        replayCall(storeFor(database), sendId, options),
      );
    },
  );

  ipcMain.handle(
    channels.getCall,
    async (_event, raw: unknown): Promise<GetCallResult> => {
      const sendId = GetCallInputSchema.safeParse(raw);
      if (!sendId.success) {
        return { ok: false, message: z.prettifyError(sendId.error) };
      }
      const database = db();
      if (!database || dbStatus().status !== 'up') {
        return { ok: false, message: 'Database not running' };
      }
      try {
        const call = await storeFor(database).getCall(
          sendId.data,
          inFlightSendIds,
        );
        return GetCallResultSchema.parse({
          ok: true,
          call: call && toDetail(call),
        });
      } catch (error) {
        return { ok: false, message: message(error) };
      }
    },
  );

  // Only the `bodies` bucket, and at most one page per read: the schema holds the limit.
  ipcMain.handle(
    channels.readBody,
    async (_event, raw: unknown): Promise<ReadBodyResult> => {
      const range = ReadBodyInputSchema.safeParse(raw);
      if (!range.success) {
        return { ok: false, message: z.prettifyError(range.error) };
      }
      const database = db();
      if (!database || dbStatus().status !== 'up') {
        return { ok: false, message: 'Database not running' };
      }
      try {
        const bytes = await storeFor(database).bodies.readRange(range.data);
        return ReadBodyResultSchema.parse({ ok: true, bytes });
      } catch (error) {
        return { ok: false, message: message(error) };
      }
    },
  );

  // Only the `bodies` bucket. Read a page at a time into the scanner, so main holds one page, not the body.
  ipcMain.handle(
    channels.describeBody,
    async (_event, raw: unknown): Promise<DescribeBodyResult> => {
      const input = DescribeBodyInputSchema.safeParse(raw);
      if (!input.success) {
        return { ok: false, message: z.prettifyError(input.error) };
      }
      const database = db();
      if (!database || dbStatus().status !== 'up') {
        return { ok: false, message: 'Database not running' };
      }
      try {
        const { bodies } = storeFor(database);
        const scanner = createPartScanner(input.data.boundary);
        const parts = [];
        for (let offset = 0; ; offset += BODY_PAGE_BYTES) {
          const page = await bodies.readRange({
            fileId: input.data.fileId,
            offset,
            length: BODY_PAGE_BYTES,
          });
          parts.push(...scanner.push(page));
          if (page.length < BODY_PAGE_BYTES) break;
        }
        parts.push(...scanner.end());
        return DescribeBodyResultSchema.parse({ ok: true, parts });
      } catch (error) {
        return { ok: false, message: message(error) };
      }
    },
  );

  // Environments and saved requests (slice 5). Each handler validates its input, needs the database, and returns a
  // result, never a rejection, like the others here.
  const withStore =
    <Store>(create: (database: Db) => Store) =>
    async <T>(
      run: (store: Store) => Promise<T>,
    ): Promise<T | { ok: false; message: string }> => {
      const database = db();
      if (!database || dbStatus().status !== 'up') {
        return { ok: false, message: 'Database not running' };
      }
      try {
        return await run(create(database));
      } catch (error) {
        return { ok: false, message: message(error) };
      }
    };
  const withEnvironments = withStore(createEnvironmentStore);
  const withSaved = withStore(createSavedRequestStore);

  ipcMain.handle(
    channels.listEnvironments,
    async (): Promise<ListEnvironmentsResult> =>
      withEnvironments(async (store) => {
        const [environments, active] = await Promise.all([
          store.list(),
          store.getActive(),
        ]);
        return ListEnvironmentsResultSchema.parse({
          ok: true,
          environments,
          activeId: active?.id ?? null,
        });
      }),
  );

  ipcMain.handle(
    channels.saveEnvironment,
    async (_event, raw: unknown): Promise<MutationResult> => {
      const input = SaveEnvironmentInputSchema.safeParse(raw);
      if (!input.success) {
        return { ok: false, message: z.prettifyError(input.error) };
      }
      const { id, ...fields } = input.data;
      return withEnvironments(async (store) => {
        if (id === undefined) await store.create(fields);
        else if (!(await store.update(id, fields))) {
          return { ok: false, message: 'That environment no longer exists' };
        }
        return { ok: true };
      });
    },
  );

  ipcMain.handle(
    channels.deleteEnvironment,
    async (_event, raw: unknown): Promise<MutationResult> => {
      const id = IdSchema.safeParse(raw);
      if (!id.success) return { ok: false, message: z.prettifyError(id.error) };
      return withEnvironments(async (store) => {
        await store.delete(id.data);
        return { ok: true };
      });
    },
  );

  ipcMain.handle(
    channels.setActiveEnvironment,
    async (_event, raw: unknown): Promise<MutationResult> => {
      const id = ActiveEnvironmentInputSchema.safeParse(raw);
      if (!id.success) return { ok: false, message: z.prettifyError(id.error) };
      return withEnvironments(async (store) => {
        await store.setActive(id.data);
        return { ok: true };
      });
    },
  );

  ipcMain.handle(
    channels.listSavedRequests,
    async (): Promise<ListSavedRequestsResult> =>
      withSaved(async (store) =>
        ListSavedRequestsResultSchema.parse({
          ok: true,
          savedRequests: await store.list(),
        }),
      ),
  );

  ipcMain.handle(
    channels.getSavedRequest,
    async (_event, raw: unknown): Promise<GetSavedRequestResult> => {
      const id = IdSchema.safeParse(raw);
      if (!id.success) return { ok: false, message: z.prettifyError(id.error) };
      return withSaved(async (store) =>
        GetSavedRequestResultSchema.parse({
          ok: true,
          savedRequest: await store.get(id.data),
        }),
      );
    },
  );

  ipcMain.handle(
    channels.saveSavedRequest,
    async (_event, raw: unknown): Promise<SaveSavedRequestResult> => {
      const input = SaveSavedRequestInputSchema.safeParse(raw);
      if (!input.success) {
        return { ok: false, message: z.prettifyError(input.error) };
      }
      const { id, ...fields } = input.data;
      return withSaved(async (store) => {
        const saved =
          id === undefined
            ? await store.create(fields)
            : await store.update(id, fields);
        return saved
          ? SaveSavedRequestResultSchema.parse({ ok: true, ...saved })
          : { ok: false, message: 'That saved request no longer exists' };
      });
    },
  );

  ipcMain.handle(
    channels.deleteSavedRequest,
    async (_event, raw: unknown): Promise<MutationResult> => {
      const id = IdSchema.safeParse(raw);
      if (!id.success) return { ok: false, message: z.prettifyError(id.error) };
      return withSaved(async (store) => {
        await store.delete(id.data);
        return { ok: true };
      });
    },
  );

  ipcMain.handle(channels.cancel, (_event, raw: unknown): void => {
    const { clientRequestId } = CancelInputSchema.parse({
      clientRequestId: raw,
    });
    controllers.get(clientRequestId)?.abort();
  });

  // A database that drops between heartbeats makes the query fail; that becomes a message, not a
  // rejected invoke (review #3).
  ipcMain.handle(channels.listCalls, async (): Promise<ListCallsResult> => {
    const database = db();
    if (!database || dbStatus().status !== 'up') return { ok: true, calls: [] };
    try {
      const calls = await storeFor(database).listCalls(
        HISTORY_LIMIT,
        inFlightSendIds,
      );
      return ListCallsResultSchema.parse({
        ok: true,
        calls: calls.map(toView),
      });
    } catch (error) {
      return { ok: false, message: message(error) };
    }
  });

  ipcMain.handle(
    channels.dbStatus,
    (): DbStatusView => DbStatusViewSchema.parse(dbStatus()),
  );
}

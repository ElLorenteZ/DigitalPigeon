// IPC handlers: validate input with the contract, call the core, validate output.
// The only Electron-facing code that touches sending and storage (AGENTS.md).
// Handlers return results rather than rejecting, so the renderer always has something to show.
import type { IpcMain } from 'electron';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { CompletionDoc } from '../core/call-schema';
import { type Call, createCallStore } from '../core/call-store';
import {
  CallNotReplayableError,
  DatabaseUnavailableError,
  type RecordedCall,
  ResponseNotRecordedError,
  type SendOptions,
  replayCall,
  sendAndRecord,
} from '../core/send';
import { InvalidHeaderError } from '../core/wire';
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
const plainBytes = (completion: CompletionDoc): CompletionDoc =>
  'response' in completion
    ? {
        ...completion,
        response: {
          ...completion.response,
          body: new Uint8Array(completion.response.body),
        },
      }
    : completion;

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

// An opened call keeps its body. getCall always reads with bodies; plainBytes keeps the contract.
const toDetail = (call: Call): unknown =>
  call.state === 'unreadable' || !call.completion
    ? call
    : { ...call, completion: plainBytes(call.completion as CompletionDoc) };

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
        send: call.send,
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
        error instanceof CallNotReplayableError
      ) {
        return {
          ok: false,
          error: { kind: 'invalid-input', message: error.message },
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
      const { clientRequestId, ...input } = parsed.data;
      return recorded(clientRequestId, (database, options) =>
        sendAndRecord(storeFor(database), input, options),
      );
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

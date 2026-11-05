// IPC handlers: validate input with the contract, call the core, validate output.
// The only Electron-facing code that touches sending and storage (AGENTS.md).
// Handlers return results rather than rejecting, so the renderer always has something to show.
import type { IpcMain } from 'electron';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { CompletionDoc } from '../core/call-schema';
import { type Call, createCallStore } from '../core/call-store';
import {
  DatabaseUnavailableError,
  ResponseNotRecordedError,
  sendAndRecord,
} from '../core/send';
import {
  type CallView,
  CancelInputSchema,
  type DbStatusView,
  DbStatusViewSchema,
  type ListCallsResult,
  ListCallsResultSchema,
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

  ipcMain.handle(
    channels.send,
    async (_event, raw: unknown): Promise<SendResult> => {
      const parsed = SendInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            kind: 'invalid-input',
            message: z.prettifyError(parsed.error),
          },
        };
      }
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

      const { clientRequestId, ...input } = parsed.data;
      const controller = new AbortController();
      controllers.set(clientRequestId, controller);
      let sendId: string | undefined;
      try {
        const call = await sendAndRecord(storeFor(database), input, {
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

// The IPC contract between renderer and main (test-strategy.md T2.1: the compiler checks both sides
// against these types; main validates every message with these schemas at runtime).
// Bodies are Uint8Array: the sandboxed renderer has no Node Buffer.
import { z } from 'zod';
import {
  CompletionDocSchema,
  CompletionSummarySchema,
  SendDocSchema,
} from '../core/call-schema';

export const channels = {
  send: 'pigeon:send',
  cancel: 'pigeon:cancel',
  listCalls: 'pigeon:list-calls',
  dbStatus: 'pigeon:db-status',
} as const;

export const METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

const RowsSchema = z.array(z.tuple([z.string(), z.string()]));

export const SendInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
  method: z.enum(METHODS),
  url: z.url({ protocol: /^https?$/ }),
  queryRows: RowsSchema,
  headerRows: RowsSchema,
});
export type SendInput = z.infer<typeof SendInputSchema>;

export const CancelInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
});

/** A history row. Completions are summaries: no response body (review #9). */
export const CallViewSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum(['completed', 'in-flight', 'interrupted']),
    send: SendDocSchema,
    completion: CompletionSummarySchema.nullable(),
  }),
  z.strictObject({
    state: z.literal('unreadable'),
    id: z.string(),
    error: z.string(),
  }),
]);
export type CallView = z.infer<typeof CallViewSchema>;

export const ListCallsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), calls: z.array(CallViewSchema) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ListCallsResult = z.infer<typeof ListCallsResultSchema>;

/** The outcome of one send, with the full completion (including the body) for display. */
export const SendResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    send: SendDocSchema,
    completion: CompletionDocSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      kind: z.enum([
        'database-unavailable',
        'not-recorded',
        'invalid-input',
        'unexpected',
      ]),
      message: z.string(),
    }),
    /** Present for `not-recorded`: the response that arrived but could not be stored. */
    completion: CompletionDocSchema.optional(),
  }),
]);
export type SendResult = z.infer<typeof SendResultSchema>;

export const DbStatusViewSchema = z.strictObject({
  status: z.enum(['connecting', 'up', 'down', 'not-configured']),
  configPath: z.string(),
  database: z.string().optional(),
  detail: z.string().optional(),
});
export type DbStatusView = z.infer<typeof DbStatusViewSchema>;

/** The API preload exposes on `window.pigeon`. */
export interface PigeonApi {
  send: (input: SendInput) => Promise<SendResult>;
  cancel: (clientRequestId: string) => Promise<void>;
  listCalls: () => Promise<ListCallsResult>;
  dbStatus: () => Promise<DbStatusView>;
}

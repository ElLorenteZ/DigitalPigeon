// The IPC contract between renderer and main (test-strategy.md T2.1: the compiler checks both sides
// against these types; main validates every message with these schemas at runtime).
// Bodies are Uint8Array: the sandboxed renderer has no Node Buffer.
import { z } from 'zod';
import {
  CompletionDocSchema,
  CompletionSummarySchema,
  SendDocSchema,
  SendSummarySchema,
} from '../core/call-schema';

export const channels = {
  send: 'pigeon:send',
  cancel: 'pigeon:cancel',
  listCalls: 'pigeon:list-calls',
  dbStatus: 'pigeon:db-status',
  getCall: 'pigeon:get-call',
  replay: 'pigeon:replay',
  readBody: 'pigeon:read-body',
  describeBody: 'pigeon:describe-body',
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

const BodyInputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({
    type: z.enum(['json', 'xml', 'text']),
    text: z.string(),
  }),
  z.strictObject({ type: z.literal('form'), rows: RowsSchema }),
  z.strictObject({
    type: z.literal('multipart'),
    parts: z.array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('field'),
          name: z.string(),
          value: z.string(),
        }),
        z.strictObject({
          kind: z.literal('file'),
          name: z.string(),
          filename: z.string(),
          contentType: z.string(),
          // Arrives in main as a plain Uint8Array, not a Buffer (spike-file-input-ipc.md).
          bytes: z.instanceof(Uint8Array),
        }),
      ]),
    ),
    boundary: z.string().optional(),
  }),
]);

export const SendInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
  method: z.enum(METHODS),
  url: z.url({ protocol: /^https?$/ }),
  queryRows: RowsSchema,
  headerRows: RowsSchema,
  body: BodyInputSchema.optional(),
});
export type SendInput = z.infer<typeof SendInputSchema>;

export const CancelInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
});

export const ReplayInputSchema = z.strictObject({
  clientRequestId: z.string().min(1),
  sendId: z.string().min(1),
});
export type ReplayInput = z.infer<typeof ReplayInputSchema>;

export const GetCallInputSchema = z.string().min(1);

/** The most one readBody call returns: the display page, equal to the inline limit (plan.md). */
export const BODY_PAGE_BYTES = 1024 * 1024;

export const ReadBodyInputSchema = z.strictObject({
  fileId: z.string().min(1),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive().max(BODY_PAGE_BYTES),
});
export type ReadBodyInput = z.infer<typeof ReadBodyInputSchema>;

export const ReadBodyResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), bytes: z.instanceof(Uint8Array) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ReadBodyResult = z.infer<typeof ReadBodyResultSchema>;

export const DescribeBodyInputSchema = z.strictObject({
  fileId: z.string().min(1),
  boundary: z.string().min(1),
});
export type DescribeBodyInput = z.infer<typeof DescribeBodyInputSchema>;

/** The parts of a stored multipart body, without their content (plan.md, phase 6). */
export const DescribeBodyResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    parts: z.array(
      z.strictObject({
        name: z.string(),
        filename: z.string().optional(),
        contentType: z.string().optional(),
        offset: z.number().int().nonnegative(),
        length: z.number().int().nonnegative(),
      }),
    ),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type DescribeBodyResult = z.infer<typeof DescribeBodyResultSchema>;

/** A history row. Sends and completions are summaries: no body (review #9). */
export const CallViewSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum(['completed', 'in-flight', 'interrupted']),
    send: SendSummarySchema,
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

/** One opened call, with the full completion including the response body. */
export const CallDetailSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum(['completed', 'in-flight', 'interrupted']),
    send: SendDocSchema,
    completion: CompletionDocSchema.nullable(),
  }),
  z.strictObject({
    state: z.literal('unreadable'),
    id: z.string(),
    error: z.string(),
  }),
]);
export type CallDetail = z.infer<typeof CallDetailSchema>;

export const GetCallResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), call: CallDetailSchema.nullable() }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type GetCallResult = z.infer<typeof GetCallResultSchema>;

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
        'cancelled',
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
  getCall: (sendId: string) => Promise<GetCallResult>;
  replay: (input: ReplayInput) => Promise<SendResult>;
  readBody: (input: ReadBodyInput) => Promise<ReadBodyResult>;
  describeBody: (input: DescribeBodyInput) => Promise<DescribeBodyResult>;
}

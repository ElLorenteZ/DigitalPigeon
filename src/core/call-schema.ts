// Call documents. A call is two insert-only documents: a send document written before the request
// goes on the wire, and a completion document written when it finishes (plan.md, Approach).
// Every document read from or written to MongoDB is parsed with these schemas (tech-stack.md).
import { z } from 'zod';

const HeaderListSchema = z.array(z.tuple([z.string(), z.string()]));

/** A body over the inline limit, in the `bodies` GridFS bucket (plan.md, Approach). */
export const StoredFileSchema = z.strictObject({
  fileId: z.string().min(1),
  length: z.number().int().positive(),
});
export type StoredFile = z.infer<typeof StoredFileSchema>;

/** Bytes in the document, or a reference to a file. Every reader handles both. */
const StoredBodySchema = z.union([z.instanceof(Uint8Array), StoredFileSchema]);
export type StoredBody = z.infer<typeof StoredBodySchema>;

const sendBase = {
  _id: z.string().min(1),
  schemaVersion: z.literal(1),
  sentAt: z.date(),
};
const requestBase = {
  method: z.string().min(1),
  url: z.string().min(1),
  /** Exactly as written on the wire, in order (plan.md, wire contract). */
  headers: HeaderListSchema,
};

export const SendDocSchema = z.strictObject({
  ...sendBase,
  request: z.strictObject({
    ...requestBase,
    /** What was sent; `null` for no body. A document written before bodies existed holds `null`. */
    body: StoredBodySchema.nullable(),
  }),
});

/** A send as listed in history: the request without its body (review #9, send-and-record). */
export const SendSummarySchema = z.strictObject({
  ...sendBase,
  request: z.strictObject(requestBase),
});

const completionBase = {
  _id: z.string().min(1),
  schemaVersion: z.literal(1),
  sendId: z.string().min(1),
  completedAt: z.date(),
  durationMs: z.number().nonnegative(),
};

const CompletionErrorSchema = z.strictObject({
  code: z.enum([
    'timeout',
    'cancelled',
    'network',
    'invalid-request',
    'storage',
  ]),
  message: z.string(),
});
export type CompletionError = z.infer<typeof CompletionErrorSchema>;

export const CompletionDocSchema = z.union([
  z.strictObject({
    ...completionBase,
    response: z.strictObject({
      status: z.number().int(),
      /** As undici reports them: lowercased names. */
      headers: HeaderListSchema,
      body: StoredBodySchema,
    }),
  }),
  z.strictObject({
    ...completionBase,
    error: CompletionErrorSchema,
  }),
]);

export type SendDoc = z.infer<typeof SendDocSchema>;
export type SendSummary = z.infer<typeof SendSummarySchema>;
export type CompletionDoc = z.infer<typeof CompletionDocSchema>;

/** A completion as listed in history: the response without its body (review #9, send-and-record). */
export const CompletionSummarySchema = z.union([
  z.strictObject({
    ...completionBase,
    response: z.strictObject({
      status: z.number().int(),
      headers: HeaderListSchema,
    }),
  }),
  z.strictObject({
    ...completionBase,
    error: CompletionErrorSchema,
  }),
]);
export type CompletionSummary = z.infer<typeof CompletionSummarySchema>;

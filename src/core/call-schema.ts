// Call documents. A call is two insert-only documents: a send document written before the request
// goes on the wire, and a completion document written when it finishes (plan.md, Approach).
// Every document read from or written to MongoDB is parsed with these schemas (tech-stack.md).
import { z } from 'zod';

const HeaderListSchema = z.array(z.tuple([z.string(), z.string()]));

export const SendDocSchema = z.strictObject({
  _id: z.string().min(1),
  schemaVersion: z.literal(1),
  sentAt: z.date(),
  request: z.strictObject({
    method: z.string().min(1),
    url: z.string().min(1),
    /** Exactly as written on the wire, in order (plan.md, wire contract). */
    headers: HeaderListSchema,
    body: z.null(),
  }),
});

const completionBase = {
  _id: z.string().min(1),
  schemaVersion: z.literal(1),
  sendId: z.string().min(1),
  completedAt: z.date(),
  durationMs: z.number().nonnegative(),
};

export const CompletionDocSchema = z.union([
  z.strictObject({
    ...completionBase,
    response: z.strictObject({
      status: z.number().int(),
      /** As undici reports them: lowercased names. */
      headers: HeaderListSchema,
      body: z.instanceof(Uint8Array),
    }),
  }),
  z.strictObject({
    ...completionBase,
    error: z.strictObject({
      code: z.enum(['timeout', 'cancelled', 'network', 'invalid-request']),
      message: z.string(),
    }),
  }),
]);

export type SendDoc = z.infer<typeof SendDocSchema>;
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
    error: z.strictObject({
      code: z.enum(['timeout', 'cancelled', 'network', 'invalid-request']),
      message: z.string(),
    }),
  }),
]);
export type CompletionSummary = z.infer<typeof CompletionSummarySchema>;

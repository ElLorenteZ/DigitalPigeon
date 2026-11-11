// Saved requests: the form's content under a name, editable and deletable, in one flat list (ADR 0001; plan.md,
// phase 3). Separate from the insert-only call collections: nothing here writes a send or a completion (T1.1).
// Body text and file bytes stay in the document while their total is at most 1 MiB; the rest go to the `bodies`
// bucket, as call bodies do, so a document stays far below MongoDB's 16 MB. Saving over a request or deleting it
// leaves its files in the bucket for slice 7 to find (plan.md, Out of scope).
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { INLINE_BODY_LIMIT, createBodyStore } from './body-store';
import { StoredFileSchema } from './call-schema';
import type { BodyInput, WireInput } from './wire';

export class InvalidSavedRequestError extends Error {}

export interface SavedRequest {
  id: string;
  name: string;
  request: WireInput;
}

export interface SavedRequestListing {
  id: string;
  name: string;
  method: string;
  url: string;
}

const RowsSchema = z.array(z.tuple([z.string(), z.string()]));
/** Bytes in the document, or a reference to a file in the `bodies` bucket. */
const ContentSchema = z.union([z.instanceof(Uint8Array), StoredFileSchema]);
type Content = z.infer<typeof ContentSchema>;

const SavedBodySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({
    type: z.enum(['json', 'xml', 'text']),
    /** The text as UTF-8. */
    text: ContentSchema,
  }),
  z.strictObject({ type: z.literal('form'), rows: RowsSchema }),
  z.strictObject({
    type: z.literal('multipart'),
    boundary: z.string().optional(),
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
          bytes: ContentSchema,
        }),
      ]),
    ),
  }),
]);
type SavedBody = z.infer<typeof SavedBodySchema>;

const SavedRequestDocSchema = z.strictObject({
  _id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  request: z.strictObject({
    method: z.string().min(1),
    url: z.string(),
    queryRows: RowsSchema,
    headerRows: RowsSchema,
    body: SavedBodySchema.optional(),
  }),
  updatedAt: z.date(),
});
type SavedRequestDoc = z.infer<typeof SavedRequestDocSchema>;

const checkedName = (name: string) => {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new InvalidSavedRequestError('Give the saved request a name');
  }
  return trimmed;
};

export function createSavedRequestStore(db: Db) {
  const saved = db.collection<SavedRequestDoc>('savedRequests');
  const bodies = createBodyStore(db);

  // Writes content in order, inline while the document's total stays within the limit.
  const storer = () => {
    let inline = 0;
    return async (bytes: Uint8Array<ArrayBuffer>): Promise<Content> => {
      if (inline + bytes.length <= INLINE_BODY_LIMIT) {
        inline += bytes.length;
        return bytes;
      }
      return bodies.writeBytes(bytes);
    };
  };

  const storedBody = async (body: BodyInput): Promise<SavedBody> => {
    const store = storer();
    switch (body.type) {
      case 'none':
      case 'form':
        return body;
      case 'json':
      case 'xml':
      case 'text':
        return {
          type: body.type,
          text: await store(new TextEncoder().encode(body.text)),
        };
      case 'multipart': {
        const parts: Extract<SavedBody, { type: 'multipart' }>['parts'] = [];
        for (const part of body.parts) {
          parts.push(
            part.kind === 'field'
              ? part
              : { ...part, bytes: await store(part.bytes) },
          );
        }
        return {
          type: 'multipart',
          ...(body.boundary === undefined ? {} : { boundary: body.boundary }),
          parts,
        };
      }
    }
  };

  // A copy, so the driver's Buffer is not handed on: the renderer has no Buffer (ipc-contract.ts).
  const bytesOf = async (content: Content): Promise<Uint8Array<ArrayBuffer>> =>
    'fileId' in content
      ? bodies.readAll(content)
      : new Uint8Array(content as Uint8Array);

  const loadedBody = async (body: SavedBody): Promise<BodyInput> => {
    switch (body.type) {
      case 'none':
      case 'form':
        return body;
      case 'json':
      case 'xml':
      case 'text':
        return {
          type: body.type,
          text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
            await bytesOf(body.text),
          ),
        };
      case 'multipart': {
        const parts = [];
        for (const part of body.parts) {
          parts.push(
            part.kind === 'field'
              ? part
              : { ...part, bytes: await bytesOf(part.bytes) },
          );
        }
        return {
          type: 'multipart',
          ...(body.boundary === undefined ? {} : { boundary: body.boundary }),
          parts,
        };
      }
    }
  };

  const storedRequest = async ({
    method,
    url,
    queryRows,
    headerRows,
    body,
  }: WireInput): Promise<SavedRequestDoc['request']> => ({
    method,
    url,
    queryRows,
    headerRows,
    ...(body ? { body: await storedBody(body) } : {}),
  });

  return {
    /** By name; entries sharing a name keep the order of their URL. */
    list: async (): Promise<SavedRequestListing[]> =>
      (
        await saved
          .find(
            {},
            { projection: { name: 1, 'request.method': 1, 'request.url': 1 } },
          )
          .sort({ name: 1, 'request.url': 1 })
          .toArray()
      ).map((doc) => ({
        id: doc._id,
        name: doc.name,
        method: doc.request.method,
        url: doc.request.url,
      })),

    get: async (id: string): Promise<SavedRequest | null> => {
      const raw = await saved.findOne({ _id: id }, { promoteBuffers: true });
      if (!raw) return null;
      const doc = SavedRequestDocSchema.parse(raw);
      const { body, ...request } = doc.request;
      return {
        id: doc._id,
        name: doc.name,
        request: {
          ...request,
          ...(body ? { body: await loadedBody(body) } : {}),
        },
      };
    },

    create: async (input: { name: string; request: WireInput }) => {
      const name = checkedName(input.name);
      const doc = SavedRequestDocSchema.parse({
        _id: randomUUID(),
        schemaVersion: 1,
        name,
        request: await storedRequest(input.request),
        updatedAt: new Date(),
      });
      await saved.insertOne(doc);
      return { id: doc._id, name };
    },

    update: async (
      id: string,
      input: { name: string; request: WireInput },
    ): Promise<{ id: string; name: string } | null> => {
      const name = checkedName(input.name);
      if (!(await saved.findOne({ _id: id }, { projection: { _id: 1 } }))) {
        return null;
      }
      const request = SavedRequestDocSchema.shape.request.parse(
        await storedRequest(input.request),
      );
      const { matchedCount } = await saved.updateOne(
        { _id: id },
        { $set: { name, request, updatedAt: new Date() } },
      );
      return matchedCount === 1 ? { id, name } : null;
    },

    /** Whether it still exists, without reading its content. */
    exists: async (id: string): Promise<boolean> =>
      (await saved.findOne({ _id: id }, { projection: { _id: 1 } })) !== null,

    delete: async (id: string): Promise<boolean> =>
      (await saved.deleteOne({ _id: id })).deletedCount === 1,
  };
}

// Files for bodies over the inline limit, in the `bodies` GridFS bucket (spike-gridfs-streaming.md).
// Writes and range reads only. The one removal is abort(), of an upload not finished: a finished
// file does not change (PRD; test-strategy.md T1.1).
import { randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import {
  type Db,
  GridFSBucket,
  MongoGridFSChunkError,
  type ObjectId,
} from 'mongodb';
import type { StoredFile } from './call-schema';

/** A body up to this size stays in its document. It equals the display page (plan.md). */
export const INLINE_BODY_LIMIT = 1024 * 1024;

// The driver inserts one chunk per 255 KiB; a write this size waits for at most one insert.
const WRITE_PIECE = 255 * 1024;

export class BodyFileMissingError extends Error {
  constructor(readonly fileId: string) {
    super(`The stored body ${fileId} is missing`);
  }
}

export interface BodyUpload {
  /** Resolves when the bytes are accepted, so the caller's reads wait for the database. */
  write: (bytes: Uint8Array, signal?: AbortSignal) => Promise<void>;
  finish: () => Promise<StoredFile>;
  /** Removes what was written. Never rejects: the failure that led here is the one to report. */
  abort: () => Promise<void>;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const whole = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    whole.set(part, offset);
    offset += part.length;
  }
  return whole;
}

// The driver types GridFS ids as ObjectId and accepts any value; a string matches the other ids here.
const asId = (fileId: string) => fileId as unknown as ObjectId;

export function createBodyStore(db: Db) {
  const bucket = new GridFSBucket(db, { bucketName: 'bodies' });

  const openUpload = (): BodyUpload => {
    const fileId = randomUUID();
    const stream = bucket.openUploadStreamWithId(asId(fileId), fileId);
    // Before the first write: an 'error' with no listener crashes the process.
    stream.on('error', () => {});
    let length = 0;
    let ending = false;
    let finishedFile = false;

    return {
      write: async (bytes, signal) => {
        for (let at = 0; at < bytes.length; at += WRITE_PIECE) {
          signal?.throwIfAborted();
          const piece = bytes.subarray(at, at + WRITE_PIECE);
          await new Promise<void>((resolve, reject) => {
            stream.write(piece, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          length += piece.length;
        }
      },
      finish: async () => {
        ending = true;
        stream.end();
        await finished(stream);
        finishedFile = true;
        return { fileId, length };
      },
      abort: async () => {
        if (finishedFile) return;
        // The driver's abort() refuses a stream already ended, and leaves its chunks.
        await (
          ending
            ? db.collection('bodies.chunks').deleteMany({ files_id: fileId })
            : stream.abort()
        ).catch(() => {});
      },
    };
  };

  const readRange = async (
    {
      fileId,
      offset,
      length,
    }: {
      fileId: string;
      offset: number;
      length: number;
    },
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> => {
    const [file] = await bucket
      .find({ _id: asId(fileId) })
      .limit(1)
      .toArray();
    if (!file) throw new BodyFileMissingError(fileId);
    // The driver refuses an end past the file (spike-gridfs-streaming.md).
    const end = Math.min(offset + length, file.length);
    if (offset >= end) return new Uint8Array();

    const parts: Uint8Array[] = [];
    try {
      for await (const part of bucket.openDownloadStream(asId(fileId), {
        start: offset,
        end,
      })) {
        signal?.throwIfAborted();
        parts.push(part as Uint8Array);
      }
    } catch (error) {
      if (error instanceof MongoGridFSChunkError) {
        throw new BodyFileMissingError(fileId);
      }
      throw error;
    }
    const bytes = concatBytes(parts);
    // Chunks removed from under a file document read as a short stream, with no error.
    if (bytes.length !== end - offset) throw new BodyFileMissingError(fileId);
    return bytes;
  };

  return {
    openUpload,
    readRange,

    writeBytes: async (
      bytes: Uint8Array,
      signal?: AbortSignal,
    ): Promise<StoredFile> => {
      const upload = openUpload();
      try {
        await upload.write(bytes, signal);
        return await upload.finish();
      } catch (error) {
        await upload.abort();
        throw error;
      }
    },

    /** The whole file, checked against the reference a document holds. */
    readAll: async (
      { fileId, length }: StoredFile,
      signal?: AbortSignal,
    ): Promise<Uint8Array<ArrayBuffer>> => {
      const bytes = await readRange({ fileId, offset: 0, length }, signal);
      if (bytes.length !== length) throw new BodyFileMissingError(fileId);
      return bytes;
    },
  };
}

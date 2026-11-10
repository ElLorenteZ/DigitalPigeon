// multipart/form-data bodies (plan.md, phase 1). Encoded as browsers encode them (WHATWG HTML,
// "multipart/form-data encoding algorithm"): names and filenames as UTF-8 with `"`, CR and LF
// percent-escaped; values and file bytes unchanged. Pure, and free of Node and DOM APIs other than
// globalThis.crypto, so the renderer imports it too (app.tsx builds a wire request for Copy as curl).
export type Part =
  | { kind: 'field'; name: string; value: string }
  | {
      kind: 'file';
      name: string;
      filename: string;
      contentType: string;
      bytes: Uint8Array<ArrayBuffer>;
    };

const utf8 = (text: string) => new TextEncoder().encode(text);

// body-store.ts has the same helper, but imports the mongodb driver, which the renderer cannot load.
function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const whole = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    whole.set(part, offset);
    offset += part.length;
  }
  return whole;
}

const escaped = (text: string) =>
  text.replaceAll('"', '%22').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

function partHead(part: Part): string {
  const disposition = `Content-Disposition: form-data; name="${escaped(part.name)}"`;
  if (part.kind === 'field') return `${disposition}\r\n\r\n`;
  return (
    `${disposition}; filename="${escaped(part.filename)}"\r\n` +
    `Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`
  );
}

const content = (part: Part): Uint8Array =>
  part.kind === 'field' ? utf8(part.value) : part.bytes;

export function encodeMultipart(
  parts: readonly Part[],
  boundary: string,
): Uint8Array<ArrayBuffer> {
  const pieces: Uint8Array[] = [];
  for (const part of parts) {
    pieces.push(utf8(`--${boundary}\r\n${partHead(part)}`));
    pieces.push(content(part));
    pieces.push(utf8('\r\n'));
  }
  pieces.push(utf8(`--${boundary}--\r\n`));
  return concatBytes(pieces);
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function drawBoundary(): string {
  const random = globalThis.crypto.getRandomValues(new Uint8Array(30));
  // 36 does not divide 256, so the first characters are slightly more likely. A boundary needs to be
  // absent from the body, not uniform; the check below makes absence hold.
  return `----dp${[...random].map((n) => ALPHABET[n % 36]).join('')}`;
}

/** True when the boundary occurs in a part: in its name, filename, value or bytes. */
export function boundaryOccursIn(
  parts: readonly Part[],
  boundary: string,
): boolean {
  const needle = utf8(boundary);
  return parts.some(
    (part) =>
      indexOfBytes(utf8(partHead(part)), needle) !== -1 ||
      indexOfBytes(content(part), needle) !== -1,
  );
}

/** A boundary that occurs in no part. */
export function chooseBoundary(
  parts: readonly Part[],
  draw: () => string = drawBoundary,
): string {
  for (;;) {
    const boundary = draw();
    if (!boundaryOccursIn(parts, boundary)) return boundary;
  }
}

export class MultipartScanError extends Error {}

export interface PartSummary {
  name: string;
  filename?: string;
  contentType?: string;
  /** Where the part's content starts in the body, in bytes. */
  offset: number;
  length: number;
}

/** The boundary a `multipart/form-data` Content-Type names, or undefined for any other value. */
export function multipartBoundary(contentType: string): string | undefined {
  const [type = '', ...params] = contentType.split(';');
  if (type.trim().toLowerCase() !== 'multipart/form-data') return undefined;
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== 'boundary') {
      continue;
    }
    let value = param.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value === '' ? undefined : value;
  }
  return undefined;
}

const CR = 13;
const LF = 10;
const DASH = 45;
// A part head longer than this is not one this app wrote, and holding it unbounded would defeat paging.
const MAX_HEAD = 16 * 1024;

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  const first = needle[0] ?? 0;
  outer: for (
    let at = haystack.indexOf(first);
    at !== -1 && at <= haystack.length - needle.length;
    at = haystack.indexOf(first, at + 1)
  ) {
    for (let i = 1; i < needle.length; i++) {
      if (haystack[at + i] !== needle[i]) continue outer;
    }
    return at;
  }
  return -1;
}

type Head = Omit<PartSummary, 'offset' | 'length'>;

// Reads the head this app's encoder writes: Content-Disposition: form-data with a quoted name and an
// optional quoted filename, then an optional Content-Type. Escapes are kept as written (%22, %0D, %0A),
// so encoding the result again gives the same bytes.
function parseHead(text: string): Head {
  let disposition: string | undefined;
  let contentType: string | undefined;
  for (const line of text.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1)
      throw new MultipartScanError(`A part header has no colon: ${line}`);
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'content-disposition') disposition = value;
    else if (name === 'content-type') contentType = value;
  }
  if (disposition === undefined) {
    throw new MultipartScanError('A part has no Content-Disposition');
  }
  const [type = '', ...rest] = disposition.split(';');
  if (type.trim().toLowerCase() !== 'form-data') {
    throw new MultipartScanError(`A part is ${type.trim()}, not form-data`);
  }
  const params = new Map<string, string>();
  for (const match of rest.join(';').matchAll(/\s*([^=\s;]+)="([^"]*)"/g)) {
    params.set((match[1] ?? '').toLowerCase(), match[2] ?? '');
  }
  const name = params.get('name');
  if (name === undefined) throw new MultipartScanError('A part has no name');
  const filename = params.get('filename');
  return {
    name,
    ...(filename === undefined ? {} : { filename }),
    ...(contentType === undefined ? {} : { contentType }),
  };
}

/**
 * Reads part summaries from a body given a page at a time. Holds at most one page plus a delimiter's
 * length between pushes, so a stored body of any size can be listed (plan.md, phase 4).
 */
export function createPartScanner(boundary: string) {
  const opening = utf8(`--${boundary}`);
  const delimiter = utf8(`\r\n--${boundary}`);
  const headEnd = utf8('\r\n\r\n');
  let state: 'start' | 'after' | 'head' | 'content' | 'done' = 'start';
  let held: Uint8Array = new Uint8Array();
  let heldAt = 0; // offset in the body of held[0]
  let current: Head | undefined;
  let contentAt = 0;

  const consume = (count: number) => {
    held = held.subarray(count);
    heldAt += count;
  };

  return {
    push(page: Uint8Array): PartSummary[] {
      held = concatBytes([held, page]);
      const closed: PartSummary[] = [];
      for (;;) {
        if (state === 'start') {
          if (held.length < opening.length) break;
          if (indexOfBytes(held.subarray(0, opening.length), opening) !== 0) {
            throw new MultipartScanError(
              'The body does not start with its boundary',
            );
          }
          consume(opening.length);
          state = 'after';
        } else if (state === 'after') {
          if (held.length < 2) break;
          if (held[0] === CR && held[1] === LF) state = 'head';
          else if (held[0] === DASH && held[1] === DASH) state = 'done';
          else
            throw new MultipartScanError(
              'A boundary is followed by neither a line break nor --',
            );
          consume(2);
        } else if (state === 'head') {
          const end = indexOfBytes(held, headEnd);
          if (end === -1) {
            if (held.length > MAX_HEAD)
              throw new MultipartScanError('A part head is too long');
            break;
          }
          current = parseHead(new TextDecoder().decode(held.subarray(0, end)));
          consume(end + headEnd.length);
          contentAt = heldAt;
          state = 'content';
        } else if (state === 'content') {
          const end = indexOfBytes(held, delimiter);
          if (end === -1) {
            // Keep what could be the start of a delimiter split across pages.
            consume(Math.max(0, held.length - (delimiter.length - 1)));
            break;
          }
          closed.push({
            ...(current as Head),
            offset: contentAt,
            length: heldAt + end - contentAt,
          });
          consume(end + delimiter.length);
          state = 'after';
        } else {
          // The epilogue after the close delimiter is not part of any part.
          consume(held.length);
          break;
        }
      }
      // A copy, so a page the caller reuses is not held.
      held = held.slice();
      return closed;
    },
    end(): PartSummary[] {
      if (state !== 'done')
        throw new MultipartScanError(
          'The body ends before its close delimiter',
        );
      return [];
    },
    held: () => held.length,
  };
}

/** The parts of a whole body. Throws MultipartScanError for a body the scanner cannot read. */
export function parseMultipart(body: Uint8Array, boundary: string): Part[] {
  const scanner = createPartScanner(boundary);
  const summaries = [...scanner.push(body), ...scanner.end()];
  return summaries.map(({ name, filename, contentType, offset, length }) => {
    const content = body.slice(offset, offset + length);
    return filename === undefined
      ? { kind: 'field', name, value: new TextDecoder().decode(content) }
      : {
          kind: 'file',
          name,
          filename,
          contentType: contentType ?? '',
          bytes: content,
        };
  });
}

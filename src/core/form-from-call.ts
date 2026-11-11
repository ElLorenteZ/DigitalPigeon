// Turns a recorded request into form input for edit-and-send. Generated headers are left out when they
// equal what wire.ts generates, and kept as rows when they differ, such as a typed Host (plan.md).
// Pure: the renderer imports this.
import type { EnvironmentSnapshot, StoredBody } from './call-schema';
import { pathFor } from './url';
import {
  MultipartScanError,
  type Part,
  encodeMultipart,
  multipartBoundary,
  parseMultipart,
} from './multipart';
import {
  type BodyInput,
  GENERATED_CONTENT_TYPE,
  METHODS_WITH_LENGTH,
  type WireInput,
  type WireRequest,
} from './wire';

type BodyType = keyof typeof GENERATED_CONTENT_TYPE;
const TYPE_OF_CONTENT_TYPE = new Map(
  (Object.entries(GENERATED_CONTENT_TYPE) as [BodyType, string][]).map(
    ([type, contentType]) => [contentType, type],
  ),
);

// ignoreBOM keeps a byte order mark, which encoding again must reproduce.
const decoded = (bytes: Uint8Array) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

// Rows only when they send the same bytes: `%20` comes back as `+`, the form drops a row with a blank name,
// and an <input> strips line breaks.
function formRows(text: string): [string, string][] | null {
  const rows = [...new URLSearchParams(text)];
  return new URLSearchParams(rows).toString() === text &&
    rows.every(
      ([name, value]) => name.trim() !== '' && !/[\r\n]/.test(name + value),
    )
    ? rows
    : null;
}

function loadedBody(
  bytes: Uint8Array,
  contentType: string | undefined,
): BodyInput {
  const text = decoded(bytes);
  const type = contentType && TYPE_OF_CONTENT_TYPE.get(contentType);
  if (type === 'form') {
    const rows = formRows(text);
    return rows ? { type, rows } : { type: 'text', text };
  }
  return { type: type || 'text', text };
}

/** A body in a file stays out of the form: the text box would hold all of it in the renderer. */
export class BodyNotLoadableError extends Error {}

type Multipart = { parts: Part[]; boundary: string };

// Parts only when sending them unchanged sends the same bytes: the Content-Type is the one wire.ts
// generates, in its place, and the parts encode back to the recorded body. Otherwise the reason.
function loadedMultipart(
  bytes: Uint8Array,
  contentTypeHeader: [string, string] | undefined,
): Multipart | string {
  const boundary = multipartBoundary(contentTypeHeader?.[1] ?? '');
  if (boundary === undefined) return 'it has no multipart boundary';
  if (
    contentTypeHeader?.[0] !== 'content-type' ||
    contentTypeHeader[1] !== `multipart/form-data; boundary=${boundary}`
  ) {
    return 'its Content-Type was typed, not generated';
  }
  let parts: Part[];
  try {
    parts = parseMultipart(bytes, boundary);
  } catch (error) {
    if (error instanceof MultipartScanError) return error.message;
    throw error;
  }
  // The same rules as form rows (formRows above): a blank name is dropped and an <input> strips line breaks.
  if (parts.some((part) => part.name.trim() === '')) {
    return 'a part has a blank name, which the form drops';
  }
  if (
    parts.some((part) => part.kind === 'field' && /[\r\n]/.test(part.value))
  ) {
    return 'a field value holds a line break, which a row cannot hold';
  }
  const again = encodeMultipart(parts, boundary);
  if (
    again.length !== bytes.length ||
    again.some((byte, i) => byte !== bytes[i])
  ) {
    return 'its parts do not encode back to the recorded bytes';
  }
  return { parts, boundary };
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export interface FormFromCallOptions {
  /** The bytes of a body stored in a file, read by the caller. Only a multipart body loads from them. */
  storedBody?: Uint8Array;
  /** The environment the call recorded. Its baseUrl is taken off the URL, so Edit loads the path (slice 5). */
  environment?: EnvironmentSnapshot;
}

export function formFromCall(
  {
    method,
    url,
    headers,
    body,
  }: Omit<WireRequest, 'body'> & { body: StoredBody | null },
  { storedBody, environment }: FormFromCallOptions = {},
): WireInput {
  const contentTypeHeader = headers.find(
    ([name]) => name.toLowerCase() === 'content-type',
  );
  // wire.ts writes a generated Content-Type second to last.
  const generatedPlace = headers.at(-2);
  const isMultipart =
    multipartBoundary(contentTypeHeader?.[1] ?? '') !== undefined;

  let multipart: Multipart | string | undefined;
  if (body && 'fileId' in body) {
    if (!storedBody || !isMultipart) {
      throw new BodyNotLoadableError(
        `The body is too large to edit: ${(body.length / (1024 * 1024)).toFixed(1)} MiB`,
      );
    }
    multipart = loadedMultipart(storedBody, generatedPlace);
    if (typeof multipart === 'string') {
      throw new BodyNotLoadableError(
        `The multipart body cannot be edited: ${multipart}`,
      );
    }
  } else if (body && isMultipart) {
    multipart = loadedMultipart(body, generatedPlace);
    // The Text fallback holds only bytes that decode as UTF-8; anything else would resend different bytes
    // (code review, 4).
    if (typeof multipart === 'string' && !isUtf8(body)) {
      throw new BodyNotLoadableError(
        `The multipart body cannot be edited: ${multipart}`,
      );
    }
  }

  const loaded: BodyInput =
    multipart && typeof multipart !== 'string'
      ? { type: 'multipart', ...multipart }
      : body && !('fileId' in body)
        ? loadedBody(body, contentTypeHeader?.[1])
        : { type: 'none' };

  // wire.ts writes its Content-Type in lowercase, second to last. A typed one elsewhere keeps its place.
  const generatedContentType =
    loaded.type === 'multipart'
      ? generatedPlace
      : body &&
          loaded.type !== 'none' &&
          generatedPlace?.[0] === 'content-type' &&
          generatedPlace[1] === GENERATED_CONTENT_TYPE[loaded.type]
        ? generatedPlace
        : undefined;

  const generated = (header: [string, string]): boolean => {
    const [name, value] = header;
    switch (name.toLowerCase()) {
      case 'host':
        return value === new URL(url).host;
      case 'connection':
        return value === (method === 'HEAD' ? 'close' : 'keep-alive');
      case 'content-length':
        return body
          ? value === String(body.length)
          : METHODS_WITH_LENGTH.has(method) && value === '0';
      case 'content-type':
        return header === generatedContentType;
      default:
        return false;
    }
  };

  return {
    method,
    // The recorded URL already includes its query string. A call sent against an environment loads its path, so the
    // edited request follows the active environment (plan revision 2, W1).
    url: (environment && pathFor(url, environment)) ?? url,
    queryRows: [],
    headerRows: headers.filter((header) => !generated(header)),
    body: loaded,
  };
}

// Turns a recorded request into form input for edit-and-send. Generated headers are left out when they
// equal what wire.ts generates, and kept as rows when they differ, such as a typed Host (plan.md).
// Pure: the renderer imports this.
import type { StoredBody } from './call-schema';
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

export function formFromCall({
  method,
  url,
  headers,
  body,
}: Omit<WireRequest, 'body'> & { body: StoredBody | null }): WireInput {
  if (body && 'fileId' in body) {
    throw new BodyNotLoadableError(
      `The body is too large to edit: ${(body.length / (1024 * 1024)).toFixed(1)} MiB`,
    );
  }
  const contentTypeHeader = headers.find(
    ([name]) => name.toLowerCase() === 'content-type',
  );
  const loaded: BodyInput = body
    ? loadedBody(body, contentTypeHeader?.[1])
    : { type: 'none' };

  // wire.ts writes its Content-Type in lowercase, second to last. A typed one elsewhere keeps its place.
  const secondToLast = headers.at(-2);
  const generatedContentType =
    body &&
    loaded.type !== 'none' &&
    secondToLast?.[0] === 'content-type' &&
    secondToLast[1] === GENERATED_CONTENT_TYPE[loaded.type]
      ? secondToLast
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
    // The recorded URL already includes its query string.
    url,
    queryRows: [],
    headerRows: headers.filter((header) => !generated(header)),
    body: loaded,
  };
}

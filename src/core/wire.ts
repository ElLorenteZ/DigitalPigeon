// The wire contract (plan.md, Approach): the exact request undici 8.12.3 writes when handed this
// header list. undici writes `host` and `connection` itself in lowercase, adds `content-length: 0`
// to a bodiless POST/PUT/PATCH, forces `connection: close` for HEAD, and writes only `close` or
// `keep-alive` whatever Connection value it is given, so the list is built in that form and the send
// document records it before dispatch. With a body, undici writes `content-length` with the byte count
// last and leaves `connection` alone (spike-undici-bodies.md). T1.3 checks it against the wire.
export interface WireInput {
  method: string;
  url: string;
  queryRows: [string, string][];
  headerRows: [string, string][];
  body?: BodyInput;
}

/** What the form holds. The record holds only the bytes this becomes. */
export type BodyInput =
  | { type: 'none' }
  | { type: 'json' | 'xml' | 'text'; text: string }
  | { type: 'form'; rows: [string, string][] };

export interface WireRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: Uint8Array<ArrayBuffer> | null;
}

export const GENERATED_CONTENT_TYPE = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  form: 'application/x-www-form-urlencoded',
} as const;

/** A header undici would refuse; raised before anything is recorded (plan.md, phase 1). */
export class InvalidHeaderError extends Error {
  constructor(
    readonly header: string,
    reason = 'use printable ASCII with no line breaks',
  ) {
    super(`Invalid header "${header}": ${reason}`);
  }
}

// RFC 9110 token. undici rejects empty names and names with a space, a colon or non-ASCII.
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// Printable ASCII plus tab. undici rejects LF, CR, NUL and DEL, and rejects or re-encodes non-ASCII.
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;

// Only space and tab are HTTP's surrounding whitespace. String.prototype.trim would also strip a
// line feed or a no-break space, hiding input that must be refused.
const trimValue = (value: string) => value.replace(/^[ \t]+|[ \t]+$/g, '');

// undici throws for these names, whatever the value (core/request.js, processHeader). The integration
// tests check this copy against the pinned version.
const REFUSED_NAMES = new Set([
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'expect',
]);

const connectionTokens = (value: string) =>
  value.toLowerCase().split(',').map(trimValue);

/** Returns the header's trimmed value, or throws if undici would refuse it. */
export function checkedHeaderValue(name: string, value: string): string {
  const trimmed = trimValue(value);
  if (!HEADER_NAME.test(name) || !HEADER_VALUE.test(trimmed)) {
    throw new InvalidHeaderError(name);
  }
  const lowerName = name.toLowerCase();
  if (REFUSED_NAMES.has(lowerName)) {
    throw new InvalidHeaderError(
      name,
      'the HTTP client cannot send this header',
    );
  }
  if (
    lowerName === 'connection' &&
    !connectionTokens(trimmed).every((token) => HEADER_NAME.test(token))
  ) {
    throw new InvalidHeaderError(
      name,
      'use a comma-separated list of connection options',
    );
  }
  return trimmed;
}

function checkedRows(rows: [string, string][]): [string, string][] {
  return rows.map(([name, value]) => [name, checkedHeaderValue(name, value)]);
}

/** A request that cannot carry its body; raised before anything is recorded (plan.md, phase 1). */
export class InvalidBodyError extends Error {
  constructor() {
    super('HEAD cannot carry a body: curl cannot export it reliably');
  }
}

// An empty text box and no form rows are no body: identical on the wire (spike-undici-bodies.md).
function encodedBody(
  body: BodyInput | undefined,
): Uint8Array<ArrayBuffer> | null {
  if (!body || body.type === 'none') return null;
  const text =
    body.type === 'form'
      ? new URLSearchParams(body.rows).toString()
      : body.text;
  return text === '' ? null : new TextEncoder().encode(text);
}

export const METHODS_WITH_LENGTH = new Set(['POST', 'PUT', 'PATCH']);
const MANAGED = new Set(['host', 'connection', 'content-length']);

export function buildWireRequest({
  method,
  url,
  queryRows,
  headerRows,
  body,
}: WireInput): WireRequest {
  const bytes = encodedBody(body);
  if (bytes && method === 'HEAD') throw new InvalidBodyError();
  const rows = checkedRows(headerRows);
  const typed = (name: string) =>
    rows.find(([n]) => n.toLowerCase() === name)?.[1];

  const headers: [string, string][] = [
    ['host', typed('host') ?? new URL(url).host],
    // undici always writes `connection: close` for HEAD (probe, phase 2), and for any other method
    // writes `close` only when the typed value lists it (code review).
    [
      'connection',
      method === 'HEAD' ||
      connectionTokens(typed('connection') ?? '').includes('close')
        ? 'close'
        : 'keep-alive',
    ],
    ...rows.filter(([name]) => !MANAGED.has(name.toLowerCase())),
  ];
  if (bytes && body && body.type !== 'none') {
    if (typed('content-type') === undefined) {
      headers.push(['content-type', GENERATED_CONTENT_TYPE[body.type]]);
    }
    headers.push(['content-length', String(bytes.length)]);
  } else if (METHODS_WITH_LENGTH.has(method)) {
    headers.push(['content-length', '0']);
  }

  return { method, url: withQuery(url, queryRows), headers, body: bytes };
}

// The URL as it goes on the wire: query rows appended to the real query string, the fragment
// dropped (it is never sent, and a `?` inside it is not a query separator).
function withQuery(url: string, rows: [string, string][]): string {
  const parsed = new URL(url);
  parsed.hash = '';
  if (rows.length > 0) {
    const query = rows
      .map(
        ([name, value]) =>
          `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
      )
      .join('&');
    parsed.search = parsed.search ? `${parsed.search}&${query}` : `?${query}`;
  }
  return parsed.toString();
}

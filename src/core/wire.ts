// The wire contract (plan.md, Approach): the exact request undici 8.12.3 writes when handed this
// header list. undici writes `host` and `connection` itself in lowercase, adds `content-length: 0`
// to a bodiless POST/PUT/PATCH, and forces `connection: close` for HEAD, so the list is built in
// that form and the send document records it before dispatch. T1.3 checks it against the wire.
export interface WireInput {
  method: string;
  url: string;
  queryRows: [string, string][];
  headerRows: [string, string][];
}

export interface WireRequest {
  method: string;
  url: string;
  headers: [string, string][];
}

const METHODS_WITH_LENGTH = new Set(['POST', 'PUT', 'PATCH']);
const MANAGED = new Set(['host', 'connection', 'content-length']);

export function buildWireRequest({
  method,
  url,
  queryRows,
  headerRows,
}: WireInput): WireRequest {
  const typed = (name: string) =>
    headerRows.find(([n]) => n.toLowerCase() === name)?.[1];

  const headers: [string, string][] = [
    ['host', typed('host') ?? new URL(url).host],
    // undici always writes `connection: close` for HEAD (probe, phase 2).
    [
      'connection',
      method === 'HEAD' ? 'close' : (typed('connection') ?? 'keep-alive'),
    ],
    ...headerRows.filter(([name]) => !MANAGED.has(name.toLowerCase())),
  ];
  if (METHODS_WITH_LENGTH.has(method)) headers.push(['content-length', '0']);

  return { method, url: withQuery(url, queryRows), headers };
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

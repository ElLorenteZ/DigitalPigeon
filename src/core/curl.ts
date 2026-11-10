// A recorded or form request as a shell command that sends the same method, URL and headers
// (spike-curl-export.md; test-strategy T2.4). Pure: the renderer imports this.
// - --globoff: without it `?filter[a]=1` fails and `?a={1,2}` sends two requests.
// - -H 'User-Agent:' -H 'Accept:' suppress curl's own headers; a typed one is still sent.
// - -H 'Name;' sends an empty value; curl treats -H 'Name: ' as removing the header.
// - A user and password in the URL are left out: curl turns them into an Authorization header, and
//   undici sends none.
// A header undici would refuse is refused here too. For a non-ASCII value left by an older version,
// curl would send UTF-8 where undici sent latin1.
import type { StoredBody } from './call-schema';
import { multipartBoundary } from './multipart';
import { type WireRequest, checkedHeaderValue } from './wire';

/** A command over this is refused. ARG_MAX is 1 MiB here and includes the environment (spike-curl-bodies.md). */
export const MAX_COMMAND_BYTES = 900 * 1024;

export class CurlRefusedError extends Error {}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

function withoutUserinfo(url: string): string {
  const parsed = new URL(url);
  if (!parsed.username && !parsed.password) return url;
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

// A multipart body is text only when every file part is: a binary file is the usual reason it is not.
const MULTIPART_REFUSAL = 'A file part holds bytes a shell command cannot hold';

function bodyText(body: Uint8Array, multipart: boolean): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      body,
    );
  } catch {
    throw new CurlRefusedError(
      multipart
        ? MULTIPART_REFUSAL
        : 'The body is not text a shell command can hold',
    );
  }
  if (text.includes('\0')) {
    throw new CurlRefusedError(
      multipart
        ? MULTIPART_REFUSAL
        : 'The body holds a NUL byte, which a shell command cannot hold',
    );
  }
  return text;
}

export function toCurl({
  method,
  url,
  headers,
  body,
}: Omit<WireRequest, 'body'> & { body?: StoredBody | null }): string {
  if (body && 'fileId' in body) {
    throw new CurlRefusedError(
      `The body is too long for a shell command: ${(body.length / (1024 * 1024)).toFixed(1)} MiB`,
    );
  }
  const headerArgs = headers.map(([name, value]) => {
    const checked = checkedHeaderValue(name, value);
    return `-H ${quote(checked === '' ? `${name};` : `${name}: ${checked}`)}`;
  });
  const contentType = headers.find(
    ([name]) => name.toLowerCase() === 'content-type',
  );
  const hasContentType = contentType !== undefined;
  const multipart = multipartBoundary(contentType?.[1] ?? '') !== undefined;

  const command = [
    'curl --http1.1 -sS --globoff',
    method === 'HEAD' ? '--head' : `-X ${quote(method)}`,
    quote(withoutUserinfo(url)),
    "-H 'User-Agent:' -H 'Accept:'",
    ...headerArgs,
    // --data-raw, never --data-binary: that reads a file when the body starts with @.
    ...(body
      ? [
          ...(hasContentType ? [] : ["-H 'Content-Type:'"]),
          `--data-raw ${quote(bodyText(body, multipart))}`,
        ]
      : []),
  ].join(' ');

  const size = new TextEncoder().encode(command).length;
  if (size > MAX_COMMAND_BYTES) {
    throw new CurlRefusedError(
      `The command is too long for a shell: ${Math.ceil(size / 1024)} KiB, limit ${MAX_COMMAND_BYTES / 1024} KiB`,
    );
  }
  return command;
}

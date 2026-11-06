// A recorded or form request as a shell command that sends the same method, URL and headers
// (spike-curl-export.md; test-strategy T2.4). Pure: the renderer imports this.
// - --globoff: without it `?filter[a]=1` fails and `?a={1,2}` sends two requests.
// - -H 'User-Agent:' -H 'Accept:' suppress curl's own headers; a typed one is still sent.
// - -H 'Name;' sends an empty value; curl treats -H 'Name: ' as removing the header.
// - A user and password in the URL are left out: curl turns them into an Authorization header, and
//   undici sends none.
// A header undici would refuse is refused here too. For a non-ASCII value left by an older version,
// curl would send UTF-8 where undici sent latin1.
import { type WireRequest, checkedHeaderValue } from './wire';

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

function withoutUserinfo(url: string): string {
  const parsed = new URL(url);
  if (!parsed.username && !parsed.password) return url;
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

export function toCurl({ method, url, headers }: WireRequest): string {
  const headerArgs = headers.map(([name, value]) => {
    const checked = checkedHeaderValue(name, value);
    return `-H ${quote(checked === '' ? `${name};` : `${name}: ${checked}`)}`;
  });

  return [
    'curl --http1.1 -sS --globoff',
    method === 'HEAD' ? '--head' : `-X ${quote(method)}`,
    quote(withoutUserinfo(url)),
    "-H 'User-Agent:' -H 'Accept:'",
    ...headerArgs,
  ].join(' ');
}

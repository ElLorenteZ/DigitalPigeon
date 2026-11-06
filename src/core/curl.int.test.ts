// T2.4 — a curl export, run in a shell, sends the same method, URL and headers. Only running curl
// shows this. curl runs asynchronously: a synchronous call blocks the event loop hosting the capture
// server, and curl hangs (spike-curl-export.md).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  type CaptureServer,
  startCaptureServer,
} from '../../test-support/capture-server';
import { toCurl } from './curl';
import { InvalidHeaderError, type WireInput, buildWireRequest } from './wire';

const run = promisify(execFile);

let capture: CaptureServer;

beforeEach(async () => {
  capture = await startCaptureServer();
});

afterEach(async () => {
  await capture.close();
});

const inShell = (command: string) =>
  run('sh', ['-c', `${command} > /dev/null`], { timeout: 10_000 });

// Sorted [lowercased name, value] pairs: order is not promised, and duplicates must survive.
const sorted = (headers: [string, string][]) =>
  headers.map(([n, v]) => `${n.toLowerCase()}: ${v}`).sort();

const received = () => {
  const raw = capture.requests.at(-1)?.rawHeaders ?? [];
  return raw.flatMap((v, i) =>
    i % 2 === 0 ? [[v, raw[i + 1] ?? ''] as [string, string]] : [],
  );
};

const wire = (over: Partial<WireInput> = {}) =>
  buildWireRequest({
    method: 'GET',
    url: `${capture.url}/orders?q=two%20words`,
    queryRows: [],
    headerRows: [
      ['X-Zeta', '1'],
      ['Authorization', 'Bearer t'],
    ],
    ...over,
  });

const expectSameRequest = (request: ReturnType<typeof wire>) => {
  expect(capture.requests).toHaveLength(1);
  const got = capture.requests[0];
  expect(got?.method).toBe(request.method);
  expect(`${capture.url}${got?.url}`).toBe(request.url);
  expect(sorted(received())).toEqual(sorted(request.headers));
  expect(got?.body.length).toBe(0);
};

describe('the export sends the recorded method, URL and headers', () => {
  test.each(['GET', 'HEAD', 'DELETE', 'OPTIONS', 'POST', 'PUT', 'PATCH'])(
    '%s',
    async (method) => {
      const request = wire({ method });
      await inShell(toCurl(request));
      expectSameRequest(request);
    },
  );

  test.each<[string, string]>([
    ['brackets', '/x?filter[a]=1'],
    ['braces', '/x?a={1,2}'],
    ['brackets in the path', '/p[1]/x'],
  ])('a URL with %s sends one request, as written', async (_label, path) => {
    const request = wire({ url: `${capture.url}${path}` });
    await inShell(toCurl(request));
    expectSameRequest(request);
  });

  test.each<[string, [string, string][]]>([
    [
      'an empty value',
      [
        ['X-E', ''],
        ['X-After', '1'],
      ],
    ],
    [
      'duplicate names',
      [
        ['X-D', '1'],
        ['X-D', '2'],
      ],
    ],
    ['a typed User-Agent', [['User-Agent', 'pigeon/1']]],
    ['a typed Accept', [['Accept', 'application/json']]],
    ['a typed Host', [['Host', 'other.test']]],
    ['a tab inside a value', [['X-T', 'a\tb']]],
  ])('%s arrives as recorded', async (_label, headerRows) => {
    const request = wire({ headerRows });
    await inShell(toCurl(request));
    expectSameRequest(request);
  });

  test.each<[string, string]>([
    ['spaces', 'a b  c'],
    ['double quotes', 'a "b" c'],
    ['single quotes', `it's 'quoted'`],
    ['a dollar sign', '$HOME $(echo x) `echo y`'],
    ['a backslash', 'a\\b\\\\c'],
  ])('a value with %s survives the shell', async (_label, value) => {
    const request = wire({ headerRows: [['X-V', value]] });
    await inShell(toCurl(request));
    expectSameRequest(request);
  });

  test('a user and password in the URL are left out: curl would send Authorization, undici does not', async () => {
    const url = new URL(`${capture.url}/x?a=1`);
    url.username = 'u';
    url.password = 'pw';
    const request = wire({ url: url.toString() });

    const command = toCurl(request);
    await inShell(command);

    expect(command).not.toContain('pw');
    expect(capture.requests[0]?.url).toBe('/x?a=1');
    expect(sorted(received())).toEqual(sorted(request.headers));
  });

  test('a URL with no user or password is exported as recorded', () => {
    // An older record can lack the trailing slash URL parsing would add.
    const url = 'http://www.example.test';
    expect(toCurl({ method: 'GET', url, headers: [] })).toContain(`'${url}'`);
  });

  test('a single quote in the URL survives the shell', async () => {
    const request = wire({ url: `${capture.url}/x?a=it's` });
    await inShell(toCurl(request));
    expect(capture.requests).toHaveLength(1);
  });

  test('HEAD with an empty value', async () => {
    const request = wire({ method: 'HEAD', headerRows: [['X-E', '']] });
    await inShell(toCurl(request));
    expectSameRequest(request);
  });
});

describe('records an older version could have written', () => {
  const recorded = (value: string) => ({
    method: 'GET',
    url: `${capture.url}/old`,
    headers: [
      ['host', new URL(capture.url).host],
      ['connection', 'keep-alive'],
      ['X-Token', value],
    ] as [string, string][],
  });

  test.each(['café', 'zażółć', 'a\nb'])(
    '%j is refused, naming the header',
    (value) => {
      expect(() => toCurl(recorded(value))).toThrow(InvalidHeaderError);
      expect(() => toCurl(recorded(value))).toThrow(/X-Token/);
    },
  );

  test('a whitespace-only value is exported as empty', async () => {
    await inShell(toCurl(recorded('   ')));
    const pairs = received();
    expect(pairs).toContainEqual(['X-Token', '']);
  });
});

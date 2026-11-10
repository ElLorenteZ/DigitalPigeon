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
import { CurlRefusedError, MAX_COMMAND_BYTES, toCurl } from './curl';
import type { Part } from './multipart';
import {
  type BodyInput,
  InvalidHeaderError,
  type WireInput,
  buildWireRequest,
} from './wire';

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

const expectSameRequest2 = (request: ReturnType<typeof wire>) => {
  expect(capture.requests).toHaveLength(1);
  const got = capture.requests[0];
  expect(got?.method).toBe(request.method);
  expect(`${capture.url}${got?.url}`).toBe(request.url);
  expect(sorted(received())).toEqual(sorted(request.headers));
};

// The command with the limit out of the way, to measure where the limit falls.
const toCurlUnchecked = (request: ReturnType<typeof wire>) => {
  try {
    return toCurl(request);
  } catch {
    return 'x'.repeat(MAX_COMMAND_BYTES + 1);
  }
};

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

describe('T2.4 — the export sends the recorded body', () => {
  const bodies: [string, BodyInput][] = [
    ['json', { type: 'json', text: '{"a":"zażółć"}' }],
    ['xml', { type: 'xml', text: '<a>ż</a>' }],
    ['text', { type: 'text', text: 'plain text' }],
    ['form', { type: 'form', rows: [['a b', 'ż&=']] }],
  ];
  const cases = ['GET', 'DELETE', 'OPTIONS', 'POST', 'PUT', 'PATCH'].flatMap(
    (method) => bodies.map(([label, body]) => [method, label, body] as const),
  );

  const expectBody = (request: ReturnType<typeof wire>) => {
    expectSameRequest2(request);
    expect(capture.requests[0]?.body).toEqual(
      Buffer.from(request.body as Uint8Array),
    );
  };

  test.each(cases)('%s, %s', async (method, _label, body) => {
    const request = wire({ method, body });
    await inShell(toCurl(request));
    expectBody(request);
  });

  test.each<[string, string]>([
    ['newlines and CRLF', 'line 1\nline 2\r\nline 3\n'],
    ['single quotes', `it's 'quoted'`],
    ['double quotes', 'a "b" c'],
    ['shell syntax', '$HOME $(echo x) `echo y`'],
    ['backslashes', 'a\\b\\\\c'],
    ['a percent sign', '%41 %'],
    ['a byte order mark', '\uFEFFabc'],
    ['non-ASCII', 'zażółć 🐦'],
  ])('a body with %s arrives unchanged', async (_label, text) => {
    const request = wire({ method: 'POST', body: { type: 'text', text } });
    await inShell(toCurl(request));
    expectBody(request);
  });

  // --data-binary would send the contents of /etc/hosts (spike-curl-bodies.md).
  test('a body starting with @ arrives as text, and no file is read', async () => {
    const request = wire({
      method: 'POST',
      body: { type: 'text', text: '@/etc/hosts' },
    });
    await inShell(toCurl(request));
    expect(capture.requests[0]?.body.toString()).toBe('@/etc/hosts');
    expectBody(request);
  });

  test('a recorded list with no Content-Type gets none from curl', async () => {
    const body = new TextEncoder().encode('abc');
    const request = {
      method: 'POST',
      url: `${capture.url}/x`,
      headers: [
        ['host', new URL(capture.url).host],
        ['connection', 'keep-alive'],
        ['content-length', '3'],
      ] as [string, string][],
      body,
    };
    await inShell(toCurl(request));
    expect(sorted(received())).toEqual(sorted(request.headers));
    expect(capture.requests[0]?.body.toString()).toBe('abc');
  });
});

describe('T2.4 — a command too long for a shell is refused', () => {
  const sized = (text: string) =>
    wire({ method: 'POST', headerRows: [], body: { type: 'text', text } });
  const byteLength = (command: string) => Buffer.byteLength(command);

  // The digits of content-length grow with the body, so step down from just over the budget.
  const longestFitting = () => {
    let length = MAX_COMMAND_BYTES - byteLength(toCurl(sized('a'))) + 1;
    while (
      byteLength(toCurlUnchecked(sized('a'.repeat(length)))) > MAX_COMMAND_BYTES
    ) {
      length -= 1;
    }
    return length;
  };

  test('a command at the limit sends', async () => {
    const request = sized('a'.repeat(longestFitting()));
    const command = toCurl(request);
    expect(byteLength(command)).toBeLessThanOrEqual(MAX_COMMAND_BYTES);
    await inShell(command);
    expect(capture.requests[0]?.body).toEqual(
      Buffer.from(request.body as Uint8Array),
    );
  });

  test('one byte over is refused, with the reason', () => {
    expect(() => toCurl(sized('a'.repeat(longestFitting() + 1)))).toThrow(
      CurlRefusedError,
    );
    expect(() => toCurl(sized('a'.repeat(longestFitting() + 1)))).toThrow(
      /too long/,
    );
  });

  // Each ' becomes '\'' in the command, four bytes for one.
  test('quoting counts: a small body of quotes can be over the limit', () => {
    const text = "'".repeat(Math.ceil(MAX_COMMAND_BYTES / 3));
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_COMMAND_BYTES);
    expect(() => toCurl(sized(text))).toThrow(CurlRefusedError);
  });

  test.each<[string, number[]]>([
    ['a NUL byte', [0x61, 0x00, 0x62]],
    ['invalid UTF-8', [0x61, 0xff, 0x62]],
  ])('a body with %s is refused: a shell cannot hold it', (_label, bytes) => {
    const request = { ...sized('abc'), body: new Uint8Array(bytes) };
    expect(() => toCurl(request)).toThrow(CurlRefusedError);
  });
});

describe('T2.4 — a multipart body', () => {
  const textParts: Part[] = [
    { kind: 'field', name: 'note', value: 'zażółć 🐦 it\'s "x" $HOME' },
    { kind: 'field', name: 'empty', value: '' },
    {
      kind: 'file',
      name: 'doc',
      filename: 'notatka.txt',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('line 1\r\nline 2\n@/etc/hosts\n'),
    },
  ];

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s: text-only parts arrive unchanged, CRLF framing included',
    async (method) => {
      const request = wire({
        method,
        body: { type: 'multipart', parts: textParts },
      });
      await inShell(toCurl(request));
      expectSameRequest2(request);
      expect(capture.requests[0]?.body).toEqual(
        Buffer.from(request.body as Uint8Array),
      );
    },
  );

  test.each<[string, number[]]>([
    ['a NUL byte', [0x61, 0x00, 0x62]],
    ['invalid UTF-8', [0x61, 0xff, 0x62]],
  ])(
    'a file part holding %s is refused, naming the file part',
    (_label, bytes) => {
      const request = wire({
        method: 'POST',
        body: {
          type: 'multipart',
          parts: [
            {
              kind: 'file',
              name: 'f',
              filename: 'f.bin',
              contentType: '',
              bytes: new Uint8Array(bytes),
            },
          ],
        },
      });
      expect(() => toCurl(request)).toThrow(
        new CurlRefusedError(
          'A file part holds bytes a shell command cannot hold',
        ),
      );
    },
  );
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

test('T2.4 — a body stored in a file is refused, with the reason', () => {
  const request = {
    method: 'POST',
    url: 'http://x/',
    headers: [] as [string, string][],
    body: { fileId: 'f', length: 2 * 1024 * 1024 },
  };

  expect(() => toCurl(request)).toThrow(CurlRefusedError);
  expect(() => toCurl(request)).toThrow(/2\.0 MiB/);
});

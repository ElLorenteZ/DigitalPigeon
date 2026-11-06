import { describe, expect, test } from 'vitest';
import {
  type BodyInput,
  InvalidBodyError,
  InvalidHeaderError,
  buildWireRequest,
} from './wire';

const base = {
  method: 'GET',
  url: 'http://api.test:8080/orders',
  queryRows: [],
  headerRows: [],
};

describe('buildWireRequest — headers', () => {
  test('starts with lowercase host from the URL, then connection: keep-alive', () => {
    expect(buildWireRequest(base).headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'keep-alive'],
    ]);
  });

  test('omits a default port from host', () => {
    expect(
      buildWireRequest({ ...base, url: 'https://api.test/x' }).headers[0],
    ).toEqual(['host', 'api.test']);
  });

  test('takes host from a typed Host header, named in lowercase, and does not repeat it', () => {
    const { headers } = buildWireRequest({
      ...base,
      headerRows: [
        ['X-A', '1'],
        ['Host', 'other.test'],
      ],
    });
    expect(headers).toEqual([
      ['host', 'other.test'],
      ['connection', 'keep-alive'],
      ['X-A', '1'],
    ]);
  });

  test('takes connection from a typed Connection header, named in lowercase', () => {
    const { headers } = buildWireRequest({
      ...base,
      headerRows: [['Connection', 'close']],
    });
    expect(headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'close'],
    ]);
  });

  test.each([
    ['Upgrade', 'keep-alive'],
    ['Keep-Alive', 'keep-alive'],
    ['foo, bar', 'keep-alive'],
    ['close', 'close'],
    ['Close', 'close'],
    ['foo, close', 'close'],
  ])(
    'a typed Connection: %s records what undici writes, %s',
    (value, written) => {
      const { headers } = buildWireRequest({
        ...base,
        headerRows: [['Connection', value]],
      });
      expect(headers[1]).toEqual(['connection', written]);
    },
  );

  test('uses connection: close for HEAD, which undici always writes for HEAD', () => {
    expect(buildWireRequest({ ...base, method: 'HEAD' }).headers[1]).toEqual([
      'connection',
      'close',
    ]);
  });

  test('uses connection: close for HEAD even when Connection is typed', () => {
    const { headers } = buildWireRequest({
      ...base,
      method: 'HEAD',
      headerRows: [['Connection', 'keep-alive']],
    });
    expect(headers[1]).toEqual(['connection', 'close']);
  });

  test('keeps the other headers in their order and case', () => {
    const { headers } = buildWireRequest({
      ...base,
      headerRows: [
        ['X-Zeta', '1'],
        ['accept', '*/*'],
        ['Authorization', 'Bearer t'],
      ],
    });
    expect(headers.slice(2)).toEqual([
      ['X-Zeta', '1'],
      ['accept', '*/*'],
      ['Authorization', 'Bearer t'],
    ]);
  });

  test.each(['POST', 'PUT', 'PATCH'])(
    'appends content-length: 0 for %s',
    (method) => {
      expect(buildWireRequest({ ...base, method }).headers.at(-1)).toEqual([
        'content-length',
        '0',
      ]);
    },
  );

  test.each(['GET', 'HEAD', 'DELETE', 'OPTIONS'])(
    'adds no content-length for %s',
    (method) => {
      const names = buildWireRequest({ ...base, method }).headers.map(
        ([name]) => name.toLowerCase(),
      );
      expect(names).not.toContain('content-length');
    },
  );

  test('replaces a typed Content-Length, since the request has no body', () => {
    const { headers } = buildWireRequest({
      ...base,
      method: 'POST',
      headerRows: [['Content-Length', '5']],
    });
    expect(
      headers.filter(([name]) => name.toLowerCase() === 'content-length'),
    ).toEqual([['content-length', '0']]);
  });
});

describe('buildWireRequest — URL', () => {
  test('sends the typed URL unchanged when there are no query rows', () => {
    expect(
      buildWireRequest({ ...base, url: 'http://api.test/a?b=1&c=%20' }).url,
    ).toBe('http://api.test/a?b=1&c=%20');
  });

  test('appends query rows in order, encoding spaces as %20', () => {
    expect(
      buildWireRequest({
        ...base,
        queryRows: [
          ['q', 'two words'],
          ['a&b', 'x=y'],
        ],
      }).url,
    ).toBe('http://api.test:8080/orders?q=two%20words&a%26b=x%3Dy');
  });

  test('appends query rows after an existing query string with &', () => {
    expect(
      buildWireRequest({
        ...base,
        url: 'http://api.test/a?b=1',
        queryRows: [['c', '2']],
      }).url,
    ).toBe('http://api.test/a?b=1&c=2');
  });

  test('places query rows before a fragment and drops the fragment, which is never sent', () => {
    expect(
      buildWireRequest({
        ...base,
        url: 'https://api.test/items#top',
        queryRows: [['page', '2']],
      }).url,
    ).toBe('https://api.test/items?page=2');
  });

  test('ignores a ? that appears only inside the fragment', () => {
    expect(
      buildWireRequest({
        ...base,
        url: 'https://api.test/items#a?b',
        queryRows: [['page', '2']],
      }).url,
    ).toBe('https://api.test/items?page=2');
  });

  test('drops a fragment when there are no query rows', () => {
    expect(
      buildWireRequest({ ...base, url: 'https://api.test/items?x=1#top' }).url,
    ).toBe('https://api.test/items?x=1');
  });

  test('keeps the method as given', () => {
    expect(buildWireRequest({ ...base, method: 'PATCH' }).method).toBe('PATCH');
  });
});

describe('buildWireRequest — refused before anything is recorded', () => {
  test.each([
    ['above U+00FF', 'X-V', 'Bearer zażółć'],
    ['emoji', 'X-V', 'Bearer 🐦'],
    ['latin1 range', 'X-V', 'Bearer café'],
    ['line feed', 'X-V', 'a\nb'],
    ['CRLF injection', 'X-V', 'a\r\nX-Evil: 1'],
    ['trailing line feed', 'X-V', 'a\n'],
    ['leading carriage return', 'X-V', '\ra'],
    ['no-break space', 'X-V', '\u00a0a'],
    ['NUL', 'X-V', 'a\u0000b'],
    ['DEL', 'X-V', 'a\u007fb'],
    ['name with a space', 'X V', '1'],
    ['name with a colon', 'X:V', '1'],
    ['non-ASCII name', 'Xż', '1'],
    ['typed Host value', 'Host', 'żółć.test'],
    ['typed Connection value', 'Connection', 'żółć'],
    ['Transfer-Encoding', 'Transfer-Encoding', 'chunked'],
    ['Keep-Alive', 'Keep-Alive', 'timeout=5'],
    ['Upgrade', 'Upgrade', 'h2c'],
    ['Expect', 'Expect', '100-continue'],
    ['any case of a refused name', 'tRaNsFeR-eNcOdInG', 'chunked'],
    ['empty Connection', 'Connection', ''],
    ['Connection with an empty token', 'Connection', 'close,'],
    ['Connection with a space inside a token', 'Connection', 'a b'],
  ])('%s', (_label, name, value) => {
    expect(() =>
      buildWireRequest({ ...base, headerRows: [[name, value]] }),
    ).toThrow(InvalidHeaderError);
  });

  test('an empty name is refused', () => {
    expect(() =>
      buildWireRequest({ ...base, headerRows: [['', '1']] }),
    ).toThrow(InvalidHeaderError);
  });

  test('a typed Connection is checked on HEAD too, where its value is not used', () => {
    expect(() =>
      buildWireRequest({
        ...base,
        method: 'HEAD',
        headerRows: [['Connection', '']],
      }),
    ).toThrow(InvalidHeaderError);
  });

  test('a refused name is explained as the name, not as bad characters', () => {
    expect(() =>
      buildWireRequest({ ...base, headerRows: [['Expect', '100-continue']] }),
    ).toThrow(/"Expect": the HTTP client cannot send this header/);
  });

  test('the error names the header', () => {
    expect(() =>
      buildWireRequest({ ...base, headerRows: [['X-Token', 'ż']] }),
    ).toThrow(/X-Token/);
  });
});

describe('buildWireRequest — accepted values', () => {
  test('printable ASCII, a tab inside a value, an empty value and duplicate names', () => {
    const { headers } = buildWireRequest({
      ...base,
      headerRows: [
        ['X-A', `a "b" 'c' $d \\e ~`],
        ['X-T', 'a\tb'],
        ['X-E', ''],
        ['X-D', '1'],
        ['X-D', '2'],
      ],
    });
    expect(headers.slice(2)).toEqual([
      ['X-A', `a "b" 'c' $d \\e ~`],
      ['X-T', 'a\tb'],
      ['X-E', ''],
      ['X-D', '1'],
      ['X-D', '2'],
    ]);
  });

  test('surrounding whitespace is trimmed from a value', () => {
    const { headers } = buildWireRequest({
      ...base,
      headerRows: [['X-P', '  a b\t ']],
    });
    expect(headers[2]).toEqual(['X-P', 'a b']);
  });

  test('a whitespace-only value becomes empty', () => {
    const { headers } = buildWireRequest({
      ...base,
      headerRows: [['X-W', '   ']],
    });
    expect(headers[2]).toEqual(['X-W', '']);
  });

  test('a typed Host value is trimmed', () => {
    const { headers } = buildWireRequest({
      ...base,
      headerRows: [['Host', ' other.test ']],
    });
    expect(headers[0]).toEqual(['host', 'other.test']);
  });
});

describe('buildWireRequest — a body', () => {
  const post = { ...base, method: 'POST' };
  const text = (bytes: Uint8Array | null | undefined) =>
    new TextDecoder().decode(bytes ?? new Uint8Array());

  test('no body input records null and changes nothing', () => {
    const wire = buildWireRequest(base);
    expect(wire.body).toBeNull();
    expect(wire.headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'keep-alive'],
    ]);
  });

  test.each<[BodyInput['type'], string]>([
    ['json', 'application/json'],
    ['xml', 'application/xml'],
    ['text', 'text/plain'],
  ])(
    '%s generates its Content-Type after the typed headers, then content-length last',
    (type, contentType) => {
      const wire = buildWireRequest({
        ...post,
        headerRows: [['X-A', '1']],
        body: { type, text: 'abc' } as BodyInput,
      });
      expect(wire.headers).toEqual([
        ['host', 'api.test:8080'],
        ['connection', 'keep-alive'],
        ['X-A', '1'],
        ['content-type', contentType],
        ['content-length', '3'],
      ]);
      expect(text(wire.body)).toBe('abc');
    },
  );

  test('form rows are encoded, and generate their Content-Type', () => {
    const wire = buildWireRequest({
      ...post,
      body: {
        type: 'form',
        rows: [
          ['a b', '1&2=3+4'],
          ['ż', ''],
        ],
      },
    });
    expect(text(wire.body)).toBe('a+b=1%262%3D3%2B4&%C5%BC=');
    expect(wire.headers.at(-2)).toEqual([
      'content-type',
      'application/x-www-form-urlencoded',
    ]);
  });

  test('content-length counts UTF-8 bytes, not characters', () => {
    const wire = buildWireRequest({
      ...post,
      body: { type: 'json', text: '"żółć"' },
    });
    expect(wire.headers.at(-1)).toEqual(['content-length', '10']);
    expect(wire.body?.length).toBe(10);
  });

  test('a typed Content-Type, in any case, is kept in place and not generated', () => {
    const wire = buildWireRequest({
      ...post,
      headerRows: [
        ['cOnTeNt-TyPe', 'application/vnd.x+json'],
        ['X-A', '1'],
      ],
      body: { type: 'json', text: '{}' },
    });
    expect(wire.headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'keep-alive'],
      ['cOnTeNt-TyPe', 'application/vnd.x+json'],
      ['X-A', '1'],
      ['content-length', '2'],
    ]);
  });

  test('a typed Content-Length is replaced by the byte count', () => {
    const wire = buildWireRequest({
      ...post,
      headerRows: [['Content-Length', '999']],
      body: { type: 'text', text: 'abc' },
    });
    expect(
      wire.headers.filter(([name]) => name.toLowerCase() === 'content-length'),
    ).toEqual([['content-length', '3']]);
  });

  test.each(['GET', 'DELETE', 'OPTIONS'])(
    '%s with a body lists content-length and stays keep-alive',
    (method) => {
      const wire = buildWireRequest({
        ...base,
        method,
        body: { type: 'text', text: 'abc' },
      });
      expect(wire.headers).toEqual([
        ['host', 'api.test:8080'],
        ['connection', 'keep-alive'],
        ['content-type', 'text/plain'],
        ['content-length', '3'],
      ]);
    },
  );

  test.each<[string, BodyInput]>([
    ['an empty text box', { type: 'json', text: '' }],
    ['no form rows', { type: 'form', rows: [] }],
    ['the None type', { type: 'none' }],
  ])('%s is no body, and generates no Content-Type', (_label, body) => {
    const onPost = buildWireRequest({ ...post, body });
    expect(onPost.body).toBeNull();
    expect(onPost.headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'keep-alive'],
      ['content-length', '0'],
    ]);
    const onGet = buildWireRequest({ ...base, body });
    expect(onGet.body).toBeNull();
    expect(onGet.headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'keep-alive'],
    ]);
  });

  test('HEAD with a body is refused', () => {
    expect(() =>
      buildWireRequest({
        ...base,
        method: 'HEAD',
        body: { type: 'text', text: 'abc' },
      }),
    ).toThrow(InvalidBodyError);
  });

  test('HEAD with an empty body is not refused', () => {
    expect(
      buildWireRequest({
        ...base,
        method: 'HEAD',
        body: { type: 'text', text: '' },
      }).body,
    ).toBeNull();
  });
});

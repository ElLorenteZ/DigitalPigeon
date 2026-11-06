import { describe, expect, test } from 'vitest';
import { BodyNotLoadableError, formFromCall } from './form-from-call';
import { type BodyInput, type WireInput, buildWireRequest } from './wire';

const typed = (over: Partial<WireInput> = {}): WireInput => ({
  method: 'GET',
  url: 'http://api.test:8080/orders?x=1',
  queryRows: [],
  headerRows: [],
  ...over,
});

describe('round trip: buildWireRequest(formFromCall(recorded)) equals recorded', () => {
  test.each<[string, Partial<WireInput>]>([
    ['no typed headers', {}],
    [
      'headers in order and case',
      {
        headerRows: [
          ['X-Zeta', '1'],
          ['accept', '*/*'],
        ],
      },
    ],
    ['query rows, merged into the URL', { queryRows: [['q', 'two words']] }],
    [
      'duplicate names and an empty value',
      {
        headerRows: [
          ['X-D', '1'],
          ['X-D', '2'],
          ['X-E', ''],
        ],
      },
    ],
    ['a typed Host', { headerRows: [['Host', 'other.test']] }],
    ['a typed Connection', { headerRows: [['Connection', 'close']] }],
    [
      'a typed Connection undici ignores',
      { headerRows: [['Connection', 'Upgrade']] },
    ],
    ['HEAD', { method: 'HEAD', headerRows: [['X-A', '1']] }],
    ['POST', { method: 'POST', headerRows: [['X-A', '1']] }],
    ['PUT', { method: 'PUT' }],
    ['PATCH', { method: 'PATCH' }],
    ['DELETE', { method: 'DELETE' }],
    ['OPTIONS', { method: 'OPTIONS' }],
    [
      'a JSON body',
      { method: 'POST', body: { type: 'json', text: '{"a":"ż"}' } },
    ],
    ['an XML body', { method: 'PUT', body: { type: 'xml', text: '<a/>' } }],
    [
      'a text body with CRLF',
      { method: 'POST', body: { type: 'text', text: 'a\r\nb' } },
    ],
    ['a body on GET', { body: { type: 'text', text: 'abc' } }],
    [
      'a body starting with a byte order mark',
      { method: 'POST', body: { type: 'text', text: '\uFEFFabc' } },
    ],
    [
      'form rows with spaces, &, =, + and non-ASCII',
      {
        method: 'POST',
        body: {
          type: 'form',
          rows: [
            ['a b', '1&2=3+4'],
            ['ż', ''],
            ['a b', 'dup'],
          ],
        },
      },
    ],
    [
      'a typed Content-Type before other headers',
      {
        method: 'POST',
        headerRows: [
          ['Content-Type', 'application/json'],
          ['X-A', '1'],
        ],
        body: { type: 'json', text: '{}' },
      },
    ],
    [
      'an unknown typed Content-Type',
      {
        method: 'POST',
        headerRows: [['content-type', 'application/vnd.x+json']],
        body: { type: 'text', text: '{}' },
      },
    ],
  ])('%s', (_label, over) => {
    const recorded = buildWireRequest(typed(over));
    expect(buildWireRequest(formFromCall(recorded))).toEqual(recorded);
  });
});

describe('formFromCall', () => {
  test('loads the recorded URL with its query, and no query rows', () => {
    const recorded = buildWireRequest(typed({ queryRows: [['q', '1']] }));
    expect(formFromCall(recorded)).toMatchObject({
      method: 'GET',
      url: 'http://api.test:8080/orders?x=1&q=1',
      queryRows: [],
    });
  });

  test('hides managed headers that equal what wire.ts generates', () => {
    const recorded = buildWireRequest(
      typed({ method: 'POST', headerRows: [['X-A', '1']] }),
    );
    expect(formFromCall(recorded).headerRows).toEqual([['X-A', '1']]);
  });

  test('hides connection: close on HEAD, which wire.ts generates', () => {
    const recorded = buildWireRequest(typed({ method: 'HEAD' }));
    expect(formFromCall(recorded).headerRows).toEqual([]);
  });

  test('keeps a typed Host and a typed Connection as rows', () => {
    const recorded = buildWireRequest(
      typed({
        headerRows: [
          ['Host', 'other.test'],
          ['Connection', 'close'],
          ['X-A', '1'],
        ],
      }),
    );
    expect(formFromCall(recorded).headerRows).toEqual([
      ['host', 'other.test'],
      ['connection', 'close'],
      ['X-A', '1'],
    ]);
  });

  test.each<[string, BodyInput]>([
    ['json', { type: 'json', text: '{}' }],
    ['xml', { type: 'xml', text: '<a/>' }],
    ['text', { type: 'text', text: 'abc' }],
    ['form', { type: 'form', rows: [['a', '1']] }],
  ])('recovers %s and hides what it generates', (_label, body) => {
    const form = formFromCall(
      buildWireRequest(
        typed({ method: 'POST', headerRows: [['X-A', '1']], body }),
      ),
    );
    expect(form.body).toEqual(body);
    expect(form.headerRows).toEqual([['X-A', '1']]);
  });

  test('no body loads as None', () => {
    const form = formFromCall(buildWireRequest(typed({ method: 'POST' })));
    expect(form.body).toEqual({ type: 'none' });
  });

  test('a typed Content-Type keeps its row and position', () => {
    const form = formFromCall(
      buildWireRequest(
        typed({
          method: 'POST',
          headerRows: [
            ['Content-Type', 'application/json'],
            ['X-A', '1'],
          ],
          body: { type: 'json', text: '{}' },
        }),
      ),
    );
    expect(form.headerRows).toEqual([
      ['Content-Type', 'application/json'],
      ['X-A', '1'],
    ]);
    expect(form.body).toEqual({ type: 'json', text: '{}' });
  });

  test('an unknown Content-Type loads as Text and keeps its row', () => {
    const form = formFromCall(
      buildWireRequest(
        typed({
          method: 'POST',
          headerRows: [['content-type', 'application/vnd.x+json']],
          body: { type: 'text', text: '{}' },
        }),
      ),
    );
    expect(form.body).toEqual({ type: 'text', text: '{}' });
    expect(form.headerRows).toEqual([
      ['content-type', 'application/vnd.x+json'],
    ]);
  });

  // Rows would send other bytes: `%20` comes back as `+`, and the form drops a row with no name.
  test.each(['a=1%202', 'a', '=x', 'a=1&&b=2'])(
    'form content that does not re-encode exactly loads as Text: %s',
    (text) => {
      const recorded = buildWireRequest(
        typed({
          method: 'POST',
          headerRows: [['content-type', 'application/x-www-form-urlencoded']],
          body: { type: 'text', text },
        }),
      );
      const form = formFromCall(recorded);
      expect(form.body).toEqual({ type: 'text', text });
      expect(form.headerRows).toEqual([
        ['content-type', 'application/x-www-form-urlencoded'],
      ]);
      expect(buildWireRequest(form)).toEqual(recorded);
    },
  );

  test('changing the URL after loading sends the new host', () => {
    const form = formFromCall(buildWireRequest(typed()));
    const edited = buildWireRequest({ ...form, url: 'http://new.test/orders' });
    expect(edited.headers[0]).toEqual(['host', 'new.test']);
  });

  test('changing the method after loading recomputes the managed headers', () => {
    const form = formFromCall(buildWireRequest(typed({ method: 'POST' })));
    const edited = buildWireRequest({ ...form, method: 'GET' });
    expect(edited.headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'keep-alive'],
    ]);
  });
});

test('a body stored in a file is reported as not loadable, with the reason', () => {
  const request = {
    method: 'POST',
    url: 'http://x/',
    headers: [['content-length', String(2 * 1024 * 1024)]] as [
      string,
      string,
    ][],
    body: { fileId: 'f', length: 2 * 1024 * 1024 },
  };

  expect(() => formFromCall(request)).toThrow(BodyNotLoadableError);
  expect(() => formFromCall(request)).toThrow(/2\.0 MiB/);
});

// The form drops a row whose name is blank, and an <input> strips line breaks (code review, 2 and 5).
test.each([
  ['a name of one space', '+=1&a=2'],
  ['a name of one tab', '%09=1'],
  ['a name of a no-break space', '%C2%A0=1'],
  ['a line feed in a value', 'a=1%0A2'],
  ['a carriage return in a value', 'a=1%0D2'],
  ['a line feed in a name', 'a%0Ab=1'],
])('form content a row cannot hold loads as text: %s', (_name, text) => {
  const body = new TextEncoder().encode(text);
  const loaded = formFromCall({
    method: 'POST',
    url: 'http://x/',
    headers: [
      ['content-type', 'application/x-www-form-urlencoded'],
      ['content-length', String(body.length)],
    ],
    body,
  });

  expect(loaded.body).toEqual({ type: 'text', text });
});

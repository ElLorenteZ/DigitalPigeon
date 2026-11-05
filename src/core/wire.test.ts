import { describe, expect, test } from 'vitest';
import { buildWireRequest } from './wire';

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

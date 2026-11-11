// T2.5 — a request's URL and the active environment's baseUrl (plan.md, phase 1).
import { describe, expect, test } from 'vitest';
import {
  InvalidBaseUrlError,
  InvalidPathError,
  NoActiveEnvironmentError,
  checkBaseUrl,
  composeUrl,
  pathFor,
} from './url';
import { buildWireRequest } from './wire';

const env = (baseUrl: string) => ({ baseUrl });

describe('composeUrl', () => {
  test.each<[string, string, string]>([
    ['https://a.test', '/orders', 'https://a.test/orders'],
    ['https://a.test/', '/orders', 'https://a.test/orders'],
    ['https://a.test/v1', '/orders', 'https://a.test/v1/orders'],
    ['https://a.test/v1/', '/orders', 'https://a.test/v1/orders'],
    ['https://a.test/v1//', '//orders', 'https://a.test/v1/orders'],
    ['https://a.test/v1', '/', 'https://a.test/v1/'],
    [
      'http://127.0.0.1:8080/api',
      '/orders/12?x=1&y=2',
      'http://127.0.0.1:8080/api/orders/12?x=1&y=2',
    ],
  ])('%s + %s → %s', (baseUrl, path, expected) => {
    expect(composeUrl(path, env(baseUrl))).toBe(expected);
  });

  test('a full URL is sent as typed, with or without an environment', () => {
    expect(composeUrl('https://b.test/x?y=1', env('https://a.test/v1'))).toBe(
      'https://b.test/x?y=1',
    );
    expect(composeUrl('http://b.test/x', undefined)).toBe('http://b.test/x');
  });

  test('a path with no environment is refused', () => {
    expect(() => composeUrl('/orders', undefined)).toThrow(
      NoActiveEnvironmentError,
    );
  });

  test('query rows are appended after composition, to the path’s own query', () => {
    const wire = buildWireRequest({
      method: 'GET',
      url: composeUrl('/orders?x=1', env('https://a.test/v1')),
      queryRows: [['q', 'two words']],
      headerRows: [],
    });
    expect(wire.url).toBe('https://a.test/v1/orders?x=1&q=two%20words');
    expect(wire.headers[0]).toEqual(['host', 'a.test']);
  });
});

describe('checkBaseUrl', () => {
  test.each<[string, string]>([
    ['https://a.test', 'https://a.test/'],
    ['http://127.0.0.1:8080/api', 'http://127.0.0.1:8080/api'],
    ['HTTPS://A.Test/V1/', 'https://a.test/V1/'],
    ['  https://a.test/v1  ', 'https://a.test/v1'],
  ])('%j is kept as %j', (text, expected) => {
    expect(checkBaseUrl(text)).toBe(expected);
  });

  test.each<[string, string]>([
    ['empty', ''],
    ['a path', '/v1'],
    ['no scheme', 'a.test/v1'],
    ['another scheme', 'ftp://a.test'],
    ['a query', 'https://a.test/v1?x=1'],
    ['a fragment', 'https://a.test/v1#top'],
    ['user information', 'https://u:p@a.test/v1'],
  ])('%s is refused', (_label, text) => {
    expect(() => checkBaseUrl(text)).toThrow(InvalidBaseUrlError);
  });
});

// Edit of a call restores its path when its URL starts with the recorded baseUrl (plan revision 2, W1).
describe('pathFor', () => {
  test.each<[string, string, string]>([
    ['https://a.test/', 'https://a.test/orders', '/orders'],
    ['https://a.test/v1', 'https://a.test/v1/orders?x=1', '/orders?x=1'],
    ['https://a.test/v1/', 'https://a.test/v1/orders', '/orders'],
    ['https://a.test/v1', 'https://a.test/v1/', '/'],
    ['https://a.test/v1', 'https://a.test/v1/a%20b', '/a%20b'],
  ])('%s, %s → %s, which composes back to the URL', (baseUrl, url, path) => {
    expect(pathFor(url, env(baseUrl))).toBe(path);
    expect(composeUrl(path, env(baseUrl))).toBe(url);
  });

  test.each<[string, string]>([
    ['https://a.test/v1', 'https://a.test/v10/orders'],
    ['https://a.test/v1', 'https://b.test/v1/orders'],
    ['https://a.test/v1', 'https://a.test/v1'],
    ['https://a.test:8443/v1', 'https://a.test/v1/orders'],
  ])('%s does not prefix %s: no path', (baseUrl, url) => {
    expect(pathFor(url, env(baseUrl))).toBeUndefined();
  });
});

// Second code review, #2: a dot segment would leave the environment's base path while the call still records it.
describe('a path with dot segments', () => {
  test.each([
    '/../admin',
    '/a/../b',
    '/./x',
    '/a/.',
    '/a/..',
    '/%2e%2E/x',
    '/.%2e/x',
    '/%2E/x',
  ])('%s is refused', (path) => {
    expect(() => composeUrl(path, env('https://h.test/api/v1'))).toThrow(
      InvalidPathError,
    );
  });

  test.each(['/a..b', '/.well-known/x', '/x?y=../z', '/x?y=./z', '/...'])(
    '%s is not a dot segment and is joined',
    (path) => {
      expect(composeUrl(path, env('https://h.test/api'))).toBe(
        `https://h.test/api${path}`,
      );
    },
  );
});

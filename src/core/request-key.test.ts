// The request a call answers (slice 7; history-grouping, phase 2): its method and URL path. Query, fragment and host
// are not part of the key. One function for the store and the renderer.
import { describe, expect, test } from 'vitest';
import { requestKeyOf } from './request-key';

describe('requestKeyOf', () => {
  test('the path without query or fragment', () => {
    expect(requestKeyOf('GET', 'http://a.test/api/orders?page=2#top')).toEqual({
      method: 'GET',
      path: '/api/orders',
    });
  });

  test('the host is not part of the key', () => {
    expect(requestKeyOf('GET', 'http://a.test/x').path).toBe(
      requestKeyOf('GET', 'https://b.test:8443/x').path,
    );
  });

  test('a URL with no path, or the root, is "/"', () => {
    expect(requestKeyOf('GET', 'http://a.test').path).toBe('/');
    expect(requestKeyOf('GET', 'http://a.test/').path).toBe('/');
    expect(requestKeyOf('GET', 'http://a.test?x=1').path).toBe('/');
  });

  test('the path as the URL parser writes it', () => {
    expect(requestKeyOf('GET', 'http://a.test/a b').path).toBe('/a%20b');
    expect(requestKeyOf('GET', 'http://a.test/a%20b').path).toBe('/a%20b');
  });

  test('a trailing slash is a different path', () => {
    expect(requestKeyOf('GET', 'http://a.test/x/').path).toBe('/x/');
  });

  test('text the URL parser refuses falls back to the part before ? or #', () => {
    expect(requestKeyOf('GET', 'not a url?x=1').path).toBe('/not a url');
  });

  test('the method is kept as given', () => {
    expect(requestKeyOf('POST', 'http://a.test/x').method).toBe('POST');
  });
});

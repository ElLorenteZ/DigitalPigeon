// The auth a call was sent with (history-grouping, phase 1): the Authorization header if there is one, otherwise the
// Cookie header, otherwise none. Values are whole header values, compared exactly.
import { describe, expect, test } from 'vitest';
import { authOf } from './headers';

describe('authOf', () => {
  test('an Authorization header gives its value', () => {
    expect(
      authOf([
        ['host', 'a.test'],
        ['Authorization', 'Bearer t1'],
      ]),
    ).toEqual({ header: 'Authorization', value: 'Bearer t1' });
  });

  test('a Cookie header is used when there is no Authorization header', () => {
    expect(
      authOf([
        ['host', 'a.test'],
        ['Cookie', 'session=abc; theme=dark'],
      ]),
    ).toEqual({ header: 'Cookie', value: 'session=abc; theme=dark' });
  });

  test('Authorization wins over Cookie, whichever comes first', () => {
    expect(
      authOf([
        ['Cookie', 'session=abc'],
        ['Authorization', 'Bearer t1'],
      ]),
    ).toEqual({ header: 'Authorization', value: 'Bearer t1' });
  });

  test('neither header gives undefined', () => {
    expect(authOf([['host', 'a.test']])).toBeUndefined();
    expect(authOf([])).toBeUndefined();
  });

  test('the first of several Cookie headers, and the first of several Authorization headers', () => {
    expect(
      authOf([
        ['Cookie', 'first=1'],
        ['Cookie', 'second=2'],
      ]),
    ).toEqual({ header: 'Cookie', value: 'first=1' });
    expect(
      authOf([
        ['Authorization', 'Bearer one'],
        ['Authorization', 'Bearer two'],
      ]),
    ).toEqual({ header: 'Authorization', value: 'Bearer one' });
  });

  test('header names match whatever their case', () => {
    expect(authOf([['COOKIE', 'a=1']])).toEqual({
      header: 'Cookie',
      value: 'a=1',
    });
    expect(authOf([['authorization', 'Basic x']])).toEqual({
      header: 'Authorization',
      value: 'Basic x',
    });
  });

  test('an empty Authorization value is still the auth, ahead of a Cookie', () => {
    expect(
      authOf([
        ['Authorization', ''],
        ['Cookie', 'a=1'],
      ]),
    ).toEqual({ header: 'Authorization', value: '' });
  });
});

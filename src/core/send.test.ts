import { describe, expect, test } from 'vitest';
import { classifySendError } from './send';

describe('classifySendError', () => {
  test.each([
    ['UND_ERR_HEADERS_TIMEOUT', 'timeout'],
    ['UND_ERR_BODY_TIMEOUT', 'timeout'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['ECONNREFUSED', 'network'],
    ['ENOTFOUND', 'network'],
  ])('%s is %s', (code, expected) => {
    expect(
      classifySendError(Object.assign(new Error(code), { code }), undefined),
    ).toBe(expected);
  });

  test('an aborted signal is cancelled, whatever the error', () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifySendError(new Error('aborted'), controller.signal)).toBe(
      'cancelled',
    );
  });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { classifySendError, replayCall, sendAndRecord } from './send';

const request = vi.hoisted(() =>
  vi.fn(async (_url: string, _options: object) => ({
    statusCode: 200,
    headers: {},
    body: { arrayBuffer: async () => new ArrayBuffer(0) },
  })),
);
vi.mock('undici', () => ({ request }));

describe('classifySendError', () => {
  test.each([
    ['UND_ERR_HEADERS_TIMEOUT', 'timeout'],
    ['UND_ERR_BODY_TIMEOUT', 'timeout'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['UND_ERR_INVALID_ARG', 'invalid-request'],
    ['UND_ERR_NOT_SUPPORTED', 'invalid-request'],
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

// Waiting out a real 30 s timeout is too slow for a gate, so this checks what undici is handed.
describe('every request has the 30 s timeouts', () => {
  const url = 'http://api.test/x';
  const store = {
    insertSend: async () => {},
    insertCompletion: async () => {},
    getCall: async () => ({
      state: 'completed',
      send: { request: { method: 'GET', url, headers: [] } },
    }),
  } as unknown as Parameters<typeof replayCall>[0];
  const timeouts = expect.objectContaining({
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });

  beforeEach(() => request.mockClear());

  test('a send', async () => {
    await sendAndRecord(store, {
      method: 'GET',
      url,
      queryRows: [],
      headerRows: [],
    });
    expect(request).toHaveBeenCalledWith(url, timeouts);
  });

  test('a replay', async () => {
    await replayCall(store, 'some-id');
    expect(request).toHaveBeenCalledWith(url, timeouts);
  });
});

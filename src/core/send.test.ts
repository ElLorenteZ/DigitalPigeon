import { beforeEach, describe, expect, test, vi } from 'vitest';
import { classifySendError, replayCall, sendAndRecord } from './send';

const request = vi.hoisted(() =>
  vi.fn(async (_url: string, _options: object) => ({
    statusCode: 200,
    headers: {},
    body: (async function* () {})(),
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
    ['UND_ERR_REQ_CONTENT_LENGTH_MISMATCH', 'invalid-request'],
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

  // The headers timer runs during the upload (undici 8.12.3, probed): a body that takes longer to
  // send than the limit would be recorded as a timeout. Second review, finding 2.
  const withBody = (mib: number, bytesOver = 0) =>
    sendAndRecord(
      {
        ...store,
        bodies: { writeBytes: async () => ({ fileId: 'f', length: 1 }) },
      } as unknown as Parameters<typeof sendAndRecord>[0],
      {
        method: 'POST',
        url,
        queryRows: [],
        headerRows: [],
        body: {
          type: 'text',
          text: 'a'.repeat(mib * 1024 * 1024 + bytesOver),
        },
      },
    );

  test('a body under 1 MiB keeps the 30 s', async () => {
    await withBody(1, -1);
    expect(request).toHaveBeenCalledWith(url, timeouts);
  });

  test('a larger body adds one second per MiB to the headers timeout only', async () => {
    await withBody(5, 100);
    expect(request).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ headersTimeout: 35_000, bodyTimeout: 30_000 }),
    );
  });
});

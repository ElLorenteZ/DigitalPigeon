// The codec carries the two values structured clone carried over IPC and JSON does not: bytes and dates
// (research.md, surprise 1). Each sample must still parse with the contract schema it belongs to.
import { describe, expect, it } from 'vitest';
import {
  GetCallResultSchema,
  ListHistoryResultSchema,
  ListRequestGroupsResultSchema,
  ListStatusCodesResultSchema,
  SearchResultSchema,
  ReadBodyResultSchema,
  SendInputSchema,
  SendResultSchema,
} from './ipc-contract';
import { decode, encode } from './wire-codec';

const bytes = (text: string) => new TextEncoder().encode(text);
const sentAt = new Date('2026-11-11T10:00:00.123Z');
const completedAt = new Date('2026-11-11T10:00:01.456Z');

const send = {
  _id: 's1',
  schemaVersion: 1 as const,
  sentAt,
  request: {
    method: 'POST',
    url: 'http://127.0.0.1:9/echo',
    headers: [['content-type', 'application/json']] as [string, string][],
    body: bytes('{"a":1}'),
  },
};
const completion = {
  _id: 'c1',
  schemaVersion: 1 as const,
  sendId: 's1',
  completedAt,
  durationMs: 12,
  response: {
    status: 200,
    headers: [['content-type', 'text/plain']] as [string, string][],
    body: bytes('hello'),
  },
};

const roundTrip = (value: unknown) => decode(encode(value));

describe('wire codec: contract values survive the trip', () => {
  it('a send result keeps its bytes as Uint8Array and its timestamps as Date', () => {
    const value = { ok: true as const, send, completion };
    const back = SendResultSchema.parse(roundTrip(value));
    expect(back).toEqual(value);
    if (!back.ok || !('response' in back.completion)) throw new Error('shape');
    expect(back.send.sentAt).toBeInstanceOf(Date);
    expect(back.completion.response.body).toBeInstanceOf(Uint8Array);
  });

  it('a call detail with a stored-file body and a null completion parses', () => {
    const value = {
      ok: true as const,
      call: {
        state: 'in-flight' as const,
        send: {
          ...send,
          request: {
            ...send.request,
            body: { fileId: 'f1', length: 20_000_000 },
          },
        },
        completion: null,
      },
    };
    expect(GetCallResultSchema.parse(roundTrip(value))).toEqual(value);
  });

  it('a read-body page of 1 MiB comes back byte for byte', () => {
    const page = new Uint8Array(1024 * 1024).map((_, i) => (i * 31) % 256);
    const back = ReadBodyResultSchema.parse(
      roundTrip({ ok: true, bytes: page }),
    );
    expect(back).toEqual({ ok: true, bytes: page });
  });

  it('a send input with a multipart file part parses with its file bytes', () => {
    const value = {
      clientRequestId: 'r1',
      method: 'POST' as const,
      url: '/upload',
      queryRows: [],
      headerRows: [],
      body: {
        type: 'multipart' as const,
        parts: [
          { kind: 'field' as const, name: 'note', value: 'x' },
          {
            kind: 'file' as const,
            name: 'f',
            filename: 'a.bin',
            contentType: 'application/octet-stream',
            bytes: new Uint8Array([0, 255, 1, 254]),
          },
        ],
      },
    };
    const parsed = SendInputSchema.safeParse(value);
    // The sample itself must be valid before the round trip can say anything.
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(SendInputSchema.parse(roundTrip(value))).toEqual(parsed.data);
  });

  it("request groups keep their newest call's timestamps as Date (history-grouping)", () => {
    const { body: _sendBody, ...summarySend } = send.request;
    const { body: _responseBody, ...summaryResponse } = completion.response;
    const latest = {
      state: 'completed' as const,
      send: { ...send, request: summarySend },
      completion: { ...completion, response: summaryResponse },
    };
    const value = {
      ok: true as const,
      groups: [
        {
          method: 'POST',
          path: '/echo',
          auth: { header: 'Cookie' as const, value: 'session=x' },
          count: 3,
          latest,
        },
        { method: 'GET', path: '/', auth: null, count: 1, latest },
      ],
    };
    const parsed = ListRequestGroupsResultSchema.safeParse(value);
    expect(parsed.success, parsed.error?.message).toBe(true);
    const back = ListRequestGroupsResultSchema.parse(roundTrip(value));
    expect(back).toEqual(value);
    if (!back.ok) throw new Error('shape');
    expect(back.groups[0]?.latest.send.sentAt).toBeInstanceOf(Date);
  });

  it("History keeps its calls' timestamps as Date and carries its mark (history-status-filter)", () => {
    const { body: _sendBody, ...summarySend } = send.request;
    const { body: _responseBody, ...summaryResponse } = completion.response;
    const value = {
      ok: true as const,
      calls: [
        {
          state: 'completed' as const,
          send: { ...send, request: summarySend },
          completion: { ...completion, response: summaryResponse },
        },
      ],
      mark: '1:s1:0',
    };
    const parsed = ListHistoryResultSchema.safeParse(value);
    expect(parsed.success, parsed.error?.message).toBe(true);
    const back = ListHistoryResultSchema.parse(roundTrip(value));
    expect(back).toEqual(value);
    if (!back.ok) throw new Error('shape');
    expect(
      back.calls[0]?.state !== 'unreadable' && back.calls[0]?.send.sentAt,
    ).toBeInstanceOf(Date);
  });

  it('status options survive the round trip, No response as the empty value (history-status-filter)', () => {
    const value = {
      ok: true as const,
      options: [
        { value: '404', label: '404', count: 2 },
        { value: '', label: 'No response', count: 1 },
      ],
    };
    expect(ListStatusCodesResultSchema.parse(roundTrip(value))).toEqual(value);
  });

  it('a search result carries its status facet (history-status-filter)', () => {
    const value = {
      ok: true as const,
      calls: [],
      total: 0,
      of: 3,
      facets: {
        method: [],
        environment: [],
        auth: [],
        savedRequest: [],
        status: [
          { value: '500', label: '500', count: 0 },
          { value: '', label: 'No response', count: 2 },
        ],
      },
    };
    const parsed = SearchResultSchema.safeParse(value);
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(SearchResultSchema.parse(roundTrip(value))).toEqual(value);
  });

  it('an empty Uint8Array stays an empty Uint8Array', () => {
    const back = roundTrip({ b: new Uint8Array(0) }) as { b: unknown };
    expect(back.b).toBeInstanceOf(Uint8Array);
    expect(back.b).toEqual(new Uint8Array(0));
  });

  it('a Node Buffer travels as plain bytes', () => {
    const back = roundTrip({ b: Buffer.from([1, 2, 3]) }) as { b: unknown };
    expect(back.b).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(back.b)).toBe(false);
    expect(back.b).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('a 17 MiB array round-trips unchanged', () => {
    const big = new Uint8Array(17 * 1024 * 1024).map((_, i) => i % 251);
    const back = roundTrip({ b: big }) as { b: Uint8Array };
    expect(back.b.length).toBe(big.length);
    expect(Buffer.from(back.b).equals(Buffer.from(big))).toBe(true);
  });

  it('writes bytes and dates as tagged JSON values', () => {
    expect(
      JSON.parse(encode({ b: new Uint8Array([1, 2]), d: sentAt })),
    ).toEqual({
      b: { $bytes: 'AQI=' },
      d: { $date: '2026-11-11T10:00:00.123Z' },
    });
  });
});

describe('wire codec: values that look like tags', () => {
  it('an object with its own toJSON travels as that JSON form', () => {
    const value = {
      url: new URL('http://example.test/a'),
      id: { toJSON: () => 'abc' },
    };
    expect(roundTrip(value)).toEqual({
      url: 'http://example.test/a',
      id: 'abc',
    });
  });
  it('a plain object whose own key is $bytes stays that object', () => {
    const value = { headers: { $bytes: 'AQI=' } };
    expect(roundTrip(value)).toEqual(value);
  });

  it('a plain object whose own key is $date stays that object', () => {
    const value = [{ $date: '2026-11-11T10:00:00.000Z' }];
    expect(roundTrip(value)).toEqual(value);
  });

  it('an escaped object keeps real bytes and dates inside it', () => {
    const value = { $bytes: new Uint8Array([7]), at: sentAt };
    const back = roundTrip(value) as { $bytes: unknown; at: unknown };
    expect(back.$bytes).toEqual(new Uint8Array([7]));
    expect(back.$bytes).toBeInstanceOf(Uint8Array);
    expect(back.at).toEqual(sentAt);
  });

  it('the escape marker itself survives as a key', () => {
    const value = { $object: { $bytes: 'x' } };
    expect(roundTrip(value)).toEqual(value);
  });
});

describe('wire codec: values it refuses', () => {
  it('an Invalid Date is refused rather than sent as null', () => {
    expect(() => encode({ at: new Date(Number.NaN) })).toThrow(RangeError);
  });
});

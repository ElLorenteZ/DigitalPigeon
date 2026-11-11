import { describe, expect, test } from 'vitest';
import {
  CompletionDocSchema,
  CompletionSummarySchema,
  SendDocSchema,
  SendSummarySchema,
} from './call-schema';

const sendFixture = {
  _id: 'send-1',
  schemaVersion: 1,
  sentAt: new Date('2026-11-03T10:00:00Z'),
  request: {
    method: 'GET',
    url: 'http://127.0.0.1:8080/orders?a=1',
    headers: [
      ['host', '127.0.0.1:8080'],
      ['connection', 'keep-alive'],
      ['Authorization', 'Bearer t'],
    ],
    body: null,
  },
};

const responseCompletion = {
  _id: 'completion-1',
  schemaVersion: 1,
  sendId: 'send-1',
  completedAt: new Date('2026-11-03T10:00:01Z'),
  durationMs: 812,
  response: {
    status: 200,
    headers: [['content-type', 'application/json']],
    body: new Uint8Array([0x7b, 0x7d]),
  },
};

const errorCompletion = {
  _id: 'completion-2',
  schemaVersion: 1,
  sendId: 'send-1',
  completedAt: new Date('2026-11-03T10:00:30Z'),
  durationMs: 30_000,
  error: { code: 'timeout', message: 'Headers timeout' },
};

describe('SendDocSchema', () => {
  test('parses a version 1 send document', () => {
    expect(SendDocSchema.parse(sendFixture)).toEqual(sendFixture);
  });

  test('parses a send document holding body bytes', () => {
    const withBody = {
      ...sendFixture,
      request: { ...sendFixture.request, body: new Uint8Array([1, 2]) },
    };
    expect(SendDocSchema.parse(withBody)).toEqual(withBody);
  });

  test('rejects text as a body: the record holds the bytes sent', () => {
    expect(() =>
      SendDocSchema.parse({
        ...sendFixture,
        request: { ...sendFixture.request, body: 'abc' },
      }),
    ).toThrow();
  });

  test('a history row is a send document without its body', () => {
    const { body: _omit, ...request } = sendFixture.request;
    const row = { ...sendFixture, request };
    expect(SendSummarySchema.parse(row)).toEqual(row);
    expect(() => SendDocSchema.parse(row)).toThrow();
  });

  test('rejects an unknown schemaVersion', () => {
    expect(() =>
      SendDocSchema.parse({ ...sendFixture, schemaVersion: 2 }),
    ).toThrow();
  });

  test('rejects a document with a missing field', () => {
    const { sentAt: _omit, ...missing } = sendFixture;
    expect(() => SendDocSchema.parse(missing)).toThrow();
  });

  test('rejects a request body other than null in this version', () => {
    expect(() =>
      SendDocSchema.parse({
        ...sendFixture,
        request: { ...sendFixture.request, body: 'x' },
      }),
    ).toThrow();
  });
});

describe('CompletionDocSchema', () => {
  test('parses a completion with a response', () => {
    expect(CompletionDocSchema.parse(responseCompletion)).toEqual(
      responseCompletion,
    );
  });

  test('parses a completion with an error', () => {
    expect(CompletionDocSchema.parse(errorCompletion)).toEqual(errorCompletion);
  });

  test('parses a completion with an invalid-request error', () => {
    const completion = {
      ...errorCompletion,
      error: { code: 'invalid-request', message: 'invalid X-V header' },
    };
    expect(CompletionDocSchema.parse(completion)).toEqual(completion);
    expect(CompletionSummarySchema.parse(completion)).toEqual(completion);
  });

  test('rejects an error code outside timeout, cancelled, network', () => {
    expect(() =>
      CompletionDocSchema.parse({
        ...errorCompletion,
        error: { code: 'other', message: 'x' },
      }),
    ).toThrow();
  });

  test('rejects a completion with neither response nor error', () => {
    const { error: _omit, ...neither } = errorCompletion;
    expect(() => CompletionDocSchema.parse(neither)).toThrow();
  });

  test('rejects a completion with both response and error', () => {
    expect(() =>
      CompletionDocSchema.parse({
        ...responseCompletion,
        error: errorCompletion.error,
      }),
    ).toThrow();
  });

  test('rejects an unknown schemaVersion', () => {
    expect(() =>
      CompletionDocSchema.parse({ ...responseCompletion, schemaVersion: 2 }),
    ).toThrow();
  });
});

describe('a body stored in a file', () => {
  const ref = { fileId: 'f-1', length: 2_000_000 };
  const send = (body: unknown) => ({
    _id: 's',
    schemaVersion: 1,
    sentAt: new Date(),
    request: { method: 'POST', url: 'http://x/', headers: [], body },
  });
  const completion = (body: unknown) => ({
    _id: 'c',
    schemaVersion: 1,
    sendId: 's',
    completedAt: new Date(),
    durationMs: 1,
    response: { status: 200, headers: [], body },
  });

  test('parses on a send and a completion', () => {
    expect(SendDocSchema.parse(send(ref)).request.body).toEqual(ref);
    expect(CompletionDocSchema.parse(completion(ref))).toMatchObject({
      response: { body: ref },
    });
  });

  test.each([
    ['no length', { fileId: 'f' }],
    ['no file id', { length: 5 }],
    ['an empty file id', { fileId: '', length: 5 }],
    ['a negative length', { fileId: 'f', length: -1 }],
    ['a fractional length', { fileId: 'f', length: 1.5 }],
    ['an extra key', { ...ref, extra: 1 }],
  ])('%s does not parse', (_name, body) => {
    expect(SendDocSchema.safeParse(send(body)).success).toBe(false);
    expect(CompletionDocSchema.safeParse(completion(body)).success).toBe(false);
  });

  test('the error code storage parses', () => {
    const { response: _unused, ...base } = completion(ref);
    expect(
      CompletionDocSchema.safeParse({
        ...base,
        error: { code: 'storage', message: 'x' },
      }).success,
    ).toBe(true);
  });
});

// Slice 5: the environment used and the saved request a send came from (plan.md, phase 1).
describe('a send with an environment and a saved request', () => {
  const linked = {
    ...sendFixture,
    environment: {
      id: 'env-1',
      name: 'staging',
      baseUrl: 'http://127.0.0.1:8080/',
    },
    savedRequestId: 'saved-1',
  };

  test('parses with both, as a send document and as a summary', () => {
    expect(SendDocSchema.parse(linked)).toEqual(linked);
    const { body: _body, ...request } = linked.request;
    expect(SendSummarySchema.parse({ ...linked, request })).toEqual({
      ...linked,
      request,
    });
  });

  test('a document written before slice 5 still parses, without either', () => {
    const parsed = SendDocSchema.parse(sendFixture);
    expect(parsed).not.toHaveProperty('environment');
    expect(parsed).not.toHaveProperty('savedRequestId');
  });

  test.each<[string, unknown]>([
    ['an environment with no baseUrl', { id: 'e', name: 'n' }],
    [
      'an environment with an extra field',
      { id: 'e', name: 'n', baseUrl: 'http://a/', x: 1 },
    ],
    [
      'an environment with an empty id',
      { id: '', name: 'n', baseUrl: 'http://a/' },
    ],
  ])('%s is refused', (_label, environment) => {
    expect(
      SendDocSchema.safeParse({ ...sendFixture, environment }).success,
    ).toBe(false);
  });

  test('an empty saved request id is refused', () => {
    expect(
      SendDocSchema.safeParse({ ...sendFixture, savedRequestId: '' }).success,
    ).toBe(false);
  });
});

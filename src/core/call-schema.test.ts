import { describe, expect, test } from 'vitest';
import { CompletionDocSchema, SendDocSchema } from './call-schema';

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

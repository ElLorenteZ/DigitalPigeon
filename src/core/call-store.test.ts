import { expect, test } from 'vitest';
import type { Db } from 'mongodb';
import { createCallStore } from './call-store';

// A minimal stand-in for Db: createIndex fails on its first call only.
function flakyIndexDb() {
  let createIndexCalls = 0;
  const inserted: unknown[] = [];
  const collection = {
    createIndex: async () => {
      createIndexCalls += 1;
      if (createIndexCalls === 1) throw new Error('not primary');
      return 'ok';
    },
    insertOne: async (doc: unknown) => {
      inserted.push(doc);
    },
  };
  const db = { collection: () => collection } as unknown as Db;
  return { db, createIndexCalls: () => createIndexCalls, inserted };
}

const send = (id: string) => ({
  _id: id,
  schemaVersion: 1 as const,
  sentAt: new Date('2026-11-04T00:00:00Z'),
  request: {
    method: 'GET',
    url: 'http://x/',
    headers: [] as [string, string][],
    body: null,
  },
});

test('a failed index creation is retried on the next insert, not cached', async () => {
  const fake = flakyIndexDb();
  const store = createCallStore(fake.db);

  await expect(store.insertSend(send('a'))).rejects.toThrow('not primary');
  await store.insertSend(send('b'));

  expect(fake.createIndexCalls()).toBeGreaterThan(2);
  expect(fake.inserted).toHaveLength(1);
});

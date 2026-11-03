import { afterAll, beforeAll, expect, test } from 'vitest';
import { type TestDb, openTestDb } from './test-db';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await openTestDb();
});

afterAll(async () => {
  await testDb?.drop();
});

test('the test database carries the dp_test_ prefix', () => {
  expect(testDb.db.databaseName).toMatch(/^dp_test_/);
  expect(testDb.name).toBe(testDb.db.databaseName);
});

test('a document written to the test database reads back', async () => {
  const collection = testDb.db.collection<{ _id: string; value: number }>(
    'smoke',
  );
  await collection.insertOne({ _id: 'a', value: 42 });
  expect(await collection.findOne({ _id: 'a' })).toEqual({
    _id: 'a',
    value: 42,
  });
});

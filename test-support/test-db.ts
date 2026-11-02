import { type Db, MongoClient } from 'mongodb';
import { inject } from 'vitest';
import { assertTestDbName, testDbName } from './test-db-name';

export interface TestDb {
  client: MongoClient;
  db: Db;
  name: string;
  /** Drops the database (through the prefix guard) and closes the client. */
  drop: () => Promise<void>;
}

/**
 * A fresh, uniquely named database on the Compose MongoDB, for one test file.
 * Call in `beforeAll`, and call `drop()` in `afterAll`.
 */
export async function openTestDb(): Promise<TestDb> {
  const client = new MongoClient(inject('mongoUri'));
  await client.connect();
  const name = testDbName();
  assertTestDbName(name);
  const db = client.db(name);

  return {
    client,
    db,
    name,
    drop: async () => {
      try {
        assertTestDbName(db.databaseName);
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    },
  };
}

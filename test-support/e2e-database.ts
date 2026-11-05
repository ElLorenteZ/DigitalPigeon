// A throwaway database for an e2e run of the app. Lives in test-support/ because AGENTS.md allows the
// mongodb driver only in main-process code and test-support/ (review F1, send-and-record).
// The returned env makes the app use the repo .env credentials and a dp_test_* database; the
// environment takes precedence over config.json, so an e2e run never touches real history.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { MongoClient } from 'mongodb';
import { mongoUri } from '../src/core/db-config';
import { assertTestDbName, testDbName } from './test-db-name';

export interface E2eDatabase {
  database: string;
  env: {
    MONGO_ROOT_USER: string;
    MONGO_ROOT_PASSWORD: string;
    DP_MONGO_DB: string;
  };
  /** Drops the database through the prefix guard. */
  drop: () => Promise<void>;
}

// Parsed the same way process.loadEnvFile parses it for the integration setup: quotes, CRLF and
// leading whitespace included (review #10).
function envFile(): Record<string, string | undefined> {
  return parseEnv(readFileSync('.env', 'utf8'));
}

export function createE2eDatabase(): E2eDatabase {
  const { MONGO_ROOT_USER: user, MONGO_ROOT_PASSWORD: password } = envFile();
  if (!user || !password) {
    throw new Error(
      'e2e needs MONGO_ROOT_USER and MONGO_ROOT_PASSWORD in .env',
    );
  }
  const database = testDbName();
  assertTestDbName(database);

  return {
    database,
    env: {
      MONGO_ROOT_USER: user,
      MONGO_ROOT_PASSWORD: password,
      DP_MONGO_DB: database,
    },
    drop: async () => {
      const client = await new MongoClient(
        mongoUri({ user, password, database, host: '127.0.0.1', port: 27017 }),
      ).connect();
      try {
        assertTestDbName(database);
        await client.db(database).dropDatabase();
      } finally {
        await client.close();
      }
    },
  };
}

import { MongoClient } from 'mongodb';
import type { TestProject } from 'vitest/node';
import { TEST_DB_PREFIX, assertTestDbName } from './test-db-name';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

// Vitest 5.0.5 with Vite 8.3.5 cannot print any error thrown from a global setup file: it reports
// "TypeError: code.charCodeAt is not a function" from Vite's source-map lookup instead. The message
// is written to stderr first so the instruction is always shown.
const fail = (message: string): never => {
  console.error(`\n[integration setup] ${message}\n`);
  throw new Error(message);
};

// Runs once per `npm run test:integration`, before any test file.
// Fails the run (never skips it) when MongoDB is unreachable: integration tests gate tier 1
// (context/foundation/test-strategy.md), so a skipped suite would read as a pass.
export default async function setup(project: TestProject): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch (cause) {
    fail(
      'Integration tests need .env with MONGO_ROOT_USER and MONGO_ROOT_PASSWORD. ' +
        `Copy .env.example to .env and set the password. (${describe(cause)})`,
    );
  }

  const user = process.env.MONGO_ROOT_USER;
  const password = process.env.MONGO_ROOT_PASSWORD;
  if (!user || !password) {
    return fail('.env must set MONGO_ROOT_USER and MONGO_ROOT_PASSWORD.');
  }

  const uri =
    `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    '@127.0.0.1:27017/?authSource=admin';

  // ~10 s covers the one-off mongod restart after the root user is created on first start.
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
  } catch (cause) {
    await client.close();
    fail(
      'MongoDB is not reachable on 127.0.0.1:27017. Start it with `docker compose up -d` ' +
        `and check the credentials in .env. (${describe(cause)})`,
    );
  }

  // Leftovers from crashed runs. Every drop goes through the prefix guard.
  try {
    const { databases } = await client
      .db('admin')
      .admin()
      .listDatabases({ nameOnly: true });
    for (const { name } of databases) {
      if (name.startsWith(TEST_DB_PREFIX)) {
        assertTestDbName(name);
        await client.db(name).dropDatabase();
      }
    }
  } finally {
    await client.close();
  }

  project.provide('mongoUri', uri);
}

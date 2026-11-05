// T1.6 — while the database is unreachable, a send is refused and nothing reaches the wire.
import { createServer } from 'node:http';
import { MongoClient } from 'mongodb';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  type CaptureServer,
  startCaptureServer,
} from '../../test-support/capture-server';
import { createCallStore } from './call-store';
import { mongoClientOptions, mongoUri } from './db-config';
import { DatabaseUnavailableError, sendAndRecord } from './send';

let capture: CaptureServer;

beforeEach(async () => {
  capture = await startCaptureServer();
});

afterEach(async () => {
  await capture.close();
});

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('a send is refused within 5 s and never dispatched while MongoDB is unreachable', async () => {
  const port = await closedPort();
  const client = new MongoClient(
    mongoUri({
      user: 'u',
      password: 'p',
      database: 'unused',
      host: '127.0.0.1',
      port,
    }),
    mongoClientOptions,
  );
  const store = createCallStore(client.db('unused'));
  const started = Date.now();

  const error = await sendAndRecord(store, {
    method: 'GET',
    url: `${capture.url}/`,
    queryRows: [],
    headerRows: [],
  }).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(DatabaseUnavailableError);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(capture.requests).toHaveLength(0);
  await client.close();
}, 40_000);

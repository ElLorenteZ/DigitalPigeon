import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { createDbConnection } from './db-connection';

const instant = () => Promise.resolve();

// A connector that refuses `failures` times, then returns a fresh fake client.
function connector(failures: number) {
  let calls = 0;
  const clients: EventEmitter[] = [];
  const connect = async () => {
    calls += 1;
    if (calls <= failures) throw new Error('ECONNREFUSED');
    const client = new EventEmitter();
    clients.push(client);
    return client;
  };
  return { connect, calls: () => calls, clients };
}

describe('createDbConnection', () => {
  test('is not-configured when there is nothing to connect with', async () => {
    const connection = createDbConnection({
      connect: undefined,
      sleep: instant,
    });
    await connection.start();
    expect(connection.status()).toBe('not-configured');
  });

  test('is connecting until the first attempt settles', async () => {
    let release!: () => void;
    const connection = createDbConnection({
      connect: () =>
        new Promise<EventEmitter>((resolve) => {
          release = () => resolve(new EventEmitter());
        }),
      sleep: instant,
    });
    const started = connection.start();
    expect(connection.status()).toBe('connecting');
    release();
    await started;
    expect(connection.status()).toBe('up');
  });

  test('retries a refused connection and is up after it succeeds within the bound', async () => {
    const c = connector(3);
    const connection = createDbConnection({
      connect: c.connect,
      attemptsBeforeDown: 5,
      sleep: instant,
    });
    await connection.start();

    expect(connection.status()).toBe('up');
    expect(c.calls()).toBe(4);
    expect(connection.client()).toBe(c.clients[0]);
  });

  test('is down once the bound is reached, and comes up when a later retry succeeds', async () => {
    const c = connector(6);
    const connection = createDbConnection({
      connect: c.connect,
      attemptsBeforeDown: 3,
      sleep: instant,
    });
    await connection.start();

    expect(['down', 'up']).toContain(connection.status());
    expect(c.calls()).toBeGreaterThanOrEqual(3);
    await vi.waitFor(() => expect(connection.status()).toBe('up'));
    expect(c.calls()).toBe(7);
    connection.stop();
  });

  test('reports down after the bound while retries keep failing', async () => {
    const c = connector(Number.POSITIVE_INFINITY);
    let sleeps = 0;
    const connection = createDbConnection({
      connect: c.connect,
      attemptsBeforeDown: 2,
      sleep: async () => {
        sleeps += 1;
        if (sleeps > 5) await new Promise(() => {}); // park the loop
      },
    });
    await connection.start();

    expect(connection.status()).toBe('down');
    connection.stop();
  });

  test('follows heartbeat events after startup: up → down → up', async () => {
    const c = connector(0);
    const connection = createDbConnection({
      connect: c.connect,
      sleep: instant,
    });
    await connection.start();
    const client = c.clients[0];

    client?.emit('serverHeartbeatFailed', {});
    expect(connection.status()).toBe('down');
    client?.emit('serverHeartbeatSucceeded', {});
    expect(connection.status()).toBe('up');
  });

  test('closes a client that connects after stop, and does not report it up', async () => {
    let release!: () => void;
    let closed = 0;
    const late = Object.assign(new EventEmitter(), {
      close: async () => {
        closed += 1;
      },
    });
    const connection = createDbConnection({
      connect: () =>
        new Promise<typeof late>((resolve) => {
          release = () => resolve(late);
        }),
      sleep: instant,
    });
    void connection.start();
    connection.stop();
    release();

    await vi.waitFor(() => expect(closed).toBe(1));
    expect(connection.client()).toBeUndefined();
    expect(connection.status()).not.toBe('up');
  });
});

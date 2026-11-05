// Connection lifecycle with startup retry (test-strategy.md T2.8). mongod restarts once after the
// root user is created on first start, so the first attempts can be refused. After
// `attemptsBeforeDown` failures the status is `down`, and retries continue at the same interval, so
// starting the database later brings the app up without a restart (author decision, phase 3).
// Once connected, status follows the driver's server heartbeat events.
export type DbStatus = 'connecting' | 'up' | 'down' | 'not-configured';

interface Emitter {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  close?: () => Promise<unknown>;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createDbConnection<C extends Emitter>({
  connect,
  attemptsBeforeDown = 5,
  retryDelayMs = 1000,
  sleep = wait,
}: {
  connect: (() => Promise<C>) | undefined;
  attemptsBeforeDown?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  let status: DbStatus = connect ? 'connecting' : 'not-configured';
  let client: C | undefined;
  let stopped = false;

  const start = (): Promise<void> => {
    if (!connect) return Promise.resolve();
    return new Promise<void>((settled) => {
      void (async () => {
        let failures = 0;
        while (!stopped) {
          try {
            const connected = await connect();
            if (stopped) {
              // Quit while this attempt was pending: release the late client instead of keeping it.
              await connected.close?.();
              settled();
              return;
            }
            client = connected;
            status = 'up';
            connected.on('serverHeartbeatFailed', () => {
              status = 'down';
            });
            connected.on('serverHeartbeatSucceeded', () => {
              status = 'up';
            });
            settled();
            return;
          } catch {
            failures += 1;
            if (failures >= attemptsBeforeDown) {
              status = 'down';
              settled();
            }
          }
          await sleep(retryDelayMs);
        }
      })();
    });
  };

  return {
    start,
    status: (): DbStatus => status,
    client: (): C | undefined => client,
    stop: (): void => {
      stopped = true;
    },
  };
}

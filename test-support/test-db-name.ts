import { randomBytes } from 'node:crypto';

// Every database the test harness creates or drops carries this prefix. The guard is the only
// thing between a helper bug and the history database, so every drop goes through it.
export const TEST_DB_PREFIX = 'dp_test_';

export function testDbName(): string {
  return `${TEST_DB_PREFIX}${Date.now()}_${randomBytes(4).toString('hex')}`;
}

export function assertTestDbName(name: string): void {
  if (
    !name.startsWith(TEST_DB_PREFIX) ||
    name.length === TEST_DB_PREFIX.length
  ) {
    throw new Error(
      `Refusing database "${name}": test databases must start with "${TEST_DB_PREFIX}"`,
    );
  }
}

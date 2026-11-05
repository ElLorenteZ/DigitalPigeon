// Where the app's MongoDB credentials come from (plan.md, Approach): the environment first, then
// config.json in Electron's userData directory, because a Finder-launched packaged app has no shell
// environment. DP_MONGO_DB overrides the database name so e2e can use a dp_test_* database.
import { z } from 'zod';

export interface DbConfig {
  user: string;
  password: string;
  database: string;
  host: string;
  port: number;
}

export type ResolvedDbConfig =
  | { kind: 'configured'; source: 'env' | 'file'; config: DbConfig }
  | {
      kind: 'not-configured';
      path: string;
      reason: 'missing' | 'invalid';
      detail?: string;
    };

const DEFAULT_DATABASE = 'digital_pigeon';
const HOST = '127.0.0.1';
const PORT = 27017;

const ConfigFileSchema = z.object({
  user: z.string().min(1),
  password: z.string().min(1),
  database: z.string().min(1).optional(),
});

export function resolveDbConfig({
  env,
  configPath,
  readFile,
}: {
  env: Record<string, string | undefined>;
  configPath: string;
  readFile: (path: string) => string;
}): ResolvedDbConfig {
  const database = (fallback?: string) =>
    env.DP_MONGO_DB || fallback || DEFAULT_DATABASE;

  if (env.MONGO_ROOT_USER && env.MONGO_ROOT_PASSWORD) {
    return {
      kind: 'configured',
      source: 'env',
      config: {
        user: env.MONGO_ROOT_USER,
        password: env.MONGO_ROOT_PASSWORD,
        database: database(),
        host: HOST,
        port: PORT,
      },
    };
  }

  let text: string;
  try {
    text = readFile(configPath);
  } catch {
    return { kind: 'not-configured', path: configPath, reason: 'missing' };
  }

  let parsed: z.infer<typeof ConfigFileSchema>;
  try {
    parsed = ConfigFileSchema.parse(JSON.parse(text));
  } catch (error) {
    return {
      kind: 'not-configured',
      path: configPath,
      reason: 'invalid',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    kind: 'configured',
    source: 'file',
    config: {
      user: parsed.user,
      password: parsed.password,
      database: database(parsed.database),
      host: HOST,
      port: PORT,
    },
  };
}

export function mongoUri({ user, password, host, port }: DbConfig): string {
  return (
    `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/?authSource=admin`
  );
}

/**
 * Client options for the app's MongoDB connection. A short server-selection timeout makes an insert
 * against a database that just went down fail in about 2 s instead of 30 s, and a 2 s heartbeat lets
 * the status indicator notice within a few seconds (plan.md, Approach).
 */
export const mongoClientOptions = {
  serverSelectionTimeoutMS: 2000,
  heartbeatFrequencyMS: 2000,
} as const;

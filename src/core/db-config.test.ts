import { describe, expect, test } from 'vitest';
import { mongoUri, resolveDbConfig } from './db-config';

const PATH = '/Users/me/Library/Application Support/DigitalPigeon/config.json';
const noFile = () => {
  throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
};
const file = (json: unknown) => () => JSON.stringify(json);

describe('resolveDbConfig', () => {
  test('uses the environment when both credentials are set, ignoring the file', () => {
    const result = resolveDbConfig({
      env: { MONGO_ROOT_USER: 'env-user', MONGO_ROOT_PASSWORD: 'env-pw' },
      configPath: PATH,
      readFile: file({ user: 'file-user', password: 'file-pw' }),
    });
    expect(result).toEqual({
      kind: 'configured',
      source: 'env',
      config: {
        user: 'env-user',
        password: 'env-pw',
        database: 'digital_pigeon',
        host: '127.0.0.1',
        port: 27017,
      },
    });
  });

  test('falls back to config.json when the environment has no credentials', () => {
    const result = resolveDbConfig({
      env: {},
      configPath: PATH,
      readFile: file({
        user: 'file-user',
        password: 'file-pw',
        database: 'history',
      }),
    });
    expect(result).toMatchObject({
      kind: 'configured',
      source: 'file',
      config: { user: 'file-user', password: 'file-pw', database: 'history' },
    });
  });

  test('falls back to the file when only one credential is in the environment', () => {
    const result = resolveDbConfig({
      env: { MONGO_ROOT_USER: 'env-user' },
      configPath: PATH,
      readFile: file({ user: 'file-user', password: 'file-pw' }),
    });
    expect(result).toMatchObject({ kind: 'configured', source: 'file' });
  });

  test('defaults the database to digital_pigeon', () => {
    const result = resolveDbConfig({
      env: {},
      configPath: PATH,
      readFile: file({ user: 'u', password: 'p' }),
    });
    expect(result).toMatchObject({ config: { database: 'digital_pigeon' } });
  });

  test('DP_MONGO_DB overrides the database from either source', () => {
    const fromEnv = resolveDbConfig({
      env: {
        MONGO_ROOT_USER: 'u',
        MONGO_ROOT_PASSWORD: 'p',
        DP_MONGO_DB: 'dp_test_1_x',
      },
      configPath: PATH,
      readFile: noFile,
    });
    const fromFile = resolveDbConfig({
      env: { DP_MONGO_DB: 'dp_test_2_y' },
      configPath: PATH,
      readFile: file({ user: 'u', password: 'p', database: 'history' }),
    });
    expect(fromEnv).toMatchObject({ config: { database: 'dp_test_1_x' } });
    expect(fromFile).toMatchObject({ config: { database: 'dp_test_2_y' } });
  });

  test('a missing config file is not-configured, naming the path', () => {
    expect(
      resolveDbConfig({ env: {}, configPath: PATH, readFile: noFile }),
    ).toEqual({
      kind: 'not-configured',
      path: PATH,
      reason: 'missing',
    });
  });

  test('a config file that is not JSON is not-configured, naming the path', () => {
    expect(
      resolveDbConfig({
        env: {},
        configPath: PATH,
        readFile: () => '{ not json',
      }),
    ).toMatchObject({ kind: 'not-configured', path: PATH, reason: 'invalid' });
  });

  test('a config file without credentials is not-configured', () => {
    expect(
      resolveDbConfig({
        env: {},
        configPath: PATH,
        readFile: file({ user: 'u' }),
      }),
    ).toMatchObject({ kind: 'not-configured', path: PATH, reason: 'invalid' });
  });
});

describe('mongoUri', () => {
  test('encodes the credentials and authenticates against admin', () => {
    expect(
      mongoUri({
        user: 'a@b',
        password: 'p:/w',
        database: 'x',
        host: '127.0.0.1',
        port: 27017,
      }),
    ).toBe('mongodb://a%40b:p%3A%2Fw@127.0.0.1:27017/?authSource=admin');
  });
});

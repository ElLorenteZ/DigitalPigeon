// Environments and the active one, against a real MongoDB (plan.md, phase 1).
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import {
  EnvironmentNotFoundError,
  InvalidEnvironmentError,
  createEnvironmentStore,
  resolveEnvironment,
} from './environment-store';
import { InvalidBaseUrlError, NoActiveEnvironmentError } from './url';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await openTestDb();
});

afterAll(async () => {
  await testDb?.drop();
});

beforeEach(async () => {
  await testDb.db.collection('environments').deleteMany({});
  await testDb.db.collection('settings').deleteMany({});
});

const store = () => createEnvironmentStore(testDb.db);

describe('environments', () => {
  test('created, read back, listed by name, with the baseUrl as checkBaseUrl writes it', async () => {
    const staging = await store().create({
      name: 'staging',
      baseUrl: 'HTTPS://Staging.test/v1',
    });
    const dev = await store().create({
      name: 'dev',
      baseUrl: 'http://127.0.0.1:8080',
    });

    expect(staging).toEqual({
      id: expect.any(String),
      name: 'staging',
      baseUrl: 'https://staging.test/v1',
    });
    expect(await store().get(staging.id)).toEqual(staging);
    expect(await store().list()).toEqual([
      { ...dev, baseUrl: 'http://127.0.0.1:8080/' },
      staging,
    ]);
  });

  test('two environments may share a name (plan revision 2, W2)', async () => {
    await store().create({ name: 'test', baseUrl: 'https://a.test' });
    await store().create({ name: 'test', baseUrl: 'https://b.test' });
    expect((await store().list()).map((e) => e.baseUrl)).toEqual([
      'https://a.test/',
      'https://b.test/',
    ]);
  });

  test('an invalid baseUrl or a blank name is refused, and nothing is stored', async () => {
    await expect(
      store().create({ name: 'x', baseUrl: 'https://a.test/?q=1' }),
    ).rejects.toThrow(InvalidBaseUrlError);
    await expect(
      store().create({ name: '  ', baseUrl: 'https://a.test' }),
    ).rejects.toThrow(InvalidEnvironmentError);
    expect(await store().list()).toEqual([]);
  });

  test('updated in place; an unknown id updates nothing', async () => {
    const env = await store().create({ name: 'a', baseUrl: 'https://a.test' });
    expect(
      await store().update(env.id, { name: 'b', baseUrl: 'https://b.test/v2' }),
    ).toEqual({ id: env.id, name: 'b', baseUrl: 'https://b.test/v2' });
    expect(await store().get(env.id)).toEqual({
      id: env.id,
      name: 'b',
      baseUrl: 'https://b.test/v2',
    });
    expect(
      await store().update('no-such-id', {
        name: 'c',
        baseUrl: 'https://c.test',
      }),
    ).toBeNull();
  });

  test('deleted; a deleted one reads as null', async () => {
    const env = await store().create({ name: 'a', baseUrl: 'https://a.test' });
    expect(await store().delete(env.id)).toBe(true);
    expect(await store().get(env.id)).toBeNull();
    expect(await store().delete(env.id)).toBe(false);
  });
});

describe('the active environment', () => {
  test('none at first; set, read back, and cleared', async () => {
    expect(await store().getActive()).toBeNull();
    const env = await store().create({ name: 'a', baseUrl: 'https://a.test' });
    await store().setActive(env.id);
    expect(await store().getActive()).toEqual(env);
    await store().setActive(null);
    expect(await store().getActive()).toBeNull();
  });

  test('an unknown id is refused', async () => {
    await expect(store().setActive('no-such-id')).rejects.toThrow(
      EnvironmentNotFoundError,
    );
  });

  test('deleting the active environment leaves none active', async () => {
    const env = await store().create({ name: 'a', baseUrl: 'https://a.test' });
    await store().setActive(env.id);
    await store().delete(env.id);
    expect(await store().getActive()).toBeNull();
  });
});

// The send names the environment its select shows; main loads it by id (plan revision 2, B1; review R1).
describe('resolveEnvironment', () => {
  test('a path with an environment gives its snapshot as stored', async () => {
    const env = await store().create({
      name: 'a',
      baseUrl: 'https://a.test/v1',
    });
    expect(await resolveEnvironment(store(), env.id, '/orders')).toEqual({
      id: env.id,
      name: 'a',
      baseUrl: 'https://a.test/v1',
    });
  });

  test('a full URL records no environment, even with one chosen or a deleted one named', async () => {
    const env = await store().create({ name: 'a', baseUrl: 'https://a.test' });
    expect(
      await resolveEnvironment(store(), env.id, 'https://b.test/x'),
    ).toBeUndefined();
    await store().delete(env.id);
    expect(
      await resolveEnvironment(store(), env.id, 'https://b.test/x'),
    ).toBeUndefined();
  });

  test('a path with no environment is refused', async () => {
    await expect(resolveEnvironment(store(), null, '/orders')).rejects.toThrow(
      NoActiveEnvironmentError,
    );
  });

  test('a path naming a deleted environment is refused', async () => {
    const env = await store().create({ name: 'a', baseUrl: 'https://a.test' });
    await store().delete(env.id);
    await expect(
      resolveEnvironment(store(), env.id, '/orders'),
    ).rejects.toThrow(EnvironmentNotFoundError);
  });
});

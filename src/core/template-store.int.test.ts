// Slice 10 (openapi-import): an imported spec becomes one source and one template per operation, filed into
// directories; templates list without bodies and open as form content. History is never touched.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { SpecError } from './openapi';
import { createTemplateStore } from './template-store';

let testDb: TestDb;

const spec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Orders API', version: '1' },
  servers: [{ url: 'https://staging.api/v2/' }],
  paths: {
    '/orders': {
      get: { tags: ['orders'], summary: 'List orders' },
      post: {
        tags: ['orders'],
        requestBody: {
          content: { 'application/json': { example: { qty: 1 } } },
        },
      },
    },
    '/customers/{id}': { get: { tags: ['customers'] } },
  },
});

beforeAll(async () => {
  testDb = await openTestDb();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('template store', () => {
  test('an import makes one source and one template per operation, filed by tag', async () => {
    const store = createTemplateStore(testDb.db);
    const sendsBefore = await testDb.db.collection('sends').countDocuments();
    const imported = await store.importOpenApi({
      text: spec,
      filename: 'orders.json',
      grouping: 'tag',
      useEnvironment: true,
    });
    expect(imported.count).toBe(3);

    const sources = await store.list();
    const source = sources.find((s) => s.id === imported.sourceId);
    expect(source?.name).toBe('Orders API');
    expect(source?.kind).toBe('openapi');
    expect(
      source?.templates.map((t) => [t.directory, t.method, t.path, t.name]),
    ).toEqual([
      ['orders', 'GET', '/orders', 'List orders'],
      ['orders', 'POST', '/orders', 'POST /orders'],
      ['customers', 'GET', '/customers/{id}', 'GET /customers/{id}'],
    ]);
    expect(await testDb.db.collection('sends').countDocuments()).toBe(
      sendsBefore,
    );
  });

  test('with the environment, a template URL is the path; without, the spec server joined to it', async () => {
    const store = createTemplateStore(testDb.db);
    const withEnv = await store.importOpenApi({
      text: spec,
      filename: 'a.json',
      grouping: 'path',
      useEnvironment: true,
    });
    const withServer = await store.importOpenApi({
      text: spec,
      filename: 'b.json',
      grouping: 'path',
      useEnvironment: false,
    });
    const first = async (sourceId: string) => {
      const listed = (await store.list()).find((s) => s.id === sourceId);
      return store.get(listed?.templates[1]?.id ?? '');
    };
    expect((await first(withEnv.sourceId))?.request).toEqual({
      method: 'POST',
      url: '/orders',
      queryRows: [],
      headerRows: [],
      body: { type: 'json', text: '{\n  "qty": 1\n}' },
    });
    expect((await first(withServer.sourceId))?.request.url).toBe(
      'https://staging.api/v2/orders',
    );
  });

  test('an invalid spec imports nothing', async () => {
    const store = createTemplateStore(testDb.db);
    const before = await testDb.db.collection('templates').countDocuments();
    await expect(
      store.importOpenApi({
        text: '{"openapi":"2"}',
        filename: 'bad.json',
        grouping: 'tag',
        useEnvironment: true,
      }),
    ).rejects.toThrow(SpecError);
    expect(await testDb.db.collection('templates').countDocuments()).toBe(
      before,
    );
  });

  // Code review of openapi-import, 2: a server URL the form cannot send falls back to the path.
  test('a server URL with variables or another scheme gives the path, not an unusable URL', async () => {
    const store = createTemplateStore(testDb.db);
    for (const url of ['https://{region}.api.test/v1', 'ftp://files.test/']) {
      const imported = await store.importOpenApi({
        text: JSON.stringify({
          openapi: '3.0.0',
          servers: [{ url }],
          paths: { '/pets': { get: {} } },
        }),
        filename: 'v.json',
        grouping: 'tag',
        useEnvironment: false,
      });
      const listed = (await store.list()).find(
        (s) => s.id === imported.sourceId,
      );
      const template = await store.get(listed?.templates[0]?.id ?? '');
      expect(template?.request.url).toBe('/pets');
    }
  });

  test('an unknown template is null', async () => {
    expect(await createTemplateStore(testDb.db).get('nope')).toBeNull();
  });
});

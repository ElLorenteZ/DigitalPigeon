// Slice 10 (openapi-import): an imported spec becomes one source and one template per operation, filed into
// directories; templates list without bodies and open as form content. History is never touched.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { SpecError } from './openapi';
import { BILLING } from '../../test-support/wsdl-fixture';
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
    // Two titles: the same title would be a re-import (slice 11).
    const titled = (title: string) =>
      JSON.stringify({ ...JSON.parse(spec), info: { title, version: '1' } });
    const withEnv = await store.importOpenApi({
      text: titled('Env API'),
      filename: 'a.json',
      grouping: 'path',
      useEnvironment: true,
    });
    const withServer = await store.importOpenApi({
      text: titled('Server API'),
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
        mode: 'new',
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

  // Slice 11: the same spec (kind and title) re-imported updates in place: ids kept, new added, gone removed.
  test('re-importing the same spec updates its templates in place, and History is untouched', async () => {
    const store = createTemplateStore(testDb.db);
    const v1 = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Reimport API' },
      paths: {
        '/a': { get: { summary: 'A one' } },
        '/b': { get: {} },
      },
    });
    const v2 = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Reimport API' },
      paths: {
        '/a': { get: { summary: 'A two' } },
        '/c': { post: {} },
      },
    });
    const first = await store.importOpenApi({
      text: v1,
      filename: 'v1.json',
      grouping: 'tag',
      useEnvironment: true,
    });
    const before = (await store.list()).find((s) => s.id === first.sourceId);
    const aId = before?.templates.find((t) => t.path === '/a')?.id;
    const sends = await testDb.db.collection('sends').countDocuments();
    const completions = await testDb.db
      .collection('completions')
      .countDocuments();

    const second = await store.importOpenApi({
      text: v2,
      filename: 'v2.json',
      grouping: 'tag',
      useEnvironment: true,
    });
    expect(second).toMatchObject({
      sourceId: first.sourceId,
      reimported: true,
      added: 1,
      updated: 1,
      removed: 1,
    });
    const sources = (await store.list()).filter(
      (s) => s.name === 'Reimport API',
    );
    expect(sources).toHaveLength(1);
    expect(
      sources[0]?.templates.map((t) => [t.method, t.path, t.name]),
    ).toEqual([
      ['GET', '/a', 'A two'],
      ['POST', '/c', 'POST /c'],
    ]);
    expect(sources[0]?.templates[0]?.id).toBe(aId);
    expect(await testDb.db.collection('sends').countDocuments()).toBe(sends);
    expect(await testDb.db.collection('completions').countDocuments()).toBe(
      completions,
    );
  });

  // Code review of reimport-and-errors, 1, 2, 5, 6 and 7.
  describe('re-import identity and order', () => {
    const doc = (
      title: string | undefined,
      paths: Record<string, unknown>,
      servers?: string[],
    ) =>
      JSON.stringify({
        openapi: '3.0.0',
        ...(title ? { info: { title } } : {}),
        ...(servers ? { servers: servers.map((url) => ({ url })) } : {}),
        paths,
      });
    const input = (
      text: string,
      mode: 'new' | 'reimport' = 'new',
      useEnvironment = true,
    ) => ({
      text,
      filename: 'f.json',
      grouping: 'tag' as const,
      useEnvironment,
      mode,
    });

    test('two untitled specs are two sources', async () => {
      const store = createTemplateStore(testDb.db);
      const a = await store.importOpenApi(
        input(doc(undefined, { '/ua': { get: {} } })),
      );
      const b = await store.importOpenApi(
        input(doc(undefined, { '/ub': { get: {} } }), 'reimport'),
      );
      expect(b.sourceId).not.toBe(a.sourceId);
      const listed = await store.list();
      expect(
        listed.find((s) => s.id === a.sourceId)?.templates.map((t) => t.path),
      ).toEqual(['/ua']);
    });

    test('a template keeps its id whether its URL is the path or the server URL', async () => {
      const store = createTemplateStore(testDb.db);
      const text = doc('Keyed API', { '/k': { get: {} } }, [
        'https://api.test/v1',
      ]);
      const first = await store.importOpenApi(input(text, 'new', true));
      const id = (await store.list()).find((s) => s.id === first.sourceId)
        ?.templates[0]?.id;
      const again = await store.importOpenApi(input(text, 'reimport', false));
      expect(again).toMatchObject({ updated: 1, added: 0, removed: 0 });
      expect(
        (await store.list()).find((s) => s.id === first.sourceId)?.templates[0]
          ?.id,
      ).toBe(id);
    });

    test('an import that would overwrite an existing source is refused unless it asked to re-import', async () => {
      const store = createTemplateStore(testDb.db);
      const text = doc('Guarded API', { '/g': { get: {} } });
      await store.importOpenApi(input(text));
      await expect(store.importOpenApi(input(text, 'new'))).rejects.toThrow(
        /already imported/,
      );
    });

    test('re-importing keeps the source in its place in the tree', async () => {
      const store = createTemplateStore(testDb.db);
      const one = await store.importOpenApi(
        input(doc('Order One', { '/1': { get: {} } })),
      );
      await store.importOpenApi(input(doc('Order Two', { '/2': { get: {} } })));
      await store.importOpenApi(
        input(doc('Order One', { '/1': { get: {} } }), 'reimport'),
      );
      const names = (await store.list()).map((s) => s.name);
      expect(names.indexOf('Order One')).toBeLessThan(
        names.indexOf('Order Two'),
      );
      expect(one.sourceId).toBeDefined();
    });

    test('re-importing collapses duplicate sources left by slice 10 into the oldest', async () => {
      const store = createTemplateStore(testDb.db);
      const sources = testDb.db.collection('templateSources');
      const old = await store.importOpenApi(
        input(doc('Dup API', { '/d': { get: {} } })),
      );
      // A second copy, as slice 10 could make.
      await sources.insertOne({
        _id: 'dup-copy' as never,
        name: 'Dup API',
        kind: 'openapi',
        filename: 'x',
        grouping: 'tag',
        importedAt: new Date(),
        createdAt: new Date(),
      });
      const again = await store.importOpenApi(
        input(doc('Dup API', { '/d': { get: {} } }), 'reimport'),
      );
      expect(again.sourceId).toBe(old.sourceId);
      expect(await sources.countDocuments({ name: 'Dup API' })).toBe(1);
    });
  });

  // Slice 12: a WSDL file is a source of SOAP templates, filed by port, re-imported in place like OpenAPI.
  describe('WSDL', () => {
    test('an import files one SOAP template per operation by port', async () => {
      const store = createTemplateStore(testDb.db);
      const imported = await store.importWsdl({
        text: BILLING,
        filename: 'billing.wsdl',
        mode: 'new',
      });
      expect(imported).toMatchObject({ count: 4, reimported: false });
      const source = (await store.list()).find(
        (s) => s.id === imported.sourceId,
      );
      expect(source?.kind).toBe('wsdl');
      expect(source?.name).toBe('BillingService');
      expect(
        source?.templates.map((t) => [t.directory, t.method, t.path]),
      ).toEqual([
        ['BillingPort', 'POST', 'CreateInvoice'],
        ['BillingPort', 'POST', 'GetInvoice'],
        ['BillingPort12', 'POST', 'CreateInvoice'],
        ['BillingPort12', 'POST', 'GetInvoice'],
      ]);
      const first = await store.get(source?.templates[0]?.id ?? '');
      expect(first?.request.url).toBe('http://localhost:8080/billing');
      expect(first?.request.headerRows).toContainEqual([
        'SOAPAction',
        '"urn:CreateInvoice"',
      ]);
    });

    test('re-importing the same WSDL updates in place', async () => {
      const store = createTemplateStore(testDb.db);
      const again = await store.importWsdl({
        text: BILLING.replace(
          /<operation name="GetInvoice">[\s\S]*?<\/operation>/g,
          '',
        ),
        filename: 'billing-v2.wsdl',
        mode: 'reimport',
      });
      expect(again).toMatchObject({
        reimported: true,
        updated: 2,
        added: 0,
        removed: 2,
      });
    });

    test('an invalid WSDL imports nothing', async () => {
      const store = createTemplateStore(testDb.db);
      const before = await testDb.db.collection('templates').countDocuments();
      await expect(
        store.importWsdl({
          text: '<definitions><oops></definitions>',
          filename: 'x.wsdl',
          mode: 'new',
        }),
      ).rejects.toThrow(SpecError);
      expect(await testDb.db.collection('templates').countDocuments()).toBe(
        before,
      );
    });
  });

  test('an unknown template is null', async () => {
    expect(await createTemplateStore(testDb.db).get('nope')).toBeNull();
  });
});

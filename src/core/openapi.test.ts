// Slice 10 (openapi-import): OpenAPI 3.x JSON into one template per operation, filed by tag or first path segment.
import { describe, expect, it } from 'vitest';
import { SpecError, groupOperations, parseOpenApi } from './openapi';

const spec = {
  openapi: '3.1.0',
  info: { title: 'Orders API', version: '2.4' },
  servers: [{ url: 'https://staging.api/v2' }],
  paths: {
    '/orders': {
      parameters: [{ name: 'X-Tenant', in: 'header', required: true }],
      get: {
        tags: ['orders'],
        summary: 'List orders',
        parameters: [
          { name: 'page', in: 'query' },
          { name: 'X-Tenant', in: 'header', example: 'acme' },
        ],
      },
      post: {
        tags: ['orders'],
        operationId: 'createOrder',
        requestBody: {
          content: {
            'application/json': { example: { sku: 'PGN-01', qty: 2 } },
          },
        },
      },
    },
    '/orders/{id}': {
      delete: { tags: ['orders'] },
      patch: {
        tags: ['orders'],
        requestBody: {
          content: {
            'application/json': {
              examples: { first: { value: { qty: 3 } } },
            },
          },
        },
      },
    },
    '/customers': { get: {} },
    '/': { options: { tags: ['meta'] } },
  },
};

describe('parseOpenApi', () => {
  it('reads the title, version and servers', () => {
    const parsed = parseOpenApi(JSON.stringify(spec));
    expect(parsed.title).toBe('Orders API');
    expect(parsed.version).toBe('2.4');
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.servers).toEqual(['https://staging.api/v2']);
  });

  it('makes one operation per path and method, in spec order', () => {
    const ops = parseOpenApi(JSON.stringify(spec)).operations;
    expect(ops.map((o) => `${o.method} ${o.path}`)).toEqual([
      'GET /orders',
      'POST /orders',
      'DELETE /orders/{id}',
      'PATCH /orders/{id}',
      'GET /customers',
      'OPTIONS /',
    ]);
  });

  it('names an operation by its summary, else its operationId, else method and path', () => {
    const ops = parseOpenApi(JSON.stringify(spec)).operations;
    expect(ops[0]?.name).toBe('List orders');
    expect(ops[1]?.name).toBe('createOrder');
    expect(ops[2]?.name).toBe('DELETE /orders/{id}');
  });

  it('merges path-level and operation-level parameters, the operation winning', () => {
    const get = parseOpenApi(JSON.stringify(spec)).operations[0];
    expect(get?.queryRows).toEqual([['page', '']]);
    expect(get?.headerRows).toEqual([['X-Tenant', 'acme']]);
    const post = parseOpenApi(JSON.stringify(spec)).operations[1];
    expect(post?.headerRows).toEqual([['X-Tenant', '']]);
  });

  it('takes a JSON request body from example, else the first of examples', () => {
    const ops = parseOpenApi(JSON.stringify(spec)).operations;
    expect(ops[1]?.body).toEqual({
      type: 'json',
      text: JSON.stringify({ sku: 'PGN-01', qty: 2 }, null, 2),
    });
    expect(ops[3]?.body).toEqual({
      type: 'json',
      text: JSON.stringify({ qty: 3 }, null, 2),
    });
    expect(ops[0]?.body).toEqual({ type: 'none' });
  });

  it('refuses what is not OpenAPI 3 JSON, saying why', () => {
    expect(() => parseOpenApi('{not json')).toThrow(SpecError);
    expect(() => parseOpenApi('{not json')).toThrow(/not valid JSON/);
    expect(() => parseOpenApi('{"swagger":"2.0","paths":{}}')).toThrow(
      /OpenAPI 3/,
    );
    expect(() => parseOpenApi('{"openapi":"3.0.0"}')).toThrow(/paths/);
  });
});

describe('groupOperations', () => {
  const ops = parseOpenApi(JSON.stringify(spec)).operations;

  it('files by first tag, untagged under "default"', () => {
    const groups = groupOperations(ops, 'tag');
    expect([...groups.keys()]).toEqual(['orders', 'default', 'meta']);
    expect(groups.get('orders')).toHaveLength(4);
  });

  it('files by first path segment, the root path under "root"', () => {
    const groups = groupOperations(ops, 'path');
    expect([...groups.keys()]).toEqual(['orders', 'customers', 'root']);
    expect(groups.get('orders')).toHaveLength(4);
  });
});

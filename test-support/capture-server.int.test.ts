import { request } from 'node:http';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type CaptureServer, startCaptureServer } from './capture-server';

interface ClientResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

// Sends with node:http so the test controls header order and case exactly.
function send(
  url: string,
  options: { method: string; headers: [string, string][]; body?: Buffer },
): Promise<ClientResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    for (const [name, value] of options.headers) req.setHeader(name, value);
    req.end(options.body);
  });
}

// Header names from rawHeaders ([name, value, name, value, ...]), in the order received.
const headerNames = (rawHeaders: string[]) =>
  rawHeaders.filter((_, i) => i % 2 === 0);

let server: CaptureServer;

beforeEach(async () => {
  server = await startCaptureServer();
});

afterEach(async () => {
  await server.close();
});

test('listens on 127.0.0.1 with an ephemeral port', () => {
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(server.url).not.toMatch(/:0$/);
});

test('records the method and the URL path with its query', async () => {
  await send(`${server.url}/orders/12?expand=items&x=%20y`, {
    method: 'PATCH',
    headers: [],
  });

  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.method).toBe('PATCH');
  expect(server.requests[0]?.url).toBe('/orders/12?expand=items&x=%20y');
});

test('records header names in the order and case they were sent', async () => {
  await send(`${server.url}/`, {
    method: 'GET',
    headers: [
      ['X-Zeta', '1'],
      ['a-Alpha', '2'],
      ['Content-Type', 'text/plain'],
    ],
  });

  const names = headerNames(server.requests[0]?.rawHeaders ?? []);
  const sent = names.filter((name) =>
    ['x-zeta', 'a-alpha', 'content-type'].includes(name.toLowerCase()),
  );
  expect(sent).toEqual(['X-Zeta', 'a-Alpha', 'Content-Type']);
});

test('records the body as the exact bytes sent, including non-UTF-8 bytes', async () => {
  const body = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x7f, 0xc3, 0x28, 0x0a]);
  await send(`${server.url}/upload`, {
    method: 'POST',
    headers: [['Content-Type', 'application/octet-stream']],
    body,
  });

  expect(server.requests[0]?.body.equals(body)).toBe(true);
});

test('records each request separately, in order', async () => {
  await send(`${server.url}/first`, { method: 'GET', headers: [] });
  await send(`${server.url}/second`, { method: 'GET', headers: [] });

  expect(server.requests.map((r) => r.url)).toEqual(['/first', '/second']);
});

test('responds with the configured status, headers and body', async () => {
  server.respondWith({
    status: 201,
    headers: { 'X-Served-By': 'capture' },
    body: Buffer.from('{"id":7}'),
  });

  const res = await send(`${server.url}/`, { method: 'POST', headers: [] });

  expect(res.status).toBe(201);
  expect(res.headers['x-served-by']).toBe('capture');
  expect(res.body.toString()).toBe('{"id":7}');
});

test('stops accepting connections after close', async () => {
  const url = server.url;
  await server.close();

  await expect(send(`${url}/`, { method: 'GET', headers: [] })).rejects.toThrow(
    /ECONNREFUSED/,
  );

  server = await startCaptureServer(); // for afterEach
});

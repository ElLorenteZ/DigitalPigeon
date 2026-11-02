// A local HTTP server for integration tests that records each request as received:
// method, URL (path and query), raw header names and values in order and case, and the body as
// bytes. Used to compare what was sent on the wire with what a call record or replay claims
// (test-strategy.md T1.2–T1.4).
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedRequest {
  method: string;
  /** Path and query, as received. */
  url: string;
  /** `[name, value, name, value, ...]` in the order and case received (`req.rawHeaders`). */
  rawHeaders: string[];
  body: Buffer;
}

export interface CaptureResponse {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer;
}

export interface CaptureServer {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  url: string;
  requests: CapturedRequest[];
  /** Sets the response served to every following request. Defaults to 200 with an empty body. */
  respondWith: (response: CaptureResponse) => void;
  close: () => Promise<void>;
}

export async function startCaptureServer(): Promise<CaptureServer> {
  const requests: CapturedRequest[] = [];
  let response: CaptureResponse = { status: 200 };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        rawHeaders: [...req.rawHeaders],
        body: Buffer.concat(chunks),
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respondWith: (next) => {
      response = next;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

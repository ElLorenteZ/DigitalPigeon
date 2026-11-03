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
  complete: boolean;
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
  bytesReceived: () => number;
  close: () => Promise<void>;
}

export async function startCaptureServer(): Promise<CaptureServer> {
  const requests: CapturedRequest[] = [];
  let response: CaptureResponse = { status: 200 };

  let bytesReceived = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let ended = false;
    const record = (complete: boolean) =>
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        rawHeaders: [...req.rawHeaders],
        body: Buffer.concat(chunks),
        complete,
      });

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      bytesReceived += chunk.length;
    });
    req.on('end', () => {
      ended = true;
      record(true);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    });
    // A client that aborts mid-body never reaches 'end'; record what arrived.
    req.on('error', () => {});
    req.on('close', () => {
      if (!ended) record(false);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respondWith: (next) => {
      response = next;
    },
    bytesReceived: () => bytesReceived,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

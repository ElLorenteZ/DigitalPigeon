// Slice 12 (wsdl-import), lesson "Probe what undici does": SOAPAction and an action parameter in Content-Type are new
// header shapes. A SOAP template sent through sendAndRecord reaches the server with exactly the recorded headers and
// the envelope's bytes (T1.3).
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'vitest';
import {
  type CaptureServer,
  startCaptureServer,
} from '../../test-support/capture-server';
import { type TestDb, openTestDb } from '../../test-support/test-db';
import { createCallStore } from './call-store';
import { sendAndRecord } from './send';
import { parseWsdl, soapTemplate } from './wsdl';
import { BILLING } from '../../test-support/wsdl-fixture';

let testDb: TestDb;
let capture: CaptureServer;

beforeAll(async () => {
  testDb = await openTestDb();
});
afterAll(async () => {
  await testDb?.drop();
});
beforeEach(async () => {
  capture = await startCaptureServer();
});
afterEach(async () => {
  await capture.close();
});

const pairs = (raw: string[]) => {
  const out: [string, string][] = [];
  for (let i = 0; i < raw.length; i += 2)
    out.push([raw[i] as string, raw[i + 1] as string]);
  return out;
};

test.each(['1.1', '1.2'] as const)(
  'a SOAP %s template arrives as recorded: headers in order and the envelope bytes',
  async (version) => {
    const port = parseWsdl(BILLING).ports.find((p) => p.soap === version)!;
    const template = soapTemplate(
      { ...port, address: `${capture.url}/billing` },
      port.operations[0]!,
    );
    capture.respondWith({ status: 200, body: Buffer.from('<ok/>') });
    const call = await sendAndRecord(createCallStore(testDb.db), template);

    const received = capture.requests.at(-1);
    expect(received?.method).toBe('POST');
    expect(pairs(received?.rawHeaders ?? [])).toEqual(
      call.send.request.headers,
    );
    const soapHeaders = call.send.request.headers.filter(([n]) =>
      /^(content-type|soapaction)$/i.test(n),
    );
    expect(soapHeaders).toEqual(template.headerRows);
    expect(received?.body.toString('utf8')).toBe(
      template.body?.type === 'xml' ? template.body.text : '',
    );
    expect(call.completion).toMatchObject({ response: { status: 200 } });
  },
);

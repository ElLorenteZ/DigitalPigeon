import { describe, expect, test } from 'vitest';
import { formFromCall } from './form-from-call';
import { type WireInput, buildWireRequest } from './wire';

const typed = (over: Partial<WireInput> = {}): WireInput => ({
  method: 'GET',
  url: 'http://api.test:8080/orders?x=1',
  queryRows: [],
  headerRows: [],
  ...over,
});

describe('round trip: buildWireRequest(formFromCall(recorded)) equals recorded', () => {
  test.each<[string, Partial<WireInput>]>([
    ['no typed headers', {}],
    [
      'headers in order and case',
      {
        headerRows: [
          ['X-Zeta', '1'],
          ['accept', '*/*'],
        ],
      },
    ],
    ['query rows, merged into the URL', { queryRows: [['q', 'two words']] }],
    [
      'duplicate names and an empty value',
      {
        headerRows: [
          ['X-D', '1'],
          ['X-D', '2'],
          ['X-E', ''],
        ],
      },
    ],
    ['a typed Host', { headerRows: [['Host', 'other.test']] }],
    ['a typed Connection', { headerRows: [['Connection', 'close']] }],
    [
      'a typed Connection undici ignores',
      { headerRows: [['Connection', 'Upgrade']] },
    ],
    ['HEAD', { method: 'HEAD', headerRows: [['X-A', '1']] }],
    ['POST', { method: 'POST', headerRows: [['X-A', '1']] }],
    ['PUT', { method: 'PUT' }],
    ['PATCH', { method: 'PATCH' }],
    ['DELETE', { method: 'DELETE' }],
    ['OPTIONS', { method: 'OPTIONS' }],
  ])('%s', (_label, over) => {
    const recorded = buildWireRequest(typed(over));
    expect(buildWireRequest(formFromCall(recorded))).toEqual(recorded);
  });
});

describe('formFromCall', () => {
  test('loads the recorded URL with its query, and no query rows', () => {
    const recorded = buildWireRequest(typed({ queryRows: [['q', '1']] }));
    expect(formFromCall(recorded)).toMatchObject({
      method: 'GET',
      url: 'http://api.test:8080/orders?x=1&q=1',
      queryRows: [],
    });
  });

  test('hides managed headers that equal what wire.ts generates', () => {
    const recorded = buildWireRequest(
      typed({ method: 'POST', headerRows: [['X-A', '1']] }),
    );
    expect(formFromCall(recorded).headerRows).toEqual([['X-A', '1']]);
  });

  test('hides connection: close on HEAD, which wire.ts generates', () => {
    const recorded = buildWireRequest(typed({ method: 'HEAD' }));
    expect(formFromCall(recorded).headerRows).toEqual([]);
  });

  test('keeps a typed Host and a typed Connection as rows', () => {
    const recorded = buildWireRequest(
      typed({
        headerRows: [
          ['Host', 'other.test'],
          ['Connection', 'close'],
          ['X-A', '1'],
        ],
      }),
    );
    expect(formFromCall(recorded).headerRows).toEqual([
      ['host', 'other.test'],
      ['connection', 'close'],
      ['X-A', '1'],
    ]);
  });

  test('changing the URL after loading sends the new host', () => {
    const form = formFromCall(buildWireRequest(typed()));
    const edited = buildWireRequest({ ...form, url: 'http://new.test/orders' });
    expect(edited.headers[0]).toEqual(['host', 'new.test']);
  });

  test('changing the method after loading recomputes the managed headers', () => {
    const form = formFromCall(buildWireRequest(typed({ method: 'POST' })));
    const edited = buildWireRequest({ ...form, method: 'GET' });
    expect(edited.headers).toEqual([
      ['host', 'api.test:8080'],
      ['connection', 'keep-alive'],
    ]);
  });
});

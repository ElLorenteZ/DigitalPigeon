import { describe, expect, test } from 'vitest';
import {
  MultipartScanError,
  type Part,
  chooseBoundary,
  createPartScanner,
  encodeMultipart,
  multipartBoundary,
  parseMultipart,
} from './multipart';

const utf8 = (text: string) => new TextEncoder().encode(text);
const latin = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const field = (name: string, value: string): Part => ({
  kind: 'field',
  name,
  value,
});
const file = (
  name: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array<ArrayBuffer>,
): Part => ({ kind: 'file', name, filename, contentType, bytes });

describe('encodeMultipart', () => {
  test('writes each part between delimiter lines and ends with the close delimiter', () => {
    const body = encodeMultipart(
      [field('note', 'hello'), file('doc', 'a.txt', 'text/plain', utf8('abc'))],
      'BND',
    );
    expect(new TextDecoder().decode(body)).toBe(
      '--BND\r\n' +
        'Content-Disposition: form-data; name="note"\r\n' +
        '\r\n' +
        'hello\r\n' +
        '--BND\r\n' +
        'Content-Disposition: form-data; name="doc"; filename="a.txt"\r\n' +
        'Content-Type: text/plain\r\n' +
        '\r\n' +
        'abc\r\n' +
        '--BND--\r\n',
    );
  });

  test('copies file bytes unchanged, including NUL, CR, LF and bytes above 0x7f', () => {
    const bytes = new Uint8Array([0x00, 0x0d, 0x0a, 0xff, 0x2d, 0x2d, 0x41]);
    const body = encodeMultipart(
      [file('f', 'b.bin', 'application/octet-stream', bytes)],
      'BND',
    );
    const head = utf8(
      '--BND\r\nContent-Disposition: form-data; name="f"; filename="b.bin"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    expect(latin(body)).toBe(latin(head) + latin(bytes) + '\r\n--BND--\r\n');
  });

  test('writes names, values and filenames as UTF-8', () => {
    const body = encodeMultipart(
      [
        field('pole', 'zażółć'),
        file('plik', 'gęś.txt', 'text/plain', utf8('x')),
      ],
      'B',
    );
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    expect(text).toContain('name="pole"\r\n\r\nzażółć\r\n');
    expect(text).toContain('name="plik"; filename="gęś.txt"\r\n');
  });

  test('escapes a quote, CR and LF in names and filenames as browsers do', () => {
    const body = new TextDecoder().decode(
      encodeMultipart(
        [file('a"b\rc\nd', 'x"y\r\nz.txt', 'text/plain', utf8(''))],
        'B',
      ),
    );
    expect(body).toContain(
      'Content-Disposition: form-data; name="a%22b%0Dc%0Ad"; filename="x%22y%0D%0Az.txt"\r\n',
    );
  });

  test('leaves a field value as written, line breaks included', () => {
    const body = new TextDecoder().decode(
      encodeMultipart([field('n', 'a\r\nb\nc"d')], 'B'),
    );
    expect(body).toContain('name="n"\r\n\r\na\r\nb\nc"d\r\n--B--');
  });

  test('writes an empty filename as filename=""', () => {
    const body = new TextDecoder().decode(
      encodeMultipart([file('f', '', 'text/plain', utf8('x'))], 'B'),
    );
    expect(body).toContain('name="f"; filename=""\r\n');
  });

  test('writes application/octet-stream when the file has no content type', () => {
    const body = new TextDecoder().decode(
      encodeMultipart([file('f', 'x.dat', '', utf8('x'))], 'B'),
    );
    expect(body).toContain('\r\nContent-Type: application/octet-stream\r\n');
  });

  // The browser's guess from the extension is sent as reported (spike-file-input-ipc.md).
  test('writes the content type the browser reported, such as application/macbinary for .bin', () => {
    const body = new TextDecoder().decode(
      encodeMultipart(
        [file('f', 'x.bin', 'application/macbinary', utf8('x'))],
        'B',
      ),
    );
    expect(body).toContain('\r\nContent-Type: application/macbinary\r\n');
  });
});

describe('chooseBoundary', () => {
  test('returns ----dp followed by 30 characters from [0-9a-z]', () => {
    expect(chooseBoundary([field('a', 'b')])).toMatch(/^----dp[0-9a-z]{30}$/);
  });

  test('two calls give different boundaries', () => {
    expect(chooseBoundary([])).not.toBe(chooseBoundary([]));
  });

  test('draws again when the boundary occurs inside a file part', () => {
    const taken = `----dp${'a'.repeat(30)}`;
    const free = `----dp${'b'.repeat(30)}`;
    const draws = [taken, free];
    const chosen = chooseBoundary(
      [file('f', 'x', '', utf8(`before ${taken} after`))],
      () => draws.shift() ?? 'unexpected',
    );
    expect(chosen).toBe(free);
  });

  test('draws again when the boundary occurs inside a field value or a name', () => {
    const first = `----dp${'c'.repeat(30)}`;
    const second = `----dp${'d'.repeat(30)}`;
    const third = `----dp${'e'.repeat(30)}`;
    const draws = [first, second, third];
    const chosen = chooseBoundary(
      [field('n', `x${first}`), field(`y${second}`, 'v')],
      () => draws.shift() ?? 'unexpected',
    );
    expect(chosen).toBe(third);
  });
});

describe('multipartBoundary', () => {
  test.each<[string, string | undefined]>([
    ['multipart/form-data; boundary=abc', 'abc'],
    ['Multipart/Form-Data; Boundary=abc', 'abc'],
    ['multipart/form-data; charset=utf-8; boundary="a b"', 'a b'],
    ['multipart/form-data;boundary=x-y', 'x-y'],
    ['multipart/form-data', undefined],
    ['multipart/mixed; boundary=abc', undefined],
    ['text/plain; boundary=abc', undefined],
    ['multipart/form-data; boundary=', undefined],
  ])('%s → %s', (header, expected) => {
    expect(multipartBoundary(header)).toBe(expected);
  });
});

describe('createPartScanner', () => {
  const boundary = 'BND';
  const parts: Part[] = [
    field('note', 'zażółć\r\nline 2'),
    file(
      'doc',
      'a.bin',
      'application/octet-stream',
      new Uint8Array([0, 13, 10, 45, 45, 66]),
    ),
    field('empty', ''),
    file('t', 'b.txt', 'text/plain', utf8('x\r\n--BN\r\n--BNE')),
  ];
  const body = encodeMultipart(parts, boundary);

  const expected = (() => {
    const text = latin(body);
    const at = (needle: string, from = 0) => text.indexOf(needle, from);
    return [
      {
        name: 'note',
        offset: at('\r\n\r\n', at('name="note"')) + 4,
        length: utf8('zażółć\r\nline 2').length,
      },
      {
        name: 'doc',
        filename: 'a.bin',
        contentType: 'application/octet-stream',
        offset: at('\r\n\r\n', at('name="doc"')) + 4,
        length: 6,
      },
      {
        name: 'empty',
        offset: at('\r\n\r\n', at('name="empty"')) + 4,
        length: 0,
      },
      {
        name: 't',
        filename: 'b.txt',
        contentType: 'text/plain',
        offset: at('\r\n\r\n', at('name="t"')) + 4,
        length: utf8('x\r\n--BN\r\n--BNE').length,
      },
    ];
  })();

  const scan = (pages: Uint8Array[]) => {
    const scanner = createPartScanner(boundary);
    const found = pages.flatMap((page) => scanner.push(page));
    return [...found, ...scanner.end()];
  };

  test('one page gives every part, with offsets and lengths of its content', () => {
    expect(scan([body])).toEqual(expected);
  });

  test('every split into two pages gives the same parts', () => {
    for (let at = 0; at <= body.length; at++) {
      expect(
        scan([body.subarray(0, at), body.subarray(at)]),
        `split at ${at}`,
      ).toEqual(expected);
    }
  });

  test('pages of one byte give the same parts', () => {
    expect(scan([...body].map((b) => new Uint8Array([b])))).toEqual(expected);
  });

  test('a part is returned when it closes, not at the end', () => {
    const scanner = createPartScanner(boundary);
    const end = latin(body).indexOf('--BND', 2) + 5 + 2;
    expect(scanner.push(body.subarray(0, end)).map((p) => p.name)).toEqual([
      'note',
    ]);
  });

  test('a large file part is held only a page plus the boundary at a time', () => {
    const big = new Uint8Array(3 * 1024 * 1024).fill(0x61);
    const large = encodeMultipart([file('f', 'f', '', big)], boundary);
    const scanner = createPartScanner(boundary);
    const found = [];
    for (let at = 0; at < large.length; at += 1024 * 1024) {
      found.push(...scanner.push(large.subarray(at, at + 1024 * 1024)));
      expect(scanner.held()).toBeLessThanOrEqual(1024 * 1024 + 64);
    }
    found.push(...scanner.end());
    expect(found).toEqual([
      expect.objectContaining({ name: 'f', length: big.length }),
    ]);
  });

  test.each<[string, string]>([
    ['no opening delimiter', 'hello'],
    [
      'a preamble before the first delimiter',
      'x\r\n--BND\r\nContent-Disposition: form-data; name="a"\r\n\r\nv\r\n--BND--\r\n',
    ],
    [
      'no close delimiter',
      '--BND\r\nContent-Disposition: form-data; name="a"\r\n\r\nv',
    ],
    [
      'a part with no Content-Disposition',
      '--BND\r\nContent-Type: text/plain\r\n\r\nv\r\n--BND--\r\n',
    ],
    [
      'a disposition other than form-data',
      '--BND\r\nContent-Disposition: attachment; name="a"\r\n\r\nv\r\n--BND--\r\n',
    ],
    [
      'a part head with no blank line',
      '--BND\r\nContent-Disposition: form-data; name="a"\r\nv\r\n--BND--\r\n',
    ],
  ])('%s is reported, not guessed', (_label, text) => {
    expect(() => scan([utf8(text)])).toThrow(MultipartScanError);
  });
});

describe('parseMultipart', () => {
  test('returns the parts that encode back to the same bytes', () => {
    const parts: Part[] = [
      field('note', 'zażółć'),
      file('doc', 'gęś.bin', '', new Uint8Array([0, 255, 13, 10])),
      field('a%22b', 'name escaped by the encoder stays escaped'),
    ];
    const body = encodeMultipart(parts, 'B');
    const parsed = parseMultipart(body, 'B');
    expect(encodeMultipart(parsed, 'B')).toEqual(body);
    expect(parsed[0]).toEqual(field('note', 'zażółć'));
    expect(parsed[1]).toEqual(
      file(
        'doc',
        'gęś.bin',
        'application/octet-stream',
        new Uint8Array([0, 255, 13, 10]),
      ),
    );
  });

  test('a body it cannot read throws MultipartScanError', () => {
    expect(() => parseMultipart(utf8('nope'), 'B')).toThrow(MultipartScanError);
  });
});

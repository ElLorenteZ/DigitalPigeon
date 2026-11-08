import { describe, expect, test } from 'vitest';
import { type BodyKind, bodyKind, createFormatter } from './body-format';

const format = (kind: BodyKind, ...pieces: string[]): string => {
  const formatter = createFormatter(kind);
  return (
    pieces.map((piece) => formatter.push(piece)).join('') + formatter.end()
  );
};

// Removes JSON whitespace outside strings, so what is left is every character the formatter must keep.
const jsonTokens = (text: string): string => {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const c of text) {
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (!' \t\n\r'.includes(c)) {
      out += c;
      if (c === '"') inString = true;
    }
  }
  return out;
};

// Removes whitespace-only text between markup and at either end. Valid for inputs whose quoted values and
// comments hold no '>' followed by whitespace and '<'.
const xmlTokens = (text: string): string =>
  text.replace(/(^|>)[ \t\n\r]+(?=<|$)/g, '$1');

const everySplit = (kind: BodyKind, input: string) => {
  const whole = format(kind, input);
  for (let at = 0; at <= input.length; at += 1) {
    expect(
      format(kind, input.slice(0, at), input.slice(at)),
      `split at ${at}`,
    ).toBe(whole);
  }
  expect(format(kind, ...input.split(''))).toBe(whole);
};

describe('bodyKind', () => {
  test.each<[string, string, BodyKind]>([
    ['application/json', 'Content-Type', 'json'],
    ['application/json; charset=utf-8', 'content-type', 'json'],
    ['Application/JSON', 'CONTENT-TYPE', 'json'],
    ['application/problem+json', 'Content-Type', 'json'],
    ['application/vnd.api+json; ext=x', 'Content-Type', 'json'],
    ['application/xml', 'Content-Type', 'xml'],
    ['text/xml; charset=utf-8', 'Content-Type', 'xml'],
    ['application/soap+xml', 'Content-Type', 'xml'],
    [' application/json ', 'Content-Type', 'json'],
    ['text/plain', 'Content-Type', 'raw'],
    ['text/html', 'Content-Type', 'raw'],
    ['application/jsonp', 'Content-Type', 'raw'],
    ['application/x-www-form-urlencoded', 'Content-Type', 'raw'],
    ['', 'Content-Type', 'raw'],
  ])('%s under %s is %s', (value, name, kind) => {
    expect(
      bodyKind([
        ['Accept', 'application/json'],
        [name, value],
      ]),
    ).toBe(kind);
  });

  test('no Content-Type is raw, even when another header names JSON', () => {
    expect(bodyKind([])).toBe('raw');
    expect(bodyKind([['Accept', 'application/json']])).toBe('raw');
  });
});

describe('JSON', () => {
  test('objects and arrays are indented by two spaces; empty ones stay on one line', () => {
    expect(format('json', '{"a":1,"b":[1,2],"c":{},"d":[]}')).toBe(
      [
        '{',
        '  "a": 1,',
        '  "b": [',
        '    1,',
        '    2',
        '  ],',
        '  "c": {},',
        '  "d": []',
        '}',
      ].join('\n'),
    );
  });

  test('existing whitespace between tokens is replaced, not added to', () => {
    expect(format('json', ' {\r\n\t"a" :  [ 1 , 2 ]\n}\n')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ]\n}',
    );
  });

  test('T2.6: numbers are copied as written, including digits beyond 2^53', () => {
    const input =
      '{"big":12345678901234567890,"neg":-9007199254740993,"dec":0.10000000000000000001,"exp":1E+400,"small":-1.5e-7}';
    const out = format('json', input);
    for (const number of [
      '12345678901234567890',
      '-9007199254740993',
      '0.10000000000000000001',
      '1E+400',
      '-1.5e-7',
    ]) {
      expect(out).toContain(`: ${number}`);
    }
    expect(jsonTokens(out)).toBe(jsonTokens(input));
  });

  test('T2.6: strings are copied as written: escapes, structural characters and spaces inside them', () => {
    const value = String.raw`"a \" b \\ c é é 😀 {[,:]} \n  two  spaces\t"`;
    expect(format('json', `{"k":${value},"e\\"k":"x"}`)).toBe(
      `{\n  "k": ${value},\n  "e\\"k": "x"\n}`,
    );
  });

  test('a string ending in an escaped backslash closes where it should', () => {
    expect(format('json', String.raw`["a\\",1]`)).toBe(
      String.raw`[` + '\n  "a\\\\",\n  1\n]',
    );
  });

  test('a byte order mark at the start is kept', () => {
    expect(format('json', '﻿{"a":1}')).toBe('﻿{\n  "a": 1\n}');
  });

  test('an empty body and a scalar body', () => {
    expect(format('json', '')).toBe('');
    expect(format('json', '  42 ')).toBe('42');
    expect(format('json', '"x y"')).toBe('"x y"');
  });

  test('literals inside arrays are copied', () => {
    expect(format('json', '[true,false,null]')).toBe(
      '[\n  true,\n  false,\n  null\n]',
    );
  });

  test.each([
    '{"a":1,,]',
    '}}{"a":',
    '[1 2 "x" "y"]',
    'tru e',
    '{"a":"unterminated',
    '<html>not json</html>',
    '{"a" 1 : : }',
  ])(
    'malformed input %j keeps every character except whitespace between tokens',
    (input) => {
      expect(jsonTokens(format('json', input))).toBe(jsonTokens(input));
    },
  );

  test('whitespace that separates two values in malformed input stays as one space', () => {
    expect(format('json', '[1 2]')).toBe('[\n  1 2\n]');
    expect(format('json', 'tru e')).toBe('tru e');
  });

  test.each([
    '{"a":1,"b":[1,{"c":"d \\" ,"}],"e":{}}',
    '﻿ [ {"x": "y\\\\"} , [] , 12345678901234567890 ]',
    '{"a":1,,]',
  ])('the same output for %j split at every position', (input) => {
    everySplit('json', input);
  });
});

describe('XML', () => {
  test('nested elements are indented by two spaces; text stays inside its element', () => {
    expect(
      format(
        'xml',
        '<?xml version="1.0"?><a x="1>2"><b/><c>text</c><!-- c > --><![CDATA[ <x> ]]><d></d></a>',
      ),
    ).toBe(
      [
        '<?xml version="1.0"?>',
        '<a x="1>2">',
        '  <b/>',
        '  <c>text</c>',
        '  <!-- c > -->',
        '  <![CDATA[ <x> ]]>',
        '  <d></d>',
        '</a>',
      ].join('\n'),
    );
  });

  test('whitespace-only text between markup is replaced by indentation', () => {
    expect(format('xml', '\n<a>\n\n   <b />   </a>\n')).toBe(
      '<a>\n  <b />\n</a>',
    );
  });

  test('text that is not whitespace-only is unchanged, including its own whitespace', () => {
    expect(format('xml', '<a>  hi  </a>')).toBe('<a>  hi  </a>');
    expect(format('xml', '<p>Hello <b>x</b> world</p>')).toBe(
      '<p>Hello <b>x</b> world</p>',
    );
  });

  test('attribute values holding > and / do not end or self-close the tag', () => {
    expect(format('xml', `<a t='>' u="/"><b/></a>`)).toBe(
      `<a t='>' u="/">\n  <b/>\n</a>`,
    );
  });

  test('a doctype with an internal subset, processing instructions and entities are copied', () => {
    expect(
      format(
        'xml',
        '<!DOCTYPE r [<!ENTITY e "v>">]><?pi a="b"?><r>&e;&amp;</r>',
      ),
    ).toBe('<!DOCTYPE r [<!ENTITY e "v>">]>\n<?pi a="b"?>\n<r>&e;&amp;</r>');
  });

  test('comments and CDATA holding markup are copied as written', () => {
    const comment = '<!-- <a> -- > --->';
    const cdata = '<![CDATA[ ]] > <b> ]]]>';
    expect(format('xml', `<r>${comment}${cdata}</r>`)).toBe(
      `<r>\n  ${comment}\n  ${cdata}\n</r>`,
    );
  });

  test('a byte order mark at the start is kept', () => {
    expect(format('xml', '﻿<a/>')).toBe('﻿<a/>');
  });

  test('an empty body', () => {
    expect(format('xml', '')).toBe('');
  });

  test('whitespace before text at the start of a body belongs to the text', () => {
    expect(format('xml', '  just text ')).toBe('  just text ');
    expect(format('xml', ' \n<a/>')).toBe('<a/>');
  });

  test.each([
    '<a><b></a>',
    '</x></y><z>',
    '<a attr="unterminated><b/>',
    '<!-- unterminated <a>',
    '<a><',
    'just text',
    '<<>>',
  ])(
    'malformed input %j keeps every character except whitespace-only text',
    (input) => {
      expect(xmlTokens(format('xml', input))).toBe(xmlTokens(input));
    },
  );

  test.each([
    '<?xml version="1.0"?>\n<a x="1>2">\n <b/> <c>t e</c><!-- c > --><![CDATA[ ]]> ]]></a>',
    '﻿<!DOCTYPE r [<!ENTITY e "v>">]><r a=\'/\'>x</r>',
    '<a><b></a>',
  ])('the same output for %j split at every position', (input) => {
    everySplit('xml', input);
  });
});

describe('raw', () => {
  test('text passes through unchanged, in any number of pieces', () => {
    expect(format('raw', ' {"a" : 1}\r\n', '<x/>  ')).toBe(
      ' {"a" : 1}\r\n<x/>  ',
    );
  });
});

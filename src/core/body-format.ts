// Display-only formatting for recorded JSON and XML bodies (T2.6). The formatter works on tokens, never
// parses a document, and carries its state between pieces, so a body read a page at a time formats as each
// page arrives. Only whitespace between tokens changes: every other character is copied as written, which
// keeps numbers beyond 2^53, escapes and entities exactly as recorded.

export type BodyKind = 'json' | 'xml' | 'raw';

export interface BodyFormatter {
  /** Formats the next piece of the body, returning the text that can be shown now. */
  push(text: string): string;
  /** Returns whatever the formatter still holds once the body is complete. */
  end(): string;
}

const INDENT = '  ';
const isSpace = (c: string) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** The kind of a recorded body, from its declared Content-Type. Anything not JSON or XML is raw. */
export function bodyKind(
  headers: readonly (readonly [string, string])[],
): BodyKind {
  const header = headers.find(
    ([name]) => name.toLowerCase() === 'content-type',
  );
  const type = (header?.[1].split(';')[0] ?? '').trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (
    type === 'application/xml' ||
    type === 'text/xml' ||
    type.endsWith('+xml')
  ) {
    return 'xml';
  }
  return 'raw';
}

export function createFormatter(kind: BodyKind): BodyFormatter {
  if (kind === 'json') return jsonFormatter();
  if (kind === 'xml') return xmlFormatter();
  return { push: (text) => text, end: () => '' };
}

function jsonFormatter(): BodyFormatter {
  let depth = 0;
  let inString = false;
  let escaped = false;
  // Separators are written lazily, when the next token shows what it is: an empty {} or [] stays on one line.
  let pending: 'none' | 'open' | 'newline' | 'space' = 'none';
  let afterValue = false;
  let sawSpace = false;

  const flush = (): string => {
    const was = pending;
    pending = 'none';
    if (was === 'open' || was === 'newline') return `\n${INDENT.repeat(depth)}`;
    return was === 'space' ? ' ' : '';
  };

  return {
    push(text) {
      let out = '';
      for (let i = 0; i < text.length; i += 1) {
        const c = text[i] as string;
        if (inString) {
          out += c;
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (isSpace(c)) {
          sawSpace = true;
          continue;
        }
        if (c === '{' || c === '[') {
          out += `${flush()}${c}`;
          depth += 1;
          pending = 'open';
          afterValue = false;
        } else if (c === '}' || c === ']') {
          depth = Math.max(depth - 1, 0);
          if (pending === 'open') pending = 'none';
          else pending = 'newline';
          out += `${flush()}${c}`;
          afterValue = true;
        } else if (c === ',') {
          out += `${flush()},`;
          pending = 'newline';
          afterValue = false;
        } else if (c === ':') {
          out += `${flush()}:`;
          pending = 'space';
          afterValue = false;
        } else {
          // A string, number, literal or anything malformed. Whitespace that separated two values stays as
          // one space, so "1 2" does not read as "12".
          const separator =
            pending === 'none' && afterValue && sawSpace ? ' ' : '';
          out += `${flush()}${separator}${c}`;
          if (c === '"') inString = true;
          afterValue = true;
        }
        sawSpace = false;
      }
      return out;
    },
    end: () => '',
  };
}

type Markup = 'start' | 'end' | 'comment' | 'cdata' | 'pi' | 'declaration';

function xmlFormatter(): BodyFormatter {
  let depth = 0;
  let started = false; // anything written yet
  let openElement = false; // a start tag was the last markup, so its end tag may share its line
  // Text between markup: held while whitespace-only, because then it is replaced by indentation.
  let heldSpace = '';
  let textWritten = false; // non-whitespace text since the last markup
  // Markup: '<' and the characters that tell what kind it is, then the kind and its scan state.
  let prefix = '';
  let markup: Markup | null = null;
  let quote = '';
  let brackets = 0;
  let lastNonSpace = '';
  let tail = '';

  const placeBefore = (kind: Markup): string => {
    if (kind === 'end') depth = Math.max(depth - 1, 0);
    const inline = textWritten || !started || (kind === 'end' && openElement);
    openElement = false;
    heldSpace = '';
    return inline ? '' : `\n${INDENT.repeat(depth)}`;
  };

  const classify = (): Markup | null => {
    if (prefix.length < 2) return null;
    const second = prefix[1];
    if (second === '/') return 'end';
    if (second === '?') return 'pi';
    if (second !== '!') return 'start';
    if (prefix === '<!--') return 'comment';
    if (prefix === '<![CDATA[') return 'cdata';
    if ('<!--'.startsWith(prefix) || '<![CDATA['.startsWith(prefix))
      return null;
    return 'declaration';
  };

  const finishMarkup = () => {
    if (markup === 'start' && lastNonSpace !== '/') {
      depth += 1;
      openElement = true;
    }
    markup = null;
    textWritten = false;
    started = true;
  };

  // Scans one character inside markup whose kind is known; returns true when the markup ends with it.
  const ends = (c: string): boolean => {
    tail = (tail + c).slice(-3);
    switch (markup) {
      case 'comment':
        return tail === '-->';
      case 'cdata':
        return tail === ']]>';
      case 'pi':
        return tail.endsWith('?>');
      default:
        if (quote) {
          if (c === quote) quote = '';
          return false;
        }
        if (c === '"' || c === "'") quote = c;
        else if (markup === 'declaration' && c === '[') brackets += 1;
        else if (markup === 'declaration' && c === ']')
          brackets = Math.max(brackets - 1, 0);
        else if (c === '>' && brackets === 0) return true;
        if (!isSpace(c)) lastNonSpace = c;
        return false;
    }
  };

  return {
    push(text) {
      let out = '';
      for (let i = 0; i < text.length; i += 1) {
        const c = text[i] as string;
        if (markup) {
          out += c;
          if (ends(c)) finishMarkup();
          continue;
        }
        if (prefix) {
          prefix += c;
          const kind = classify();
          if (!kind) continue;
          out += placeBefore(kind);
          markup = kind;
          quote = '';
          brackets = 0;
          lastNonSpace = '';
          tail = '';
          if (kind === 'start') {
            // The second character already belongs to the tag's name or body.
            out += '<';
            prefix = '';
            out += c;
            if (ends(c)) finishMarkup();
          } else {
            out += prefix;
            prefix = '';
          }
          continue;
        }
        if (c === '<') {
          prefix = '<';
        } else if (!textWritten && isSpace(c)) {
          heldSpace += c;
        } else {
          // The whitespace belongs to text that is not whitespace-only, so it is kept.
          out += heldSpace;
          heldSpace = '';
          out += c;
          textWritten = true;
          started = true;
        }
      }
      return out;
    },
    end() {
      // Unclassified markup at the very end is copied as it is; trailing whitespace-only text is dropped.
      const rest = prefix;
      prefix = '';
      heldSpace = '';
      return rest;
    },
  };
}

// The HTTP transport's value encoding (plan.md, phase 1). JSON loses the two values structured clone carried
// over IPC: bytes become indexed objects and dates become strings, and the contract schemas check for
// `Uint8Array` and `Date` (research.md, surprise 1). Both sides tag them: {"$bytes": base64}, {"$date": ISO}.
// Uses only `btoa`/`atob`, which Node and the browser both provide.

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: spreading a multi-MiB array into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encode(value: unknown): string {
  return JSON.stringify(
    value,
    function (this: Record<string, unknown>, key, converted: unknown) {
      // `this[key]` is the value before `toJSON` ran: a Date or Buffer, not its JSON form.
      const original = this[key];
      if (original instanceof Uint8Array) return { $bytes: toBase64(original) };
      if (original instanceof Date) return { $date: original.toISOString() };
      // An object that carries a tag name as its own key is sent as its entries, so the decoder cannot read it
      // as a tag. JSON.parse revives bottom-up, so the escape must not leave a lookalike object inside.
      if (
        isPlainObject(original) &&
        Object.keys(original).some((k) => TAGS.has(k))
      ) {
        return { $object: Object.entries(original) };
      }
      // Anything else with a toJSON (a URL, a driver ObjectId) travels as that JSON form.
      return converted;
    },
  );
}

const TAGS = new Set(['$bytes', '$date', '$object']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export function decode(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      const tagged = value as Record<string, unknown>;
      if (keys.length === 1 && typeof tagged.$bytes === 'string')
        return fromBase64(tagged.$bytes);
      if (keys.length === 1 && typeof tagged.$date === 'string')
        return new Date(tagged.$date);
      if (keys.length === 1 && Array.isArray(tagged.$object)) {
        return Object.fromEntries(tagged.$object as [string, unknown][]);
      }
    }
    return value;
  });
}

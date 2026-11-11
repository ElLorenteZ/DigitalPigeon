// A request's URL and the active environment (plan.md, phase 1; test-strategy.md T2.5). A URL starting with `/`
// is a path, joined to the environment's baseUrl with exactly one `/`; a full http(s) URL is sent as typed.
// Pure: main composes the URL it sends, and the renderer composes the same one for Copy as curl.

/** A path was given and no environment is chosen. Raised before anything is recorded. */
export class NoActiveEnvironmentError extends Error {
  constructor() {
    super('This URL is a path: choose an environment to send it to');
  }
}

export class InvalidBaseUrlError extends Error {}

/** A path with a `.` or `..` segment would leave the environment's base path once the URL is parsed (second code review, 2). */
export class InvalidPathError extends Error {
  constructor() {
    super('A path cannot contain . or .. segments');
  }
}

// The path part only: a query or fragment may hold anything. %2e is a dot to the URL parser too.
const hasDotSegment = (path: string) =>
  (path.split(/[?#]/, 1)[0] ?? '')
    .split('/')
    .some((segment) => /^\.{1,2}$/.test(segment.replace(/%2e/gi, '.')));

const withoutTrailingSlashes = (text: string) => text.replace(/\/+$/, '');
const withoutLeadingSlashes = (text: string) => text.replace(/^\/+/, '');

export const isPath = (url: string) => url.startsWith('/');

export function composeUrl(
  url: string,
  environment: { baseUrl: string } | undefined,
): string {
  if (!isPath(url)) return url;
  if (hasDotSegment(url)) throw new InvalidPathError();
  if (!environment) throw new NoActiveEnvironmentError();
  return `${withoutTrailingSlashes(environment.baseUrl)}/${withoutLeadingSlashes(url)}`;
}

/** The baseUrl as stored: an absolute http(s) URL with no query, fragment or user information, as the URL parser writes it. */
export function checkBaseUrl(text: string): string {
  let parsed: URL;
  try {
    parsed = new URL(text.trim());
  } catch {
    throw new InvalidBaseUrlError(
      'Use a full URL starting with http:// or https://',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidBaseUrlError(
      'Use a URL starting with http:// or https://',
    );
  }
  if (parsed.search || parsed.hash) {
    throw new InvalidBaseUrlError(
      'A base URL cannot have a query or a fragment',
    );
  }
  if (parsed.username || parsed.password) {
    throw new InvalidBaseUrlError(
      'A base URL cannot hold a user name or password',
    );
  }
  return parsed.href;
}

/** The path that composes back to `url` with this environment, or undefined when the URL does not start with its baseUrl. */
export function pathFor(
  url: string,
  environment: { baseUrl: string },
): string | undefined {
  const base = withoutTrailingSlashes(environment.baseUrl);
  if (!url.startsWith(`${base}/`)) return undefined;
  const path = url.slice(base.length);
  return composeUrl(path, environment) === url ? path : undefined;
}

// The request a call answers: its method and URL path (slice 7). The query string, fragment and host are not part of
// the key ("same method and path", author 2026-11-11). Pure: the store groups and lists responses with it, and the
// renderer names a request with it, so the two cannot disagree on what a path is (history-grouping).
export function requestKeyOf<M extends string>(
  method: M,
  url: string,
): { method: M; path: string } {
  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch {
    path = url.split(/[?#]/)[0] || '/';
  }
  return { method, path: path.startsWith('/') ? path : `/${path}` };
}

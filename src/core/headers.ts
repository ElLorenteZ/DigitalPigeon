// One rule for the auth a request carried: History search's facet, its results table, the call record's chip and
// history grouping all use authOf (code review of history-search, 10; history-grouping).

export interface Auth {
  header: 'Authorization' | 'Cookie';
  value: string;
}

// The auth a call was sent with (history-grouping), in the author's words: "if authorization is provided its
// authorization, if not - cookie, else no authorization". The first header of that name, its whole value.
export function authOf(
  headers: readonly (readonly [string, string])[],
): Auth | undefined {
  const first = (name: string) =>
    headers.find(([n]) => n.toLowerCase() === name)?.[1];
  const authorization = first('authorization');
  if (authorization !== undefined) {
    return { header: 'Authorization', value: authorization };
  }
  const cookie = first('cookie');
  return cookie === undefined ? undefined : { header: 'Cookie', value: cookie };
}

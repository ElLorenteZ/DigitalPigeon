// The Authorization value a request carried, the first if there were several. One rule for the History search's
// facet, its results table and the call record's chip (code review of history-search, 10).
export function authorizationOf(
  headers: readonly (readonly [string, string])[],
): string | undefined {
  return headers.find(([name]) => name.toLowerCase() === 'authorization')?.[1];
}

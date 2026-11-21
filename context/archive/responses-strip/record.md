---
change_id: responses-strip
title: Show every response a request has received, and let one be picked
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-21
ticket: null
verdict: merge
outcome: shipped
milestone: M1, slice 7 (roadmap.md)
branch: responses-strip, PR #6 (stacked on #5; archived on the branch before merge)
raw: raw/
---

## 1. What was built

- A new operation, `pigeon:list-responses` (`callStore.listResponses`). It returns every call with the same method and
  URL path, newest first, without bodies, up to 500.
- The workspace shows "Responses to this request · N kept" under the response header. Each response is a chip with a
  status dot, the code, the time and the duration. The newest chip is pressed. Picking a chip loads that call and shows
  its response.
- The call record shows "Other responses to METHOD path". Picking a chip opens that call.

**Differs from the plan:**
- Code review led to tagging both lists and every pick with the request or result they belong to.
- The strips scroll sideways rather than wrap.
- The × on chips was left for slice 8.

## 2. Why this approach

"The same request" is the method plus the URL pathname. The query string, fragment and host are left out. The author
decided method and path. Screen 01 settles the query string: it groups `/api/orders?dryRun=false` with `/api/orders`.

A server query, not the History list, because History holds only the newest 200 calls, and the exit criterion says
"every response". A regex on the stored URL needed no schema change.

## 3. What was rejected

- **Computing the strip from History in the renderer.** It fails silently past 200 calls.
- **Storing a `requestKey` or `request.path` on each send now.** A schema change and a migration. Deferred to slice 9,
  where search needs indexes anyway.
- **The query string as part of the key.** Screen 01 contradicts it.

## 4. Surprises

- The strip loads after the result has scrolled into view. It then pushes the body below the fold, which broke T2.9.
  The result now scrolls into view again when the strip first appears.
- Async lists in the UI needed keys more than expected. Code review found that the previous call's chips could show
  under the new call's name, and that a pick could land on a newer result.
- A Playwright `page.route` stub whose answer is still held must settle before `unroute`, or `fulfill` throws "Route
  is already handled".

## 5. What still stands

- `pathPattern` in `call-store.ts` and `requestKeyOf` in `app.tsx` must agree on what a path is. Check both if a
  response is missing from its own strip, for example with encoded characters or the root path. Slice 9 replaces both
  with a stored, indexed `request.path`.
- `listResponses` scans `sends` and runs on every History change, twice when a call is open. That is acceptable at a
  personal tool's volume.
- More than 500 responses to one request show only the newest 500.

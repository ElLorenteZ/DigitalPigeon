---
change_id: responses-strip
title: Show every response a request has received, and let one be picked
produced-by: lz-plan
revision: 1
created: 2026-11-21
updated: 2026-11-21
inputs: change.md, the Pencil design (pyg23 "Responses Strip", aJeTB "Other responses"), src/core/call-store.ts, src/server/ipc.ts, src/shared/ipc-contract.ts, src/renderer/app.tsx
---

# Plan: responses strip

## Approach

- **Same request = same method and same URL path, query string and fragment excluded.** Screen 01 shows the request
  `/api/orders?dryRun=false` with History rows `/api/orders`, and its strip counts them together. The host is not part
  of the key (author, 2026-11-11). The path is compared exactly, trailing slash included.
- **Store.** `callStore.listResponses(method, path, inFlight)` finds the sends with `request.method === method` whose
  `request.url` matches `^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*<escaped path>(?:[?#]|$)`. An empty path is treated as `/`,
  and the pattern for `/` also accepts a URL with no path. Results are newest first, without bodies, with completions
  attached as `listCalls` does. A cap of 500 keeps one request with thousands of calls from loading them all. No index:
  the query scans `sends`, which is acceptable at a personal tool's volume (the roadmap's slice 9 revisits indexes).
- **Contract.** A new channel `pigeon:list-responses` takes `{ method, path }` (zod: method one of `METHODS`, path a
  string starting with `/`, at most 8 KiB). It returns `ListCallsResult`. A database that is not up returns
  `{ ok: true, calls: [] }`, as `listCalls` does.
- **UI.**
  - The workspace strip appears under the response header for the request of the result shown. A chip shows a status
    dot, the code, the time and the duration. The newest is selected. Picking a chip calls `getCall` and shows that
    response in place of the latest, with the strip keeping it selected.
  - The call record shows "Other responses to METHOD path", one chip per other response. Picking one opens that call.
  - Both strips refresh when History changes, through the existing poll.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Compute the strip from the History list in the renderer | History holds the newest 200 calls. "A request shows every response it has received" would fail silently past 200. |
| Store a `requestKey` field on each send | Changes `call-schema.ts` and every document's shape. Old documents lack it and need a migration. A regex query needs neither. |
| Query string as part of the key | Screen 01 groups `/api/orders?dryRun=false` with `/api/orders`. |

## Out of scope

- The × on a chip (slice 8).
- An index for the path query.
- Grouping by host or environment.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | Every recorded `request.url` is absolute (`scheme://host/...`). Sends record the composed URL (slice 5). | Relative URLs never match. | no. `send.ts` composes before recording; phase 1's integration test covers an environment path. |

## Phases

### Phase 1: the store and the operation answer "every response to this method and path"

- **Files:** `src/core/call-store.ts`, `src/core/call-store.int.test.ts`, `src/shared/ipc-contract.ts`,
  `src/server/ipc.ts`, `src/renderer/api.ts`, `src/server/http.int.test.ts` (contract coverage).
- **Executor:** lz-tdd. A query with cases is decidable at the integration layer (test-strategy, Integration).
- **Cases:** same method and path with different queries match; another method does not; another path, `/orders/1`
  against `/orders`, does not; a path that shares a prefix, `/orders` against `/orders-old`, does not; another host
  matches; `/` matches a URL with no path; newest first; past 200 calls, all are returned up to the cap; regex
  characters in the path are escaped.
- **Verification:** `npx vitest run --project integration src/core/call-store.int.test.ts src/server/http.int.test.ts`
  red, then green. Typecheck.

### Phase 2: the strip and the call record's other responses

- **Files:** `src/renderer/app.tsx`, `src/index.css`, `e2e/responses.spec.ts` (new).
- **Executor:** lz-e2e.
- **Scenarios:**
  1. The roadmap outcome: the same method and path sent three times with different queries shows three chips, newest
     selected. Picking the oldest shows its body, and the chip is marked selected.
  2. A call opened from History lists its other responses. Picking one opens it.
  3. A send to another path shows a strip of one.
- **Verification:** `npx playwright test e2e/responses.spec.ts` red, then green 3×. The full e2e suite green. Typecheck
  and lint. A screenshot compared with the design's strip.

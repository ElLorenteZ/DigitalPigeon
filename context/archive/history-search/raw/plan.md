---
change_id: history-search
title: Search and filter History, and resend or delete a selection
produced-by: lz-plan
revision: 1
created: 2026-11-21
updated: 2026-11-21
inputs: change.md, the Pencil design (g0TMy screen 04, hiQXR screen 03 row 3), src/core/call-store.ts, src/server/ipc.ts, src/renderer/app.tsx, archive/delete-with-undo, archive/responses-strip
---

# Plan: history search

## Approach

- **Search in the store.** `callStore.searchCalls(query)` runs in Node over the send and completion documents, without
  bodies.
  - **Filters** combine with AND across facets and OR within a facet:
    - `methods[]`;
    - `environmentIds[]`, where `""` means no environment;
    - `auths[]`: the exact `Authorization` value, where `""` means none;
    - `savedRequestIds[]`, where `""` means none;
    - `from` and `to`, as a date range on `sentAt`;
    - `text`.
  - **Text** matches, case-insensitively:
    - the URL;
    - any request header value;
    - the inline request or response body, decoded as UTF-8.

    Bodies are read with a cursor only for calls that pass every other filter. Stored-file bodies are not searched;
    the UI says so.
  - **Facet counts:** each option counts the calls that match every other active filter, the standard faceted count,
    so picking an option never hides its siblings' counts.
  - **The result:**
    - `calls`, newest first, up to 500;
    - `total`, the number matching;
    - `of`, all calls;
    - `facets`: `method`, `environment` (id, last-seen name and `baseUrl`), `auth` and `savedRequest`.
- **Contract.** `pigeon:search-calls` takes the query (zod: lists of strings, ISO dates, text up to 1 KiB). It returns
  the result above.
- **UI (screen 04).**
  - The History tab gains a search box ("Search URL, body or header…"), active filters as chips with ×, and "Clear
    all". Below them sit the facet sections Method, Environment, Auth header and Saved request, each option a checkbox
    with its count, plus From and To dates.
  - While any text or filter is active, the main area shows the results view in place of the workspace:
    - a heading "N calls match" with a summary of the filters;
    - a table with Method, URL, Environment, Auth header, Status, Duration and Sent;
    - a checkbox on each row, and row actions Resend, Edit and Delete;
    - "N selected · Resend N · Delete N" for a selection.

    Clearing every filter returns to the workspace. An empty result says "No calls match" and offers "Clear filters".
  - **Resend** is `replay`, one at a time in order. Each creates a new record. Edit loads the form, as in the call
    record. Delete of a selection goes through slice 8's held-delete, one toast per call, so each can be undone.
- **The carried item** (`archive/responses-strip`: a stored, indexed `request.path`) is not done here. Search runs in
  memory, so it gains nothing from a path index. `listResponses` keeps its regex, and the item moves to "Not ordered
  yet".

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| MongoDB aggregation with `$facet` | Text over binary bodies cannot be matched in a query, so the body step runs in Node anyway. Two engines would have to agree on one filter definition. |
| A text index | Bodies are binary. A text field per document means a schema change and a migration, for a personal tool's volume. |
| Filtering the History list in the renderer | History holds 200 calls. The criteria are about all calls. |

## Out of scope

- Searching stored-file bodies (over 1 MiB).
- Saved searches.
- Sorting the table by column; it is newest first.

## Phases

### Phase 1: the search answers filters, text and facet counts over all calls

- **Executor:** lz-tdd (test-strategy T1.7 for bulk delete stays with phase 2; search correctness is integration).
- **Files:** `src/core/call-store.ts`, `src/core/call-store.int.test.ts`, `src/shared/ipc-contract.ts`,
  `src/server/ipc.ts`, `src/renderer/api.ts`, `src/server/http.int.test.ts`.
- **Verification:** `npx vitest run --project integration src/core/call-store.int.test.ts src/server/` red, then green.

### Phase 2: screen 04: facets, the results table, and resend or delete a selection

- **Executor:** lz-e2e.
- **Files:** `src/renderer/app.tsx`, `src/index.css`, `e2e/search.spec.ts` (new).
- **Scenarios:**
  1. Text plus a method facet narrows the table, the counts follow, and Clear all returns to the workspace.
  2. An empty result says so and offers Clear filters.
  3. Resend a selection of two: two new records; the originals unchanged.
  4. Delete a selection of two: both disappear, and both are gone after the window, while the others stay (T1.7 bulk).
- **Verification:** `npx playwright test e2e/search.spec.ts` red, then green 3×. The full suite green. A screenshot
  compared with screen 04.

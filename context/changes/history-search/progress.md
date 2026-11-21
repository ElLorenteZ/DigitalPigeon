---
change_id: history-search
produced-by: lz-tdd
updated: 2026-11-21
---

# Progress: history search

## Phase 1: the search answers filters, text and facet counts over all calls

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/call-store.ts`: `searchCalls(query, inFlight)` and the types `SearchQuery`, `SearchResult` and
  `FacetOption`.
  - It reads every call summary and derives each call's facts: method, environment, auth, saved request, `sentAt`, URL
    and header values.
  - Text matches the URL or a header value. Failing that, it matches an inline request or response body, read with a
    cursor for the remaining calls only and decoded as UTF-8, ignoring case.
  - Each facet option counts the calls that match every other filter.
  - The result is newest first, up to 500, with `total` and `of`.
- `src/shared/ipc-contract.ts`, `src/server/ipc.ts`, `src/renderer/api.ts`: `pigeon:search-calls`, with
  `SearchQuerySchema` and `SearchResultSchema`.
- Tests:
  - `src/core/search.int.test.ts` (new, its own database), 7 cases:
    - no filter;
    - OR within a facet, AND across facets;
    - each facet's count excludes its own filter;
    - `""` means none;
    - text in the URL, a header value or a body, ignoring case;
    - a date range;
    - the call state.
  - The store-surface guard now lists `searchCalls`. The all-operations HTTP test covers the channel.

**Verification**

```
$ npx vitest run --project integration src/core/search.int.test.ts      # before
     × (7) store.searchCalls is not a function
$ npx vitest run --project integration src/server/http.int.test.ts -t "every operation"   # before the contract
     × TypeError: Cannot read properties of undefined (reading 'replace')
$ npx vitest run --project integration src/server/ src/core/search.int.test.ts src/core/call-store.int.test.ts
      Tests  74 passed (74)
```

**Drift:** none.

## Phase 2: screen 04: facets, the results table, and resend or delete a selection

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/renderer/app.tsx`:
  - The History tab has a "Search history" box and a "Filters" button. While a search is active, the tab shows
    `SearchFilters` instead of the list: chips with ×, "Clear all", and the facets Method, Environment, Auth header and
    Saved request (each a `group` of checkboxes with counts), plus Sent From and To dates.
  - The main area has a third view, `results`, which shows `SearchResults`: "N calls match" with a summary, the table,
    the selection actions "Resend N" and "Delete N", and per-row Resend, Edit and ×. An empty result says "No calls
    match" and offers "Clear filters".
  - The search runs 250 ms after the last change and again on every History change.
  - Resend replays each call in order. Delete goes through slice 8's `deleteLater`. Edit loads the call and then
    `editCall`.
  - From a call opened in the results, "Back" returns to the results ("Back to the results").
- `src/index.css`: search, facet and table styles.
- `e2e/search.spec.ts` (new): 4 scenarios. Scenario 4 covers bulk delete removing only the selection (T1.7, bulk).

**Verification**

```
$ npx playwright test e2e/search.spec.ts                 # before the UI
  4 failed
$ npx playwright test e2e/search.spec.ts --repeat-each=3  → 12 passed (40.9s)
$ npx playwright test                                     → 78 passed (1.3m)
$ npm run typecheck → 0 · npm run lint → clean · npm run test:unit → 371 passed
$ screenshot: context/changes/history-search/shot-search.png, compared with g0TMy (screen 04)
```

**Differences from the design:**
- the heading is "History" rather than "Search history", because T2.9 looks for that heading;
- no auth-value descriptions such as "staging · service token";
- the date facet is a From/To pair, not a preset list.

**Drift:**
- decision: the carried item "stored, indexed `request.path`" moves to "Not ordered yet". Search runs in memory, so the
  index gains nothing here.

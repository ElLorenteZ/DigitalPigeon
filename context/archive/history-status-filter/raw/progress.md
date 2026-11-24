---
change_id: history-status-filter
produced-by: lz-e2e
plan: plan.md
updated: 2026-11-24
---

# Progress: Filter History by HTTP status code with a multi-select combo box

## Phase 1 — The store lists, groups and counts calls filtered by status, including "No response", and `listCalls` returns the unfiltered `mark`

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-24
- **Finished:** 2026-11-24

**Changed**
- `src/core/call-store.int.test.ts` — new `describe('status filter')`, 8 tests, written first and watched failing:
  six on unfiltered lists coming back (the selection was ignored), two on `listStatusCodes` / `historyMark` not
  existing. The store-surface guard (T1.1) lists the two new read functions.
- `src/core/call-store.ts` — `statusCondition(statuses)` (one `completions.distinct('sendId', …)`, then `$in`, or
  `$nin` when `''` is selected), merged into `listCalls` and `listRequestGroups` before the limit; `historyMark`
  (`count:newestId:inFlight` over the environment's sends, no status condition); `listStatusCodes`; module-level
  `statusOf` and `StatusOption`.
- `src/shared/ipc-contract.ts` — `StatusList`; `statuses` on `ListCallsInputSchema` and `ListRequestGroupsInputSchema`;
  `ListHistoryResultSchema` (`calls` + `mark`) for `listCalls`, with `ListCallsResultSchema` kept for `listResponses`;
  channel `pigeon:list-status-codes` with its input and result schemas; `PigeonApi` updated.
- `src/server/ipc.ts` — `listCalls` passes `statuses` and returns `mark` (`''` when the database is down);
  `listRequestGroups` already passed its whole input; new `listStatusCodes` handler.
- `src/renderer/api.ts` — `listStatusCodes`.
- `src/shared/wire-codec.test.ts` — round trips for `ListHistoryResultSchema` and `ListStatusCodesResultSchema`, watched
  failing (schemas undefined) before the contract change.
- `src/server/http.int.test.ts` — the "every operation in the contract answers through HTTP" guard failed on the new
  channel, as designed; the channel was added to it, with assertions on `mark` and a `200` option.

**Verification**

```
$ npx vitest run --project integration src/core/call-store.int.test.ts -t status
 ✓ status filter > listCalls keeps the calls answered with a selected status, newest first
 ✓ status filter > '' selects the calls with no response: an error, in flight and interrupted
 ✓ status filter > a code and No response together select both; an empty selection selects every call
 ✓ status filter > the status filter applies before the limit
 ✓ status filter > the status filter combines with the environment
 ✓ status filter > listRequestGroups counts only the calls with a selected status, and the newest of them is latest
 ✓ status filter > listStatusCodes lists each status present with its count, codes ascending and No response last
 ✓ status filter > historyMark changes with every new call, including one the status selection would hide
      Tests  9 passed | 34 skipped (43)
$ npx vitest run --project unit src/shared/wire-codec.test.ts
      Tests  17 passed (17)
$ npm run typecheck
(clean)
$ npx vitest run --project integration src/core/call-store.int.test.ts
      Tests  43 passed (43)
$ npx vitest run --project integration src/server
      Tests  43 passed (43)
$ npm run lint
All matched files use the correct format.
```

PASS — the selection filters before the limit and composes with the environment; No response covers error, in-flight
and interrupted calls; the mark moves on a call the selection hides.

**Drift:** decision — the plan's Phase 1 check "historyMark is the same with and without a status selection" was
replaced by "historyMark moves when a 200 call is added while the list filtered to 404 does not change", because the
store function takes no selection and the plan's form is true by construction (plan review, revision 2). The
`http.int.test.ts` assertions on `mark` and the `200` option were added after the handler existed, so they were not
watched failing; the coverage guard itself was.

**Drift:** decision — `historyMark`'s in-flight part is the process-wide in-flight count, not the environment's. A send
in another environment can refetch the views once more than needed; it never misses one.

## Phase 2 — Search narrows by status and returns a `status` facet with counts

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-24
- **Finished:** 2026-11-24

**Changed**
- `src/core/search.int.test.ts` — new `describe('searchCalls by status')`, 4 tests, watched failing on the status being
  ignored (`[ 's1', 's2', 's5' ]` for text + `['200']`; all five calls for `['500','409']`; `ok` kept under `['']`).
- `src/core/call-store.ts` — `SearchQuery.statuses`; `CallFacts.status` from `statusOf`; `'status'` as a `FacetName`
  checked in `matches`; `facets.status` built by `facet('status', …)` and sorted by `byStatus` (codes ascending, No
  response last). Refactor: `listStatusCodes` uses the same `byStatus`; the store suite stayed green unchanged.
- `src/shared/ipc-contract.ts` — `statuses: StatusList` on `SearchQuerySchema`; `status` in `SearchResultSchema.facets`.
- `src/shared/wire-codec.test.ts` — a `SearchResultSchema` round trip with a `status` facet, watched failing with the
  contract change stashed (the strict `facets` object refused `status`), passing with it restored.

**Verification**

```
$ npx vitest run --project integration src/core/search.int.test.ts -t status
 ✓ searchCalls by status > text and a status combine with AND
 ✓ searchCalls by status > statuses combine with OR
 ✓ searchCalls by status > the status facet counts under the other filters and ignores its own selection
 ✓ searchCalls by status > '' matches calls with no response: an error and a call in flight
      Tests  4 passed | 9 skipped (13)
$ npx vitest run --project unit src/shared/wire-codec.test.ts
      Tests  18 passed (18)
$ npx vitest run --project unit
      Tests  419 passed (419)
$ npx vitest run --project integration
      Tests  402 passed (402)
$ npm run typecheck && npm run lint
(clean) / All matched files use the correct format.
```

PASS — status is one more facet: AND across facets, OR within, its counts ignore its own selection, and No response
matches error and in-flight calls. The existing search cases pass unchanged.

**Drift:** decision — the store keeps its own `SearchQuery` interface (`src/core/call-store.ts`, beside `RequestGroup`),
separate from the contract's; `statuses` was added to both. The plan named only the contract.

**Drift:** decision — the status facet is sorted (codes ascending, No response last), where the other facets keep the
order calls first show a value. The plan did not state an order; this matches `listStatusCodes`, so the combo box
lists options the same way in both modes.

## Phase 3 — The combo box in History filters the day view and the grouped view, and the strips keep refreshing

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-24
- **Finished:** 2026-11-24

**Risks (test-strategy T2.9, T2.10; each needs the assembled UI):** the control does not filter what the user sees by
mouse or keyboard; its list opens out of view; an earlier selection's answer replaces the later selection's list; the
views keyed on History stop refreshing while a selection hides the calls that changed. Which calls match is not tested
here: T2.3, covered at integration in Phases 1–2.

**Changed**
- `e2e/status-filter.spec.ts` — new. A local server answers the `status` in each URL's query, or holds the response;
  a closed port gives a refused call. Six calls are seeded through the form in `beforeAll` (/items 200, 200, 404;
  /other 404, 500; one refused). Six scenarios: options and counts with nothing selected and the open list in view;
  selecting by day and by request, an expanded group, chips, × per status and Clear; keyboard (ArrowDown, Space,
  Escape, typing, Enter); a held `listCalls` answer for an earlier selection released last (`stubOperation`, `gate`,
  `settle`); option counts during a held send that the selection hides; the empty state and
  `expectNoCspViolations`.
- `src/renderer/app.tsx`:
  - `statuses` state, always sorted (`byStatus`), and `statusKeyOf` (JSON) as its comparable key;
  - `historyList` stores the selection key and the server `mark`; `history` is empty unless both the environment and
    the selection match (`historyLoaded`);
  - `refreshHistory` sends `statuses` and drops an answer whose environment or selection is no longer chosen, and it
    refetches when the selection changes;
  - `historyMark` is `${dataVersion}:${historyList.mark}`;
  - `useRequestGroups` takes `statuses` in its key; a new `useStatusCodes` hook;
  - the expanded group's rows are filtered with `statusOfView`;
  - a new `StatusFilter` component (combobox, multiselectable listbox, chips with "Remove status …", "Clear status
    filter"), rendered between the search box and the list;
  - `HistoryList` shows "No calls with the selected status" only when the list for this selection is on hand and
    empty.
- `src/index.css` — `.status-filter` styles from the existing chip and facet tokens. The list opens in the flow below
  the field, not as an overlay, so the sidebar cannot clip it.

**Verification**

Red, before the component existed, against the built app: 6 failed, each at
`getByRole('combobox', { name: 'Filter by status' })` not found. The seeding reached "6 calls".

The first green run failed "selecting codes … × clears": after Clear, the list stayed at "1 call". The selection key
was `statuses.join(',')`, and `['']` (No response only) joins to `''`, the same as no selection. Clearing changed no
key, so nothing refetched, and the No-response list counted as current. The key became `JSON.stringify` (see Drift).

Each mechanism, broken on purpose:

```
# selection guard removed from refreshHistory and historyLoaded
$ npx playwright test e2e/status-filter.spec.ts -g "earlier selection"
    Expected: "3 calls"
    Received: "2 calls"
  1 failed
# historyMark computed from the filtered list again, as before this change
$ npx playwright test e2e/status-filter.spec.ts -g "in flight"
    Expected: "No response · 2 calls"
    Received: "No response · 1 call"
  1 failed
```

Restored, then:

```
$ npm run build && npx playwright test e2e/status-filter.spec.ts --repeat-each=3
  18 passed (11.2s)
$ npm run test:e2e
  110 passed (1.6m)
```

PASS — the control filters both views from the mouse and the keyboard, its list opens in view, a late answer for an
earlier selection is dropped, the counts refresh during a send the selection hides, and an empty filtered list says
why. The new spec runs three times clean, and the existing history-grouping, environment-history, responses and
search specs pass.

**Drift:** decision — the plan's scenario "with 404 selected, send a request that answers 200 → the responses strip
lists the new call" was replaced. Send clears the result (`setResult(null)` in `run`), and Replay returns to the
request, so the strip is not on screen while a call is in flight. A completed send already bumps `dataVersion`. The
only views that can show the refresh gap are the status option counts and the filtered lists. The scenario now holds a
send with 404 selected and asserts that "No response" counts it while History's 404 list stays unchanged. Then it
asserts that the strip lists the call after completion ("4 kept").

**Drift:** defect — the plan's `StatusList` uses `''` for No response. With the canonical form `join(',')` that the
review's "WORTH FIXING" item suggested, `['']` and `[]` give the same key. Fixed in the renderer with `statusKeyOf`
(JSON); the contract and the store are unaffected. The defect was caught by this phase's Clear scenario.

**Drift:** decision — precondition A4 was not met as written: `history-grouping` is still open. Its remaining review
items are F1 (CSP assertions in `history-grouping.spec.ts` and `responses.spec.ts`) and F2 (the author's visual
check). Its F3 (uncommitted phases) was committed as `af7a187`. Neither remaining item edits the History code changed
here. The uncommitted "Back to the request" edit in `app.tsx` (call view, around line 1264) and `e2e/shell.spec.ts`
predates this change. It is in a different region, and it must be committed separately from this change.

**Drift:** decision — the empty-state scenario deletes the selected status's only call, instead of switching to an
environment where the selected code has no calls. Same observable state, without creating an environment.

## Phase 4 — The same combo box narrows search results and shows the search facet's counts

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-24
- **Finished:** 2026-11-24

**Risk (T2.10 family, assembled UI only):** in search mode the combo box offers History's counts instead of the
search's, its selection does not narrow the results table, or Clear all drops it. Search's matching is covered at
integration (Phase 2).

**Changed**
- `e2e/status-filter.spec.ts` — one scenario, placed before the empty-state scenario (that one deletes a call). It
  covers: text `/other` → counts 404 · 1, 500 · 1, 200 · 0; selecting 500 → "1 call matches" and one row showing 500;
  404 still counts 1 under the 500 selection; Clear all → results hidden, the 500 chip remains, History shows 1 call.
- `src/renderer/app.tsx` — `StatusFilter` takes `searchResult.facets.status` while `searchActive` (`null` until the
  search answers) and `listStatusCodes` otherwise. `queryOf(text, filters, statuses)`. `searchKey` includes
  `statuses`. `clearSearch` is unchanged, so the selection survives Clear all.

**Verification**

```
# red, before the change: the options were History's
$ npx playwright test e2e/status-filter.spec.ts -g "in search"
    Expected: "404 · 1 call"
    Received: "404 · 2 calls"
  1 failed
# after the change, with `statuses` removed from the searchCalls query on purpose
    Expected substring: "1 call matches"
    Received string:    "2 calls match…"
  1 failed
# restored
$ npm run build && npx playwright test e2e/status-filter.spec.ts --repeat-each=3
  21 passed (13.7s)
$ npm run test:e2e
  111 passed (1.6m)
$ npx vitest run --project unit
      Tests  419 passed (419)
$ npx vitest run --project integration
      Tests  402 passed (402)
$ npm run lint && npm run typecheck
All matched files use the correct format. / 0 errors
```

PASS — in search the counts are the search's status facet and ignore their own selection, the selection narrows the
results, and Clear all keeps it.

An earlier run of the same gates in one background command took 10.9 min for e2e (1.6 min usually). It failed
`saved-requests.spec.ts:245` (`toHaveAccessibleName`) and `:387`, and one integration test. The run's output did not
name the integration test. None of these reproduced:
- `saved-requests.spec.ts` alone: 9 passed;
- `saved-requests.spec.ts` with `--repeat-each=3`: 27 passed;
- the full e2e suite again: 111 passed (1.6 min);
- integration again: 402 passed.

They are recorded as unexplained, and they coincide with the slow run. Neither spec touches the status filter.

**Drift:** none

## Review fixes — host code review (#2–#6, #9, #10) and lz-review F1, F2

- **Executor:** lz-build (the e2e and integration tests were written first and watched red)
- **Status:** done
- **Started:** 2026-11-24
- **Finished:** 2026-11-24

**Changed**
- `src/core/status.ts` — new: `statusOf(completion)` and `byStatus(a, b)`. The store and the renderer import the
  same two rules (#10).
- `src/core/call-store.ts`:
  - `listCalls` and `listResponses` drop unreadable records when a status is selected, because their status is
    unknown (#2);
  - `listResponses` takes `statuses` and applies them in its `sends` query, before `RESPONSES_LIMIT` (#3);
  - the local `byStatus` and `statusOf` are removed (#10);
  - the `RequestGroup` doc comment is back on `RequestGroup` (#9).
- `src/shared/ipc-contract.ts`, `src/server/ipc.ts` — `statuses` on `ListResponsesInputSchema`, passed through (#3).
- `src/renderer/app.tsx`:
  - an expanded group asks `listResponses` with the selection, and the client-side filter is removed; the strips still
    pass none (#3);
  - Space toggles only while nothing is typed (#4);
  - in search, the combo box shows the search's failure (#5);
  - `useStatusCodes` does not fetch while a search runs (#6);
  - the `HistoryList` comment is back above `HistoryList` (#9);
  - the local `byStatus` and `statusOfView` are removed (#10);
  - typed text is cleared whenever the list closes (see Drift).
- `src/core/call-store.int.test.ts` — "a status selection never lists an unreadable record" and "listResponses with
  statuses filters before its 500-call limit" (501 calls, the oldest answered 500).
- `e2e/status-filter.spec.ts` — the keyboard scenario now types "no r" and checks that Escape clears the text. A new
  scenario covers the options failing in search and outside it: the reason shows, the selected 404 is listed with
  0 calls (F2), × clears it, and the next refetch removes the error.

**Verification**

```
# red, before the fixes
$ npx vitest run --project integration src/core/call-store.int.test.ts -t "code review"
AssertionError: expected [ 'unreadable u-bad' ] to deeply equal []
AssertionError: expected [ 'r-500', 'r-499', 'r-498', …(497) ] to deeply equal [ 'r-0' ]
      Tests  2 failed | 43 skipped (45)
$ npx playwright test e2e/status-filter.spec.ts -g "keyboard|fail"     # against the build without the fixes
    Expected: "no r"   Received: "r"
    Expected: "Statuses could not be loaded: search store down"   (element not found)
  2 failed
# after
$ npx vitest run --project integration src/core/call-store.int.test.ts src/core/search.int.test.ts
      Tests  58 passed (58)
$ npm run build && npx playwright test e2e/status-filter.spec.ts --repeat-each=3
  24 passed (16.0s)
$ npm run typecheck   → 0 errors
$ npm run lint        → All matched files use the correct format.
$ npx vitest run --project unit          → Tests  419 passed (419)
$ npx vitest run --project integration   → Tests  404 passed (404)
$ npm run test:e2e                       → 112 passed (1.6m)
```

PASS — each fix has a test that failed without it, except #6, #9 and #10. #6 is a request not made; #9 and #10 are
structure.

**Drift:** decision — typed text is now cleared when the list closes. The first run with the "no r" step left the
text in the box, and the next tests opened an already narrowed list. A user would meet the same stale narrowing.

**Drift:** decision — after the options fail, they recover on the next refetch (a History change, or entering and
leaving search), not by themselves. Every other History list behaves the same way.

---
change_id: history-status-filter
status: draft
produced-by: lz-plan
created: 2026-11-24
updated: 2026-11-24
inputs: [change.md]
---

# Plan: Filter History by HTTP status code with a multi-select combo box

Revision 2 (2026-11-24) answers the plan review's verdict, REVISE:
- The refresh key no longer comes from the filtered list.
- A stale answer from an earlier status selection is dropped.
- The empty filtered list states why it is empty.
- The viewport check is now part of the verification.
- The new schemas get wire-codec cases.
- A4 names `history-grouping`.

No phase had been executed, so no `progress.md` entry is affected.

## Approach

The status filter is applied on the server, as one more condition on the queries History already runs, never on the
rows the UI holds. A shared store helper turns a status selection into a MongoDB condition on `sends._id`. It reads the
matching send ids from `completions` first, because the status is stored on the completion
(`src/core/call-schema.ts:85`), not on the send. `listCalls`, `listRequestGroups` and `searchCalls` take an optional
`statuses` list and apply that condition before their limit or grouping. The day view's 200 rows are then the newest
200 *matching* calls. Group counts and each group's newest call then reflect only matching calls.

The selection is a list of strings, following the convention `SearchQuerySchema` already uses
(`src/shared/ipc-contract.ts:325`): a three-digit code such as `"404"`, or `""` for "No response". A call has no
response when its completion holds an `error`, when it is in flight, or when it was interrupted. An empty or absent list
means no filtering. The options come from the stored data, each with a count. In the default list they come from a new
operation, `pigeon:list-status-codes`, scoped to the selected environment. In search mode they come from a new `status`
facet on `SearchResult`. That facet is computed like the existing ones (`src/core/call-store.ts:242`): each count leaves
out the status selection itself.

Filtering `listCalls` changes what the UI's refresh key reads. `historyMark` (`src/renderer/app.tsx:647`) is computed
from the History list (`app.tsx:211`). The responses strip, the other-responses list, the groups, the expanded group and
search all refetch when it changes (`app.tsx:672`, `:695`, `:712`, `:728`, `:841`). The fix is a separate `mark` on the
`listCalls` result, computed by the server from the environment's calls *without* the status condition: their count,
the newest send id, and the number in flight. `historyMark` is built from `dataVersion` and that `mark`, so every
existing refresh fires as it does today, whatever the selection.

The UI is one multi-select combo box, rendered in the History tab between the search box and the list. It stays in
place in both modes, and one piece of `App` state holds the selection. A selected code is passed to every History query.
The responses strip calls `listResponses` without it and stays unfiltered. The combo is written in `app.tsx`, using the
ARIA combobox and multiselectable listbox pattern, with no new dependency. The property that makes this the right shape is
that History already filters on the server over every call (environment-aware-history, history-search). Adding status as
one more server condition keeps one definition of "matches" for the list, the groups and search.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Filter the rows the UI already holds | The day view holds the newest 200 calls (`listCalls` limit). Filtering them in the UI shows fewer than 200 matches while older matching calls exist, and an empty list when all 200 newest calls are 200 OK. `history-search` rejected UI-side filtering of History for this reason (`context/archive/history-search/record.md` §3), and it still holds. |
| A `Status` checkbox facet inside the search Filters panel only | The user chose a combo box that applies in both modes. A facet in the Filters panel is hidden until search mode starts. |
| A fixed list of common codes | The user chose codes present in the data, with counts. A fixed list offers codes with zero calls and leaves out unusual codes that were recorded (for example 418 or 599). |
| A MongoDB `$lookup` aggregation joining sends to completions | `list()` (`src/core/call-store.ts:369`) runs `find` on `sends` and reads completions separately. Running a pipeline only for the status case would give the store two read paths. Resolving the status to a set of send ids first keeps `list()` unchanged. |
| A combo box library (Downshift, React Aria, Headless UI) | It would be a new runtime dependency for one control. `tech-stack.md` keeps the UI on React with no component library, and every existing control is written in `app.tsx`. |
| Refresh key: bump `dataVersion` when a send starts, instead of the server `mark` | A completed send already bumps `dataVersion` (`app.tsx:405-408`), and so do replay (`:777`) and delete (`:882`). The remaining gap is the in-flight row. The renderer cannot tell when the send document exists, because polling finds it (`app.tsx:379-385`). A bump at Send would refetch before the row exists, and nothing bumps again when it appears. |
| Refresh key: a second, unfiltered `listCalls` fetch | It doubles the History read on every poll and refresh, only to compute three numbers the server can return with the first read. |

## Out of scope

- The responses strip and `useResponses` for the strip: `listResponses` gets no status parameter. A History group that
  is expanded is filtered on the client from the calls it already lists (see Phase 3).
- Typing a code that is not present in the data. The user chose present codes only.
- Status classes (2xx, 4xx) and ranges, as in `change.md`.
- Adding the status selection to search's active-filter chips or to Clear all. The combo box sits outside the Filters
  panel and has its own clear control. Clear all resets only the search filters (see For the reviewer).
- Persisting the selection in `localStorage` or across restarts.
- Indexing `completions.response.status`. The other History queries already read every summary, and an index is a
  separate decision for the roadmap's "Search performance" item.
- Changing when or how often History refreshes. The `mark` keeps today's refresh triggers and adds none.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | Every completion with a response stores `response.status` as an integer (`CompletionDocSchema`, `src/core/call-schema.ts:82-88`). A completion with an `error` has no `response`. | Codes stored as strings or under another key would be missed. Phase 1's tests would catch this, but the helper would need a second shape. | yes — verified by reading the schema |
| A2 | Building the matching send-id set in Node (one `completions.find` projected to `sendId`) is fast enough with the number of calls History holds today. | History would slow down. `searchCalls` already loads every summary on each query (history-search §5), and `call-store.int.test.ts:597` times `listRequestGroups` over 5000 calls. | no |
| A3 | A call in flight or interrupted has no completion document, so the "No response" set is the sends *not* in the set of completions that have a response. | In-flight calls would disappear under "No response". Phase 1 tests an in-flight send. | yes — verified at `call-store.ts:505-507`; Phase 1 asserts it |
| A4 | The open change `history-grouping` (review verdict merge-with-fixes, no phase verified in its `progress.md`) is closed or has its review fixes committed before Phase 3 starts. The same goes for the uncommitted edits to `src/renderer/app.tsx` and `e2e/shell.spec.ts` found at planning time. | Its fixes edit `HistoryList` and the hooks Phase 3 edits. The two changes would mix in one diff, and review would compare each against the wrong plan. | no — a precondition for Phase 3, not for Phases 1–2 |
| A5 | Every refresh that `historyMark` triggers today comes from a change in its four inputs: `dataVersion`, list length, newest id and in-flight count (`app.tsx:647`). A `mark` holding the last three, computed without the status condition, therefore triggers the same refreshes. | A refresh that depended on something else in the list would be lost. Phase 3's scenario with a status selection active checks the observable case (a new send reaching the strip). | no — read from the single definition at `app.tsx:647` |

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | The store lists, groups and counts calls filtered by status, including "No response", and `listCalls` returns the unfiltered `mark` | `src/core/call-store.ts`, `src/shared/ipc-contract.ts`, `src/server/ipc.ts`, `src/renderer/api.ts`, `src/core/call-store.int.test.ts`, `src/shared/wire-codec.test.ts` | lz-tdd | `npx vitest run --project integration src/core/call-store.int.test.ts -t status` and `npx vitest run --project unit src/shared/wire-codec.test.ts` |
| 2 | Search narrows by status and returns a `status` facet with counts | `src/core/call-store.ts`, `src/shared/ipc-contract.ts`, `src/core/search.int.test.ts`, `src/shared/wire-codec.test.ts` | lz-tdd | `npx vitest run --project integration src/core/search.int.test.ts -t status` |
| 3 | The combo box in History filters the day view and the grouped view, and the strips keep refreshing | `src/renderer/app.tsx`, styles, `e2e/status-filter.spec.ts`, `e2e/support.ts` | lz-e2e | `npx playwright test e2e/status-filter.spec.ts` after `npm run build` |
| 4 | The same combo box narrows search results and shows the search facet's counts | `src/renderer/app.tsx`, `e2e/status-filter.spec.ts` | lz-e2e | `npx playwright test e2e/status-filter.spec.ts` after `npm run build` |

### Phase 1 — the store filters by status

**Changes:**
- `src/core/call-store.ts`:
  - A private helper `statusCondition(statuses)` returns `{}` for an absent or empty list. Otherwise it returns
    `{ _id: { $in: ids } }`, where `ids` are the `sendId`s of the completions whose `response.status` is in the
    selected codes.
  - When `""` is selected, the helper instead returns `{ _id: { $nin: ids } }`, where `ids` are the sends whose
    completion has a response with an *unselected* status. In-flight calls, interrupted calls and error completions
    then pass.
  - The helper is merged with `inEnvironment(environmentId)` in `listCalls` (line 88) and `listRequestGroups`
    (line 144), so `limit` applies after it.
  - A new store function `historyMark({ environmentId? }, inFlight)` returns
    `{ count, newestId, inFlight }` over the environment's sends, with no status condition.
  - A new store function `listStatusCodes({ environmentId? })` returns `{ value, label, count }[]`. The label is the
    code or `No response`, and the order is codes ascending with No response last. Counts are over the environment's
    calls.
- `src/shared/ipc-contract.ts`:
  - A shared `StatusList` schema, `z.array(z.string().regex(/^(\d{3})?$/)).max(100).optional()`.
  - `statuses` added to `ListCallsInputSchema` and `ListRequestGroupsInputSchema`.
  - `listCalls` gets its own result schema with `calls` and `mark: z.string()`. `ListCallsResultSchema`
    (line 281) stays as it is for `listResponses`.
  - The channel `listStatusCodes: 'pigeon:list-status-codes'`, its input and result schemas, and the `PigeonApi`
    method.
- `src/server/ipc.ts`: the handler for the new channel. `statuses` is passed through at lines ~542 and ~571. The
  `listCalls` handler adds `mark`, and the database-down branch (line 539) returns `mark: ''`.
- `src/renderer/api.ts`: the new operation and the new `listCalls` result type.
- `src/shared/wire-codec.test.ts`: round-trip cases for the new `listCalls` result and the `listStatusCodes` result
  (T2.1).

**Verification:**

```
$ npx vitest run --project integration src/core/call-store.int.test.ts -t status
expected: passing tests that seed calls answering 200, 404 and 500, one error completion, one in-flight send and one
send with no completion, then assert:
  - listCalls with ['404'] returns only the 404 call; ['200','500'] returns both, newest first
  - [''] returns the error, in-flight and interrupted calls and no call that has a status
  - ['404',''] returns their union; [] and absent return every call
  - with limit 1 and ['200'], the newest 200 call is returned even when newer calls have other statuses
  - listRequestGroups with ['404'] counts only 404 calls per group, and `latest` is the newest 404 call
  - listStatusCodes returns 200, 404 and 500 with their counts and No response with 3, scoped by environmentId
  - historyMark is the same with and without a status selection, and changes when a 200 call is added while the
    filter selects only 404
$ npx vitest run --project unit src/shared/wire-codec.test.ts
expected: the two new round-trip cases pass with the existing ones
$ npm run typecheck
expected: clean
```

**Done when:** the listed cases pass against the test database, and `typecheck` is clean with the new contract fields.

**Executor:** lz-tdd: the result sets are known before the code. test-strategy T2.3 ("a history filter returns the
wrong set of calls") places this at the integration layer.

### Phase 2 — search filters by status

**Changes:**
- `src/shared/ipc-contract.ts`: `statuses: StatusList` in `SearchQuerySchema`, and `status: z.array(FacetOptionSchema)`
  in the `facets` of `SearchResultSchema`.
- `src/core/call-store.ts`: `factsOf` gains `status` (`"200"` or `""`), derived from the summary it already reads. Inside
  `matches` (line 230), `'status'` becomes a `FacetName` checked by `within(query.statuses, f.status)`. `facets.status` is
  built with `facet('status', …)`, so its counts leave out the status selection.
- `src/shared/wire-codec.test.ts`: a round-trip case for `SearchResultSchema` with a `status` facet.

**Verification:**

```
$ npx vitest run --project integration src/core/search.int.test.ts -t status
expected: passing tests showing that
  - text + ['404'] returns only 404 calls containing the text
  - the status facet counts every status under the text and method filters, ignoring the status selection
  - [''] matches error and in-flight calls
$ npx vitest run --project unit src/shared/wire-codec.test.ts
expected: passes, with the SearchResult case
```

**Done when:** these cases pass and the existing `search.int.test.ts` cases still pass unchanged.

**Executor:** lz-tdd: the same pure-set reasoning as Phase 1, on the code path search already tests.

### Phase 3 — the combo box filters the default History list

**Precondition:** A4 is settled. `history-grouping` is closed or its fixes are committed, and the working tree has no
unrelated edits to `app.tsx`.

**Changes:**
- `src/renderer/app.tsx`:
  - a `StatusFilter` component: an input with `role="combobox"`, `aria-expanded` and `aria-controls`, and a popup
    `role="listbox"` with `aria-multiselectable="true"`;
  - each option is `role="option"` with `aria-selected`, its label and its count;
  - the closed field shows the selected codes, or `All statuses` when none is selected, and has a clear (×) control;
  - typing narrows the options;
  - Space and Enter toggle the active option, Escape closes the popup, and a click outside closes it;
  - `App` holds `statuses: string[]` (initially `[]`) and renders the combo box between `.search-box` and the list
    (around line 1115).
- Refresh key: `historyMark` (`app.tsx:647`) becomes `${dataVersion}:${mark}`, where `mark` is stored with the list in
  `historyList`. Nothing else in the file derives a refresh from `history`'s length, first row or in-flight count.
- Stale answers: `refreshHistory` (`app.tsx:311`) reads the selection through a `currentStatuses` ref, which mirrors
  `currentEnvironment`. Its result is dropped when the selection changed while the request was pending. `historyList`
  also stores the selection it was fetched with, and `history` (`app.tsx:211`) is empty unless both the environment and
  the selection match. A changed selection triggers `refreshHistory`, as an environment change does (`app.tsx:351`).
- `useRequestGroups` (`app.tsx:2527`): `statuses` is passed to it and added to its key text. A result from another key
  is already dropped there.
- Options come from `listStatusCodes`, refetched on the environment and on `historyMark`. A selected code that is not in
  the current options stays selected and is listed with count 0.
- In an expanded group, the rows from `useResponses` are filtered on the client by the same selection. The group's count
  already reflects it, from Phase 1.
- Empty state: when a selection is active and the day or grouped view lists no call, the list area shows "No calls with
  the selected status" instead of an empty list. The combo box stays visible above it.
- `e2e/status-filter.spec.ts`: new. It seeds calls through the capture server answering 200, 404 and 500, plus one
  connection-refused send.

**Verification:**

```
$ npm run build && npx playwright test e2e/status-filter.spec.ts
expected: scenarios pass:
  - nothing selected → every call is listed
  - select 404 → only 404 rows (day view), then switch to grouped → each group's count counts only 404 calls
  - add No response → the refused call is listed as well
  - × clears → every call again
  - select a code with no calls in the selected environment → "No calls with the selected status" is shown
  - with 404 selected, send a request that answers 200 → the responses strip lists the new call, and the History list
    does not
  - two quick selections with the first listCalls answer held (`stubOperation`) and released last → the list
    matches the second selection
  - keyboard: focus, ArrowDown, Space selects, Escape closes, and the selection is kept
  - the open listbox is `toBeInViewport()` in the sidebar
  - row counts are read after waiting for the listed count (lesson 2026-11-23), never immediately after a selection
  - expectNoCspViolations(page) is called at the end of the spec (lesson 2026-11-23, CSP claim)
$ npm run test:e2e
expected: the existing history-grouping, environment-history, responses and search specs still pass
```

**Done when:** the spec passes against the production build, and the full e2e suite has no new failure.

**Executor:** lz-e2e: the risks are the wiring of a new control, the refresh key and answer order in the assembled UI.
test-strategy T2.10 places answer-order defects at the e2e layer. The query semantics are covered by Phases 1 and 2.

### Phase 4 — the combo box in search mode

**Changes:**
- `src/renderer/app.tsx`: the `Filters` interface does not change. `queryOf` gains `statuses` from `App` state. The
  combo box takes its options from `searchResult.facets.status` while `searchActive` is true, and from
  `listStatusCodes` otherwise. `searchKey` includes `statuses`. `clearSearch` leaves `statuses` unchanged.
- `e2e/status-filter.spec.ts`: search scenarios.

**Verification:**

```
$ npm run build && npx playwright test e2e/status-filter.spec.ts
expected: scenarios pass:
  - type text that matches calls of two statuses, select one → the results table lists only that status, and the total
    changes
  - option counts follow the text filter
  - Clear all ends search and the selection remains, filtering the default list
```

**Done when:** the spec passes, with Phase 3's scenarios unchanged.

**Executor:** lz-e2e: same reason as Phase 3.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| A large `$in`/`$nin` id list (tens of thousands of ids) in one query | low | slow History | A2. The cost is of the same order as search's full read. Indexing is out of scope and recorded for the roadmap. |
| A refresh is lost because the key no longer reads the filtered list | medium before this revision | strips and groups out of date | The server's `mark` ignores the selection (Phase 1 test), and a Phase 3 scenario sends a 200 request while 404 is selected |
| An earlier selection's answer arrives last | medium | the list does not match the selection | The selection ref guard and stored selection in Phase 3, with a held-answer scenario |
| e2e counts read mid-refetch | medium | flaky spec | Phase 3 waits for the listed count, following the 2026-11-23 lesson |
| The selected environment changes and a selected code has no calls there | medium | the list is empty and the cause is unclear | The code stays listed with count 0, and the empty state names the status filter |
| The combo popup escapes the narrow sidebar or is clipped | medium | the control is unusable | A `toBeInViewport()` assertion in Phase 3's verification |
| `history-grouping` fixes land in the same code during Phase 3 | medium | a mixed diff and a confused review | A4 precondition on Phase 3 |

## For the reviewer

- **The `mark` replaces three of `historyMark`'s four inputs.** Check that nothing other than `historyMark` relied on
  `history`'s length or first row to refresh. A5 rests on the single definition at `app.tsx:647`. This is the weakest
  link of revision 2.
- **Clear all leaves the status selection in place.** The combo box sits outside the Filters panel and has its own
  ×, and keeping it through Clear all treats it as a standing view setting. The other choice is to reset it with the
  search filters. This decision is not in `change.md`; it follows from the placement the user chose.
- **An expanded group is filtered on the client.** `listResponses` is shared with the responses strip, which must stay
  unfiltered, so the expanded rows are filtered in the renderer. It returns at most `RESPONSES_LIMIT` (500) calls, so a
  group with more than 500 calls could show fewer matching rows than its count. A `statuses` parameter on
  `listResponses` would avoid that, at the cost of one more contract field.
- **"No response" covers three states:** error completions, in-flight calls and interrupted calls. Check that this is
  what the user means by "request and responses with specified http code".
- **The empty-state text comes from the plan review, not from the user.** It exists so that an empty filtered list
  does not look like an empty History.

## References

- `src/core/call-store.ts:88` (`listCalls`), `:144` (`listRequestGroups`), `:179` (`searchCalls`), `:369` (`list`),
  `:505-507` (no completion → in-flight or interrupted): where the condition is applied
- `src/core/call-schema.ts:82-88`, `:103-108`: `response.status` on the completion and its summary
- `src/shared/ipc-contract.ts:124`, `:281`, `:291`, `:325-360`: the input, result and search schemas being extended
- `src/server/ipc.ts:530-556`: the `listCalls` handler and its database-down branch
- `src/renderer/app.tsx:211` (`history`), `:311-330` (`refreshHistory` and its environment guard), `:379-385` (polling
  while in flight), `:405-408`, `:777`, `:882` (`dataVersion` bumps), `:647` (`historyMark`), `:672-728` (views keyed
  on it), `:1100-1135` (History tab), `:2527` (`useRequestGroups`), `:3605` (`queryOf`), `:3908` (search's empty text)
- `context/archive/history-search/record.md`: UI-side filtering of History was rejected, and facet counts leave out
  their own facet
- `context/changes/history-grouping/`: open change touching the same History code (A4)
- `context/foundation/test-strategy.md` T2.1, T2.3, T2.10: contract round trips, history filters at integration, answer
  order at e2e
- `context/foundation/lessons.md` 2026-11-23 (two entries): count rows after the refetch, and assert every CSP claim

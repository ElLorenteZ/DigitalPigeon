---
change_id: environment-aware-history
produced-by: lz-e2e
plan: plan.md
updated: 2026-11-23
---

# Progress: Detect a call's environment from its URL, and show History for the selected environment

Branch `environment-aware-history`, created from `history-grouping` @ `a43ff5f` and moved onto `af7a187` once
history-grouping's Phases 3 and 5 were committed on their own branch (that commit was checked separately: typecheck,
lint, 410 unit, 383 integration, 95 e2e). This change is committed on top of it.

## Phase 1 — One rule picks the environment of a full URL

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-23
- **Finished:** 2026-11-23

**Changed**
- `src/core/url.ts` — `environmentForUrl(url, environments, selectedId)`: none for a path or an unparseable URL; otherwise the URL as `new URL(url).href`, and among the environments `pathFor` accepts, the longest `baseUrl` (trailing slashes removed); among equal ones, the selected one, otherwise the first given.
- `src/core/url.test.ts` — `describe('environmentForUrl')`, 6 tests.

**Verification**

```
# red
$ npx vitest run --project unit src/core/url.test.ts
TypeError: environmentForUrl is not a function
      Tests  6 failed | 43 passed (49)

# green
$ npx vitest run --project unit src/core/url.test.ts
      Tests  49 passed (49)
```

PASS — no environments, a path, unparseable → none; another host or scheme → none; the longest baseUrl wins; `/apix`
is not under `/api`; `HTTP://H.TEST:80/x` matches `http://h.test/`; equal baseUrls → selected, else first; every
existing `url.test.ts` case unchanged.

**Drift:** defect — the plan's case "the baseUrl itself with no trailing path (`http://h/api`) → no match for
`http://h/api/`" is wrong: `pathFor` accepts `http://h/api/` under `http://h/api` (path `/`). The test states what
`pathFor` does: `http://h/api/` matches; `http://h/api` (no slash) does not.

## Phase 2 — A full-URL send records its matched environment (R1 superseded)

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-23
- **Finished:** 2026-11-23

**Changed**
- `src/core/environment-store.ts` — `resolveEnvironment` for a full URL returns `environmentForUrl(url, await store.list(), id)`; a deleted chosen id is not an error for a full URL. Store parameter widened to `Pick<…, 'get' | 'list'>`. Doc comment records that this supersedes review R1.
- `src/core/send.ts` — `sendAndRecord` records `environment` whenever one is given (the path check is in `resolveEnvironment`); unused `isPath` import removed; option comment updated.
- `src/core/call-schema.ts` — snapshot comments: a path joined to, or a full URL starting with, the `baseUrl`.
- `src/core/environment-store.int.test.ts` — the R1 test replaced by three: a full URL gets its match whichever environment is chosen; a URL under no baseUrl gets none; with the chosen environment deleted, a full URL is not refused and gets its match. Hosts are random, since the file shares one database.
- `src/core/send.int.test.ts` — the R1 test replaced by two: a full URL records the environment it is given, is sent as typed (not joined to the `/api/` base path) and reads back with it; a full URL with none records none.

**Verification**

```
# red (the R1 tests rewritten to the new rule)
$ npx vitest run --project integration src/core/send.int.test.ts src/core/environment-store.int.test.ts
     × a full URL gives the environment whose baseUrl it starts with, whichever is chosen
       AssertionError: expected undefined to deeply equal { …(3) }
     × with the chosen environment deleted, a full URL is not refused and still gets its match
       AssertionError: expected undefined to deeply equal { …(3) }
     × a full URL records the environment it was matched to, and is sent as typed
       AssertionError: expected undefined to deeply equal { id: 'env-a', name: 'a', …(1) }
      Tests  3 failed | 95 passed (98)

# the first green run failed on the new test's own URL assertion (query rows are appended to the URL); the assertion
# was corrected, then the code was stashed and the corrected test seen red again (3 failed), then restored:
$ npx vitest run --project integration src/core/send.int.test.ts src/core/environment-store.int.test.ts
      Tests  98 passed (98)

$ npx vitest run --project unit src/core/form-from-call.test.ts src/core/url.test.ts
(passed)
$ npm run typecheck
(no errors)
$ grep -rn "review R1" src
src/core/environment-store.int.test.ts:143:  // environment-aware-history, phase 2: supersedes review R1 (...)
src/core/environment-store.ts:124: * ... this supersedes review R1, under which a full URL used none
src/core/send.int.test.ts:326:  // environment-aware-history, phase 2: ... (supersedes review R1).
```

PASS — a full URL records the environment it starts with; one under none records none; paths unchanged; T1.1 cases
unchanged (whole integration project below).

**Drift:** decision — no `form-from-call.test.ts` case added. `formFromCall` receives a snapshot and cannot tell a
joined path from a matched full URL; the existing case "a call sent against an environment loads its path and query"
(`form-from-call.test.ts:450`) already states that Edit loads the path. A new case would pass on its first run and
specify nothing.

## Phase 3 — "All" replaces "None", and the selector follows a match

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the plan assigns this phase to lz-e2e; its risk is UI state across a send, a held answer and a reload
(T2.10). It also carries the `dataVersion` bump after every send (A3), which has no observable check of its own in
Phase 3 and is verified by Phase 5 (h) (second plan review). Run `/lz-e2e environment-aware-history`.

## Phase 4 — The server lists calls, groups and responses for one environment

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-23
- **Finished:** 2026-11-23

**Changed**
- `src/core/call-store.ts` — `inEnvironment(id)` filter (`{ 'environment.id': id }`, or `{}`); `listCalls(limit, inFlight, { includeBodies, environmentId })` filters before the limit; `listResponses(…, auth?, environmentId?)` adds it to the `sends.find` filter; `listRequestGroups(inFlight, { splitByAuth, environmentId })` lists with it.
- `src/shared/ipc-contract.ts` — `ListCallsInputSchema` (optional `{ environmentId?: string, min 1 }`); `environmentId` on `ListResponsesInputSchema` and `ListRequestGroupsInputSchema`; `PigeonApi.listCalls(input?)`.
- `src/server/ipc.ts` — the `listCalls` handler validates its optional input and passes the id; `listResponses` passes it; `listRequestGroups` passes its parsed input as before.
- `src/core/call-store.int.test.ts` — `describe('environment filter')`, own database: B's 5 calls are the oldest, behind 250 of A's and 5 with none.
- `src/server/http.int.test.ts` — with no input listCalls lists the replay; `environmentId: 'none-such'` empties listCalls, listResponses and listRequestGroups over HTTP.
- `src/server/ipc.int.test.ts` — a non-string, empty or null `environmentId` refused by the three operations; no input and a valid id accepted.

**Verification**

```
# red
$ npx vitest run --project integration src/core/call-store.int.test.ts -t "environment filter"
     × listCalls with an environment returns its calls only, even beyond the newest 200; without one, every call
       AssertionError: expected [ 'n-4', 'n-3', 'n-2', 'n-1', …(196) ] to deeply equal [ 'b-4', 'b-3', 'b-2', 'b-1', 'b-0' ]
     × listResponses with an environment keeps the calls recorded under it
     × listRequestGroups with an environment counts its calls only
      Tests  3 failed | 32 skipped (35)
$ npx vitest run --project integration src/server/ipc.int.test.ts src/server/http.int.test.ts
     × list operations refuse an environment that is not an id string
       AssertionError: expected { ok: true, calls: [ { …(3) }, …(4) ] } to match object { ok: false }
     × every operation in the contract answers through HTTP
       AssertionError: expected [ Array(1) ] to deeply equal []
      Tests  2 failed | 41 passed (43)

# green
$ npx vitest run --project integration src/core/call-store.int.test.ts
      Tests  35 passed (35)
$ npx vitest run --project integration src/server/ipc.int.test.ts src/server/http.int.test.ts
      Tests  43 passed (43)

$ npx vitest run --project unit
      Tests  416 passed (416)
$ npx vitest run --project integration
      Tests  390 passed (390)
$ npm run typecheck && npm run lint
(no errors) · Finished in 165ms on 101 files
```

PASS — each operation narrows to one environment's recorded calls before any limit; no input lists every call; a bad
id is refused.

**Drift:** decision — `src/renderer/api.ts` unchanged: `call(channels.listCalls)` is generic over the contract's
signature, so the optional input needed no edit (plan listed it). The plan's `wire-codec.test.ts` step is moot: no
result schema changed (it passes in the unit run above).

## Phase 5 — History, the strips and search follow the selected environment

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the plan assigns this phase to lz-e2e; its risks are rendered lists swapped under a key across a selector
change, and search's default state (T2.10). Its server half is Phase 4 (done). Run `/lz-e2e environment-aware-history`
after Phase 3.

## Phase 3 — "All" replaces "None", and the selector follows a match

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-23
- **Finished:** 2026-11-23

**Risk:** a user sends a full URL to a known environment and the select does not move to it, or moves after the user
picked another environment during the send, or forgets the choice on reload. UI state across a send, a held answer and
a reload: e2e (T2.10). The match and the recording are Phases 1–2 (unit, integration), not re-tested here.

**Changed**
- `src/renderer/app.tsx` — the select's first option reads "All" (value `""`, as "None"); `currentEnvironment` ref (the select's value, read after an await); `followDetected(sent, url, sentWith)`: after an ok send of a full URL recorded under an environment still listed, `chooseEnvironment(id)` unless the select changed since the send started; `run` bumps `dataVersion` after every send result (A3; no check of its own in this phase, verified by Phase 5 (h)).
- `e2e/environments.spec.ts` — capture server `c`; "None" → "All" in the first scenario's option list and the deletion scenario (now also asserts the checked option reads "All"); two scenarios: (a)+(b)+(d) a full URL under `detected` moves the select, the call record names it, a reload keeps it, a URL under none leaves the select; (c) a choice made during a held send (`stubOperation` + `gate` on `send`) is kept and the call is still recorded under its match. (e) is the existing deletion scenario with "All".

**Verification**

```
# red, before the behaviour existed
$ npm run build && npx playwright test e2e/environments.spec.ts
  ✘  a path goes to the chosen environment, …                     (option list: 'None' ≠ 'All')
  ✘  a refused base URL says why, … leaves All, …                 (toHaveText 'All')
  ✘  a full URL under an environment moves the select to it, …    (1.0m: no "All" option to select)
  ✘  a choice made while a full-URL send is in flight is kept, …  (1.0m: no "All" option to select)
  4 failed · 3 passed
# the two new scenarios failed before their detection steps, so each was also broken deliberately after green:

# deliberate breaks, each reverted
(follow removed: chooseEnvironment not called)        1 failed — a full URL under an environment … (toHaveText)
(in-flight guard removed)                             1 failed — a choice made while … in flight (toHaveValue)

# green, three runs
$ npm run build && npx playwright test e2e/environments.spec.ts   (×3)
  7 passed (3.7s)
  7 passed (3.7s)
  7 passed (3.7s)

$ npm run test:e2e
  97 passed (1.4m)
```

PASS — "All" replaces "None"; the select follows a detected environment, keeps a choice made during the send, and the
choice survives a reload. A2 held for this phase: the whole suite passed with no reset.

**Drift:** none.

## Phase 5 — History, the strips and search follow the selected environment

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-23
- **Finished:** 2026-11-23

**Risks:** with an environment selected, History, request groups, the strip or Other responses show another
environment's calls; a list fetched for one environment appears after switching to another; selecting an environment
turns search on; search does not start narrowed, or cannot be widened; a send outside the selection never reaches open
search results; the strip hides the call on screen without saying why. Rendered state across a selector change: e2e
(T2.10). Which calls an environment holds is Phase 4 (integration).

**Changed**
- `src/renderer/app.tsx`
  - History state `historyList: { environmentId, calls }`; `history` is the list only when it was fetched for the selected environment ('' = All). `refreshHistory` asks for the selected environment, drops an answer for one no longer selected, and runs again when the select changes.
  - `inSelected` (`{ environmentId }` or `{}`) added to the strip's, the expanded group's and Other responses' keys; `useResponses`' tag text includes it; `useRequestGroups(enabled, splitByAuth, environmentId, refresh)` passes it and tags by it.
  - `resultOutside`: the selected environment's name when the call on screen is not recorded under it. The strip is shown for that call even with no other responses, and its label adds "· X — this call is not in X".
  - Search: `searchFollowsSelect` (default true). `searchFilters` = `filters` with `environmentIds: [selected]` (or `[]`) while following; used for the query, `searchKey`, `SearchFilters` and `SearchResults`. `changeSearchFilters` keeps following when the environment part is unchanged (and keeps it out of `filters`), otherwise stops following. A select change and `clearSearch` return to following. `searchActive` still reads `filters` only.
- `e2e/environment-history.spec.ts` (new) — 7 scenarios over environments X (`/api`) and Y (`/api`) on two capture servers and one unmatched server: (a)+(b) All lists 3, X lists 1, by day and by request, title count follows; (c) a full URL under Y moves the select and History lists Y's calls only; (d) strip and Other responses list Y's only, an unmatched send keeps Y and the strip says "Y — this call is not in Y" (in view), All removes the note; (e) selecting X leaves the workspace; search narrowed to X, chip removable, Clear all and search again → narrowed again; no text + Filters + chip removed → results stay and list every environment (second plan review); (h) search open, chip removed, a send made through Edit on a result is in the results when they are shown again; (f) a held `listCalls` answer for X is not shown after switching to Y; (g) a send under X is listed after switching to All.
- `e2e/environments.spec.ts` — A2 resets: the first scenario counts beta's one call under beta and both under All; the in-flight scenario selects All before opening the held call; the deletion scenario waits for History to list every call (as the server lists them) before counting; the B1 scenario expects second's one call instead of `rowsBefore + 1`.
- `e2e/saved-requests.spec.ts` — A2 resets in the environment scenario: All before opening the first call, second again before the edited path is sent (and a wait for its second row: its earlier call has the same name), All at the end so later tests in the file read every call.

**Verification**

```
# red, against the Phase 3 build
$ npx playwright test e2e/environment-history.spec.ts --timeout=20000
  ✘ (a)(b) toHaveCount  ✘ (c) toHaveCount  ✘ (d) toContainText  ✘ (e) chip not found
  ✘ (h) browser closed (chip not found)  ✘ (f) toHaveCount  ✘ (g) toHaveAccessibleName
  7 failed

# defects in the spec, found while going green, fixed:
#  - X's base address ends in /api, so the seed's path /api/orders went to /api/api/orders; the path is /orders
#  - strip counts compared with all History rows; now with listResponses for GET /api/orders
#  - the search clear button is "Clear all", not "Clear"
#  - (h) typed into the request form, which the results view hides while search is open; the form is reached through
#    Edit on a result and the results through "Show results"

# deliberate breaks, each reverted
(no dataVersion bump after a send)          1 failed — (h) toHaveCount
(History list not tagged; stale answer kept) 1 failed — (f) toHaveCount
(search ignores the select)                 2 failed — (e) toBeVisible, (h)
(strip label without the "not in" note)     1 failed — (d) toContainText
(groups not narrowed by environment)        1 failed — (a)(b) toHaveAccessibleName

# green, three runs
$ npm run build && npx playwright test e2e/environment-history.spec.ts   (×3)
  7 passed (5.0s)
  7 passed (5.1s)
  7 passed (5.0s)

# A2: the whole suite after Phase 5, before the resets
$ npm run test:e2e
  3 failed — environments.spec.ts:90, :234; saved-requests.spec.ts:245   101 passed
# after the resets, one more failure surfaced only in the full suite (environments.spec.ts:158, counting rows while
# History refetched for All) and the B1 scenario's count had the same race; both fixed as above
$ npx playwright test e2e/environments.spec.ts --repeat-each=2   (×3)
  14 passed · 14 passed · 14 passed
$ npx playwright test e2e/environments.spec.ts e2e/saved-requests.spec.ts   (×3)
  16 passed · 16 passed · 16 passed
$ npm run test:e2e   (×2)
  104 passed (1.5m)
  104 passed (1.5m)

$ npm run typecheck && npm run lint
(no errors) · Finished in 150ms on 102 files
$ npx vitest run --project unit && npx vitest run --project integration
      Tests  416 passed (416)
      Tests  390 passed (390)
```

PASS for every automated criterion. T3.2 manual look: done by the author on 2026-11-23 against the screenshots below —
"I looked, it's fine". Screenshots (throwaway spec, deleted after):
`/private/tmp/claude-501/-Users-lorentez-Developer-DigitalPigeon/4732e474-11c5-41c5-a080-962fe00a65a7/scratchpad/env-selected.png`
(staging selected after a detected send: History by request lists staging's 3 calls; an unmatched call on screen, the
strip reads "2 kept · staging — this call is not in staging"),
`/private/tmp/claude-501/-Users-lorentez-Developer-DigitalPigeon/4732e474-11c5-41c5-a080-962fe00a65a7/scratchpad/env-all.png`
(All: 4 calls).

**Drift:**
- decision — (h) as planned ("a full-URL send … appears in the results without any other action") cannot be performed:
  while search is open the request form is hidden by the results view. The scenario sends through Edit on a result
  and then presses "Show results"; it still fails without the A3 bump.
- decision — the strip is also shown when the call on screen is the only response and is outside the selection, so the
  "not in X" note has somewhere to appear (the strip was hidden with no responses).
- decision — A2 resets are per scenario (select All, or count the environment's own calls), not a shared helper; each
  is commented where it is.
- defect (plan, A2) — A2 named the risk as History narrowing after a scenario selects an environment. Two failures were
  of another kind: counting History rows while it refetches after the select changes. They appeared only in the full
  suite.

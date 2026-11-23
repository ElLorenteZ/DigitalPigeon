---
change_id: environment-aware-history
status: draft
produced-by: lz-plan
created: 2026-11-23
updated: 2026-11-23
revision: 2 — after lz-plan-review (REVISE, 2026-11-23); no phase executed, numbering unchanged
inputs: [change.md, research.md]
base: history-grouping working tree (land-slices-7-12 @ 2a44ef1 + a43ff5f + uncommitted Phases 3, 5). All file:line references are to that tree.
---

# Plan: Detect a call's environment from its URL, and show History for the selected environment

## Approach

**One selector, three meanings kept together.** The title-bar select keeps its role as the send target and gains the
History role. "None" becomes "All" (author, this session). "All" sends full URLs as typed and refuses paths, as
"None" does today (`url.ts:38`). It also shows every call, which is today's History (research, surprise 2). Choosing
an environment sends paths to it, as today, and narrows History to the calls recorded under it.

**Detection happens in main, at send time, and is written once into the existing snapshot.** For a full URL, the send
handler lists the environments from the store and picks the one whose `baseUrl` the URL starts with. The selector's id
still travels with the send (B1, `ipc.ts:263-271`) and only breaks ties. The match reuses `pathFor`'s rule
(`url.ts:70-79`) on the URL as the parser writes it, so the rule Edit uses to restore a path is the rule that decides
the environment. The call records the same `EnvironmentSnapshot` a path send records (`call-schema.ts:19-32`). This
supersedes slice 5's review R1 ("a full URL records no environment", `send.int.test.ts:326`), by the author's decision
in `change.md`.

**Filtering uses the recorded snapshot only** (author, this session). History, request groups, the responses strip and
search all filter on `send.environment.id`. Older full-URL calls have no snapshot and appear under "All" only. Editing
an environment never moves an old call, which keeps the slice 5 principle (`saved-requests-and-environments/record.md:36-41`).
The search facet already reads that field (`call-store.ts:449`), so all four places agree.

**The selector follows a match** (author, this session). After a full-URL send whose recorded environment is X, the
selector moves to X and the choice is stored for startup, as a manual choice is (`app.tsx:876-890`). With no match, the
selector stays. A choice the user made while the send was in flight wins over the follow (the "state captured before
an `await`" class, `saved-requests-and-environments/record.md:64`, six instances).

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| A separate History environment control, with the title-bar select unchanged | Two environment choices on screen, and they can disagree. Rejected by the author this session ("All replaces None"). |
| Match old full-URL calls at read time against today's environments | Editing a `baseUrl` would move old calls between environments, against slice 5's snapshot rule. The search facet would disagree unless it changed too, outside the boundary. Rejected by the author this session. |
| Detect in the renderer and send the matched id | The renderer would decide what main records. Slice 5 rejected "the renderer composes the URL and sends it with a snapshot" (`record.md:47`). Main already loads environments by id (B1). |
| Match on origin (scheme + host + port) only | Ignores a `baseUrl` with a path (`http://h/api/`). Edit would then restore a path that does not compose back, since `pathFor` needs the prefix. One rule for both is the reason `pathFor` is reused. |
| Several matches → record none | A URL under `http://h/api/` with environments `http://h/` and `http://h/api/` is clearly the second. Longest `baseUrl` wins; for equal `baseUrl`s, the selected environment if it is one of them, otherwise the first in `list()` order (name, then `baseUrl`, `environment-store.ts:57-60`). |
| Filter History in the renderer from the newest 200 | An environment used less often shows few or no calls. The server filters before the limit (`ipc.ts:81`). |

## Out of scope

- Rewriting a request's URL when the selector changes; values from responses into environments (change.md boundary).
- Backfilling snapshots on stored calls (change.md boundary; records are insert-only).
- Replay. A replay records the original's snapshot unchanged (`send.ts:279-287`), and the selector does not follow a
  replay or a resend. Not asked; the intent says "requests", which the send path covers.
- Template sends get detection only because they go through the same send (`template-store.ts:243-245`). No template
  UI change.
- An environment filter for unreadable records. They have no snapshot and appear under "All" only.
- A design update in the Pencil file for "All" (the author's instruction outranks the design, `AGENTS.md`).
- Changing what "All" is called elsewhere: the search facet keeps "No environment" for calls with no snapshot.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | A typed full URL that parses can be compared as `new URL(url).href` against the stored `baseUrl` (itself a `href`, `url.ts:67`). A URL that does not parse has no match. | An upper-case host or explicit default port misses its environment (research, "Matching runs on strings"). Phase 1's unit cases fail first. | no — covered by Phase 1 cases |
| A2 | Existing e2e specs keep passing. Several specs choose an environment (`environments.spec.ts`, `saved-requests.spec.ts`, `templates.spec.ts`, `shell.spec.ts`) inside a shared context and database. A later scenario in the same file that sends a full URL and reads History could find History narrowed, or the selector moved by detection, if an environment's `baseUrl` equals the capture server's URL. | Phase 3 or 5 cannot finish green until those specs reset to "All". | **yes** — checked in Phase 3's verification (whole e2e suite) before Phase 5 adds filtering; each failing spec gets an explicit reset, recorded in the ledger |
| A3 | **Revised (plan review).** `dataVersion` is bumped only after a delete lands (`app.tsx:739`) and after a resend (`app.tsx:818`), not after a send; a send refreshes History (`app.tsx:384`) and `historyMark` (`app.tsx:623`) changes only because the list changed. Once the list is filtered, a send outside the selected environment leaves the list, and so `historyMark`, unchanged; search (`app.tsx:777`) would not refetch. The plan therefore bumps `dataVersion` after every send result (Phase 3), and assumes that one counter is the refresh signal for every view keyed on `historyMark`. | Search with the environment chip removed misses sends outside the selection. Caught by Phase 5 (h). | no — verified by reading; Phase 5 (h) observes it |
| A4 | The stored active setting `null` means "All". No migration: `settings.active-environment.environmentId: null` (`environment-store.ts:28-32`) already means "none chosen". | None; "All" is a label for the same value. | no |

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | One rule picks the environment of a full URL | `src/core/url.ts`, `src/core/url.test.ts` | lz-tdd | `npx vitest run --project unit src/core/url.test.ts` |
| 2 | A full-URL send records its matched environment (R1 superseded) | `environment-store.ts`, `ipc.ts`, `send.ts`, `call-schema.ts` comment, int tests | lz-tdd | `npx vitest run --project integration src/core/send.int.test.ts src/core/environment-store.int.test.ts` |
| 3 | "All" replaces "None", and the selector follows a match | `app.tsx`, `e2e/environments.spec.ts` | lz-e2e | `npm run test:e2e` |
| 4 | The server lists calls, groups and responses for one environment | `call-store.ts`, `ipc-contract.ts`, `ipc.ts`, `api.ts`, tests | lz-tdd | `npx vitest run --project integration src/core/call-store.int.test.ts src/server/ipc.int.test.ts src/server/http.int.test.ts` |
| 5 | History, the strips and search follow the selected environment | `app.tsx`, `e2e/environment-history.spec.ts` (new) | lz-e2e | `npm run test:e2e` |

### Phase 1 — One rule picks the environment of a full URL

**Changes:**
- `src/core/url.ts` — `environmentForUrl(url, environments, selectedId)`: `undefined` for a path (`isPath`) or an
  unparseable URL; otherwise the URL as `new URL(url).href`, and of the environments for which `pathFor(href, env)` is
  defined, the one with the longest `baseUrl` (trailing slashes removed); among equal `baseUrl`s, the one whose id is
  `selectedId`, otherwise the first in the given order.

**Verification:**
```
$ npx vitest run --project unit src/core/url.test.ts
expected: passes — new cases: no environments → undefined; a path → undefined; http://h/x matches http://h/;
          http://h/api/x picks http://h/api/ over http://h/; http://h/apix does not match http://h/api/;
          http://H:80/x matches http://h/ (A1); https vs http do not match; two environments with one baseUrl →
          the selected one, else the first; unparseable URL → undefined; the baseUrl itself with no trailing path
          (http://h/api) → no match for http://h/api/, as pathFor
```

**Done when:** the command passes and every existing `url.test.ts` case passes unchanged.

**Executor:** lz-tdd — a pure function with enumerable cases (T2.5, unit).

### Phase 2 — A full-URL send records its matched environment

**Changes:**
- `src/core/environment-store.ts:116-130` — `resolveEnvironment` for a full URL lists the environments and returns
  `environmentForUrl(url, list, id)` instead of `undefined`. A deleted selected id is not an error for a full URL (as
  today). The doc comment names R1 as superseded by this change. Its store parameter widens from
  `Pick<…, 'get'>` (`environment-store.ts:121`) to `Pick<…, 'get' | 'list'>`; every test fake typed to it gains
  `list`.
- `src/core/send.ts:96-99` — records `environment` whenever one is given (the path check moves to
  `resolveEnvironment`); `composeUrl` still leaves a full URL unchanged (`url.ts:36`).
- `src/core/call-schema.ts:31` — comment: present when a path was joined to the environment's `baseUrl` or a full URL
  started with it.
- Tests: `send.int.test.ts:326` and `environment-store.int.test.ts:142` change from "records no environment" to the new
  rule (R1 superseded: an intended behaviour change, so these edits are the red step, not a refactor).
- Edit of a detected call loads the path (`form-from-call.ts:197-199`), as for a path send. No code change; one
  `form-from-call.test.ts` case states it.

**Verification:**
```
$ npx vitest run --project integration src/core/send.int.test.ts src/core/environment-store.int.test.ts
expected: passes — a full URL under an environment's baseUrl records that environment's snapshot; one matching no
          environment records none; with the selected environment deleted, a full URL still sends and records the
          match; a path send is unchanged; the call is immutable afterwards (T1.1 cases unchanged)
$ npx vitest run --project unit src/core/form-from-call.test.ts
expected: passes — a full-URL call with a snapshot loads its path
$ npm run typecheck
expected: no errors
```

**Done when:** all pass, and `grep -n "review R1" src` shows only the superseded note.

**Executor:** lz-tdd — what the store holds after a send (T1.1, T2.5; integration).

### Phase 3 — "All" replaces "None", and the selector follows a match

**Changes:**
- `src/renderer/app.tsx:899-911` — the first option reads "All" (value `""`, as "None" today).
- After an ok send whose request URL was not a path and whose `send.environment` names an environment still in the
  list, call `chooseEnvironment(id)` (`app.tsx:876`), unless the selector changed since the send started. The selected
  id is read when the send starts and compared when the result arrives.
- `run` (`app.tsx:367-386`) bumps `dataVersion` after every send result, beside its `refreshHistory()`, so views keyed
  on `historyMark` refetch after a send whatever the filter (A3). No visible change in this phase; Phase 5 observes it.
- `e2e/environments.spec.ts` — scenarios: (a) with "All" selected, a full URL to environment X's `baseUrl` moves the
  selector to X and the call record shows "Environment: X — …"; (b) a full URL matching nothing leaves the selector
  where it was; (c) the selector changed during a held send (`stubOperation` + `gate`) keeps the user's choice;
  (d) a reload after (a) still shows X; (e) a path with "All" is refused as it is with "None" today.
- Any existing spec broken by detection or the label gets an explicit reset to "All" at its start (A2), each recorded
  in the ledger.

**Verification:**
```
$ npm run build && npx playwright test e2e/environments.spec.ts
expected: passes, including (a)–(e)
$ npm run test:e2e
expected: whole suite passes (A2)
$ npm run typecheck && npm run lint
expected: no errors
```

**Done when:** all pass; each scenario seen failing first (or deliberately broken) and run three times clean.

**Executor:** lz-e2e — UI state across a send, a held answer and a reload (T2.10).

### Phase 4 — The server lists calls, groups and responses for one environment

**Changes:**
- `src/core/call-store.ts:85-89` — `listCalls(limit, inFlight, { includeBodies, environmentId })`: with an id, the
  MongoDB filter `{ 'environment.id': id }` before the limit.
- `call-store.ts:97-127` — `listResponses(..., auth?, environmentId?)`: the same filter in the `sends.find`.
- `call-store.ts:136-160` — `listRequestGroups(inFlight, { splitByAuth, environmentId })`: `list({ 'environment.id': id }, 0, …)`.
- `src/shared/ipc-contract.ts` — `listCalls` takes an optional input `{ environmentId?: string }` (today it takes none,
  `ipc-contract.ts:494`); `ListResponsesInputSchema` and `ListRequestGroupsInputSchema` gain `environmentId` (string,
  optional; absent = all).
- `src/server/ipc.ts:529-544` and the two other handlers — validate and pass it.
- `src/renderer/api.ts` — signatures.

**Verification:**
```
$ npx vitest run --project integration src/core/call-store.int.test.ts
expected: passes — 250 calls to env A, 5 to env B, 5 with none: listCalls(200, {environmentId: B}) returns B's 5
          (filter before the limit); no id returns 200 newest across all; groups and responses for B count only B;
          a snapshot of a deleted environment still matches its id
$ npx vitest run --project integration src/server/ipc.int.test.ts src/server/http.int.test.ts
expected: passes — the inputs are validated (a non-string id refused); the operations answer over HTTP; listCalls
          called with no input, as http.int.test.ts:247 does, still answers with every call
$ npx vitest run --project unit src/shared/wire-codec.test.ts
expected: passes
```

**Done when:** all pass.

**Executor:** lz-tdd — a filter returning the wrong set (T2.3, integration).

### Phase 5 — History, the strips and search follow the selected environment

**Changes:**
- `src/renderer/app.tsx:296-309` — `refreshHistory` passes the selected `environmentId` (none for "All"), and refetches
  when it changes. The list is tagged by the id it was fetched for, so a list for X is never shown under Y (T2.10).
- `useRequestGroups` and `useResponses` (history-grouping) pass it too; their tags include it.
- History search (revised after plan review): the selector's environment is applied to search queries as a
  separate default, not written into `filters`. `searchActive` (`app.tsx:233-234`) is `filtersOpen || text ||
  hasFilters(filters)`; putting the selector's id into `filters.environmentIds` would turn search on, and replace the
  workspace with results, whenever an environment is selected. Rule: while the user has not chosen in the
  environment facet, a search query carries `environmentIds: [selected]` (none for "All"), and the summary shows it
  as a removable chip. Choosing in the facet, or removing that chip, overrides it. Any selector change, manual or
  by detection, and `clearSearch` (`app.tsx:787-792`) return to following the selector. So search opens, clears and
  follows on the same rule.
- The responses strip and "Other responses" follow the selector (author). When the call on screen is not recorded
  under the selected environment (an unmatched full URL with X selected, or a call opened from "All"), the strip omits
  it and its label says so: "… · X — this call is not in X". The call stays reachable under "All".
- The History title count follows the filtered list (day mode: loaded calls; request mode: sum of groups).
- `e2e/environment-history.spec.ts` (new): calls to X (path), to Y (full URL, detected) and to an unmatched host.
  (a) "All" lists all three. (b) Choosing X lists only X's call, in both By day and By request. (c) After a full-URL
  send to Y, the selector is Y and History lists Y's call. (d) The strip and "Other responses" for a request sent to
  both X and Y show only the selected environment's; with X selected, an unmatched full URL's strip label says the call
  is not in X. (e) Selecting X does not open search: the workspace stays. Typing a search term with X selected shows
  the X chip and X's calls only; removing the chip shows all; Clear returns to X's calls. (f) A held `listCalls`
  answer for X does not appear after switching to Y (`stubOperation` + `gate`). (g) Switching to "All" after a send
  under X lists the call. (h) With search open and the X chip removed, a full-URL send to an unmatched host appears in
  the results without any other action (A3).

**Verification:**
```
$ npm run build && npx playwright test e2e/environment-history.spec.ts
expected: passes (a)–(h), three runs clean
$ npm run test:e2e
expected: whole suite passes
$ npm run typecheck && npm run lint
expected: no errors
```

**Done when:** all pass, and the author has looked at History with an environment selected (T3.2, manual).

**Executor:** lz-e2e — rendered lists swapped under a key, across a selector change (T2.10).

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| R1 Existing e2e specs fail because History narrows or the selector moves | medium | Phases 3, 5 blocked | A2: whole suite in Phase 3; explicit resets recorded |
| R2 The selector moves under the user during a send | medium without the guard | next path send goes elsewhere | Phase 3 (c): a choice made during the send wins |
| R3 The user expects old full-URL calls under their environment | high for existing history | "my calls are missing" under X | Accepted by the author (snapshot only); they remain under "All" |
| R4 Detection moves the selector to an environment the user did not intend (nested `baseUrl`s) | low | path sends go to the longer `baseUrl` | Longest-prefix rule, Phase 1 cases; the selector shows the result |
| R5 A deleted environment's calls are reachable only under "All" | certain | small | Accepted; the search facet still lists the deleted environment by its snapshot |

## For the reviewer

- **"All chosen by default".** The plan reads this as: with nothing stored, the selector shows "All", and the stored
  choice still restores at startup (slice 5). The other reading, "every start opens on All", would drop the startup
  restore. Not asked; check with the author.
- **R1 superseded.** A recorded slice 5 decision with tests is reversed by the author's intent. The plan changes the
  two pinning tests as red steps. Check that no other reader depends on "a snapshot means a path was joined": the
  research found Edit (`form-from-call.ts:199`), where the change is intended.
- **Search follows the selector as a default, not as a filter.** The author asked for search to follow. Any selector
  change, including a move by detection after a send, discards a facet choice the user made in search. Chosen here as
  one rule; the alternative (only manual changes reset it) keeps the user's choice but lets search disagree with the
  selector silently.
- **The strip omits the call on screen when it is not in the selected environment**, and says so in its label. The
  alternative, filtering the strip by the shown call's own environment, contradicts "the strips follow the selected
  environment" (author).

### Revision 2 — what changed after lz-plan-review

| Review finding | Change |
|---|---|
| A3 false: `dataVersion` is not bumped on send | A3 restated against `app.tsx:739, 818, 384`; Phase 3 bumps it after every send result; Phase 5 (h) |
| Search's starting state contradicted "follows the selector" | Selector applied as a default separate from `filters` (it would otherwise turn search on, `app.tsx:233`); one rule for open, clear and change; Phase 5 (e) |
| The call on screen absent from its own strip | Decided: strip follows the selector and its label says the call is not in X; Phase 5 (d) |
| Detection resets the search facet | Stated: any selector change resets it (For the reviewer) |
| `resolveEnvironment` store type | Phase 2 names the widened `Pick` |
| `listCalls` with no input | Phase 4 expected output |
- **Phase 5 depends on history-grouping** (request groups, strips). If history-grouping is not merged first, Phase 4/5
  lose the `listRequestGroups` parts and gain a rebase.

## References

- `research.md` — findings 1–5, surprises 1–4, unanswered 1–6 (settled: 4 by the author this session; matching rule,
  several matches and Edit chosen here).
- `src/core/url.ts:30-40, 42-68, 70-79` — isPath, composeUrl, checkBaseUrl, pathFor.
- `src/core/environment-store.ts:57-60, 97-130` — list order, active setting, resolveEnvironment.
- `src/core/send.ts:94-99, 279-287`; `src/core/call-schema.ts:19-32`.
- `src/server/ipc.ts:81, 263-290, 529-544`; `src/shared/ipc-contract.ts:95-102, 458-463, 494`.
- `src/renderer/app.tsx:197-202, 262-309, 623, 876-911`.
- `src/core/call-store.ts:85-160, 217, 449-451`.
- `context/archive/saved-requests-and-environments/record.md` — B1, R1, snapshot rule, state-after-await class.
- `context/foundation/test-strategy.md` — T1.1, T2.3, T2.5, T2.10, T3.2.
- Author answers, this session: All replaces None; follow a match, keep if none; recorded environment only; list,
  strips and search follow.

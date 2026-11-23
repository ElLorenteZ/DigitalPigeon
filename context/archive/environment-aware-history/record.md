---
change_id: environment-aware-history
title: Detect a call's environment from its URL, and show History for the selected environment
produced-by: lz-archive
archived: 2026-11-23
change-opened: 2026-11-23
ticket: null
verdict: merge-with-fixes
outcome: shipped
milestone: none (author request after M1/M2; builds on history-grouping)
branch: environment-aware-history @ 254447c, merged into main as 6cc8c9f (directly, no PR review)
raw: raw/
---

## 1. What was built

A full URL now records the environment whose `baseUrl` it starts with, not only a path joined to one. Main decides it at
send time from the environments store (`environmentForUrl` in `src/core/url.ts`, called by `resolveEnvironment`):
`pathFor`'s prefix rule on the URL as the parser writes it, the longest `baseUrl` wins, and among equal ones the selected
environment, otherwise the first by name. The snapshot is the same `{id, name, baseUrl}` a path send records.

The title-bar select reads "All" where it read "None" (same value, `null`). After a full-URL send recorded under an
environment, the select moves to it and stores the choice for startup, unless the user changed the select while the
send was in flight. With no match the select stays.

History (by day and by request), the responses strip, the call record's Other responses and search follow the select,
filtering on the recorded snapshot id. `listCalls`, `listResponses` and `listRequestGroups` take an optional
`environmentId`, applied in MongoDB before History's 200 limit. Search applies the select's environment as a default
chip kept out of `filters`. The strip says "· X — this call is not in X" when the call on screen is outside the
selection.

Differences from the plan, all recorded in `raw/progress.md`:
- Scenario (h) could not be run as planned. The request form is hidden while search is open, so the send goes through Edit on a result and "Show results".
- A2 cost more than planned. Three existing scenarios needed resets, and two more raced History's refetch after a select change. Those two showed up only in the full suite.
- One planned unit case was wrong about `pathFor`: `http://h/api/` is under base `http://h/api`.
- A planned `form-from-call` test was not added, because the existing case already covers it.

## 2. Why this approach

The author's words: "environments should be updated automatically on requests. history should be shown for selected
environment with "all" chosen by default". The author chose "Request URL → env detected" and one change for both parts.

One select keeps one meaning on screen: where paths go, and which calls are shown. A second History control could
disagree with it. Detection lives in main and reads the store, so the renderer never decides what is recorded. That is
slice 5's B1 rule. Reusing `pathFor` means the rule that picks a call's environment is also the one Edit uses to turn the
call back into a path.

Filtering by the recorded snapshot only keeps slice 5's principle that editing an environment never changes what an old
call means. It also agrees with the search facet, which already filtered by snapshot id.

## 3. What was rejected

- **Rewrite the open request's URL when the select changes** (offered for "updated automatically"). Not chosen by the author.
- **Write values from responses into environments.** Not chosen. The PRD also excludes variables other than `baseUrl`.
- **A separate History environment control, title-bar select unchanged.** Two choices that can disagree. The author chose "All replaces None".
- **Match old full-URL calls at read time against today's environments.** Editing a `baseUrl` would move old calls, against the snapshot rule, and the search facet would disagree. The author chose recorded-environment-only, so older full-URL calls appear under "All" only.
- **Detect in the renderer and send the matched id.** The renderer would decide what main records, which slice 5 rejected.
- **Match on origin only.** Ignores a `baseUrl` with a path. Edit's `pathFor` would then fail to restore the path.
- **Several matches → record none.** A nested `baseUrl` is clearly the more specific one, so the longest prefix wins.
- **Filter the newest 200 in the renderer.** A rarely used environment would show little or nothing, so the server filters before the limit.
- **Put the selector's id into search `filters`.** `hasFilters(filters)` turns search on, so selecting an environment would replace the workspace with results. Found in the first plan review.
- **Strip filtered by the shown call's own environment.** Contradicts "the strips follow the select" (author).
- **Selector follows replays and resends.** Out of scope. A replay records the original's snapshot.

## 4. Surprises

- **The intent reversed a recorded decision.** Slice 5's review R1, "a full URL records no environment", had three tests pinning it. Two were rewritten as red steps; `url.test.ts:32` still holds, since full URLs are still sent as typed.
- **`dataVersion` was bumped only after deletes and resends, not sends** (first plan review). A filtered `historyMark` no longer changes for a send outside the selection, so search went stale. `run` now bumps it after every send.
- **Selecting an environment would have opened search,** because `searchActive` reads `filters`. Caught at plan revision, before any code.
- **Every select change now refetches History.** Specs that count rows straight after a change race that refetch. This failed only in the full suite.
- **The ledger tools read a phase's first entry** (the lz-tdd routing note) as its status, so routed phases look unfinished to the scripts.
- **The two changes had to be split after the fact.** history-grouping's uncommitted work shared `app.tsx` with this change. It was separated by reversing this change's edits on a copy and checking that version alone: 410 unit, 383 integration, 95 e2e.

## 5. What still stands

- **Load-bearing:** `resolveEnvironment` (`src/core/environment-store.ts`) lists all environments on every full-URL send. Matching is `environmentForUrl` plus `pathFor` (`src/core/url.ts`). The snapshot is written once, so editing or deleting an environment never moves a call.
- **Renderer state:**
  - `historyList` is tagged with the environment it was fetched for.
  - `currentEnvironment` is a ref holding the select's value, assigned during render and read after awaits.
  - `searchFollowsSelect` tracks whether search still follows the select.
  - `followDetected` is called only from Send.
- **Known and accepted:**
  - Calls sent to a full URL before this change have no snapshot and appear only under "All".
  - A deleted environment's calls appear only under "All".
  - Any select change, including a move by detection, discards an environment choice made in search.
- **If a call lands under the wrong environment,** check, in order:
  1. Whether two `baseUrl`s overlap: longest wins, then the selected one, then first by name.
  2. Whether the typed URL normalises differently: `new URL(url).href`.
  3. `resolveEnvironment`.
- **If History or a strip shows another environment's calls,** check the `@environmentId` part of `useResponses` and `useRequestGroups`' tag text, and the `historyList.environmentId` comparison.
- **If search shows stale results after a send,** check the `setDataVersion` call in `run`'s `finally`.
- **Not reviewed:** general correctness. `/code-review` was not run before the direct merge.
- **Open at archive time** (lessons candidates in `raw/review.md`):
  - New e2e specs without a CSP assertion. This is the second change in a row, after history-grouping's F1.
  - Counting rows while History refetches.
  - Routing entries read as a phase's status.

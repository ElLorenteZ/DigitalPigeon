---
change_id: history-grouping
status: draft
produced-by: lz-plan
created: 2026-11-22
updated: 2026-11-22
revision: 2 — after lz-plan-review (REVISE, 2026-11-22); no phase verified yet, numbering unchanged
inputs: [change.md, research.md]
base: land-slices-7-12 @ 2a44ef1 (PR #12). All file:line references are to that branch.
---

# Plan: Group history by request path, optionally split by the authorization sent

## Approach

Three ideas carry the change. **One definition of each key, in `src/core/`, used by store and renderer alike.** The
request key (method + URL pathname) moves out of `app.tsx:2275-2286` into a pure core module, and the auth key
(first `Authorization` value, otherwise first `Cookie` value, otherwise none) replaces `authorizationOf`
(`headers.ts:1-7`). The renderer already imports from `src/core/headers` (`app.tsx:44`), so this follows an existing
seam. It removes the disagreement `responses-strip/record.md` §5 warns about between `pathPattern`
(`call-store.ts:402-407`) and `requestKeyOf`: `listResponses` keeps its MongoDB filter on `request.method` and drops
the `$regex`, then keeps the calls whose key, computed by the shared function, matches.

**Grouping over all of history runs in the store, in Node, the way `searchCalls` already does** (`call-store.ts:114-118`
loads every summary and filters in memory). A new operation, `listRequestGroups({ splitByAuth })`, returns one entry
per request (and per auth key when split): method, path, auth, count, and the newest call's summary. Expanding a group
calls `listResponses` with the group's key, so a group's count and its expanded rows are computed by the same function
over the same summaries.

**The toggles are per-browser preferences, held in `localStorage`.** History opens grouped by request; "Split by
auth" starts off; both are remembered on reload (author, this session). One "Split by auth" setting applies to the
History list and to both responses views, so "auth" means one thing on screen at a time. Storage access is wrapped so a
blocked or empty `localStorage` falls back to the defaults.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Group the newest 200 History rows in the renderer | A request last sent 201 calls ago has no group or a short count (`ipc.ts:78`). Rejected by the author this session, and by `responses-strip` for the strip for the same reason. |
| Store `request.path` and an auth key on each send, with indexes and a `$group` aggregation | A schema change plus a migration of insert-only records (`call-store.ts:1-2`, T1.1); `responses-strip` and `history-search` both deferred it ("Search performance", `roadmap.md:245-248`). No measured slowness justifies it (T3.5 is manual). |
| MongoDB aggregation deriving the path from `request.url` in the query | A second implementation of the key in the query language, the disagreement this change removes. `history-search` rejected `$facet` for the same reason (two engines, one definition). |
| Keep `listResponses`'s `$regex` and add the auth filter beside it | Group counts (Node, parsed URL) and expanded rows (regex, raw text) could disagree for an encoded path: a group says 3, opens to 2. |
| A separate "Split by auth" toggle per place (History, strip, call record) | Three settings for one idea; the strip and the History list could show different groupings of the same calls. Not asked; chosen here — see For the reviewer. |
| Key auth by header name and value (`Authorization: x` distinct from `Cookie: x`) | The author's rule picks one header per call; an `Authorization` value equal to a `Cookie` value is not a realistic case. The facet contract (`auths: string[]`, `ipc-contract.ts:276`) stays a list of values. Recorded as accepted risk R4. |

## Out of scope

- A diff or side-by-side view (change.md boundary; the author compares manually).
- Parsing cookies inside the `Cookie` header, naming tokens, cookie jar (change.md boundary).
- Changing what "the same request" is: host, environment and query stay out of the key (change.md boundary).
- Storing derived keys on records, or indexes for them (rejected above).
- A design update in the Pencil file. The design draws History by day only; the author's instruction outranks it
  (`AGENTS.md`, Deeper context). The new controls follow the existing segmented-button pattern
  (`app.tsx:3863-3879`, templates' "Group into directories by").
- Grouping inside History search results. Search keeps its flat results table.
- Pagination of groups. All groups are returned; a group expands to at most 500 calls (`RESPONSES_LIMIT`,
  `call-store.ts:334`).

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | Loading every send summary per grouping request is fast enough at the author's history size, as `searchCalls` already does on each search (`call-store.ts:118`). | History in request mode is slow on every refresh (it refetches on each History change, like the strips, `app.tsx:620`). Phase 4 still works; T3.5 is manual. | no — measured in Phase 4 (timing printed by the integration test at 5 000 calls) |
| A2 | `new URL(url).pathname` gives the same path for every stored URL that the current `$regex` matches, except encoded or parser-normalised paths, where it is the intended behaviour. | Some call drops out of its own strip after Phase 2. Caught by the existing `listResponses` cases in `call-store.int.test.ts`, which must pass unchanged. | no |
| A3 | `localStorage` is available on the app's origin under the production CSP. | Toggles do not persist; defaults apply each load. The wrapper makes this non-fatal. Checked by Phase 5's reload scenario under `npm run test:e2e` (CSP on). | no |
| A4 | Existing e2e specs keep working if `launchWithTestDatabase()` seeds the grouping preference to "by day" when none is stored (`e2e/support.ts:94-97`, the context already has an init script). | 15 specs touch the History list; with "by request" as default, rows they click are inside collapsed groups. Phase 5 cannot finish green. | **yes** — verified as Phase 5's first step: seed, run `npm run test:e2e`, all existing specs pass before any request-mode UI exists |
| A5 | Unreadable records (`state: 'unreadable'`) have no key and are left out of groups; they remain visible in "by day" mode. | A user in request mode does not see an unreadable record. Acceptable: no group can hold it. | no |

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | A call authenticated by `Cookie` only shows that cookie in History search's Auth facet, its results column and the call record chip | `src/core/headers.ts`, `src/core/call-store.ts`, `src/renderer/app.tsx`, tests | lz-tdd | `npx vitest run --project unit src/core/headers.test.ts`; `npx vitest run --project integration src/core/search.int.test.ts`; `npx playwright test e2e/search.spec.ts` |
| 2 | `listResponses` uses the shared request key and can be narrowed to one auth key | `src/core/request-key.ts` (new), `call-store.ts`, `ipc-contract.ts`, `ipc.ts`, `app.tsx` | lz-tdd | `npx vitest run --project unit src/core/request-key.test.ts`; `npx vitest run --project integration src/core/call-store.int.test.ts` |
| 3 | "Split by auth" in the workspace strip and on the call record, remembered on reload | `app.tsx`, `index.css`, `e2e/responses.spec.ts` | lz-e2e | `npx playwright test e2e/responses.spec.ts` after `npm run build` |
| 4 | The server returns request groups over all of history, optionally split by auth | `call-store.ts`, `ipc-contract.ts`, `ipc.ts`, `api.ts`, tests | lz-tdd | `npx vitest run --project integration src/core/call-store.int.test.ts -t groups`; `npx vitest run --project unit src/shared/wire-codec.test.ts` |
| 5 | History opens grouped by request; By day / By request and Split by auth toggle it and are remembered | `app.tsx`, `index.css`, `e2e/support.ts`, `e2e/history-grouping.spec.ts` (new) | lz-e2e | `npm run test:e2e` (whole suite) |

### Phase 1 — One auth rule: Authorization, otherwise Cookie

**Changes:**
- `src/core/headers.ts:1-7` — `authorizationOf` becomes `authOf(headers)`, returning `{ header: 'Authorization' |
  'Cookie', value } | undefined`: the first `authorization` header (name matched ignoring case), otherwise the first
  `cookie` header, otherwise `undefined`. Empty values count as present (as now). The module comment states the
  author's rule verbatim.
- `src/core/call-store.ts:388` — `factsOf.auth` = `authOf(...)?.value ?? ''`, plus `authHeader` (`'Authorization' |
  'Cookie' | ''`); the auth facet's `labelOf` (`call-store.ts:217-221`) sets `detail` to the header name, so every UI
  site can label a value without re-reading headers.
- `src/renderer/app.tsx:2033-2037` — the call record chip reads `Authorization: …` or `Cookie: …` from `authOf`.
- `src/renderer/app.tsx:3495` — the results table's auth column uses `authOf` and names the header.
- `src/renderer/app.tsx:3311-3315` — the facet option text shows the header name before the shortened value
  (`Cookie: session=…`), taken from the option's `detail`.
- `src/renderer/app.tsx:3394-3398` — the active-filter summary reads `Cookie: …` or `Authorization: …` from the
  matching facet option's `detail` (as `facetLabel` does for environments); a selected value with no option in the
  current facets keeps the generic word "auth". "no Authorization" becomes "no auth header".
- Facet heading text "Auth header" is unchanged (screen 04).
- `e2e/search.spec.ts` — one scenario: a Cookie-only call; its facet option, its results-table cell and the summary
  line all say `Cookie:`.

**Verification:**
```
$ npx vitest run --project unit src/core/headers.test.ts
expected: passes — cases: Authorization only; Cookie only; both (Authorization wins); neither; two Cookie headers (first);
          name case ("COOKIE", "authorization"); empty Authorization value present
$ npx vitest run --project integration src/core/search.int.test.ts
expected: passes — new case: a call with only a Cookie header is counted under its Cookie value in facets.auth,
          and filtering `auths: [cookieValue]` returns it; existing Authorization cases unchanged
$ npm run typecheck
expected: no errors; no remaining reference to authorizationOf
```

```
$ npm run build && npx playwright test e2e/search.spec.ts
expected: passes, including the Cookie-label scenario; no CSP violation
```

**Done when:** all of the above pass and `grep -rn "authorizationOf\|Authorization: \${" src` finds nothing.

**Executor:** lz-tdd — a pure function with enumerable cases, plus one store query (T2.3, integration). The
`search.spec.ts` scenario is the phase's last step; lz-tdd routes it to lz-e2e if it refuses it.

### Phase 2 — The request key in one place, and responses narrowed by auth

**Changes:**
- `src/core/request-key.ts` (new) — `requestKeyOf(method, url)`, moved from `app.tsx:2274-2286` unchanged in
  behaviour (pathname; fallback split on `?#`; leading `/` ensured). Pure, no Node or browser imports.
- `src/renderer/app.tsx` — imports it; local copy deleted.
- `src/core/call-store.ts:94-107` — `listResponses(method, path, inFlight, auth?)`: MongoDB filter on
  `request.method` only; in Node, keep summaries where `requestKeyOf(...).path === path` and, when `auth` is given,
  `(authOf(headers)?.value ?? '') === auth`; newest first; at most `RESPONSES_LIMIT`. `pathPattern` and
  `escapeRegExp` are deleted if nothing else uses them.
- `src/shared/ipc-contract.ts:118-121` — `ListResponsesInputSchema` gains `auth: z.string().max(65536).optional()`
  (`''` = calls with no auth header; absent = no split), matching `AuthList`'s bound (`ipc-contract.ts:276`).
- `src/server/ipc.ts:690-705` — passes `auth` through.

**Verification:**
```
$ npx vitest run --project unit src/core/request-key.test.ts
expected: passes — query and fragment ignored; host ignored; root and empty path → "/"; percent-encoded path kept as
          the parser writes it; unparseable URL falls back
$ npx vitest run --project integration src/core/call-store.int.test.ts
expected: every existing listResponses case passes unchanged; new cases: auth "A" returns only calls with
          Authorization A; auth "" returns only calls with no Authorization and no Cookie; a Cookie-only call is
          returned for its Cookie value
```

**Done when:** both pass and the workspace strip in `npx playwright test e2e/responses.spec.ts` still passes (no UI
change yet).

**Executor:** lz-tdd — pure key function plus store filtering, both specifiable before the code.

### Phase 3 — "Split by auth" in the responses views

**Changes:**
- `src/renderer/app.tsx` — a preference hook `usePreference(key, default)` over `localStorage`, every read and write
  in `try/catch`, values validated (unknown value → default). Keys: `dp.history.grouping` (`'request' | 'day'`, used in
  Phase 5) and `dp.splitByAuth` (`boolean`, default `false`).
- `useResponses` (`app.tsx:2308-2342`) takes the auth key; its tag text includes it, so a list fetched for one auth is
  never shown for another (the slice 7 tagging rule, `app.tsx:2306-2307`).
- `ResponsesStrip` (`app.tsx:2345-2385`) label row gains a "Split by auth" toggle button (`aria-pressed`); when on,
  the label reads "Responses to this request · <header> …abbreviated value" or "· no auth".
- The call record's "Other responses" (`app.tsx:2127-2140`) follows the same setting and names the auth in its label.
- `e2e/responses.spec.ts` — new scenario. The file shares one browser context and one database across its tests
  (`responses.spec.ts:24-26`, `beforeAll`), so the scenario sends to a path no other test in the file uses
  (`/split-by-auth`), and removes `dp.splitByAuth` from `localStorage` in a `finally` block (or an `afterEach` scoped
  to it), so later tests start with the toggle off.

**Verification:**
```
$ npm run build && npx playwright test e2e/responses.spec.ts
expected: passes — new scenario: send GET /split-by-auth with Authorization A, then A, then B, then a Cookie-only call;
          strip shows 4; press Split by auth → strip shows the calls with the current call's auth only (1 for the
          Cookie call); open the first A call → "Other responses" shows the other A call only; reload the page →
          the toggle is still pressed; no CSP violation recorded
```

**Done when:** the spec passes under `npm run test:e2e`'s build (CSP on), and the result stays in view after the
toggle changes the strip (`toBeInViewport()`, T2.9).

**Executor:** lz-e2e — the risk is UI state across a reload and a list swapped under a key (T2.10), observable only in
the browser.

### Phase 4 — Request groups over all of history

**Changes:**
- `src/core/call-store.ts` — `listRequestGroups(inFlight, { splitByAuth })`: `list({}, 0, …)` as `searchCalls` does;
  skip unreadable; key = `method + requestKeyOf(...).path` (+ `authOf(...)?.value ?? ''` when split); per group:
  `method`, `path`, `auth` (`{ header, value } | null`, only when split), `count`, `latest` (the newest call's
  summary). Groups ordered by `latest.sentAt` descending.
- `src/shared/ipc-contract.ts` — channel `listRequestGroups: 'pigeon:list-request-groups'`, input schema
  `{ splitByAuth: boolean }`, result schema; `PigeonApi` entry.
- `src/server/ipc.ts` — handler beside `listResponses` (`ipc.ts:690`), same database-down handling as `listCalls`
  (`ipc.ts:526`: empty list when not up, `{ ok: false, message }` on failure).
- `src/renderer/api.ts` — the named operation.
- `src/shared/wire-codec.test.ts` — the new result schema round-trips.

**Verification:**
```
$ npx vitest run --project integration src/core/call-store.int.test.ts -t groups
expected: passes — 250 sends over 2 paths: counts sum to 250 (beyond HISTORY_LIMIT); /a?x=1 and /a on two hosts are
          one group; GET /a and POST /a are two; split: Authorization A, Authorization B, Cookie-only and none are four
          groups of one path; latest is the newest call; an unreadable send is in no group; a 5 000-send case prints
          its duration (A1)
$ npx vitest run --project unit src/shared/wire-codec.test.ts
expected: passes
$ npx vitest run --project integration src/server/ipc.int.test.ts
expected: passes (operation registered; database-down returns an empty list)
```

**Done when:** all three pass and the 5 000-send duration is recorded in `progress.md`.

**Executor:** lz-tdd — the grouping is a store query whose wrong set is the failure (T2.3, integration).

### Phase 5 — History list grouped by request, toggled and remembered

**Changes:**
- **First, before any UI:** `e2e/support.ts:83-98` — `launchWithTestDatabase({ historyGrouping = 'day' } = {})`
  (`'day' | 'request' | 'unset'`) adds, beside `recordCspViolations` (`support.ts:97`), an init script that sets
  `dp.history.grouping` only when the key is absent (`'unset'` adds none), so existing specs run in day mode and a
  reload keeps a user's change. Run `npm run test:e2e`; all existing specs pass (A4).
- `src/renderer/app.tsx` `HistoryList` (`app.tsx:2998-3082`) — title row gains a segmented control **By request /
  By day** and the shared **Split by auth** toggle (shown in request mode). Request mode renders one row per group from
  `listRequestGroups`: method badge, path, `N calls`, latest code and time, and, when split, the auth header name and
  abbreviated value (`abbreviate`, as the call chip). Pressing a group expands it: rows from `listResponses(method,
  path, auth)` in the existing row markup (open, ×). Groups refetch on the same `historyMark` as the strips
  (`app.tsx:620`); held (undo-window) calls are hidden in expanded rows (`notHeld`, `app.tsx:615`).
- **Expansion fetch:** one group is expanded at a time, and its rows come from `useResponses` (`app.tsx:2308-2342`),
  which tags each list with its key, so rows fetched for group A are never shown under group B (T2.10; responses-strip
  code review items 2 and 7). The group list itself is tagged the same way by its `splitByAuth` value.
- **Errors:** a failed `listRequestGroups` shows "History could not be loaded: <message>" in the existing
  `history-error` element (`app.tsx:3026-3030`); a failed expansion shows "Calls of this request could not be loaded:
  <message>" under the group (`data-testid="group-error"`), the pattern of `responses-error` (`app.tsx:1052-1056`).
- **Empty history:** request mode shows what day mode shows today with no calls (an empty list, `0 calls`).
- **Title count:** in request mode `N calls` is the sum of the group counts, i.e. all of history; in day mode it stays
  the loaded list's length (`app.tsx:3024`).
- **In view:** expanding a group scrolls its first row into view if it is below the fold (T2.9).
- Day mode is today's list, unchanged.
- `e2e/history-grouping.spec.ts` (new). Its default-mode test calls `launchWithTestDatabase({ historyGrouping:
  'unset' })` inside the test and closes it at the end, so it sees a fresh browser whatever ran before; the rest of the
  file shares one launch with `historyGrouping: 'request'` (the config runs one worker, `playwright.config.ts:9`).

**Verification:**
```
$ npm run test:e2e
expected: all specs pass, including the new one:
  - a fresh browser opens History grouped by request
  - three sends of GET /orders (one with ?page=2) and one of GET /orders/1 → two groups, "3 calls" and "1 call"
  - expanding /orders lists three rows, the first `toBeInViewport()`; opening one shows its call record in view
  - the title reads "4 calls"
  - expanding /orders, then /orders/1 while /orders' answer is held (`stubOperation` + `gate`, `e2e/support.ts:175`,
    `:217`); after release and `settle(page)`, only /orders/1's row is listed under /orders/1
  - `listRequestGroups` stubbed to fail → `history-error` shows its message; an expansion stubbed to fail →
    `group-error` under that group, other groups unaffected
  - Split by auth with two different Authorization values → /orders splits into two groups
  - switching to By day shows the dated list; reload → still By day, Split by auth still on
  - deleting a row inside an expanded group hides it at once and Undo restores it (slice 8 behaviour)
  - no CSP violation
```

**Done when:** `npm run test:e2e` is green, `npm run lint` and `npm run typecheck` pass, and the author has looked at
request mode against screen 01's sidebar (T3.2, manual).

**Executor:** lz-e2e — a flow across the sidebar, the call view and a reload.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| R1 Existing e2e specs break because History's default changes | high without mitigation | Phase 5 blocked | A4: seed day mode in `launchWithTestDatabase`, verified green before UI work |
| R2 Request mode slow at real size (all summaries per refresh) | low (single user) | sluggish sidebar | A1 timing at 5 000 sends recorded in Phase 4; "Search performance" item stays the remedy |
| R3 Group count differs from expanded rows | low after Phase 2 | user distrusts the count | Both computed by `requestKeyOf` + `authOf` over the same summaries |
| R4 An Authorization value equal to a Cookie value merges two auth groups | very low | two auth identities shown as one | Accepted (Alternatives table) |
| R5 Count includes a call in its 8 s undo window | medium | count one too high for 8 s | Accepted; `dataVersion` refetch after the delete lands corrects it (`history-search/record.md` §4) |
| R6 Changing `authorizationOf` changes the facet's meaning for existing users | certain | Cookie values appear in the Auth facet | Intended (author, this session) |

## For the reviewer

- **Weakest link: one shared "Split by auth" setting.** The author said "both toggled" and was not asked whether that
  means one setting or one per place. This plan chose one. If wrong, Phases 3 and 5 change their preference keys only.
- **A4 / R1.** Pinning existing specs to day mode means the default mode is covered by one new spec only. Check that
  `history-grouping.spec.ts` covers the journeys that matter in request mode, including opening a call and the
  responses strip after it.
- **Choices made in revision 2 without asking the author:** one group expanded at a time; request-mode title count is
  all of history; empty request mode looks like empty day mode; the filter summary falls back to "auth" for a value
  with no facet option. Each is small and changes only Phase 1 or 5 copy and state.

### Revision 2 — what changed after lz-plan-review

| Review finding | Change |
|---|---|
| Phase 1 missed `app.tsx:3313` and `:3396` | Both listed; header name carried in the facet's `detail`; `search.spec.ts` Cookie-label scenario |
| e2e specs share a context and database per file | Phase 3: own path, toggle cleared after; Phase 5: default-mode test launches its own browser |
| Expansion fetch could show another group's rows | Expansion reuses tagged `useResponses`; held-answer e2e case |
| No UI error path | `history-error` and `group-error` named; stubbed-failure e2e cases |
| T2.9 not asserted for expansion | Scroll into view; `toBeInViewport()` on the first row |
| Empty state, title count, stale citation | Decided in Phase 5; `ipc.ts:526` |
- **Phase 2 drops the `$regex`.** `listResponses` then loads every summary of one method. Attack whether that is
  acceptable next to `searchCalls` doing the same for every method.
- **The design does not draw request mode.** The author's instruction outranks it; the UI reuses existing patterns.
  Check whether the author wants screen 01 updated first.

## References

- `research.md` — findings 1-5, author decisions, unanswered items (all four settled: one shared toggle by this plan;
  first `Cookie` header, matching `authorizationOf`'s precedent; facet adopts the rule (author); A1 measured in Phase 4).
- `src/core/headers.ts:1-7` — current auth rule.
- `src/core/call-store.ts:94-107`, `:114-118`, `:334`, `:378-392`, `:402-407` — listResponses, searchCalls' load,
  limits, facts, pathPattern.
- `src/renderer/app.tsx:615-636`, `:2274-2286`, `:2306-2385`, `:2998-3082`, `:3863-3879` — strip wiring, request key,
  useResponses, ResponsesStrip, HistoryList, segmented-button precedent.
- `src/shared/ipc-contract.ts:118-121`, `:276` — ListResponsesInput, AuthList bound.
- `src/server/ipc.ts:78`, `:690` — HISTORY_LIMIT, listResponses handler.
- `e2e/support.ts:83-98` — launchWithTestDatabase context and init script.
- `context/archive/responses-strip/record.md` — key decision; two rules must agree; renderer grouping rejected.
- `context/archive/history-search/record.md` — in-memory search; `$facet` and text index rejected; `dataVersion`.
- `context/foundation/test-strategy.md` — T2.3 (filter returns wrong set, integration), T2.9, T2.10, T3.2, T3.5.
- Author answers, this session: group over all history; open by request, toggles remembered; one auth rule for
  search too.

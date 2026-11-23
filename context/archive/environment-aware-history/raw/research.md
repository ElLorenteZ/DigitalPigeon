---
change_id: environment-aware-history
produced-by: lz-research
questions: 5
updated: 2026-11-23
---

# Research: environment detected from the URL, and History for the selected environment

Researched on branch `history-grouping` (working tree; includes `land-slices-7-12` @ 2a44ef1). Line numbers refer to
that tree.

## Questions asked

1. Where is a send's environment decided and recorded today, for paths, full URLs and replays? — **answered**
2. What can a stored `baseUrl` look like, and can one URL match several environments? — **answered**
3. Where does the active environment live, what changes it, and does the renderer learn a send's recorded
   environment? — **answered**
4. What can be filtered by environment today: the History list, request groups, the responses strip, search? —
   **answered**
5. Do calls already recorded carry enough to be shown under an environment? — **answered** (the decision it raises is
   unanswered; see Unanswered)

## Findings

### 1. Where a send's environment is decided and recorded

**Answer:** The environment is recorded only when the typed URL is a path. A full URL records no environment,
whichever one the selector shows. This is a recorded decision (slice 5, "review R1"), and tests pin it. Replays copy the
original's snapshot.

**Evidence**
- `src/core/environment-store.ts:116-130` — `resolveEnvironment` returns `undefined` for a non-path URL before it
  looks at the id ("A full URL uses none, whatever is chosen (review R1)").
- `src/server/ipc.ts:263-290` — the send handler resolves the environment by the id the renderer sent
  (`environmentId`), from the store, never a `baseUrl` from the renderer (B1).
- `src/core/send.ts:94-99` — `sendAndRecord` composes the URL and records `environment` only when
  `isPath(input.url) && environment`.
- `src/core/call-schema.ts:19-32` — `EnvironmentSnapshotSchema` `{id, name, baseUrl}`; the send's `environment`
  field is commented "Present only when the URL was a path joined to this environment's baseUrl (slice 5)".
- `src/core/send.ts:279-287` — replay records the original call's environment and saved-request link unchanged.
- Tests pinning today's rule: `src/core/send.int.test.ts:326-331` ("a full URL records no environment, even with one
  given (review R1)"), `src/core/environment-store.int.test.ts:142`, `src/core/url.test.ts:32`.
- `src/core/template-store.ts:85-93, 243-245` — a template whose OpenAPI server is sendable stores a full URL
  (`joinUrl(server, op.path)`); otherwise it stores the path and uses the active environment. Full-URL templates
  therefore record no environment today.

**Verified by:** reading; text search for the tests.

**Confidence:** high.

### 2. The shape of a stored `baseUrl`, and multiple matches

**Answer:** A `baseUrl` is an absolute http(s) URL as `new URL().href` writes it: lower-cased scheme and host, default
port dropped, a trailing `/` for a bare origin, and an optional path. Query, fragment and user info are refused.
Nothing stops two environments from having the same or nested `baseUrl`s, so one URL can match several. A prefix
test already exists: `pathFor`.

**Evidence**
- `src/core/url.ts:42-68` — `checkBaseUrl` parses the URL, requires http/https, refuses query, fragment, username and
  password, and returns `parsed.href`.
- `src/core/environment-store.ts:39-44, 64-85` — `checked` trims the name and applies `checkBaseUrl`. Create and
  update do not check for a duplicate `baseUrl`.
- `context/archive/saved-requests-and-environments/record.md:57` — duplicate names allowed by the author; "entries are
  told apart by method and URL, or `baseUrl`".
- `src/core/url.ts:70-79` — `pathFor(url, env)`: the URL must start with `baseUrl` (trailing slashes removed) + `/`,
  and composing the remainder back must give the same URL. `http://h/api/` and `http://h/` both match
  `http://h/api/x`. Two environments with the same `baseUrl` both match.
- `src/core/environment-store.ts:57-60` — `list()` orders by name, then `baseUrl`. That is the only ordering defined.

**Verified by:** reading.

**Confidence:** high for the shape. Comparing against a typed URL that is not normalised (upper-case host, explicit
`:443`) is **unverified**: `pathFor` compares raw strings, and the URL in the send is recorded as composed or typed.

### 3. The active environment: where it lives, what changes it, what the renderer learns

**Answer:** The selector's value is renderer state (`environmentId`). Each send carries it. Choosing an environment also
saves it in main, but only to restore the selector at startup. The select offers "None", not "All". A send returns the
recorded `send` document, so the renderer receives the environment that was recorded.

**Evidence**
- `src/renderer/app.tsx:197-202` — `environments` and `environmentId` state.
- `src/renderer/app.tsx:262-280` — `refreshEnvironments` keeps the current choice while it exists, otherwise takes
  `activeId` from the server.
- `src/renderer/app.tsx:876-890` — `chooseEnvironment` sets state and queues `setActiveEnvironment`, comment: "Only
  what the select shows at the next start; a send names its environment itself (B1)".
- `src/renderer/app.tsx:899-911` — `<select aria-label="Environment">` with `<option value="">None</option>` then one
  option per environment (`name — baseUrl`).
- `src/renderer/app.tsx:1105-1111` — send passes `environmentId` from that state.
- `src/core/environment-store.ts:97-112`, `src/server/ipc.ts:451-462` — `getActive`/`setActive` store
  `settings.active-environment`.
- `src/shared/ipc-contract.ts:458-463` — `SendResultSchema` ok branch carries `send: SendDocSchema` (including
  `environment`).
- `context/archive/saved-requests-and-environments/record.md:49, 54` — rejected: main reading the stored active
  environment at send time (races a switch, B1); active environment in renderer state or browser storage only (lost
  on restart).

**Verified by:** reading.

**Confidence:** high.

### 4. What can be filtered by environment today

**Answer:** Only History search filters by environment: over all calls, by snapshot id, with `""` meaning "no
environment". The History list (the newest 200), request groups and the responses strip have no environment input.

**Evidence**
- `src/server/ipc.ts:81, 529-544` — `listCalls` takes no input and returns `HISTORY_LIMIT = 200` newest calls.
- `src/core/call-store.ts:398-402, 410` — `SearchQuery.environmentIds`; `FacetName` includes `'environment'`.
- `src/core/call-store.ts:217-218, 258-265` — filtering with `within(query.environmentIds, f.environmentId)`; the
  facet labels `""` "No environment" and the others by name, with `baseUrl` as the detail.
- `src/core/call-store.ts:449-451` — facts read `send.environment?.id ?? ''`, i.e. the recorded snapshot only.
- `src/core/search.int.test.ts:163` — `""` selects calls with no environment.
- `src/renderer/app.tsx:3469-3498, 3581, 3627, 3713` — search filter state `environmentIds`, chips, facet.
- `src/core/call-store.ts` `listResponses(method, path, inFlight, auth?)` and `listRequestGroups(inFlight,
  {splitByAuth})` (history-grouping, uncommitted Phase 4 code in `a43ff5f`) — no environment parameter.
- `src/renderer/app.tsx:3849` — results table environment column: `call.send.environment?.name ?? '—'`.
- `src/renderer/app.tsx:2189-2193` — the call record shows the chip "Environment: name — baseUrl" when a snapshot
  exists.

**Verified by:** reading; text search.

**Confidence:** high.

### 5. Whether existing calls can be shown under an environment

**Answer:** Calls sent to a path carry a snapshot with the environment's id at send time. Calls sent to a full URL
carry none, including those whose URL starts with an environment's `baseUrl`. Records are insert-only. A full-URL
call can be placed under an environment only by matching its URL against the environments as they are now, at read
time. That contradicts the slice 5 principle that editing an environment never changes what an old call means.

**Evidence**
- `src/core/call-schema.ts:28-34` — the snapshot is optional, written once.
- `context/archive/saved-requests-and-environments/record.md:36-41` — "a call links to them through an id and a
  snapshot written once, so editing or deleting an environment never changes what an old call means"; rejected
  "Recording only the environment id".
- `change.md` boundary — backfilling stored records is out of scope.
- The share of the author's history recorded with no environment is **unknown**: tests never touch the history
  database (AGENTS.md).

**Verified by:** reading.

**Confidence:** high for the mechanism. The size of the gap is unmeasured.

## What the code does not say

- **The snapshot means "joined", and two readers depend on that.** Edit loads `pathFor(url, environment)`
  (`src/core/form-from-call.ts:197-199`, `src/renderer/app.tsx:432-437`), turning a recorded full URL back into a path
  that follows the active environment. If a full-URL call gets a detected snapshot, Edit of that call loads a path
  instead of the URL as typed. That changes `form-from-call.test.ts:477`'s neighbours' premise. Replay is unaffected:
  it re-sends the recorded URL (`send.ts:279-287`).
- **The selector is both the send target and, by this intent, a History filter.** "None" in the select means "send
  paths nowhere; full URLs as typed" (`app.tsx:905`, `url.ts:38`). The intent's "All" is a History notion. One control
  cannot hold both "None" and "All" without a rule, and nothing in the code relates them.
- **Following a detected environment changes where the next path goes.** The selector drives where every later path
  send goes (`app.tsx:1108`). A full-URL send that moves the selector also changes the target of the next path send.
  That target is also saved for startup (`app.tsx:876-890`).
- **Matching runs on strings in `pathFor`.** A typed URL with an upper-case host or an explicit default port does not
  start with the normalised `baseUrl` (`url.ts:67`, `url.ts:76`). The send records the typed URL as given
  (`send.ts:96`, `composeUrl` returns it unchanged for a full URL).
- **Concurrency rule from slice 5.** Main must decide from the store, not from a renderer-sent `baseUrl` (B1,
  `ipc.ts:266`). Detection in main would read `environments.list()` per send. Nothing caches environments in main
  today.

## Surprises

1. **The intent reverses a recorded decision.** "A full URL records no environment, even with one given (review R1)"
   is a slice 5 decision with tests (`send.int.test.ts:326`, `environment-store.int.test.ts:142`, `url.test.ts:32`).
   The author's "Request URL → env detected" changes it. The plan should name R1 as superseded, not drift past it.
2. **There is no "All" today.** The title-bar select offers "None" plus environments (`app.tsx:905-910`). History
   shows every call, unfiltered (`ipc.ts:529-544`). "All" as the default therefore matches today's History. The new
   behaviour is narrowing when an environment is selected.
3. **Old full-URL calls drop out of a filtered History** unless matched at read time (finding 5). With a snapshot-only
   filter, a user who selects an environment does not see the calls they sent to its host before this change.
4. **The search facet already does environment filtering over all of history** (`call-store.ts:217`), by snapshot id.
   A History-list filter by snapshot id would agree with the facet. A read-time URL match would not, unless the facet
   changes too, and the boundary excludes facet changes beyond what History needs.

## Prior art found

- `context/archive/saved-requests-and-environments/record.md` — one URL rule (path joins `baseUrl`; full URL as
  typed); snapshot written once; B1 (send carries the selector's id; main loads it); R1 (full URL records none).
  Rejected: "environment replaces scheme, host and port of a full URL". Still holds, except R1, which this intent
  overturns.
- `context/archive/history-search/record.md:17` — search by environment over every call; in-memory filtering.
- `context/changes/history-grouping/` — request groups and the responses strip, not yet merged; neither takes an
  environment.

## Unanswered

These are author decisions, not code questions:

1. **Matching rule.** Is a match a `baseUrl` prefix (as `pathFor`), the origin only (scheme + host + port), or the
   host only? Does matching normalise the typed URL (case, default port)?
2. **Several matches.** Choose the longest `baseUrl`, the currently selected environment if it matches, or record
   none? Same-`baseUrl` duplicates are allowed today (finding 2).
3. **Selector following.** After a full-URL send matches environment X, does the selector switch to X (changing where
   the next path goes and what opens at startup), or does only History/the call record show X? And when nothing
   matches, does the selector stay, or go to "None"?
4. **Where "All" lives.** Is it a new option in the title-bar select (next to or replacing "None"), or a separate
   History control? And which History views follow it: the list (day and request modes), the responses strip, the
   call record's "Other responses", search?
5. **Old calls.** Are full-URL calls recorded before this change matched at read time against current environments,
   or shown only under "All"? Read-time matching conflicts with the snapshot principle (finding 5).
6. **Edit of a detected call.** Does Edit load the path (it follows the active environment) or the URL as typed?

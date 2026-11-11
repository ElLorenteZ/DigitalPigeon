---
change_id: saved-requests-and-environments
produced-by: lz-tdd
plan: plan.md
updated: 2026-11-11
---

# Progress: Save and edit requests, and send them to the active environment's baseUrl

## Phase 1 — a path goes to the active environment

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Changed**
- `src/core/url.ts` (new) — `composeUrl` (a path joins the `baseUrl` with exactly one `/`; a full URL is unchanged; a path with no environment throws `NoActiveEnvironmentError`), `checkBaseUrl` (absolute http(s), no query, fragment or user information; returns the URL parser's `href`, so `HTTPS://A.Test` is stored as `https://a.test/`), `pathFor` (the path that composes back to a URL, or undefined), `isPath`.
- `src/core/environment-store.ts` (new) — `environments` collection and an `active-environment` document in `settings`: list (by name, then `baseUrl`), get, create, update, delete (clears the active setting when it pointed there), getActive, setActive (refuses an unknown id). Names are trimmed, blank refused, duplicates allowed (plan revision 2, W2). `resolveEnvironment(store, id, url)`: a full URL gives no environment whatever is chosen; a path needs an id that still exists (`NoActiveEnvironmentError`, `EnvironmentNotFoundError`).
- `src/core/call-schema.ts` — `EnvironmentSnapshotSchema`; optional `environment` and `savedRequestId` on send documents and summaries.
- `src/core/send.ts` — `SendOptions` gains `environment` and `savedRequestId`. `sendAndRecord` composes the URL before `buildWireRequest` and records the environment only when the URL was a path, and the saved request id when given. `replayCall` copies both from the original.
- `src/core/form-from-call.ts` — option `environment`: Edit loads `pathFor(url, environment)` when it exists, otherwise the URL as recorded.
- Tests: `url.test.ts` (new, 30: composition including slashes, a `baseUrl` with a path, query rows after composition; `checkBaseUrl` keeps and refuses; `pathFor` round trips, and `/v10` against `/v1`, another host and another port give no path); `call-schema.test.ts` (+5: both fields parse; a document without them parses; a malformed snapshot and an empty id are refused); `environment-store.int.test.ts` (new, 12); `send.int.test.ts` (+5: a path on GET, POST and DELETE records the composed URL, the snapshot and the saved request id, equal to the wire; a full URL records neither; a path with no environment leaves no send document and sends nothing); `replay.int.test.ts` (+1: a replay records the original's snapshot and link after the environment object changed); `form-from-call.test.ts` (+3: the path loads and composes back to the same request; a URL with another host loads as recorded; no environment loads as recorded).

**Verification**

```
$ npx vitest run --project unit src/core/url.test.ts src/core/call-schema.test.ts src/core/form-from-call.test.ts
 Test Files  3 passed (3)
      Tests  117 passed (117)
$ npx vitest run --project integration src/core/environment-store.int.test.ts src/core/send.int.test.ts src/core/replay.int.test.ts
 Test Files  3 passed (3)
      Tests  138 passed (138)
$ npm run test:unit         → 344 passed
$ npm run test:integration  → 288 passed
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — a path sent with environment A records A's composed URL and snapshot and reaches the capture server there; a
path with no environment, or a deleted one (`resolveEnvironment`), is refused before anything is recorded; Edit of a
composed call restores its path.

**Red evidence**
- `url.test.ts`: 30 seen failing against a stub (`not implemented`, or the wrong error class).
- `environment-store.int.test.ts`: 12 seen failing against a stub.
- `call-schema.test.ts`: the parse case failed. The three refusal cases passed before the field existed, because the strict schema refused any `environment` key; after it existed, a mutation (an optional `baseUrl` and an allowed extra key) failed two of them. Restored.
- `send.int.test.ts` and `replay.int.test.ts`: 5 seen failing (the bare path was not composed). "A full URL records no environment" passed before the code, guarding existing behaviour; a mutation recording the environment for any URL failed it. Restored.
- `form-from-call.test.ts`: the path case failed; the two "loads as recorded" cases passed before and after, guarding the fallback.

**Drift:** decision — the plan put the deleted-environment refusal on the send path ("a send naming an environment
that no longer exists throws `EnvironmentNotFoundError`") → it is in `resolveEnvironment`, which the IPC handler calls
before `sendAndRecord`; `sendAndRecord` takes the snapshot the caller loaded. Covered by
`environment-store.int.test.ts`; phase 2 connects it.

**Drift:** decision — review R1 resolved as proposed: a full URL records no environment and is never refused for a
missing one; only a path needs an environment.

## Phase 2 — environments in the app

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the select, the form, the Environments section and the call panel connecting are observable only in the
assembled app (`test-strategy.md` T2.7, T2.9); plan.md names lz-e2e. Run `/lz-e2e saved-requests-and-environments`.
`resolveEnvironment` (phase 1) is what the send handler calls.

## Phase 3 — saved requests in the store

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Changed**
- `src/core/saved-request-store.ts` (new) — `savedRequests` collection (`_id`, `schemaVersion`, `name`, `request`, `updatedAt`), parsed with `zod`. `request` holds the form content; body text is stored as UTF-8 and each file part's bytes as content that is inline while the document's total stays within `INLINE_BODY_LIMIT` (1 MiB), otherwise a file reference written with `bodies.writeBytes`. `list` (id, name, method, URL; by name, then URL), `get` (bytes read back, copied to plain `Uint8Array`), `create`, `update` (writes new files, replaces the document; old files stay), `delete`. Names trimmed, blank refused (`InvalidSavedRequestError`), duplicates allowed.
- `src/core/saved-request-store.int.test.ts` (new, 16) — round trip for no body, None, JSON, XML, text with a byte order mark and CRLF, form rows with duplicates, and multipart with a field, a small file and a carried boundary; a 17 MiB text body and a 17 MiB file stored as file references with the document under 64 KiB, read back with equal length and SHA-256 as plain `Uint8Array`; two 600 KiB files: the first inline, the second a file; the list by name with method and URL, duplicates allowed; a blank name refused; update, unknown id, delete; T1.1: creating, saving over (with a 2 MiB file) and deleting leave every send and completion document deep-equal.
- `src/core/send.ts` — no change in this phase: phase 1 already records `savedRequestId` (`send.int.test.ts`, "a path sent against an environment").

**Verification**

```
$ npx vitest run --project integration src/core/saved-request-store.int.test.ts src/core/send.int.test.ts
 Test Files  2 passed (2)
      Tests  99 passed (99)
$ npm run test:unit         → 344 passed
$ npm run test:integration  → 304 passed
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — every body type reads back as saved, the 17 MiB cases are stored as file references, and the T1.1 case compares
calls before and after.

**Red evidence**
- All 16 seen failing against a stub (`not implemented`; the blank-name case on the error class).
- Mutation A, `update` also writing to `sends`: the T1.1 case failed. Mutation B, everything inline: the two 17 MiB cases and the 1 MiB cap case failed. Restored.

**Drift:** decision — the plan's round-trip check was "`buildWireRequest` of the read-back form equals that of the saved
form" → the read-back form is compared with the saved form itself. A multipart form without a carried boundary gets a
new random boundary on each `buildWireRequest`, so two wire requests from equal forms differ; equal forms give equal
wire requests for every other part.

**Drift:** decision — a blank saved-request name is refused, matching environments; the plan named the field and did
not say.

**Notes**
- The first run of this file crashed its worker (SIGABRT) after 8 passes, inside one of the 17 MiB cases, which then
  compared whole values with `toEqual`. They now compare length and SHA-256, and all 16 pass. Which assertion failed in
  the crashed run was not established. Second occurrence of "a test crashed its worker instead of failing"
  (`archive/multipart-with-file-copies/record.md` §4), now in a new file written after that lesson was recorded.

## Phase 4 — saved requests in the app

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the list, the form's link, Save / Save as new / New, and the call panel's link are render state and a
journey (`test-strategy.md` T2.7, T2.9, T2.10); plan.md names lz-e2e. `createSavedRequestStore` (phase 3) and
`savedRequestId` on the send (phase 1) are what the handlers call. Review R2 (a send naming a deleted saved request)
is decided and tested here.

## Phase 5 — the slice outcome, and the test strategy

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the journey across saved requests, environments, history, Replay and Edit is only observable in the
assembled app; plan.md names lz-e2e.

## Phase 2 — environments in the app

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Risks through the gate:** a path goes to the environment the select shows, including when Send follows the switch at
once (B1); calls name the environment they used, unchanged by later edits (T2.7); a refused path is visible (T2.9).
Composition, recording and the environment store are covered below (phase 1).

**Changed**
- `src/shared/ipc-contract.ts` — channels and schemas for `listEnvironments` (environments and the stored active id), `saveEnvironment` (create without an id, update with one), `deleteEnvironment`, `setActiveEnvironment`; `SendInputSchema.url` accepts a full http(s) URL or a path starting with `/`; `SendInput.environmentId`.
- `src/main/ipc.ts` — the send handler calls `resolveEnvironment` with the id the send carries and passes the snapshot to `sendAndRecord`; `NoActiveEnvironmentError` and `EnvironmentNotFoundError` map to `invalid-input` ("Not sent"). Four environment handlers, each validating input, checking the database and returning a result.
- `src/preload.ts` — four named functions; the header says twelve.
- `src/renderer/app.tsx` — an Environment select before the URL field (None, then "name — baseUrl"); choosing one sets the form's environment and saves it as the startup choice. Send carries `environmentId`. Copy as curl from the form composes with the chosen environment. `EnvironmentsEditor`: rows "Environment name N" / "Environment base address N" with Save and Delete, a row to add one, and the reason (`environments-error`, `role="alert"`) when a save is refused. The call panel shows "Environment: name — baseUrl" (`call-environment`) from the call's snapshot.
- `e2e/environments.spec.ts` (new) — (1) two environments on two capture servers; `/orders?x=1` with alpha reaches alpha; switch to beta and Send at once reaches beta; the panel names each call's environment; renaming alpha and changing its base address leaves the earlier call's panel as recorded; Copy as curl composes with alpha's new address. (2) A base address with a query is refused with the reason; deleting the chosen environment leaves None; a path then shows "Not sent … choose an environment", in view, and adds no history row. (3) B1, deterministic: the switch's save is held in main while Send runs; the request reaches the newly chosen environment.

**Verification**

```
$ npm run package && npx playwright test e2e/environments.spec.ts --repeat-each=3
  9 passed (6.1s)
$ npm run test:e2e          → 39 passed (37.9s)
$ npm run test:unit         → 344 passed
$ npm run test:integration  → 304 passed
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — the switch scenario and the held-save scenario pass 3× (plus one run each before), the refusal is in view, and
every gate passes.

**Red evidence**
- Scenarios (1) and (2) failed on the build before the UI existed (no "New environment name" field).
- B1: a mutation where main read the stored active environment instead of the id the send carries **passed scenario (1) 5 times out of 5** — the switch's save lands before the send reads it, so (1) cannot detect that regression. Scenario (3) was added, holding the save in main; under the same mutation it failed (the request went to the previous environment). Restored and rebuilt.

**Drift:** decision — the plan named the labels "Environment base URL"; they are "Environment base address" (and "New
environment base address"), because Playwright's `getByLabel('URL')` matches any label containing "URL", and every
existing spec selects the URL field that way.

**Drift:** defect — found by scenario (1): "Add environment" cleared its fields after the save resolved, wiping a
second environment typed while the first was saving. Fixed: each field is cleared only if it still holds what was
saved; a row's draft is dropped only if unchanged since its save. Same mechanism as code review CR1/CR2 in
`multipart-with-file-copies` (state captured before an await, applied after it).

**Notes**
- The held-save scenario replaces main's `setActiveEnvironment` handler for the rest of the launch, so it is last in the file.
- The startup choice (`setActiveEnvironment`) is fire-and-forget: a failure shows in `environments-error`; the send does not depend on it.

## Phase 4 — saved requests in the app

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Risks through the gate:** save, open, save over, save as new and delete connect the form, the list and the call
panel (T2.7); the opened form and the list are in view after their actions (T2.9); overlapping opens leave the form
with the later one (T2.10); a saved request with a 17 MiB file sends after the file is gone (A4). Routed below: review
R2 in main to `src/main/ipc.int.test.ts` (main-process handlers run in plain Node, layer contract); storage to phase 3.

**Changed**
- `src/shared/ipc-contract.ts` — `RequestFormSchema` (the form's fields), reused by `SendInputSchema`, which gains `savedRequestId`; channels and schemas for `listSavedRequests`, `getSavedRequest`, `saveSavedRequest` (create without an id, update with one), `deleteSavedRequest`.
- `src/main/ipc.ts` — four saved-request handlers; the send handler records `savedRequestId` only when `exists(id)` is true (R2: a deleted one is sent without the link).
- `src/core/saved-request-store.ts` — `exists(id)`, reading no content.
- `src/preload.ts` — four named functions; the header says sixteen.
- `src/renderer/app.tsx` — `SavedRequestBar` (Saved request name, Save, Save as new, New, "Editing saved request: name", the reason when a save is refused) and `SavedRequestList` ("name — METHOD url" and Delete). Opening one ends a pending Edit, keeps only the latest open (`latestSavedOpen`), fills the form, links it and brings it into view. Save updates the linked one or creates and links; Save as new creates and links the copy; New empties and unlinks. Deleting the linked saved request unlinks the form. Edit of a call unlinks and passes the call's environment to `formFromCall`, so the path is restored. The call panel shows "From saved request: name" or "From a deleted saved request" (`call-saved-request`).
- `src/main/ipc.int.test.ts` — R2: a send naming an existing saved request records it; after it is deleted, a send naming it goes out and records no link.
- `e2e/saved-requests.spec.ts` (new) — (1) save; list entry; save over; New empties and unlinks; open restores the change, in view; Save as new adds a second entry and links the copy; send from the saved request, the panel links back; delete it, the list entry is gone (in view) and the panel says deleted. (2) Delete the linked saved request, then send: no link recorded. (3) A saved multipart request with a 17 MiB file: delete the file, New, open it, send; the server receives the file's bytes. (4) Overlapping opens with the first answer held: the form holds the second; the link names it.

**Verification**

```
$ npm run package && npx playwright test e2e/saved-requests.spec.ts --repeat-each=3
  12 passed (9.9s)
$ npm run test:e2e          → 43 passed (40.3s)
$ npm run test:unit         → 344 passed
$ npm run test:integration  → 305 passed
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — the scenarios pass 3× (plus a run before), the form and the list are in view after their actions, and every
gate passes.

**Red evidence**
- All four scenarios failed on the build before the UI existed (no New button).
- Mutations, together: the latest-open guard removed, and the send not carrying `savedRequestId`. Scenario (4) failed on the URL and (1) on the missing "From saved request" line; (2) and (3) passed. Restored and rebuilt.
- R2 in main: written after the handler; a mutation that always recorded the link failed it. (A first mutation run filtered on "R2", which appears only in a comment, and skipped every test; rerun with the test's name.)

**Drift:** decision — review R2: a send naming a deleted saved request is sent without the link. The UI also unlinks the
form when its saved request is deleted, so scenario (2) checks the outcome a user sees, and main's handling of a
stale id is tested in `ipc.int.test.ts`, not in e2e.

**Drift:** decision — "Save as new" is disabled while the form is unlinked: Save already creates a new saved request
then. Not in the plan.

**Notes**
- Scenario (4) wraps main's real get handler by reading Electron's private `ipcMain._invokeHandlers` map (`e2e/saved-requests.spec.ts`). An Electron upgrade can remove it; the scenario then fails at setup, not silently.
- One assertion was moved after its first run: the list was checked in view after opening a call, which scrolls to the call panel by design; it is now checked right after Delete.

## Phase 5 — the slice outcome, and the test strategy

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Risk through the gate:** the roadmap outcome as one journey across saved requests, environments, history, Replay and
Edit (T2.7). Every piece is tested below or in phases 2 and 4; only this scenario shows them together.

**Changed**
- `e2e/saved-requests.spec.ts` — a second capture server, and the outcome scenario: environments `first` and `second`; a saved request "Orders" with the path `/orders`; sent with `first`, then with `second`, reaching each server; the first call's panel names `first` and links to "Orders"; Replay of it reaches `first` again and keeps both; Edit of it loads `/orders` unlinked; adding a header and saving creates "Orders edited", which sent with `second` reaches `second`; "Orders" reopens unchanged. Placed before the overlap scenario, which must stay last.
- `context/foundation/test-strategy.md` — `revised:` line; Covered column for T1.1, T1.2, T1.3, T2.2, T2.5, T2.7, T2.9, T2.10; T2.5 removed from the gap list; known limits for files left by saved requests, opening a saved request in one answer, the environment a send uses, and the overlap scenario's private Electron API.

**Verification**

```
$ npx playwright test e2e/saved-requests.spec.ts --repeat-each=3
  15 passed (11.9s)
$ npm run test:unit         → 344 passed
$ npm run test:integration  → 305 passed
$ npm run test:e2e          → 44 passed (41.0s)
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — the outcome scenario passes 3× (plus a first run), `test-strategy.md` lists no slice 5 gap, and all gates pass.

**Red evidence**
- The scenario was written after the features existed and passed on its first run. Mutation: Edit not passing the call's environment to `formFromCall`; the scenario failed with the URL `http://127.0.0.1:…/v1/orders` where `/orders` was expected. Restored and rebuilt.

**Drift:** decision — the plan said "Save as new creates a new saved request" from the edited call → Save is used,
because an edited call is unlinked, and Save as new is disabled while unlinked (phase 4 drift). The outcome is the same:
a new saved request, and the original unchanged.

## Review follow-up — F1 (2026-11-11)

- **Executor:** lz-e2e
- **Status:** done

`review.md` F1, disposition fix now: Copy as curl from the form refusing a path with no environment had no test.
`e2e/environments.spec.ts` scenario (2) now presses Copy as curl after the refused send and expects "choose an
environment" in `form-curl-error`.

```
mutation: Copy as curl uses the path without composing
  1 failed — Received: "Cannot export as curl: Failed to construct 'URL': Invalid URL"
restored and rebuilt
$ npx playwright test e2e/environments.spec.ts --repeat-each=3
  9 passed (7.0s)
$ npm run lint → exit 0
```

**Drift:** none

## Code review follow-up — /code-review, first pass (2026-11-11)

- **Executor:** lz-e2e (renderer findings), lz-build (main refactors)
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

Ten findings; dispositions by the author ("go ahead", 2026-11-11): fix #1, #2, #4, #5, #7, #9, #10; accept #3, #6, #8.
Triage is in `review.md`, "Code review findings".

**Changed**
- `src/renderer/app.tsx` — #1: `formIdentity`, bumped when the form is replaced (New, an open, an Edit), not when typed in; a save links the form only if it is still the one saved. #2: `endPendingEdit` also ends a pending open of a saved request, so typing, a send, Edit or New cancel it; `openSaved` takes its counter after. #4: `savedListLoaded`; the panel says "From a deleted saved request" only when a loaded list lacks the id, otherwise "From a saved request". #5: choices of environment are stored one after another (`choiceSaves`), so the last one is stored. #10: `type Form = RequestForm`.
- `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/renderer/app.tsx` — #7: `EnvironmentResult` → `MutationResult`, `EnvironmentIdSchema` → `IdSchema`; one `withStore(create)` wrapper builds `withEnvironments` and `withSaved`. #9: the send handler loads the environment and checks the saved request together; `listEnvironments` reads the list and the active one together.
- `e2e/saved-requests.spec.ts` — `holdFirstAnswer(channel)` (wraps main's real handler, holds its first answer, restores it); scenarios for #1 (Save held, New, release: the new form stays unlinked and empty), #2 (open held, type in the URL, release: the typed URL stays, no link), #4 (the list handler fails; a call from a just-saved request reads "From a saved request").
- `e2e/environments.spec.ts` — scenario for #5 (the first choice's store held, a second choice made, release: after the held write finishes, the stored active environment is the second). Placed before the B1 scenario, which replaces that handler for good.

**Verification**

```
4 new scenarios seen failing on the build before the fixes:
  #5 stored active = the earlier choice; #1 link shown on the new form; #2 URL replaced by the saved one; #4 "From a deleted saved request"
$ npx playwright test e2e/saved-requests.spec.ts e2e/environments.spec.ts -g "New leaves|typing while|could not load|two quick choices" --repeat-each=3
  12 passed (7.3s)
$ npx playwright test e2e/saved-requests.spec.ts e2e/environments.spec.ts --repeat-each=3
  36 passed (17.8s)
$ npm run test:e2e          → 48 passed (40.8s)
$ npm run test:unit         → 344 passed
$ npm run test:integration  → 305 passed
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — each renderer fix has a scenario seen failing first; #7, #9 and #10 are refactors covered by the existing
suites (all green after them).

**Drift:** none

**Notes**
- #5's scenario first waited a timer tick before re-reading the stored choice; replaced before running by a promise main resolves when the held write completes, so no wait depends on time.
- `holdFirstAnswer` reads Electron's private `ipcMain._invokeHandlers`, as the overlap scenario does (known limit in `test-strategy.md`).
- #1 and #2 are the fifth and sixth instances of state captured before an await and applied after it (`review.md`, Lessons candidates).

## Correction — code review follow-up, #7 (2026-11-11)

The "Code review follow-up" entry above records #7's rename (`EnvironmentResult` → `MutationResult`,
`EnvironmentIdSchema` → `IdSchema`) as done. It was not: the rename ran as `sed -E 's/\bName\b/…/g'`, and macOS
`sed` does not support `\b`, so nothing matched and no error was raised. Typecheck and lint passed because nothing had
changed. The `withStore` part of #7 was applied (by a separate edit) and is correct. The second `/code-review` pass
found the old names. Renamed with `perl -pi -e 's/\b…\b/…/g'` on 2026-11-11; `grep` finds no old name in `src`;
`npm run typecheck` and `npm run lint` exit 0.

## Code review follow-up — /code-review, second pass (2026-11-11)

- **Executor:** lz-tdd (#2), lz-build (#3 handler, #9), lz-e2e (#1, #5, #10)
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

Ten findings; dispositions by the author ("go ahead with all", 2026-11-11): fix #1, #2, #3, #5, #9, #10; #8 was the
rename recorded under "Correction" above; accept #4 (= CR3), #6 (= CR6), #7 (files left by save-over, out of scope by
plan). Triage is in `review.md`.

**Changed**
- `src/core/url.ts` — #2: `InvalidPathError`; a path whose path part has a `.` or `..` segment (including `%2e` forms) is refused before anything is recorded; a query or fragment may hold anything.
- `src/main/ipc.ts` — #2: `InvalidPathError` maps to `invalid-input`. #3: a `MongoError` from the environment lookup or the saved-request check before recording becomes `DatabaseUnavailableError` (`database-unavailable`).
- `src/shared/ipc-contract.ts` — #9: `EnvironmentSchema` is `EnvironmentSnapshotSchema` from `call-schema.ts`.
- `src/renderer/app.tsx` — #1: `saving`; Save and Save as new are disabled while a save is in flight. #5: each queued save of the environment choice catches its own failure and shows it, so later choices are still stored. #10: `savedListError`, separate from save and delete errors, cleared by the next successful list.
- `src/core/url.test.ts` — 13 cases for #2 (8 refused, 5 joined). `src/main/ipc.int.test.ts` — #3 with a database whose `findOne` throws a `MongoError`.
- `e2e/saved-requests.spec.ts` — #1: Save held; Save is disabled and one entry results. `holdFirstAnswer` fixed: its release gate now exists before any call arrives; before, `release()` could run before the held handler had set it, leaving the answer held.
- `e2e/environments.spec.ts` — #5: the first store of a choice throws; the error is shown and a later choice is stored.

**Verification**

```
Seen failing before the fixes: #2 8 refusals did not throw; #3 kind "unexpected"; #1 Save enabled while held; #5 no error shown
$ npx vitest run --project unit src/core/url.test.ts → 43 passed
$ npx vitest run --project integration src/main/ipc.int.test.ts → 7 passed
$ npx playwright test e2e/saved-requests.spec.ts e2e/environments.spec.ts --repeat-each=3
  42 passed (19.1s)
$ npm run test:e2e          → 50 passed (40.8s)
$ npm run test:unit         → 357 passed
$ npm run test:integration  → 306 passed
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — five of the six fixes have a test seen failing first; #9 is a refactor covered by the existing suites.

**Red evidence for the earlier scenarios, redone:** the first-pass scenarios for CR1 and CR2 used `holdFirstAnswer` with
the release race. With the fixed helper, a mutation reverting CR1's identity check and CR2's shared cancellation failed
both. Restored and rebuilt.

**Drift:** none

**Notes**
- #10 has no test: a stale list error only outlives a successful load across a database reconnect, which no scenario here arranges. The change is a separate state cleared on a successful list.
- The `holdFirstAnswer` race is the test-side form of the async-state class: a value set after an await, read by a caller that did not wait for it.

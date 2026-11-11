---
change_id: saved-requests-and-environments
status: draft
produced-by: lz-plan
created: 2026-11-10
updated: 2026-11-10
revision: 2 — answers the plan review of 2026-11-10 (verdict revise). B1 a send carries the environment id the select shows, and main loads that environment by id (phases 1, 2). W1 Edit restores the path when the call's URL starts with its recorded baseUrl (phases 1, 5; author: "Restore the path"). W2 duplicate names are allowed and told apart by what is shown beside them (author: "Allow duplicates"). W3 repeat runs are in the verification commands. W4 the New button is kept (author: "Keep 'New'"). Phase numbers unchanged; no phase was verified.
inputs: [change.md, prd.md, shape-notes.md, roadmap.md, test-strategy.md, lessons.md, decisions/0001-saved-requests-are-a-flat-list.md, archive/multipart-with-file-copies/record.md, archive/request-bodies-and-storage/record.md, answers given 2026-11-10]
---

# Plan: Save and edit requests, and send them to the active environment's baseUrl

## Approach

Environments and saved requests are two new mutable collections beside the insert-only call collections. An
environment is `{ name, baseUrl }`; one setting document names the active environment. A saved request is
`{ name, request }`, where `request` is the form's content (method, URL, query rows, header rows, body) and file parts
keep their bytes (author, 2026-11-10: "Keep the file bytes"). Saved requests are one flat list (ADR 0001). Both can be
created, edited and deleted one at a time (author: "Delete one at a time").

One URL rule applies to every request, typed or saved (author: "Path joins baseUrl"): a URL starting with `/` is joined
to the active environment's `baseUrl`; a full `http(s)` URL is sent as typed. **Main** composes the URL at send time,
loading the environment the send names by id from MongoDB, and the send document records the composed URL, a snapshot of the
environment used (`id`, `name`, `baseUrl`), and the id of the saved request the form came from. A snapshot, not a
reference, because an environment can be edited or deleted and a call record must not change meaning afterwards
(PRD: a call record is never changed). The send names the environment the select shows, by id, because IPC
handlers in main run concurrently: a send pressed right after a switch could otherwise read the setting before the
switch's write lands (plan review B1). Main never takes a `baseUrl` from the renderer. The stored active setting only
decides what the select shows at startup. The renderer uses the same pure `composeUrl` only for Copy as curl.

The property that makes this shape right: the call path stays insert-only and keeps recording what went on the wire.
Saved requests and environments never touch `sends` or `completions`; the link from a call to them is an id plus a
snapshot written once. Edit of a call loads an unlinked form (author: "No, unlinked") and restores the path when the
call's URL starts with its recorded `baseUrl` (author: "Restore the path"), so the edited request follows the active
environment again; Replay copies the original's link and environment snapshot, because it sends the original's
composed URL. Names are labels and may repeat (author: "Allow duplicates"): the saved-request list shows each entry's
method and URL beside its name, and the Environment select shows each `baseUrl` beside its name.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| The environment replaces scheme, host and port of a full URL | No path in the form, and where a request goes is harder to see. Author chose path joins `baseUrl`. |
| Only saved requests use environments | Typed requests would keep needing full URLs, and two URL rules would exist. Author chose one rule. |
| The renderer composes the URL and sends a full URL with an environment snapshot | The record would carry what the renderer claimed, which can disagree with the stored active environment after a switch in another window or a failed save. Main composes and records from the store. |
| The call record holds only the environment id | Editing or deleting the environment would change what the record means. A snapshot is written once. |
| Saved request file parts without bytes, re-picked before sending | A saved request with a file could not be sent as-is. Author chose keeping bytes. |
| Saved files shared with call files by reference | Deleting one would need reference counting; slice 3a rejected the same for replays (`archive/request-bodies-and-storage/record.md` §3). Each owns its bytes. |
| Saved requests as versions (append-only) | The PRD asks to "edit it later"; history of a saved request is not a requirement. Saving overwrites. |
| The active environment in renderer state or browser storage | Lost on restart, and main could not read it at send time. |
| Edit of a call keeps the link to its saved request | Save would overwrite the saved request with an old call by accident. Author chose unlinked. |
| Main reads the stored active environment at send time | IPC handlers run concurrently, so a send right after a switch can read the old setting and go to a host the select no longer shows (plan review B1). The send names the environment by id instead. |
| Edit loads the composed URL as recorded | A saved request made from an edited call would be pinned to that host. Author chose restoring the path. |
| Duplicate names refused | Offered; author chose to allow them. Entries are told apart by method and URL, or by `baseUrl`. |
| Deletion deferred to slice 7 | Test entries and typos would stay in both lists for the rest of M1. Author chose single delete now. |

## Out of scope

- Filtering history by environment or saved request (slice 6). This change writes the fields slice 6 filters on.
- Cleaning up GridFS files left by a saved request that is saved over or deleted. Slice 7 finds files no document refers to (`roadmap.md`, carried items; T3.9). Accepted by the author with "Keep the file bytes".
- Deleting calls, and bulk or retention deletion (slice 7).
- Directories or tags for saved requests (ADR 0001).
- Environment variables other than `baseUrl`, and auth per environment (PRD non-goal; later milestone).
- Versions or undo for saved requests and environments.
- Sorting or searching the saved-request list beyond listing by name.
- A `baseUrl` with a query string, fragment or user information: refused when the environment is saved.
- Importing or exporting saved requests or environments.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | Joining a `baseUrl` to a path changes only the URL undici is handed; no new method, body type or header rule reaches undici, so the standing undici rule needs no probe. The T1.3 cases run with a composed URL in phase 1. | The record would differ from the wire; phase 1's T1.3 case fails. | yes — checked by phase 1's tests |
| A2 | Adding optional `environment` and `savedRequestId` to `SendDocSchema` and `SendSummarySchema` keeps every existing document parsing at `schemaVersion: 1`, as slice 3a's additions did (`call-schema.ts:31-44`). | Old calls list as unreadable. Phase 1's T2.2 fixtures catch it. | yes — checked by phase 1's tests |
| A3 | A saved request document stays under 16 MB when inline content (body text and file bytes together) is capped at 1 MiB and everything above goes to the `bodies` bucket, as call bodies do (`body-store.ts:15`). | Saving a large request fails. Phase 3 saves a 17 MiB text body and a 17 MiB file. | no — the cap is by construction |
| A4 | Main can return a saved request's file bytes to the renderer in one IPC answer. Partly verified: `readBody` returns `Uint8Array` main → renderer up to 1 MiB pages; the spike sent 256 MiB renderer → main (`archive/multipart-with-file-copies/raw/spike-file-input-ipc.md`). Not tried: main → renderer above 1 MiB. Phase 5's e2e opens a saved request holding a 17 MiB file. | Opening a large saved request fails; it would then be read in pages, as Edit of a stored call is. | no — the paged fallback exists |

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | A request with a path is sent to the active environment's `baseUrl`, and the call records the composed URL and the environment; a path with no active environment is refused before anything is recorded | `src/core/url.ts`, `src/core/environment-store.ts`, `src/core/send.ts`, `src/core/call-schema.ts`, `src/core/form-from-call.ts`, tests | lz-tdd | unit + integration |
| 2 | In the app: define environments, switch the active one, and the same typed path goes to the other `baseUrl`; edit and delete environments | `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/app.tsx`, `e2e/environments.spec.ts` | lz-e2e | `npx playwright test e2e/environments.spec.ts` |
| 3 | A saved request is stored, read back, saved over and deleted, with its bodies and file bytes intact, and sending from it records its id; calls are untouched | `src/core/saved-request-store.ts`, `src/core/send.ts`, tests | lz-tdd | integration |
| 4 | In the app: save the form, find it in the list, open it, edit and save again, save as new, delete; a call from it links back; a saved request with a file sends after the file is deleted | `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/app.tsx`, `e2e/saved-requests.spec.ts` | lz-e2e | `npx playwright test e2e/saved-requests.spec.ts` |
| 5 | The slice outcome end to end: one saved request, two environments, switch, send; two calls to two hosts, each linking to the saved request and naming its environment; Replay keeps both; Edit unlinks | `e2e/saved-requests.spec.ts`, `test-strategy.md` | lz-e2e | full gates |

### Phase 1 — a path goes to the active environment

**Changes:**
- `src/core/url.ts` (new): `composeUrl(url, environment)`. A URL starting with `/` joins the `baseUrl`'s path with exactly one `/` between them and keeps the path's query; a full `http(s)` URL is returned unchanged; a path with no environment throws `NoActiveEnvironmentError`. `checkBaseUrl(text)`: an absolute `http(s)` URL with no query, fragment, or user information. Pure; the renderer imports it for Copy as curl.
- `src/core/environment-store.ts` (new): `environments` collection (`_id`, `schemaVersion`, `name`, `baseUrl`, `updatedAt`) with list, create, update, delete, and an `active-environment` document in a `settings` collection with get and set. Deleting the active environment clears the setting. Every document parsed with `zod` (`tech-stack.md`).
- `src/core/call-schema.ts`: optional `environment: { id, name, baseUrl }` and `savedRequestId` on `SendDocSchema` and `SendSummarySchema`.
- `src/core/send.ts`: `sendAndRecord` takes the environment the caller loaded (or none) and an optional `savedRequestId`, composes the URL before `buildWireRequest`, and records both; `replayCall` copies them from the original (`send.ts:224-261`).
- `src/core/environment-store.ts` also has `get(id)`; a send naming an environment that no longer exists throws `EnvironmentNotFoundError` before anything is recorded.
- `src/core/form-from-call.ts`: when the send document has an `environment` and its URL starts with that `baseUrl` as `composeUrl` joins it, Edit loads the remaining path (with its query) instead of the full URL. Otherwise the URL loads as recorded.
- Tests: `src/core/url.test.ts` (T2.5: trailing and missing slashes, a `baseUrl` with a path, the path's query kept, query rows appended after composition, a full URL unchanged, refusals; for Edit, `composeUrl(restoredPath, snapshot)` equals the recorded URL for each case, and a URL that does not start with its `baseUrl` loads unchanged); `src/core/call-schema.test.ts` (T2.2: a document without the new fields parses); `src/core/environment-store.int.test.ts`; `src/core/send.int.test.ts` (T1.2 and T1.3 with a composed URL; a path with no environment, and a path naming a deleted environment, each leave no send document and send nothing); `src/core/replay.int.test.ts` (Replay records the original's environment snapshot, even after the environment is edited).

**Verification:**

```
$ npx vitest run --project unit src/core/url.test.ts src/core/call-schema.test.ts src/core/form-from-call.test.ts
$ npx vitest run --project integration src/core/environment-store.int.test.ts src/core/send.int.test.ts src/core/replay.int.test.ts
expected: all pass
```

**Done when:** a path sent with environment A records A's composed URL and A's snapshot and reaches the capture
server at that URL; sending with B reaches B; a path with no environment, or a deleted one, is refused with no send
document; Edit of a composed call restores its path.

**Executor:** lz-tdd — composition is pure (Tier 2 T2.5, unit); recording is Tier 1 T1.2 and T1.3, integration.

### Phase 2 — environments in the app

**Changes:**
- `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload.ts`: named functions to list environments with the active one, save one (create or update, `checkBaseUrl` in main), delete one, and set the active one. `SendInputSchema.url` accepts a full `http(s)` URL or a path starting with `/` (`ipc-contract.ts:68`); `SendInput` gains `environmentId` (or null), the one the select shows. The send handler loads that environment by id and refuses a missing one.
- `src/renderer/app.tsx`: an Environment select beside the URL (None, and each environment as name and `baseUrl`) and an Environments section to add, rename, change `baseUrl` and delete. The URL field's placeholder says a path uses the active environment. Copy as curl from the form composes with the active environment, or refuses a path with none active. The call panel names the environment the call recorded.
- `e2e/environments.spec.ts` (new): two environments pointing at two capture servers; a typed `/orders` sent with A reaches A, switch to B and press Send at once, it reaches B (B1); both history rows show their full URLs; the panel names each call's environment; editing A's `baseUrl` leaves the earlier call's panel unchanged; deleting B leaves None active and a path send shows the refusal in view (T2.9).

**Verification:**

```
$ npm run package && npx playwright test e2e/environments.spec.ts --repeat-each=3
expected: all pass
```

**Done when:** the switch scenario passes 3× and the refusal is in view.

**Executor:** lz-e2e — the select, the form and the panel connecting are T2.7; the refusal in view is T2.9.

### Phase 3 — saved requests in the store

**Changes:**
- `src/core/saved-request-store.ts` (new): `savedRequests` collection (`_id`, `schemaVersion`, `name`, `request`, `updatedAt`) with list (names and ids, sorted by name), get, create, update, delete. `request` holds the form content; body text and file bytes stay inline while their total is at most 1 MiB, and the rest go to the `bodies` bucket as file references (A3). Get returns the bytes read back. Update writes new files and replaces the document; files the old document referred to are left for slice 7 (Out of scope).
- `src/core/send.ts`: `sendAndRecord` records `savedRequestId` when given (phase 1 added the field).
- `src/core/saved-request-store.int.test.ts` (new): round trip for each body type, including multipart with a small file and with a 17 MiB file, and a 17 MiB text body; `buildWireRequest` of the read-back form equals that of the saved form (T2.12's discipline); update replaces name and request; delete removes it and get returns null; T1.1: saving, updating and deleting saved requests leaves every send and completion document byte-equal.

**Verification:**

```
$ npx vitest run --project integration src/core/saved-request-store.int.test.ts src/core/send.int.test.ts
expected: all pass
```

**Done when:** every body type round-trips to the same wire request, the 17 MiB cases store file references, and the
T1.1 case compares calls before and after.

**Executor:** lz-tdd — storage behaviour against a real MongoDB, specified before it exists. Tier 1 T1.1, integration.

### Phase 4 — saved requests in the app

**Changes:**
- `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload.ts`: named functions to list, get, save (create or update by id) and delete saved requests. `SendInput` gains an optional `savedRequestId`, which main checks exists before recording.
- `src/renderer/app.tsx`: a Saved requests section listing each entry's name, method and URL, each opening into the form; a Name field and Save / Save as new on the form; Delete on a saved request. The form remembers the saved request it was opened from until another is opened, Edit loads a call (unlinked), or New clears it (author: "Keep 'New'"). Opening a saved request while another open is pending: the latest wins (the guard Edit uses, `latestEdit`). The call panel shows "From saved request <name>", or "From a deleted saved request".
- `e2e/saved-requests.spec.ts` (new): save a typed request, it appears in the list; open it, change a header, Save, reopen shows the change; Save as new adds a second entry; send from a saved request, the call panel links to it; delete it, the panel says deleted; a saved multipart request with a 17 MiB file sends the same bytes after the file is deleted from disk (A4).

**Verification:**

```
$ npm run package && npx playwright test e2e/saved-requests.spec.ts --repeat-each=3
expected: all pass
```

**Done when:** the scenarios pass 3× and the opened form and the saved list are in view after each action (T2.9).

**Executor:** lz-e2e — list, form and panel wiring; T2.7, T2.9, T2.10.

### Phase 5 — the slice outcome, and the test strategy

**Changes:**
- `e2e/saved-requests.spec.ts`: the roadmap outcome. One saved request with a path; environments A and B; send with A, switch to B, open the saved request, send. Two calls reach two capture servers; each panel names its environment and links to the saved request. Replay of the first call goes to A and keeps both. Edit of the first call loads an unlinked form with the path restored: Save as new creates a new saved request with that path, sending it with B reaches B, and the original saved request's content is unchanged.
- `context/foundation/test-strategy.md`: Covered column for T1.1, T1.2, T1.3, T2.2, T2.5, T2.7, T2.9, T2.10; T2.5 leaves the gap list; known limits for orphaned saved-request files and the saved-request file size.

**Verification:**

```
$ npm run test:unit && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint
expected: all gates exit 0
```

**Done when:** the outcome scenario passes 3×, `test-strategy.md` lists no slice 5 gap, and all gates pass.

**Executor:** lz-e2e — the journey across saved requests, environments, history and Replay.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| A saved-request write touches call documents (an upsert or a shared collection) | low | Tier 1 T1.1: a call changes after it was written | Separate collections; phase 3's T1.1 case compares calls before and after. |
| The recorded environment disagrees with the URL sent | medium | False record | Main composes and records from one read of the store (phase 1); T1.3 with a composed URL. |
| Saving over a request leaves files in GridFS | certain | Wasted storage only | Accepted; slice 7 finds them. |
| Async state captured before an await, as code review found twice in slice 4 (`archive/multipart-with-file-copies/record.md` §4) | medium | The form shows a saved request other than the last opened | Phase 4 reuses the latest-wins guard and tests an overlap. |
| A path typed with None active, and the refusal is out of view | medium | The send appears to do nothing | Phase 2's T2.9 assertion. |

## For the reviewer

- **Phase 2 and phase 4 each add several named preload functions** (four for environments, four for saved requests).
  `AGENTS.md` asks for a narrow, named API; check the count is justified against one function per operation.
- **The environment snapshot in each call** duplicates the environment's name and `baseUrl` across calls. That is the
  point (records do not change), but slice 6 filters by environment id, so an edited environment's calls still match it.
- **Saving over a request orphans its GridFS files.** Accepted for now; check that slice 7's carried item covers them.
- **Restoring the path on Edit (W1)** strips the recorded `baseUrl` only when the URL starts with it as `composeUrl`
  joins it. Check the unit cases cover a `baseUrl` with a path and one with a trailing slash.
- **The send names its environment (B1).** A renderer that shows a stale select still sends to the environment it
  shows, which is the one the user sees; main refuses only an id that no longer exists.
- **No probe is planned for undici (A1).** The claim is that a composed URL is still just a URL. Check that nothing
  else in the request changes with environments.

## References

- `src/core/call-store.ts:1-2`, `27-121` — insert-only call store; no update or delete.
- `src/core/call-schema.ts:31-44` — send document schemas the new fields extend.
- `src/core/send.ts:80-171`, `224-261` — send and replay paths.
- `src/core/body-store.ts:15`, `138-150` — the 1 MiB inline limit and `writeBytes`.
- `src/shared/ipc-contract.ts:68` — `SendInputSchema.url` requires a full URL today.
- `src/renderer/app.tsx` — the URL field, `editCall` and `latestEdit`, `HistoryList`.
- `context/foundation/decisions/0001-saved-requests-are-a-flat-list.md` — flat list, by name.
- `context/archive/multipart-with-file-copies/record.md` — Edit's latest-wins guard; async state defects.
- `context/archive/request-bodies-and-storage/record.md` — each record owns its bytes.

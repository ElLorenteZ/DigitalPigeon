---
produced-by: lz-roadmap
current-milestone: M1
updated: 2026-11-11
target: ~/Documents/digital-pigeon.pen
---

# Roadmap

Target: the Pencil design `~/Documents/digital-pigeon.pen` is the final state. Every milestone moves the app towards
it. The author's current instructions outrank this file (author, 2026-11-11).

| Design screen | Milestone |
|---|---|
| 01 Workspace — Send & Record (sidebar tabs, method/env/auth dropdowns, responses strip, logo) | M1, slices 6–7 (Templates tab: M2) |
| 02 Call Record — Preview, Replay, Export (Delete, env/auth chips, other responses) | M1, slices 6–8 |
| 03 System States (rows 1–2 shipped behaviour; row 3: import failed, empty filter result, delete with undo) | M1 slices 8–9; import failed: M2 |
| 04 History — Search, Filter, Resend | M1, slice 9 |
| 05 Templates — Import OpenAPI / WSDL | M2 |

## Current: M1 — REST client that keeps every call

Appetite: about 2 weeks, sized to replace Postman/Insomnia for REST work (`shape-notes.md`). Re-cut on 2026-11-11 to
the target design: slices 6–9 replace the former slices 6 (find calls) and 7 (delete and retention). The appetite is
exceeded by the re-cut; the author's instruction sets the target, not the appetite.

**Exit criteria** — from `prd.md` Success criteria:
- [x] Sending the same unchanged request twice produces two call records, each with its own timestamp. *(slice 1: `call-store.int.test.ts`, `send.int.test.ts` T1.1, e2e journey shows two rows)*
- [x] A call record's content does not change after it is written; edit-and-send creates a new record and the original is unchanged when viewed again. *(slice 1: insert-only store, no update or delete; slice 2: `replay.int.test.ts` T1.1, `e2e/edit-and-export.spec.ts`)*
- [x] An exact replay sends the same method, URL, headers and body as the recorded request, and creates a new record. *(slices 2 and 3a: holds for no body and for JSON, XML, text and form bodies, `replay.int.test.ts` T1.3; multipart is slice 4; slice 4: multipart, inline and stored, `send.int.test.ts`, `replay.int.test.ts`)*
- [ ] A call record disappears only after the user deletes it, one at a time or in bulk.
- [x] A call record shows the request as sent, response status, response headers, full response body and timing. *(slice 2: the panel shows all of these; slice 3a: a body over 16 MB is stored in full, T1.5, and read to its end with Load more, `e2e/bodies.spec.ts`; slice 3b: shown in a read-only Monaco editor. Renderer memory limits how far a very large body can be paged, T3.10)*
- [x] JSON and XML request and response bodies are shown pretty-printed. *(slice 3b: Pretty by default with a Raw switch, chosen from the recorded `Content-Type`; formatted page by page up to 17 MiB with stored bytes unchanged, `src/core/body-format.ts` unit tests, `e2e/bodies.spec.ts`; T1.8 guarded by `e2e/body-safety.spec.ts`)*
- [x] JSON, XML, plain-text, form-urlencoded and multipart requests can each be sent and are recorded. *(slice 3a: all but multipart, `send.int.test.ts` T1.2, T1.3; multipart is slice 4; slice 4: multipart on 6 methods, `send.int.test.ts`, `e2e/multipart.spec.ts`)*
- [x] A recorded multipart call can be replayed after the uploaded file is deleted from its original location. *(slice 4: T1.4, `replay.int.test.ts` inline and GridFS, `e2e/multipart.spec.ts`)*
- [ ] History can be narrowed by environment, by saved request, by date range, and by a search term in URL or body.
- [ ] History can be narrowed by HTTP method (one or several) and by the `Authorization` header value sent; filters combine, and each option shows its count.
- [ ] A request shows every response it has received, newest first, and any one of them can be deleted without affecting the others.
- [ ] A call can be resent from History, one at a time or as a selection; each resend creates a new record.
- [ ] A deleted call can be restored with Undo for a few seconds, then it is gone permanently.
- [ ] The app shows the target design's shell: the circuit-trace pigeon logo, title bar with the active environment, sidebar tabs, and the status bar.
- [x] Switching the active environment changes the `baseUrl` a saved request is sent to. *(slice 5: `e2e/saved-requests.spec.ts` outcome scenario, `e2e/environments.spec.ts`, `send.int.test.ts`, `url.test.ts` T2.5)*
- [x] A request exported as curl, run in a terminal, sends the same method, URL, headers and body. *(slices 2 and 3a: holds for no body and for JSON, XML, text and form bodies with a command up to 900 KiB, on macOS, `curl.int.test.ts` T2.4; a longer command is refused with the reason; multipart is slice 4; slice 4: a text-only multipart body, `curl.int.test.ts`; a binary file part is refused with the reason, as a command over 900 KiB is)*
- [x] The app runs as a local install on the personal machine with no account. *(slice 1: the author ran the packaged app from `npm run package` and sent a request with only `config.json`; no installer from `make` yet)*
- [ ] *(Author's judgement)* Postman/Insomnia goes unopened for REST work for two weeks, and finding and replaying a past call is faster than in Postman.

| # | Slice | Observable outcome | Status | Change |
|---|---|---|---|---|
| 1 | Send and record | Type a method, URL, query params and headers (including a pasted auth header), send, see status, headers, body and timing; the call appears in a history list; sending twice shows two entries | done | `send-and-record` |
| 2 | Preview, replay, export | Open a past call and see the request as sent and the response; replay it exactly or edit and send, and a new entry appears while the original is unchanged; copy either as curl and run it | done | `preview-replay-export` |
| 3a | Request bodies and storage | Send JSON, XML, plain-text and form-urlencoded bodies; replay and curl export send the same bytes; a body over 16 MB is stored and shown in full | done | `request-bodies-and-storage` |
| 3b | Editor and formatting | JSON and XML request and response bodies shown pretty-printed in the editor, with what is stored and sent unchanged; a response body cannot run as script | done | `editor-and-formatting` |
| 4 | Multipart with file copies | Send a multipart request with a file; delete the file from disk; replay the call and the server receives the same bytes | done | `multipart-with-file-copies` |
| 5 | Saved requests and environments | Save a request and edit it later; define environments (name + `baseUrl`), switch the active one, and the same saved request goes to the other `baseUrl`; calls link back to their saved request | done | `saved-requests-and-environments` |
| 6 | Workspace shell in the design | The app looks like screens 01 and 02: the logo in the title bar, the environment selector in the title bar, a sidebar with Saved and History tabs (Templates appears in M2), request above response, the status bar; every existing e2e journey still passes | next | — |
| 7 | Responses to this request | Send the same method and path three times and the response panel shows three response chips, newest selected; pick one to view it; the call record lists the other responses of its request | later | — |
| 8 | Delete with undo | Delete one response from the strip, the history list or the call record; it disappears, an Undo toast restores it for a few seconds, then it is gone permanently along with its stored bodies and file copies | later | — |
| 9 | Search, filter, resend | Screen 04: search text plus method, environment, `Authorization` header and date facets with counts, results table, resend one or a selection, delete a selection; an empty result says so and offers to clear filters | later | — |

**Order rationale:**
- Slice 1 goes first because it is both the thinnest end-to-end path and the riskiest. Recording the request exactly as it went over the wire through `undici` (T1.2, T1.3) underpins every later slice. It also carries the groundwork that has no visible outcome of its own:
  - the IPC contract with `zod`
  - the database connection with startup retry
  - the database name read from the environment, so e2e can use a `dp_test_*` database
  - the database-down behaviour

  It is expected to be the largest slice.
- Slice 2 next: immutability (T1.1) and exact replay (T1.3) are the product's reason to exist, and curl export is the same "request as data" transformation.
- Slices 3–4 before saved requests: GridFS, the 16 MB limit (T1.5) and file copies (T1.4) are technical risks with no workaround if the storage shape is wrong. They should fail while the storage design is still cheap to change.
- Slice 5 is finished before the re-cut slices start: environments and saved-request links are what slices 7 and 9 group and filter by.
- Slice 6 (shell) next, because it makes every later slice cheaper: `src/renderer/app.tsx` is one 1857-line unstyled file, and slices 7–9 each add UI that the design places in the sidebar, title bar and response panel. Building them before the shell means building their UI twice. Its outcome is observable (the app matches screens 01/02 for what already works) and the existing e2e suite is its regression check. It is the slice most likely to overrun: renderer work cost most in slice 4.
- Slice 7 before 8: the responses strip is where a single delete first appears in the design, and it fixes what "the same request" means (open question below) before delete and search depend on it.
- Slice 8 before 9: single delete with undo is proven before bulk delete of a selection. Deletion is irreversible after the undo window (T1.7), and the cleanup carried from slice 3a (T3.9) belongs here.
- Slice 9 last: the biggest UI (screen 04) on top of a store that already groups, deletes and restores calls. The `Authorization` facet reads headers already recorded on every call; no new data is captured.
- Retention rules were part of the former slice 7. They are not in the target design and move to "Later".
- Monaco editor arrives in slice 3b, where formatting first needs it; slices 1, 2 and 3a show bodies as plain text.
- Slice 3 was cut in two, bodies first (author, 2026-11-06). Slice 3b must carry T1.8 and T2.6 from its first phase: it is the first time a body renders as anything but text. It also has to show a body held in a file, which is read a page at a time.

**Carried into later slices** from `archive/request-bodies-and-storage`:
- ~~Slice 4: recheck undici's headers timer with file bodies, and T1.5 for uploaded files.~~ Done in slice 4 (`send.test.ts`, `large-bodies.int.test.ts`).
- Slice 8 (was 7): delete must find chunks with no file document and finished files no call refers to (T3.9), and recheck the error when a file is removed during a read.
- From `multipart-with-file-copies` (code review CR9): `describeBody` opens one GridFS stream per 1 MiB page; one stream
  for the whole file would do. Pick up when touching stored-body reads, at the latest in slice 8.
- When the work machine's OS is decided: curl export fails on Linux above 128 KiB (T2.4, T3.4).

**Decisions needed before a slice can be planned** (PRD Open questions):
- ~~Before slice 1: database-down behaviour~~ — decided 2026-11-03: sending is blocked (`archive/send-and-record`).
- ~~Before slice 5: how saved requests are organised~~ — decided 2026-11-10: a flat list, tags later (`decisions/0001-saved-requests-are-a-flat-list.md`).
- ~~Before slice 7: what makes two calls responses to "the same request"~~ — decided 2026-11-11: "same method and path"
  (author). The host and environment do not separate them. Left to `lz-plan`: whether the query string is part of the
  path.
- ~~Before slice 8: where a call is held during the Undo window~~ — decided 2026-11-11: "held in the app" (author). The
  store is not touched until the timer ends; Undo is a renderer-only cancel. Length: 8 s, as in the design. Left to
  `lz-plan`: what happens to a pending delete when the app quits inside the window.

**Calibration:**
- **`test-harness`** (2026-11-02): one day. Configuration-heavy; a weak guide to feature slices.
- **Slice 1, `send-and-record`** (2026-11-03 → 2026-11-04): two days. Expected to be the largest
  slice, because it carried the groundwork: IPC contract, call-record schema, database connection,
  and database-down behaviour. The time went on:
  - a spike (A1, the driver bundled into the packaged app)
  - two plan reviews; one found that undici rewrites headers
  - a defect drift (`HEAD`)
  - a host code review with 9 fixes, one of them a tier-1 record mismatch

  Feature-only slices (2–7) should be smaller. Slice 2 did not confirm this.
- **Slice 2, `preview-replay-export`** (2026-11-05 → 2026-11-06): two days, the same as slice 1, with no
  groundwork to carry. The time went on:
  - two spikes; the non-ASCII one disproved its prediction and added a phase that changed slice 1's send
    path
  - a plan review that found curl's globbing and empty-value behaviour
  - a defect found through the author's packaged-app check (the panel opened off-screen)
  - a host code review with 8 fixes, two of them records that did not match the wire

  Most of the cost came from what undici and curl do, not from the feature. Slice 3 meets the same
  boundary with bodies, `content-length` and the 16 MB limit, so expect at least the same. Slices 5–7 touch
  undici less, and are the next check on whether feature slices cost less.
- **Slice 3a, `request-bodies-and-storage`** (2026-11-06 → 2026-11-07): two days for half of slice 3. The time
  went on:
  - three spikes; one failed and replaced `--data-binary`, which would have sent local files
  - two plan reviews, each followed by a revision
  - a false diagnosis in phase 6, written as a fix and then removed
  - two host code review passes with 11 fixes, including chunks left behind, a paging defect and an upload timeout

  The prediction held: undici, curl and GridFS took most of the time. Slice 3b touches none of them, but brings in
  Monaco, which has no earlier calibration.
- **Slice 3b, `editor-and-formatting`** (2026-11-07 → 2026-11-08): two days, the same as every slice so far, with
  no undici, curl or GridFS work. The time went on:
  - a spike whose "no worker" result did not hold inside this app's renderer, found only in phase 2
  - two plan reviews and six plan revisions, two of them answering defect drifts during the build
  - Monaco's lazily loaded JSON support throwing unregistered-service errors, missed by a console-only listener
  - a host code review whose findings ran to CR8

  Leaving the undici boundary did not make the slice cheaper; a new library cost the same. Two days a change is
  now the observed rate regardless of boundary. Slice 4 returns to undici, curl and GridFS with file bodies.
- **Slice 4, `multipart-with-file-copies`** (2026-11-08 → 2026-11-10): two days of work, opened on the 8th and closed
  on the 10th. The prediction "at least two days" held, but not for the predicted reason: the undici and curl probe
  matched the wire on the first try, and phases 1–3 needed no production change beyond the encoder. The time went on:
  - a probe and a spike before the plan was approved, and three plan revisions after two plan reviews
  - the renderer: a parts editor, an incremental parser, an eighth preload function, Edit of stored bodies
  - a hang in a boundary check, and a test that crashed its worker instead of failing
  - a host code review with 7 fixes, three of them async state in the renderer that every e2e scenario missed

  Slices 5–7 are mostly renderer and query work, the area that cost most here. Expect two days each.
- **Host code review:** found defects in all five changes after every other check passed: record-versus-wire
  mismatches in slices 1 and 2, storage and paging defects in slice 3a, Monaco service errors in 3b, async renderer
  state and unchecked header values in slice 4. One pass before merge is now expected
  (`test-strategy.md`). Plan for it in each slice.
- **M1 appetite:** about 2 weeks for 7 slices, now 8 changes. After 8 days of slice work, 5 of 8 changes and 9 of 13
  exit criteria are done. At two days a change, the remaining 3 take 6 days, for about 14 in all. That meets the
  appetite with no margin.
- **Merged:** slices 1, 2 and 3a reached `main` together on 2026-11-07, at `15c97c9`, with no pull request (author's
  instruction). "Done" here now means closed, archived and merged. Slice 3b reached `main` through PR #3 on
  2026-11-08. Slice 4 reached `main` at `7ab1f65` on 2026-11-09, fast-forwarded with no pull request (author's
  instruction), and was closed and archived on 2026-11-10.

## Later milestones

### M2 — Templates from OpenAPI and WSDL (design screen 05)

Next after M1, because it is the rest of the target design. Slices named, not detailed; detail them when M1 closes.
- **OpenAPI import**: choose a JSON file, preview, generate one template per operation into directories by tag or path
  segment; the Templates tab shows the tree; a template opens into the form and sends with the active `baseUrl`.
- **Re-import and errors**: re-importing updates templates in place without touching History; an invalid file imports
  nothing and shows where it failed (screen 03, row 3).
- **WSDL import and SOAP send**: spike WSDL parsing first (`tech-stack.md`); templates filed by service and port; a SOAP
  operation sends and is recorded like any other call.

### Not ordered yet

Not in the target design. Order is set when the author asks for them.
- **GraphQL requests**, and grouping history by request type.
- **Retention rules** (moved out of M1 on 2026-11-11: not in the target design).
- **Side-by-side diff of two calls.**
- **Collection runner.**
- **OAuth2 token flows, cookie jar.**
- **Proxy, client certificates (mTLS), custom CA** — moves into M1 if assumption A1 (work APIs need no proxy) proves false.
- **WebSocket, gRPC, SSE.**

## Not in any milestone

From `prd.md` Non-goals:
- Pre-request scripts, response assertions, chaining values between requests.
- Import of Postman collections and environments.
- Accounts, multiple users, shared workspaces, sync between machines.
- Mock servers.
- Environment variables other than `baseUrl`.
- Reading or committing stored data outside the app.
- Redacting secrets in history.
- Size caps or truncation of stored response bodies.

## Closed

None.

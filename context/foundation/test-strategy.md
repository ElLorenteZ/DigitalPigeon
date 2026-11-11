---
produced-by: lz-test-strategy
updated: 2026-11-08
tiers: 8/12/10
revised: 2026-11-02 — test harness installed (change test-harness); gates verified; e2e target corrected to the production build output
revised: 2026-11-03 — change send-and-record covers T1.1, T1.2, T1.3, T1.6, T2.1, T2.2, T2.8 and part of T2.7; gates re-verified
revised: 2026-11-06 — change preview-replay-export moves T2.4 from unit to integration and covers it, completes T2.7, and extends T1.1, T1.2 and T1.3 to edit, replay and refused headers; gates re-verified
revised: 2026-11-06 — code review of preview-replay-export adds T2.9, T2.10, T2.11 and T3.8, narrows T3.2, and extends T1.2, T1.3 and T2.4 to refused header names, the Connection value and URL user information; gates re-verified
revised: 2026-11-07 — change request-bodies-and-storage covers T1.5 and extends T1.1, T1.2, T1.3, T1.6, T2.2, T2.4, T2.7, T2.9, T2.10 and T2.11 to bodies; adds T2.12, T3.9, T3.10 and a code review step; gates re-verified
revised: 2026-11-11 — change saved-requests-and-environments covers T2.5 and extends T1.1, T1.2, T1.3, T2.2, T2.7, T2.9 and T2.10 to saved requests and environments; unit, integration and e2e re-verified
revised: 2026-11-09 — change multipart-with-file-copies covers T1.4 and extends T1.2, T1.3, T1.5, T2.4, T2.7, T2.10, T2.11 and T2.12 to multipart bodies and uploaded files; unit, integration and the multipart e2e specs re-verified
revised: 2026-11-08 — change editor-and-formatting covers T1.8 and T2.6, extends T2.9 to the Pretty and Raw switch and to Load more inside the editor's own area, ends T3.10's long scroll, and adds the console check to T1.8; unit, lint, typecheck and the e2e specs re-verified, the packaging step not (network)
---

# Test strategy

## Failures to prevent
The product exists to keep every call, unchanged, and to resend it exactly. The failures that matter
are a call record that is lost, overwritten or altered after it was written; a send that leaves no
record; and a replay or recorded request that differs from the bytes that went on the wire. A
response body executing as code in the renderer is the one security failure with high impact.

## Risk tiers

### Tier 1 — automated, gates block
| # | Risk | Layer | Why that layer | Covered? |
|---|---|---|---|---|
| T1.1 | A call record is overwritten or changed after it is written: a second send of the same unchanged request replaces the first (for example an upsert keyed by saved request), or edit-and-send modifies the original record. | integration | Immutability is a property of what MongoDB holds after the operation. Only a re-read from the real store observes it. | yes — `src/core/call-store.int.test.ts` (two identical sends list as two calls; upsert mutation caught), `src/core/send.int.test.ts` (same input sent twice), `src/core/replay.int.test.ts` (after a replay and after edit-and-send, `getCall(original)` is deep-equal to before), `src/core/large-bodies.int.test.ts` (a replay of a stored body has its own file, and the original's document and file are unchanged), `src/core/body-store.int.test.ts` (no function removes a finished file), `src/core/saved-request-store.int.test.ts` (creating, saving over and deleting saved requests leave every send and completion deep-equal) |
| T1.2 | A send completes but no call record is written, or the record is missing part of what the PRD requires: request as sent, status, response headers, full body, timing, timestamps, environment, source saved request. | integration | The send path crosses two real boundaries (HTTP and MongoDB). Tested against a local HTTP server on `127.0.0.1` and the test database. | yes — `src/core/send.int.test.ts` (status, headers, body bytes, timing; failed send insert → zero dispatches; failed completion insert → not-recorded error; a header undici would refuse, by its characters or by its name, leaves no send document and sends nothing; `HEAD` with a body refused the same way; multipart on 6 methods, and a typed `Content-Type` with a multipart body refused the same way; a path records the environment snapshot and the source saved request; a path with no environment is refused the same way), `src/main/ipc.int.test.ts` (a saved request deleted before the send is not linked) |
| T1.3 | The recorded request, or an exact replay, differs from the bytes on the wire: `undici` adds or reorders headers, changes `content-length` or encoding, or the record is built from the editor model instead of the dispatched request. | integration | Defaults added by the HTTP client are visible only at the wire. A local server captures the raw request and the test compares it with the record and with the replay. | yes — `src/core/send.int.test.ts` (all 7 methods without a body, 6 with each body type, multipart included; send document equals what the capture server received; a typed `Connection` records the value undici writes; a user and password in the URL add no header; undici itself refuses the names and values `wire.ts` refuses) and `src/core/wire.test.ts`; `src/core/replay.int.test.ts` (all 7 methods; a replay's method, URL, raw headers and body equal the original's at the capture server, for the same combinations); `src/core/multipart.test.ts` (multipart encoding and boundary choice); a path composed with an environment's baseUrl on GET, POST and DELETE, and a replay keeping the original's environment snapshot |
| T1.4 | A recorded multipart call cannot be replayed after the uploaded file is deleted from disk, because no copy was stored. | integration | Needs a real file, its deletion, GridFS and a captured replay. | yes — `src/core/replay.int.test.ts` (a 64 KiB inline body and a 3 MiB GridFS body: file read, sent, deleted, replayed, both requests equal); `e2e/multipart.spec.ts` (a file picked in the form, deleted, replayed from the panel) |
| T1.5 | A response or upload body over 16 MB fails to save or is truncated, or a transfer that does not finish leaves a document referring to a partial file. | integration | The 16 MB limit and the GridFS threshold exist only in a real MongoDB, and only a real server refuses a chunk. | yes, for request and response bodies — `src/core/large-bodies.int.test.ts` (17 MiB each way reads back with equal SHA-256; the 1 MiB threshold; cancel, server dying, timeout and a chunk refused by MongoDB each leave no chunks), `src/core/body-store.int.test.ts` (range reads, failed `finish()`, chunks removed); uploads: `large-bodies.int.test.ts` (a 17 MiB file part stored, sent and replayed with equal SHA-256), `e2e/multipart.spec.ts` (a 17 MiB file through the form and the send handler) |
| T1.6 | A send proceeds while the database is unreachable and the call is lost without the user being told. | integration | Requires a real failed connection (closed port or stopped container). The expected behaviour waits on the PRD open question on database-down behaviour; the test asserts whichever behaviour is decided, and in every case no send is silently unrecorded. | yes — behaviour decided: sending is blocked. `src/core/db-down.int.test.ts` (refused in under 5 s, never dispatched), `src/core/large-bodies.int.test.ts` (a failed request-body upload dispatches nothing and reports the database) |
| T1.7 | Single delete, bulk delete or a retention rule removes records it should not (filter too broad, wrong date boundary, wrong environment). Deletion is irreversible. | integration | The failure is the query matching the wrong documents in the real store. Tested by seeding records on both sides of each boundary and counting what remains. | **gap** |
| T1.8 | A response body runs script in the renderer (`<script>`, `<img onerror>`, SVG, HTML preview) because it was rendered as live HTML. | e2e | A render-only defect. Only a real Electron renderer with the production CSP shows whether script executes. Run against the production build output (`npm run test:e2e` builds first), because the CSP is injected into production builds only. | yes — `e2e/body-safety.spec.ts`: `<script>`, `<img onerror>`, SVG `onload` and a `javascript:` link as `text/html`, `application/xml`, `application/json` and `text/plain`, in Pretty and Raw; no flag set, no new window, no navigation, and no console error or uncaught page error, which also catches a blocked worker or a Monaco service error |

### Tier 2 — automated where cheap
| # | Risk | Layer | Why that layer | Covered? |
|---|---|---|---|---|
| T2.1 | Renderer and main disagree on an IPC message shape. | types | Both sides compile from one shared contract module in one bundle, so a mismatch is a compile error. `zod` validation in main handles malformed input at runtime and needs no separate test of its own. | yes — `src/shared/ipc-contract.ts`, checked by `tsc`; main validates every message with its schemas |
| T2.2 | A stored document of an older shape crashes the UI or is silently misread. | unit | `zod` schemas parse fixture documents of each `schemaVersion`. Pure; no database needed. | yes, for `schemaVersion: 1`, including `body: null`, inline bytes, file references, and a send with and without `environment` and `savedRequestId` — `src/core/call-schema.test.ts`; a failing stored document lists as an `unreadable` row (`call-store.int.test.ts`) |
| T2.3 | A history filter (environment, saved request, date range) or search (substring of URL or body, for example `/orders/12`) returns the wrong set of calls. | integration | Text-index tokenisation and the `$regex` fallback behave only in a real MongoDB. | **gap** |
| T2.4 | A curl export, run in a terminal, sends a different method, URL, headers or body (quoting, escaping, binary and multipart bodies). | integration | Only running curl shows what curl sends: curl globs URLs, treats `-H 'Name: '` as removing a header, and adds its own headers, and a string assertion sees none of that. Moved from unit in change `preview-replay-export`. Needs `curl` on `PATH`. | yes — `src/core/curl.int.test.ts` (all 7 methods through `sh -c`; bracket and brace URLs, empty values, duplicates, quoting, a user and password in the URL left out; each body type on 6 methods; a body starting with `@`; refusals of a command over 900 KiB, of a stored body, and of bytes a shell cannot hold; a text-only multipart body on 4 methods, and a binary file part refused with its own message) |
| T2.5 | Switching environment does not change the URL a saved request is sent to, or URL composition breaks (`baseUrl` + path slashes, query encoding). | unit | Pure function of environment and request. | yes — `src/core/url.test.ts` (joining with one `/`, a baseUrl with a path, the path's query, query rows after composition, a full URL unchanged, refusals; `checkBaseUrl`; Edit's `pathFor` composing back); `e2e/environments.spec.ts` (a typed path to two environments; a send while the switch is still being saved) |
| T2.6 | Pretty-printing JSON or XML changes the content, for example integers above 2^53 lose precision through `JSON.parse`. | unit | Pure transformation with known inputs. | yes — `src/core/body-format.test.ts` (numbers and strings copied as written, every character but whitespace between tokens kept, the same output for any split into pieces) |
| T2.7 | The journey send → appears in history → replay → new record appears is broken by the wiring between renderer, preload and main. | e2e | Each piece is tested below; only the assembled app shows that they connect. Two or three journeys, no assertions on stored document contents (those belong to integration). | yes — `e2e/send-and-record.spec.ts` (send → history), `e2e/replay.spec.ts` (open → replay → new row, original unchanged), `e2e/edit-and-export.spec.ts` (Edit, Copy call as curl, refused-header message), `e2e/bodies.spec.ts` (a typed body opened, replayed and edited; Form rows; a 17 MiB response through Load more; a large typed body), `e2e/multipart.spec.ts` (pick a file → send → delete it → replay; the parts list and Edit → Send for an inline and a stored call), `e2e/environments.spec.ts` (define, switch, edit, delete; calls keep their environment), `e2e/saved-requests.spec.ts` (save, open, save over, save as new, delete, link back; one saved request to two environments, Replay and Edit) |
| T2.8 | The app fails at startup instead of retrying while `mongod` restarts after first initialisation. | unit | Retry logic tested with a fake connector that refuses N times. The real restart is timing-dependent and flaky to reproduce. | yes — `src/core/db-connection.test.ts` (retry within the bound, down after it with continued retries, heartbeat up/down) |
| T2.9 | An action's result opens out of view, so the action appears to do nothing: a call opened from a long history, Cancel during a replay, a replay's result, the form after Edit, a page added by Load more, and a refused `HEAD`, Edit or curl export. | e2e | Render-only. A locator finds an element wherever it is, so only an explicit viewport assertion on a rendered page observes this. Found twice in `preview-replay-export`, by the author and by code review. | yes — `e2e/replay.spec.ts` (panel on open), `e2e/panel-actions.spec.ts` (Cancel, result below a tall form, form after Edit), `e2e/bodies.spec.ts` (Load more keeps the body area and the remaining count in view, the Pretty and Raw switch keeps the body in view, History one scroll below a 1 MiB response, the three refusals, the body box after Edit), `e2e/environments.spec.ts` (a path refused with no environment), `e2e/saved-requests.spec.ts` (the opened form, the list after Delete) |
| T2.10 | The panel shows or acts on a different call from the one last clicked, so Replay sends a real request to the wrong target: a failed open leaves the previous call live, an earlier answer arrives after a later one, or a page read for one body appears under the next call. | e2e | The defect is in renderer state, which has no lower test layer. Failure and answer order are arranged by replacing the get-call handler in the launched app. | yes — `e2e/open-call-failures.spec.ts`; `e2e/multipart-edit-failures.spec.ts` (two overlapping Edits of stored multipart calls: the later one stays in the form; a failed read leaves the form unchanged); `e2e/saved-requests.spec.ts` (two overlapping opens of saved requests: the later one stays in the form; a Save finishing after New leaves it unlinked; typing during an open is kept; a call is not called deleted while the list failed), `e2e/environments.spec.ts` (two quick choices store the later one) |
| T2.11 | A send or replay to a server that never answers stays in flight far beyond its limit instead of recording `timeout`, or a large request body is cut off by that limit while still uploading. The limit is 30 s, plus 1 s per whole MiB of request body. | unit | The defaults are what can differ between paths, and a real 30 s wait is too slow for a gate. The test reads the values handed to undici. That a timeout records `timeout` is part of T1.2 (`send.int.test.ts`, with a short timeout). | yes — `src/core/send.test.ts` (a send, a replay, a body under 1 MiB, a larger body, a 17 MiB multipart file part) |
| T2.12 | Edit loads a recorded body into the form so that sending it unchanged sends different bytes: a type guessed wrongly, a byte order mark dropped, or form rows that cannot hold the content. | unit | Pure mapping from a recorded request to form input, with known inputs. Found twice by code review of `request-bodies-and-storage`. | yes — `src/core/form-from-call.test.ts` (round trip for each type, multipart with its recorded boundary included; content a row cannot hold loads as Text, for form rows and multipart field values and names; a multipart body that does not re-encode loads as Text inline and is refused when stored) |

### Tier 3 — manual or deliberately unverified
| # | Risk | Treatment | Why acceptable |
|---|---|---|---|
| T3.1 | `contextIsolation`, `sandbox`, `nodeIntegration` or the CSP is relaxed. | Review against the non-negotiable rule in `AGENTS.md`. | Three lines of config, changed rarely, and T1.8 fails if a relaxation exposes script execution. |
| T3.2 | Visual appearance, theme, Monaco highlighting and editor behaviour look wrong. Excludes something being out of view after an action, which is T2.9. | Manual, during daily use. | Visible at once, no data loss, one user. |
| T3.3 | The packaged macOS app does not launch (signature, quarantine). | Manual, on each `npm run package`. | Visible at once; the ad-hoc signature already works (`context/scaffold-verification.md`). |
| T3.4 | Windows or Linux builds fail. | Unverified. | Work-laptop use is deferred (PRD constraints, `infrastructure.md`). Revisit when it is pursued. |
| T3.5 | Search or history views are slow at real history size. | Manual, at real size. | No PRD performance criterion. Single-user volumes. |
| T3.6 | History is lost with the Docker volume. | Not tested. Manual `mongodump` backup. | Accepted in the `infrastructure.md` risk register. |
| T3.7 | Replay of a call with an expired token behaves unexpectedly. | Not tested. | Behaviour is a PRD open question, settled at first real use. |
| T3.8 | A call opened while in flight stays "In flight" in the panel after it completes. | Not tested. Accepted by the author in code review of `preview-replay-export`. | Clicking the row again refreshes it, the history row is correct, and the stored record is unaffected. |
| T3.9 | GridFS holds data no call refers to: chunks left by a crash mid-stream, or a finished file whose document insert failed. | Not tested. Accepted by the author in `request-bodies-and-storage`. | Wasted storage only, and no record is false. Slice 7's delete must find both kinds. |
| T3.10 | A very large body exhausts renderer memory when paged far enough. | Manual, during daily use. 17 MiB stayed usable in e2e. | The stored bytes are unaffected. The long scroll to History ended with `editor-and-formatting`: a body scrolls inside its own area, and T2.9's test checks History is one scroll away. |

## Layer contract
| Layer | Tool | Owns | Does not touch |
|---|---|---|---|
| Types | `tsc` (strict, `noUncheckedIndexedAccess`) | Shapes inside the bundle, IPC contract at compile time | Anything at runtime: MongoDB documents, HTTP responses |
| Unit | Vitest, Node environment | Pure functions: wire request building and header refusal, form mapping, URL composition, formatting, `zod` schemas, retry logic; the options handed to undici, with undici mocked | MongoDB, network, Electron APIs |
| Integration | Vitest, Node environment; real MongoDB from `docker-compose.yml`, a throwaway `dp_test_*` database per test file from `openTestDb()` (dropped afterwards, never the history database); local HTTP server on `127.0.0.1`, ephemeral port | Main-process send, record, replay, store, GridFS, search, delete; IPC handlers through a stand-in for `ipcMain`; curl export run through `sh -c` with the system curl | Electron APIs, the renderer |
| E2E | Playwright `_electron` (experimental API), launching Electron from `node_modules` on the production build output (`.vite/build`, `args: ['.']`). Not the packaged `.app`: its fuses disable the inspector Playwright attaches through. | Journeys across renderer, preload and main; render-only defects, including whether something is in the viewport; renderer state under failures arranged by replacing an IPC handler in the launched app | Stored document contents, logic reachable one layer down |
| Manual | — | Tier 3 | Anything in tier 1 |

Design consequence: integration tests run in plain Node, so main-process modules for sending,
recording and storage must not import `electron`. Electron-specific wiring stays in a thin layer that only
e2e exercises. `src/main/ipc.ts` imports Electron only as a type, so its handlers can also run in plain Node
(`src/main/ipc.int.test.ts`).

## What the type system already covers
- Required fields of a call record, saved request and environment as constructed in code.
- IPC payload shapes between renderer and main, given one shared contract module.
- Exhaustive handling of body kinds (JSON, XML, text, form-urlencoded, multipart) when modelled as a
  discriminated union with a `never` check.
- Possibly-missing array and record entries (`noUncheckedIndexedAccess`).

Not covered by types, and therefore not to be assumed: documents read from MongoDB, data received
over IPC at runtime, HTTP responses. Each is validated with `zod` (`tech-stack.md`).

## Quality gates
Gates run locally before commit. No hosted CI (author decision, 2026-11-02).

| Gate | Command | Verified | Blocks |
|---|---|---|---|
| Types | `npm run typecheck` | 2026-11-07, exit 0 | every commit |
| Lint + format | `npm run lint` | 2026-11-07, exit 0 | every commit |
| Build | `npm run package` | 2026-11-07, exit 0 (run by `test:e2e`) | every commit touching main, preload or Vite config |
| Unit | `npm run test:unit` | 2026-11-08, exit 0 (240 tests) | tier 1 and 2 unit risks |
| Integration | `npm run test:integration` (requires `docker compose up -d` and `.env`; fails, never skips, when MongoDB is unreachable; `curl` on `PATH`) | 2026-11-07, exit 0 (250 tests) | tier 1, T2.4 |
| E2E | `npm run test:e2e` (runs `npm run package` first) | 2026-11-07, exit 0 (19 tests). 2026-11-08: the specs, 25 tests, pass on the Vite build; the packaging step after it failed to download Electron (network) | T1.8, T2.7, T2.9, T2.10 |

**Code review before merge (author decision, 2026-11-07).** At least one `/code-review` pass runs before a change
merges. It is a manual step, not a gate: it does not pass or fail, and no command enforces it. A further pass on the
fixes is suggested when they touch storage or failure paths. It found defects the tests and `lz-review` missed on all
three changes so far. `review.md` records whether it ran.

## Known gaps
Harness: change `test-harness` (`context/archive/test-harness/record.md`). Covered so far: changes
`send-and-record`, `preview-replay-export`, `request-bodies-and-storage`, `editor-and-formatting`, `multipart-with-file-copies` and `saved-requests-and-environments`, see the Covered column. e2e runs always use a
`dp_test_*` database through `test-support/e2e-database.ts`, so no run touches real history.

Uncovered, and where each is expected to be closed (`roadmap.md`):
- **T1.7** delete and retention removing the wrong records — slice 7.
- **T2.3** history filters and search — slice 6.

Known limits inside covered risks:
- **T1.3's wire contract** encodes undici 8.12.3's normalisation: lowercase `host`, `connection` added
  and moved to second place, `connection: close` forced on `HEAD`, `content-length: 0` on bodiless
  `POST`/`PUT`/`PATCH`, `connection` written as `close` when the typed value lists it and `keep-alive`
  otherwise, header values trimmed by `wire.ts`. An undici upgrade can change it; the T1.3 cases fail if
  it does.
- **Refused headers.** `wire.ts` keeps its own copy of what undici rejects: non-ASCII values, LF, CR, NUL,
  DEL, invalid names, `Transfer-Encoding`, `Keep-Alive`, `Upgrade`, `Expect`, and a `Connection` value
  that is not a token list. A test checks the named cases against undici, so a rule undici removes fails
  it. A rule undici adds fails no test. Anything still rejected records `invalid-request`. The capture
  server decodes header values as latin1, so any future comparison of a
  non-ASCII value must decode them first.
- **T1.2's timing:** `durationMs` includes time writing to GridFS above 1 MiB, so durations above and below
  that size are not comparable. Accepted by the author.
- **T1.5:** a storage failure is arranged with a collection validator on `bodies.chunks` and `bodies.files`.
  A crash mid-stream is not tested (T3.9). A file removed during a read can report the database as unavailable;
  nothing can remove a file until slice 7, which must recheck this.
- **T2.4 holds for curl 8.7.1 on macOS and POSIX `sh`.** Other curl versions and shells are unverified. The
  900 KiB limit was measured on one machine, and terminal pasting is untested. On Linux, one argument is capped
  at 128 KiB, so a command between 128 KiB and 900 KiB is offered and fails (T3.4). Accepted by the author.
- **Records from before the refusal** can hold non-ASCII values. Replay sends them as recorded (tested);
  curl refuses them (tested). A record holding a typed `Connection` other than `close` or `keep-alive`
  exports that literal value, which differs from what undici sent (not tested, accepted).
- **T2.9 covers the actions named there.** A new action that changes something out of view needs its own
  viewport assertion; no test covers the class. None of it has been checked in the packaged `.app`. DevTools
  docks some time after launch in e2e and halves the width, so a position check on long text must wait for it,
  as `e2e/bodies.spec.ts` does. The `cancelled` result of a cancel during a large write has not been seen on
  screen: an IPC test proves the result, and it shares the "Not sent" path.
- **T1.8 in the editor:** the window check Cmd+clicks a URL once per view. Monaco finds links through its worker, after
  the body is drawn, so with links turned on a click can land before a link exists; the check caught a links-on,
  no-handler build in every run, but not in every content type. The packaged `.app`'s console cannot be read, so its
  CSP was checked on the Vite build only. A body that shows Pretty is formatted text, and text copied from it differs
  from the record; Raw shows the record, except a leading byte order mark, which the label notes.
- **T2.10:** an earlier open that fails after a later one has no test. The overlap test covers an earlier
  answer only.
- **T2.11:** no test waits out a real 30 s timeout, or runs a slow upload through `sendAndRecord`. A throwaway
  probe confirmed that the timer runs during an upload, on Node 22 and not Electron's Node 24. The added second
  per MiB assumes about 8 Mbit/s, so a slower link can record `timeout`.
- **T2.12:** a `Content-Type` typed last in lowercase looks generated, so Edit drops its row, and changing the body
  type then changes the header. Sending unchanged still sends the same bytes. Accepted by the author. A body in a file
  cannot be edited, except a multipart one, which Edit reads page by page into the renderer; renderer memory then holds
  the whole body (measured at 3 MiB in e2e).
- **Saved requests leave files behind:** saving over or deleting a saved request with content above 1 MiB leaves its
  GridFS files; nothing removes them until slice 7 (plan of `saved-requests-and-environments`, Out of scope).
- **Saved requests, a field or row over 16 MB:** the 1 MiB inline budget counts body text and file bytes only, so such
  a save fails with MongoDB's size error and leaves the files it wrote. Accepted (code review of
  `saved-requests-and-environments`, CR6).
- **Opening a saved request** returns all its content from main in one IPC answer and holds it in the renderer;
  checked at 17 MiB in e2e.
- **The environment a send uses** is the one its select shows, loaded by id in main. The stored active environment
  only decides what the select shows at startup; a failure to store it is shown and does not stop a send.
- **`e2e/saved-requests.spec.ts`'s overlap scenario** reads Electron's private `ipcMain._invokeHandlers` to wrap the
  real handler; an Electron upgrade can remove it.
- **Multipart, a file part's content type** is what the browser reports for the file, from its extension (`.bin` gives
  `application/macbinary`), and is recorded as sent. It cannot be edited.
- **Multipart, Edit of a stored body has no size limit:** the renderer allocates the whole body, so Edit of an upload
  near 1–2 GB can fail or crash the renderer. Accepted by the author (code review of `multipart-with-file-copies`, CR3).
- **Multipart, the parts list of a stored body** reads the whole file in main on every open, and the read runs to the
  end after the panel changes. Accepted (CR8).
- **Multipart, a file that cannot be read when picked** shows "Could not read <name>" in its row and leaves the part
  with no file. No test covers it: Playwright cannot make `File.arrayBuffer()` reject without patching the page, and the
  renderer has no unit layer. Accepted by the author (review of `multipart-with-file-copies`, F3).
- **Multipart, picking a file through the native dialog** is unverified: Playwright sets the files without opening it,
  and the manual check planned for it was not performed (accepted by the author, review of `multipart-with-file-copies`,
  F1).
- **T3.7:** exact replay sends the recorded token, expired or not. Offering a current one is still a
  PRD open question.

## Not a target
Coverage percentage is not tracked and is not a goal. Adequacy is judged per risk against this
document.

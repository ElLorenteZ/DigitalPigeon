---
produced-by: lz-test-strategy
updated: 2026-11-06
tiers: 8/11/8
revised: 2026-11-02 — test harness installed (change test-harness); gates verified; e2e target corrected to the production build output
revised: 2026-11-03 — change send-and-record covers T1.1, T1.2, T1.3, T1.6, T2.1, T2.2, T2.8 and part of T2.7; gates re-verified
revised: 2026-11-06 — change preview-replay-export moves T2.4 from unit to integration and covers it, completes T2.7, and extends T1.1, T1.2 and T1.3 to edit, replay and refused headers; gates re-verified
revised: 2026-11-06 — code review of preview-replay-export adds T2.9, T2.10, T2.11 and T3.8, narrows T3.2, and extends T1.2, T1.3 and T2.4 to refused header names, the Connection value and URL user information; gates re-verified
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
| T1.1 | A call record is overwritten or changed after it is written: a second send of the same unchanged request replaces the first (for example an upsert keyed by saved request), or edit-and-send modifies the original record. | integration | Immutability is a property of what MongoDB holds after the operation. Only a re-read from the real store observes it. | yes — `src/core/call-store.int.test.ts` (two identical sends list as two calls; upsert mutation caught), `src/core/send.int.test.ts` (same input sent twice), `src/core/replay.int.test.ts` (after a replay and after edit-and-send, `getCall(original)` is deep-equal to before) |
| T1.2 | A send completes but no call record is written, or the record is missing part of what the PRD requires: request as sent, status, response headers, full body, timing, timestamps, environment, source saved request. | integration | The send path crosses two real boundaries (HTTP and MongoDB). Tested against a local HTTP server on `127.0.0.1` and the test database. | yes, for bodiless requests — `src/core/send.int.test.ts` (status, headers, body bytes, timing; failed send insert → zero dispatches; failed completion insert → not-recorded error; a header undici would refuse, by its characters or by its name, leaves no send document and sends nothing). Bodies arrive in slice 3 |
| T1.3 | The recorded request, or an exact replay, differs from the bytes on the wire: `undici` adds or reorders headers, changes `content-length` or encoding, or the record is built from the editor model instead of the dispatched request. | integration | Defaults added by the HTTP client are visible only at the wire. A local server captures the raw request and the test compares it with the record and with the replay. | yes, for bodiless requests — `src/core/send.int.test.ts` (all 7 methods; send document equals what the capture server received; a typed `Connection` records the value undici writes; a user and password in the URL add no header; undici itself refuses the names and values `wire.ts` refuses) and `src/core/wire.test.ts`; `src/core/replay.int.test.ts` (all 7 methods; a replay's method, URL, raw headers and body equal the original's at the capture server). Bodies and multipart arrive in slices 3–4 |
| T1.4 | A recorded multipart call cannot be replayed after the uploaded file is deleted from disk, because no copy was stored. | integration | Needs a real file, its deletion, GridFS and a captured replay. | **gap** |
| T1.5 | A response or upload body over 16 MB fails to save or is truncated. | integration | The 16 MB limit and the GridFS threshold exist only in a real MongoDB. | **gap** |
| T1.6 | A send proceeds while the database is unreachable and the call is lost without the user being told. | integration | Requires a real failed connection (closed port or stopped container). The expected behaviour waits on the PRD open question on database-down behaviour; the test asserts whichever behaviour is decided, and in every case no send is silently unrecorded. | yes — behaviour decided: sending is blocked. `src/core/db-down.int.test.ts` (refused in under 5 s, never dispatched) |
| T1.7 | Single delete, bulk delete or a retention rule removes records it should not (filter too broad, wrong date boundary, wrong environment). Deletion is irreversible. | integration | The failure is the query matching the wrong documents in the real store. Tested by seeding records on both sides of each boundary and counting what remains. | **gap** |
| T1.8 | A response body runs script in the renderer (`<script>`, `<img onerror>`, SVG, HTML preview) because it was rendered as live HTML. | e2e | A render-only defect. Only a real Electron renderer with the production CSP shows whether script executes. Run against the production build output (`npm run test:e2e` builds first), because the CSP is injected into production builds only. | **gap** |

### Tier 2 — automated where cheap
| # | Risk | Layer | Why that layer | Covered? |
|---|---|---|---|---|
| T2.1 | Renderer and main disagree on an IPC message shape. | types | Both sides compile from one shared contract module in one bundle, so a mismatch is a compile error. `zod` validation in main handles malformed input at runtime and needs no separate test of its own. | yes — `src/shared/ipc-contract.ts`, checked by `tsc`; main validates every message with its schemas |
| T2.2 | A stored document of an older shape crashes the UI or is silently misread. | unit | `zod` schemas parse fixture documents of each `schemaVersion`. Pure; no database needed. | yes, for `schemaVersion: 1` — `src/core/call-schema.test.ts`; a failing stored document lists as an `unreadable` row (`call-store.int.test.ts`) |
| T2.3 | A history filter (environment, saved request, date range) or search (substring of URL or body, for example `/orders/12`) returns the wrong set of calls. | integration | Text-index tokenisation and the `$regex` fallback behave only in a real MongoDB. | **gap** |
| T2.4 | A curl export, run in a terminal, sends a different method, URL, headers or body (quoting, escaping, binary and multipart bodies). | integration | Only running curl shows what curl sends: curl globs URLs, treats `-H 'Name: '` as removing a header, and adds its own headers, and a string assertion sees none of that. Moved from unit in change `preview-replay-export`. Needs `curl` on `PATH`. | yes, for bodiless requests — `src/core/curl.int.test.ts` (all 7 methods through `sh -c`; bracket and brace URLs, empty values, duplicates, quoting, a user and password in the URL left out). Binary and multipart bodies arrive in slices 3–4 |
| T2.5 | Switching environment does not change the URL a saved request is sent to, or URL composition breaks (`baseUrl` + path slashes, query encoding). | unit | Pure function of environment and request. | **gap** |
| T2.6 | Pretty-printing JSON or XML changes the content, for example integers above 2^53 lose precision through `JSON.parse`. | unit | Pure transformation with known inputs. | **gap** |
| T2.7 | The journey send → appears in history → replay → new record appears is broken by the wiring between renderer, preload and main. | e2e | Each piece is tested below; only the assembled app shows that they connect. Two or three journeys, no assertions on stored document contents (those belong to integration). | yes — `e2e/send-and-record.spec.ts` (send → history), `e2e/replay.spec.ts` (open → replay → new row, original unchanged), `e2e/edit-and-export.spec.ts` (Edit, Copy call as curl, refused-header message) |
| T2.8 | The app fails at startup instead of retrying while `mongod` restarts after first initialisation. | unit | Retry logic tested with a fake connector that refuses N times. The real restart is timing-dependent and flaky to reproduce. | yes — `src/core/db-connection.test.ts` (retry within the bound, down after it with continued retries, heartbeat up/down) |
| T2.9 | An action's result opens out of view, so the action appears to do nothing: a call opened from a long history, Cancel during a replay, a replay's result, the form after Edit. | e2e | Render-only. A locator finds an element wherever it is, so only an explicit viewport assertion on a rendered page observes this. Found twice in `preview-replay-export`, by the author and by code review. | yes — `e2e/replay.spec.ts` (panel on open), `e2e/panel-actions.spec.ts` (Cancel, result below a tall form, form after Edit) |
| T2.10 | The panel shows or acts on a different call from the one last clicked, so Replay sends a real request to the wrong target: a failed open leaves the previous call live, or an earlier answer arrives after a later one. | e2e | The defect is in renderer state, which has no lower test layer. Failure and answer order are arranged by replacing the get-call handler in the launched app. | yes — `e2e/open-call-failures.spec.ts` |
| T2.11 | A send or replay to a server that never answers stays in flight far beyond the 30 s limit instead of recording `timeout`. | unit | The defaults are what can differ between paths, and a real 30 s wait is too slow for a gate. The test reads the values handed to undici. That a timeout records `timeout` is part of T1.2 (`send.int.test.ts`, with a short timeout). | yes — `src/core/send.test.ts` (a send and a replay) |

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

## Layer contract
| Layer | Tool | Owns | Does not touch |
|---|---|---|---|
| Types | `tsc` (strict, `noUncheckedIndexedAccess`) | Shapes inside the bundle, IPC contract at compile time | Anything at runtime: MongoDB documents, HTTP responses |
| Unit | Vitest, Node environment | Pure functions: wire request building and header refusal, form mapping, URL composition, formatting, `zod` schemas, retry logic; the options handed to undici, with undici mocked | MongoDB, network, Electron APIs |
| Integration | Vitest, Node environment; real MongoDB from `docker-compose.yml`, a throwaway `dp_test_*` database per test file from `openTestDb()` (dropped afterwards, never the history database); local HTTP server on `127.0.0.1`, ephemeral port | Main-process send, record, replay, store, GridFS, search, delete; curl export run through `sh -c` with the system curl | Electron APIs, the renderer |
| E2E | Playwright `_electron` (experimental API), launching Electron from `node_modules` on the production build output (`.vite/build`, `args: ['.']`). Not the packaged `.app`: its fuses disable the inspector Playwright attaches through. | Journeys across renderer, preload and main; render-only defects, including whether something is in the viewport; renderer state under failures arranged by replacing an IPC handler in the launched app | Stored document contents, logic reachable one layer down |
| Manual | — | Tier 3 | Anything in tier 1 |

Design consequence: integration tests run in plain Node, so main-process modules for sending,
recording and storage must not import `electron`. Electron-specific wiring stays in a thin IPC
layer that only e2e exercises.

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
| Types | `npm run typecheck` | 2026-11-06, exit 0 | every commit |
| Lint + format | `npm run lint` | 2026-11-06, exit 0 | every commit |
| Build | `npm run package` | 2026-11-06, exit 0 (run by `test:e2e`) | every commit touching main, preload or Vite config |
| Unit | `npm run test:unit` | 2026-11-06, exit 0 (130 tests) | tier 1 and 2 unit risks |
| Integration | `npm run test:integration` (requires `docker compose up -d` and `.env`; fails, never skips, when MongoDB is unreachable; `curl` on `PATH`) | 2026-11-06, exit 0 (112 tests) | tier 1, T2.4 |
| E2E | `npm run test:e2e` (runs `npm run package` first) | 2026-11-06, exit 0 (12 tests) | T1.8, T2.7, T2.9, T2.10 |

## Known gaps
Harness: change `test-harness` (`context/archive/test-harness/record.md`). Covered so far: changes
`send-and-record` and `preview-replay-export`, see the Covered column. e2e runs always use a
`dp_test_*` database through `test-support/e2e-database.ts`, so no run touches real history.

Uncovered, and where each is expected to be closed (`roadmap.md`):
- **T1.4** multipart replay after file deletion — slice 4.
- **T1.5** body over 16 MB — slice 3.
- **T1.7** delete and retention removing the wrong records — slice 7.
- **T1.8** response body executing as script — the first slice that renders a body in an editor
  or preview beyond plain text (slice 3). Today bodies are decoded into `<pre>` as text, in the
  response view and the call panel.
- **T2.3** history filters and search — slice 6.
- **T2.5** environment and `baseUrl` — slice 5.
- **T2.6** pretty-printing — slice 3.
- **T1.2, T1.3, T2.4** for request bodies — slices 3–4.

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
- **T2.4 holds for curl 8.7.1 on macOS and POSIX `sh`.** Other curl versions and shells are unverified.
- **Records from before the refusal** can hold non-ASCII values. Replay sends them as recorded (tested);
  curl refuses them (tested). A record holding a typed `Connection` other than `close` or `keep-alive`
  exports that literal value, which differs from what undici sent (not tested, accepted).
- **T2.9 covers the actions named there.** A new action that changes something out of view needs its own
  viewport assertion; no test covers the class. None of it has been checked in the packaged `.app`.
- **T2.10:** an earlier open that fails after a later one has no test. The overlap test covers an earlier
  answer only.
- **T2.11:** no test waits out a real 30 s timeout.
- **T3.7:** exact replay sends the recorded token, expired or not. Offering a current one is still a
  PRD open question.

## Not a target
Coverage percentage is not tracked and is not a goal. Adequacy is judged per risk against this
document.

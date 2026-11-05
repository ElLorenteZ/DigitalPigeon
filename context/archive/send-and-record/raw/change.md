---
change_id: send-and-record
title: Send a REST request from the app and record every send as its own call record
status: closed
ticket: null
created: 2026-11-03
updated: 2026-11-04
closed: 2026-11-04
produced-by: lz-change
---

## Intent

"commit and run /lz-change send-and-record" — opening slice 1 of M1 as cut in
`context/foundation/roadmap.md`:

> | 1 | Send and record | Type a method, URL, query params and headers (including a pasted auth
> header), send, see status, headers, body and timing; the call appears in a history list; sending
> twice shows two entries |

## Boundary

**This change covers:**
- Building a request in the renderer: method, URL, query parameters, headers (an auth token is a
  pasted header). No request body.
- Sending it from the main process through `undici`, and showing the response status, headers,
  body (as plain text) and timing.
- Writing every send as its own call record in MongoDB: the request as it went on the wire, the
  full response, timing and timestamps. Sending the same request twice gives two records.
- A history list of calls, newest first.
- The groundwork the slice needs and nothing later can show on its own (roadmap Order rationale):
  the typed IPC contract validated with `zod` in main, the call-record schema with a
  `schemaVersion`, the database connection with startup retry, the database name read from the
  environment so e2e uses a `dp_test_*` database, and the behaviour when MongoDB is not running.
- Tests for the risks this slice introduces, at the layers `test-strategy.md` assigns: T1.1 (two
  sends, two records; no overwrite), T1.2 (no send without a complete record), T1.3 (recorded
  request equals the wire), T1.6 (database down), T2.1 (IPC contract), T2.2 (schema version),
  T2.7 (send → appears in history), T2.8 (startup retry).

**Explicitly not in this change:**
- Opening a past call, exact replay, edit-and-send, curl export — slice 2 (`preview-replay-export`).
- Request bodies of any type, pretty-printing, Monaco editor, bodies over 16 MB and GridFS —
  slice 3.
- Multipart and file copies — slice 4.
- Saved requests, environments and `baseUrl` — slice 5. The URL is typed in full.
- Filtering or searching history — slice 6. The list is unfiltered.
- Deleting calls and retention rules — slice 7.
- Fixing the backup comment in `docker-compose.yml` — a separate fix.

## Notes

- **Blocking decision before planning:** what the app does when MongoDB is not running (PRD Open
  questions): block sending, send and warn that the call is not recorded, or start the container
  from the app. The PRD notes "Every send is recorded" points to blocking.
- Constraint carried from `context/archive/test-harness/record.md` §5: the app reads its database
  name from the environment before any e2e test sends or records.
- Code that sends, records or stores calls must not import `electron`, so integration tests run it
  in plain Node (`AGENTS.md`, `test-strategy.md` Layer contract).
- Status corrected at close: recorded `new`, artifacts showed `reviewing`.
- Outcome (2026-11-04): closed. All 5 plan phases done and verified in `progress.md` (TDD for core phases
  1–3, build for app wiring, e2e for the send → history journey). Review verdict `merge-with-fixes`:
  - F1–F3 fixed (e2e database helper moved to `test-support/`, smoke spec on a test database,
    `test-strategy.md` and `AGENTS.md` updated)
  - F4–F7 accepted
  - host code review: 9 of 10 findings fixed, including a tier-1 fragment/query record mismatch;
    #4 (bodies over 16 MB) accepted as slice 3

  Gates: unit 69, integration 38, e2e 3 (3 runs). Spike `spike-main-bundle.md` verified the packaged
  build. Branch `send-and-record`, not committed, merged or pushed.

---
change_id: send-and-record
produced-by: lz-e2e
plan: plan.md
updated: 2026-11-03
---

# Progress: Send a REST request from the app and record every send as its own call record

## Phase 1 — Call documents are insert-only and list back as calls, newest first, with in-flight and interrupted sends distinguished

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-03
- **Finished:** 2026-11-03

**Changed**
- `package.json` / `package-lock.json` — `zod` 4.6.7 added to `dependencies`.
- `src/core/call-schema.ts` — new. `SendDocSchema` and `CompletionDocSchema` (strict objects,
  `schemaVersion: 1`, string `_id`s, header lists as `[name, value]` tuples, request `body: null`,
  completion is a union of `response` (status, headers, `Uint8Array` body) or `error` (`timeout` |
  `cancelled` | `network`, message)). Types derived from the schemas.
- `src/core/call-store.ts` — new. `createCallStore(db)` returns exactly `insertSend`,
  `insertCompletion`, `listCalls(limit, inFlight)`. Inserts parse with the schema first and create
  indexes `sends.sentAt: -1` and `completions.sendId: 1` on first use. `listCalls` reads newest
  first with `promoteBuffers`, joins completions by `sendId`, and returns `completed`, `in-flight`,
  `interrupted`, or `unreadable` (with the zod error) per call.
- `src/core/call-schema.test.ts` — new, 10 unit tests (T2.2).
- `src/core/call-store.int.test.ts` — new, 8 integration tests (T1.1 store half).

**Cycles**
1. Schema tests first, against a `z.any()` stub: 7 failed with `expected [Function] to throw an
   error`; 3 passed (the valid-fixture cases, which the stub accepts; not seen red).
   Implementation: 10 passed.
2. Store tests first, against a stub returning `[]`: 6 failed (`expected [] to deeply equal [
   'a-2', 'a-1' ]`, `expected undefined to be 'completed'`, `expected undefined to be 'in-flight'`,
   `expected [] to have a length of 2 but got +0`, `expected undefined to match object { state:
   'unreadable', id: 'f-bad' }`, `expected undefined to be defined`); 1 passed (the "no update or
   delete" shape test, which the stub's three functions satisfy; not seen red).
   Implementation: 7 passed.
3. Index test first: 1 failed, `expected [ { _id: 1 } ] to deep equally contain { sentAt: -1 }`.
   Implementation: 8 passed.
4. Done-when mutation (reverted): `insertSend` changed to an upsert keyed by `request` → 6 failed,
   including `two sends of identical content list as two calls, newest first`.

**Verification**

```
$ npm run test:unit && npm run test:integration
unit exit 0
 Test Files  2 passed (2)
      Tests  24 passed (24)
integration exit 0
 Test Files  3 passed (3)
      Tests  19 passed (19)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
```

PASS — call documents are schema-validated on write and read, insert-only, listed newest first
with completed / in-flight / interrupted / unreadable states, and an upsert would be caught.

**Drift:** decision — the plan said "every document read is parsed with its schema" without saying
what happens on failure. The author chose (this session) to list a failing document as its own
`unreadable` row with the schema error, rather than failing the whole list or skipping it. `Call`
gained an `unreadable` variant; phase 4's history list must render it. Also: `promoteBuffers`
returns bodies as `Buffer`, a `Uint8Array` subclass, so phase 4 must convert to a plain
`Uint8Array` before crossing IPC or rely on structured clone doing it.

## Phase 2 — A request sent through the core reaches the wire exactly as its send document says, and every outcome (response, timeout, cancel, network error) is recorded

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-03
- **Finished:** 2026-11-03

**Changed**
- `package.json` / `package-lock.json` — `undici` 8.12.3 added to `dependencies`, exact.
- `src/core/wire.ts` — new. `buildWireRequest({ method, url, queryRows, headerRows })` returns the
  header list undici writes:
  1. `host`, lowercase: typed value or URL host
  2. `connection`, lowercase: typed value or `keep-alive`; always `close` for `HEAD`
  3. other typed headers, in order and case
  4. `content-length: 0` for `POST`, `PUT` and `PATCH`; a typed `Content-Length` is replaced

  Query rows are appended with `encodeURIComponent`, after an existing query with `&`.
- `src/core/send.ts` — new. `sendAndRecord(store, input, { signal, headersTimeoutMs = 30_000,
  bodyTimeoutMs = 30_000 })`:
  - inserts the send document, then dispatches with `undici.request`
  - records a response completion (status, lowercased header pairs, body bytes, duration), or an
    error completion (`timeout` for `UND_ERR_HEADERS_TIMEOUT` / `UND_ERR_BODY_TIMEOUT`,
    `cancelled` when the signal aborted, `network` otherwise)
  - throws `ResponseNotRecordedError` (carrying the completion) when the completion insert fails
- `src/core/wire.test.ts` — new, 19 unit tests.
- `src/core/send.int.test.ts` — new, 14 integration tests. T1.3 for `GET`, `HEAD`, `DELETE`,
  `OPTIONS`, `POST`, `PUT` and `PATCH`; T1.1; T1.2; refused → `network`; hang + 200 ms headers
  timeout → `timeout`; abort after 100 ms → `cancelled`; failed send insert → zero dispatches;
  failed completion insert → `ResponseNotRecordedError`.

**Cycles**
1. Wire tests first, against a stub returning no headers: 11 failed (e.g. `expected [] to deeply
   equal [ [ 'host', 'api.test:8080' ], …(1) ]`, `expected 'http://api.test/a?b=1' to be
   'http://api.test/a?b=1&c=2'`). 6 passed against the stub and were not seen red:
   - "no content-length" for `GET`, `HEAD`, `DELETE` and `OPTIONS`
   - "URL unchanged without rows"
   - "method kept"

   Implementation: 17 passed.
2. Send tests first, against a stub returning a fixed error completion: 13 failed on assertions
   (`expected undefined to be 'GET'`, …, `promise resolved … instead of rejecting`). 1 passed
   against the stub and was not seen red: the refused connection → `network`, because the stub
   hard-codes `network`. Implementation: 13 of 14 passed. `HEAD` failed:

   ```
   - "keep-alive",
   + "close",
   ```
3. Probe (undici 8.12.3, scratch script, deleted):
   - `HEAD` with `connection: keep-alive` and with `close` both went out as `connection: close`
   - `GET` and `POST` with `connection: close` kept it

   Two wire tests added for `HEAD` (default and typed `Connection`): 2 failed, `expected [
   'connection', 'keep-alive' ] to deeply equal [ 'connection', 'close' ]`. Rule implemented:
   wire 19 passed, send 14 passed.
4. Done-when mutations, each reverted (`cmp` confirmed both files byte-identical afterwards):
   - dispatching before the send insert → 1 failed (`a send whose send document cannot be
     inserted is never dispatched`)
   - recording `input.headerRows` instead of the wire headers → 7 failed (every T1.3 method)
   - removing the `content-length` rule → 7 failed (wire tests and T1.3 `POST`, `PUT`, `PATCH`)

**Verification**

```
$ npm run test:unit && npm run test:integration
unit exit 0
 Test Files  3 passed (3)
      Tests  43 passed (43)
integration exit 0
 Test Files  4 passed (4)
      Tests  33 passed (33)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ grep -rn "from 'electron'" src/core
no electron import in src/core
```

PASS — for all seven methods the send document equals what the capture server received; every
outcome is recorded; nothing is dispatched unrecorded; each mutation named in the plan is caught.

**Drift:**
- defect — the plan's wire contract said `connection` is `keep-alive` or the typed value for every
  method. undici 8.12.3 forces `connection: close` for `HEAD` (probe above). The contract now has a
  `HEAD` rule, and a typed `Connection` on `HEAD` is not honoured. The plan anticipated a defect of
  this kind for unprobed methods, so it was fixed forward inside phase 2. No other phase is
  affected.
- decision — the plan did not say what happens to a typed `Content-Length` on a bodiless request.
  It is replaced by the computed value (`0` for `POST`/`PUT`/`PATCH`, absent otherwise), because
  the request body is always empty in this slice. How undici handles a mismatched length was not
  tested.

## Phase 3 — The core resolves its database, retries on startup, and refuses to send while the database is down

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-03
- **Finished:** 2026-11-03

**Changed**
- `src/core/db-config.ts` — new.
  - `resolveDbConfig({ env, configPath, readFile })`:
    1. `MONGO_ROOT_USER` + `MONGO_ROOT_PASSWORD` from the environment when both are set
    2. otherwise `config.json` (`user`, `password`, optional `database`)
    3. `DP_MONGO_DB` overrides the database from either source; the default is `digital_pigeon`

    A missing file gives `not-configured` with `reason: 'missing'`; bad JSON or missing
    credentials give `reason: 'invalid'`. Both name the path.
  - `mongoUri(config)` URI-encodes the credentials, with `authSource=admin`.
  - `mongoClientOptions` sets `serverSelectionTimeoutMS: 2000` and `heartbeatFrequencyMS: 2000`.
- `src/core/db-connection.ts` — new. `createDbConnection({ connect, attemptsBeforeDown = 5,
  retryDelayMs = 1000, sleep })` exposes `start`, `status`, `client` and `stop`.
  - Status is `not-configured` without a connector, then `connecting`.
  - It becomes `up` on success, or `down` after the bound; retries continue after `down`.
  - Once connected it follows `serverHeartbeatFailed` / `serverHeartbeatSucceeded`.
- `src/core/send.ts` — `DatabaseUnavailableError` added; a failed send-document insert now rejects
  with it (message `Database unavailable: <cause>`), before anything is dispatched.
- `src/core/db-config.test.ts` (9), `src/core/db-connection.test.ts` (6) — new unit tests (T2.8 and
  config precedence).
- `src/core/db-down.int.test.ts` (1) — new integration test (T1.6), real driver against a closed
  port with `mongoClientOptions`.

**Cycles**
1. Config tests first, against a stub always returning `not-configured`: 9 failed (e.g. `expected
   { kind: 'not-configured', …(2) } to deeply equal { kind: 'configured', …(2) }`, `expected '' to
   be 'mongodb://a%40b:p%3A%2Fw@127.0.0.1:27…'`). Implementation: 9 passed.
2. Connection tests first, against a stub always `connecting`: 6 failed.
   - 5 failed on status assertions (e.g. `expected 'connecting' to be 'up'`).
   - 1 failed with `TypeError: release is not a function`. The stub never called `connect`, which
     is the behaviour that test checks.

   Implementation: 6 passed.
3. T1.6 first, against `mongoClientOptions = {}` and a `DatabaseUnavailableError` that was never
   thrown. It failed after 30 015 ms: `expected MongoTopologyClosedError … to be an instance of
   DatabaseUnavailableError`. This showed both missing behaviours: the default 30 s server
   selection, and no wrapping. Implementation: passed in 2.39 s, together with the 14 send tests.
4. Done-when mutation, reverted (`cmp` confirmed): dispatching before the send-document insert → T1.6
   failed, `expected [ { method: 'GET', url: '/', …(3) } ] to have a length of +0 but got 1`.

**Verification**

```
$ npm run test:unit && npm run test:integration
unit exit 0
 Test Files  5 passed (5)
      Tests  58 passed (58)
integration exit 0
 Test Files  5 passed (5)
      Tests  34 passed (34)
   Duration  2.34s
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ grep -rn "from 'electron'" src/core
no electron import in src/core
```

PASS — the database is resolved from env or file with `DP_MONGO_DB` override. Startup retries end
`up` or `down`, with recovery after `down`. Heartbeats move status. A send against an unreachable
database is refused in about 2 s and never dispatched.

**Drift:** decision — the plan said "bounded attempts" without saying what happens after the bound.
The author chose (this session) that after `attemptsBeforeDown` failures the status is `down` and
retries continue at `retryDelayMs`. Starting Docker later then brings the app up without a restart.

## Phase 4 — The app sends a request typed in the window and shows the response and a growing history list

- **Executor:** lz-tdd → routed to lz-build
- **Status:** in-progress

**Routed:** IPC handlers, preload bridge and renderer wiring, verified by observation. The
behaviour behind them is tested in phases 1–3, and the journey is phase 5 (lz-e2e). The plan
assigns this phase to lz-build; a test-first loop here would assert Electron's IPC. Run
`/lz-build send-and-record` to execute it.

Carried from earlier phases:
- The history list renders the `unreadable` state (phase 1 drift).
- Bodies cross IPC as plain `Uint8Array`, not `Buffer` (phase 1 drift).
- `HEAD` requests always show `connection: close` in the recorded request (phase 2 drift).

## Phase 4 — The app sends a request typed in the window and shows the response and a growing history list

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-03
- **Finished:** 2026-11-03

**Changed**
- `src/shared/ipc-contract.ts` — new. Channel names (`pigeon:send`, `pigeon:cancel`,
  `pigeon:list-calls`, `pigeon:db-status`) and zod schemas:
  - `SendInput`: `clientRequestId`, a method from the seven, an http(s) URL, query rows, header rows
  - `CallView`: reuses the core document schemas, plus the `unreadable` variant
  - `SendResult`: `ok`, or `database-unavailable` / `not-recorded` / `invalid-input` /
    `unexpected`
  - `DbStatusView`

  Also the `PigeonApi` type. Bodies are `Uint8Array`.
- `src/main/ipc.ts` — new. `registerIpc({ ipcMain, db, dbStatus })`:
  - validates input with the contract and refuses to send unless status is `up`
  - keeps an `AbortController` per `clientRequestId`, and the set of in-flight send ids from
    `onSent`
  - maps `ResponseNotRecordedError` and `DatabaseUnavailableError` to their result kinds
  - copies bodies to plain `Uint8Array`, and validates its output with the contract
- `src/main.ts` — resolves config from env, then `userData/config.json`, and creates
  `createDbConnection` with a `MongoClient` using `mongoClientOptions`. It registers the IPC
  handlers and stops the connection on quit. The window is 1100×800. The hardening flags
  (`contextIsolation`, `sandbox`, `nodeIntegration`) are unchanged.
- `src/preload.ts` — exposes `window.pigeon` with exactly `send`, `cancel`, `listCalls` and
  `dbStatus`.
- `src/renderer/app.tsx` — new.
  - **Form and controls:** method select, URL, query and header row editors, and a Send button
    that is disabled unless status is `up` and becomes Cancel while a send is in flight.
  - **Status line:** polled every 2 s; it shows the config path when not configured.
  - **Response view:** status, duration, headers, and the body as text via `TextDecoder`, never
    HTML. The error view covers `timeout`, `cancelled`, `network` and "Response received but NOT
    recorded".
  - **History list:** method, URL, outcome and time for every state, including `unreadable` and
    `in flight`. It re-fetches after each send and every 500 ms while a send is in flight.
- `src/renderer.tsx` — mounts `App`. `src/index.css` — layout and status colours.
- `src/core/send.ts` / `send.int.test.ts` — `onSent(send)` option, called after the send-document
  insert and before dispatch. The new integration test failed first (`expected undefined to be
  '4610f8bd-…'`) and then passed.

**Verification**

```
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:unit && npm run test:integration
      Tests  58 passed (58)
      Tests  35 passed (35)
$ npm run package
package exit 0
$ grep -c MongoClient / undici in .vite/build/preload.cjs and the renderer bundle
preload.cjs mongodb:0 undici:0 · index-*.js mongodb:0 undici:0
```

Observations, scripted with a throwaway Playwright spec (`.probe/`, deleted) against the built app
(`.vite/build`, `args: ['.']`). It used env credentials, `DP_MONGO_DB=dp_test_…` (dropped
afterwards), a capture server, and a local TCP server that never responds:

```
OBSERVE status: Database: up (dp_test_1793736147213_ed9807a3)
OBSERVE send 1: 201 · 8 ms | body {"ok":true} | history rows 1
OBSERVE send 2: history rows 2: ["GET http://127.0.0.1:56650/orders — 201 · …","GET http://127.0.0.1:56650/orders — 201 · …"]
OBSERVE capture received headers: ["host","127.0.0.1:56650","connection","keep-alive","X-Zeta","1"]
OBSERVE in flight row visible
OBSERVE cancel: cancelled: This operation was aborted (802 ms) | first row: GET http://127.0.0.1:56651/hang — cancelled · …
OBSERVE mongo stopped: status down after 183 ms; Send disabled=true
OBSERVE mongo started: status up after 1795 ms; Send disabled=false
OBSERVE dropped dp_test_1793736147213_ed9807a3
  1 passed (5.4s)
```

Packaged app, observed by the author: `config.json` was written to
`~/Library/Application Support/DigitalPigeon/` (mode 600, user and password from `.env`, default
database `digital_pigeon`). The author opened `out/DigitalPigeon-darwin-arm64/DigitalPigeon.app`
(built 21:02), sent `GET https://example.com`, and reported: "I see exactly what you described".
That is the status line "Database: up (digital_pigeon)", `200 · N ms`, the headers, the HTML as
plain text, and one history row.

PASS — the app sends a typed request, shows the response, records it, and grows history. Cancel
and database-down behave as planned, in the built output and the packaged app.

**Drift:**
- decision — the first observation run failed: `li[data-state="in-flight"]` was expected to number
  1 and numbered 0. The renderer re-fetched history immediately on Send, before main had inserted
  the send document. It now re-fetches every 500 ms while a send is in flight; the plan said only
  "re-fetched after each send completes or fails".
- decision — `sendAndRecord` gained an `onSent` option (`src/core/send.ts`, a file outside this
  phase's list), because main needs the send id while the request runs in order to mark it
  in flight. It is covered by a new integration test.
- decision — the plan's `npm start` and `docker compose stop` observations were made by script
  against the built output, not by eye under `npm start`. Only the packaged-app observation was
  made by a person. Dev mode (`npm start`) itself was not observed in this phase.
- One real call to `https://example.com` is now in the `digital_pigeon` history database (the
  author's packaged-app check).

## Phase 5 — The send → history journey holds in the built app, against a test database

- **Executor:** lz-build → routed to lz-e2e
- **Status:** in-progress

**Routed:** the journey across renderer, preload and main is the e2e layer's risk (test-strategy
T2.7); the plan assigns it to lz-e2e. Run `/lz-e2e send-and-record`. The phase 4 observation script
is a usable starting point for selectors (`getByLabel('URL')`, `getByTestId('history')`,
`data-state` on rows); the spec must drop its `dp_test_*` database through `assertTestDbName`.

## Phase 5 — The send → history journey holds in the built app, against a test database

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-03
- **Finished:** 2026-11-03

**Risk:** a user sends a request and sees the response, but the call never appears in history, or a
second send replaces the first row, because the renderer–preload–main wiring breaks. This is
test-strategy T2.7, assigned to e2e. Each piece is tested below: store and wire in phases 1–2, and
database handling in phase 3. Only the assembled app can show they connect.

**Gate:** only T2.7 passed the gate. Not written as e2e:
- the cancel and database-down UI, observed by script in phase 4. The plan names no e2e risk for
  them; cancel recording is covered by `send.int.test.ts` and T1.6 by `db-down.int.test.ts`.

**Changed**
- `e2e/support.ts` — new. `launchWithTestDatabase()`:
  - reads `MONGO_ROOT_USER` and `MONGO_ROOT_PASSWORD` from `.env` and generates a `dp_test_*` name
  - launches with `args: ['.']` and those plus `DP_MONGO_DB` in the environment, which beats
    `config.json`
  - selects the app window by URL, polled
  - `close()` closes the app and drops the database through `assertTestDbName`
- `e2e/send-and-record.spec.ts` — new, 1 scenario. The capture server answers `201` with
  `{"id":7}`. The scenario waits for the status line to show `up (<test db>)` and for history to be
  empty. It fills the URL and an `Authorization` header, then presses Send and expects
  `response-status` to contain `201`, `response-body` to equal `{"id":7}`, and one history row
  reading `GET <url>/orders — 201`. It presses Send again and expects two such rows. Selectors:
  `getByLabel`, `getByRole('button' | 'listitem')`, and `data-testid` where no role fits. It never
  waits on a duration.

**Proof the scenario can fail**
The behaviour already existed, so the scenario was broken deliberately. With `await
refreshHistory()` removed from the renderer's post-send `finally` and the app rebuilt:

```
  ✘  1 e2e/send-and-record.spec.ts:29:5 › each send shows its response and adds its own row to history (5.3s)
    Error: expect(locator).toHaveCount(expected) failed
    Expected: 1
    Received: 0
```

The renderer was restored (`cmp` byte-identical) and the app rebuilt.

**Verification**

```
$ npm run test:e2e                       (run 1, fresh package)
  ✓  1 e2e/send-and-record.spec.ts:29:5 › each send shows its response and adds its own row to history (678ms)
  ✓  2 e2e/smoke.spec.ts:39:5 › the app window renders the React root (369ms)
  ✓  3 e2e/smoke.spec.ts:44:5 › the production build carries a Content-Security-Policy meta tag (4ms)
  3 passed (5.6s)
$ npx playwright test e2e/send-and-record.spec.ts   (runs 2 and 3, same build)
  1 passed (1.8s)
  1 passed (1.9s)
$ npm run test:e2e                       (run 4, rebuilt after the mutation was reverted)
  3 passed (3.6s)
$ listDatabases after all runs, including the failed mutation run
[ 'admin', 'config', 'digital_pigeon', 'local' ]
$ npm run typecheck && npm run lint
typecheck 0
lint 0
```

PASS — 4 clean runs (3 on one build). The scenario fails when history is not re-fetched after a
send, and every run, including the failing one, removed its test database.

**Drift:** none against the plan.
- `e2e/smoke.spec.ts` launches the app without `DP_MONGO_DB`. Since phase 4 the app connects at
  startup using `config.json`, so the smoke spec now connects to the real `digital_pigeon`
  database and lists history; it never sends.
- Making it use `launchWithTestDatabase()` would keep every e2e run away from real history. That
  change is outside this phase's file list and is noted for review.

## Phase 5 — The send → history journey holds in the built app, against a test database

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-03
- **Finished:** 2026-11-03

Follow-up to review findings F1 and F2 (`review.md`, both fix now). The earlier Phase 5 section
stands; this section records the changes.

**Changed**
- `test-support/e2e-database.ts` — new. `createE2eDatabase()` reads the credentials from `.env`,
  generates a `dp_test_*` name through the guard, and returns `{ database, env: { MONGO_ROOT_USER,
  MONGO_ROOT_PASSWORD, DP_MONGO_DB }, drop }`. `drop` goes through `assertTestDbName`. (F1: the
  `mongodb` import moves to `test-support/`, which `AGENTS.md` allows.)
- `e2e/support.ts` — rewritten. `launchWithTestDatabase()` launches with `{ ...process.env,
  ...db.env }` and drops the database on `close()`. It no longer imports `mongodb`.
- `e2e/smoke.spec.ts` — rewritten to launch through `launchWithTestDatabase()`, so it no longer
  connects to `digital_pigeon` (F2). Same two assertions.

**Verification**

```
$ grep -rln "from 'mongodb'\|from 'undici'" e2e
none
$ grep -rn "electron.launch" e2e
e2e/support.ts:22:  const app = await electron.launch({
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:e2e                       (run 1, fresh package)
  ✓  1 e2e/send-and-record.spec.ts:29:5 › each send shows its response and adds its own row to history (518ms)
  ✓  2 e2e/smoke.spec.ts:16:5 › the app window renders the React root (23ms)
  ✓  3 e2e/smoke.spec.ts:20:5 › the production build carries a Content-Security-Policy meta tag (6ms)
  3 passed (3.5s)
$ npx playwright test                    (runs 2 and 3, same build)
  3 passed (3.2s)
  3 passed (3.3s)
$ npm run test:unit && npm run test:integration
      Tests  58 passed (58)
      Tests  35 passed (35)
$ listDatabases after the runs
[ 'admin', 'config', 'digital_pigeon', 'local' ]
```

PASS — no e2e file imports the driver; the only app launch goes through the test-database helper;
the suite ran 3× clean and left no `dp_test_*` database.

**Drift:** none — changes match the dispositions of F1 and F2 in `review.md`.

## Phase 1 — Call documents are insert-only and list back as calls, newest first, with in-flight and interrupted sends distinguished

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-04
- **Finished:** 2026-11-04

Follow-up to host code review findings #8 and #9 (`review.md`, Host code review). Earlier Phase 1
sections stand.

**Changed**
- `src/core/call-schema.ts` — `CompletionSummarySchema` / `CompletionSummary`: a completion whose
  response has no `body`.
- `src/core/call-store.ts`:
  - `ensureIndexes` resets its cached promise when index creation rejects, so the next insert
    retries it (#8).
  - `listCalls(limit, inFlight, { includeBodies = false })` projects out `response.body` unless
    asked, and parses rows with the summary schema (#9).
- `src/core/call-store.test.ts` — new unit test with a fake `Db` whose first `createIndex` rejects.
- `src/core/call-store.int.test.ts` — new test: history rows carry status and no body. The
  existing body read-back test now passes `{ includeBodies: true }`.

**Cycles**
1. Index retry: red with `Error: not primary`, because the second insert re-threw the first
   insert's cached rejection. Green after the reset.
2. Body-less rows: red with `expected true to be false` (`'body' in response`). Green with the
   projection and summary schema.

## Phase 2 — A request sent through the core reaches the wire exactly as its send document says, and every outcome (response, timeout, cancel, network error) is recorded

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-04
- **Finished:** 2026-11-04

Follow-up to host code review findings #1, #5 and #7. Earlier Phase 2 sections stand.

**Changed**
- `src/core/wire.ts` — `withQuery` builds on `URL`: the fragment is dropped (never sent), query rows
  are appended to the real query string, spaces stay `%20` (#1).
- `src/core/send.ts`:
  - Only a `MongoError` from `insertSend` becomes `DatabaseUnavailableError`; other errors, such
    as a schema error, surface as themselves (#5).
  - `classifySendError` is exported, and `UND_ERR_CONNECT_TIMEOUT` maps to `timeout` (#7).
- `src/core/wire.test.ts` — 3 fragment cases.
- `src/core/send.int.test.ts`:
  - every T1.3 case now also asserts the recorded URL equals origin + the received path and query
  - new T1.3 case for a URL with `#top` and a query row
  - new case: a schema error from `insertSend` is not database-unavailable and dispatches nothing
- `src/core/send.test.ts` — new, 6 unit tests for `classifySendError`.

**Cycles**
1. #1 confirmed before the fix: `https://api.x/items#top` with row `page=2` recorded
   `…/items#top?page=2` while `/items` was sent. Red: 3 wire tests (`expected
   'https://api.test/items#top?page=2' to be 'https://api.test/items?page=2'`, …) and the T1.3 case
   (`expected '/orders' to be '/orders?page=2'`). The earlier T1.3 tests compared only path+query,
   which is why they missed it. Green: wire 22, send 16.
2. #5 red: `expected Error: Database unavailable: [ … ] …`. #7 red: `UND_ERR_CONNECT_TIMEOUT is
   timeout`, `expected 'network' to be 'timeout'`. Green: send unit 6, send and db-down
   integration 18 (T1.6 still wraps the real driver error).

## Phase 3 — The core resolves its database, retries on startup, and refuses to send while the database is down

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-04
- **Finished:** 2026-11-04

Follow-up to host code review finding #6. Earlier Phase 3 section stands.

**Changed**
- `src/core/db-connection.ts` — if `stop()` was called while `connect()` was pending, the client
  that connects afterwards is closed and not kept; the status does not become `up`.
- `src/core/db-connection.test.ts` — new test. Red: `expected +0 to be 1` (close count). Green:
  7 passed.

## Phase 4 — The app sends a request typed in the window and shows the response and a growing history list

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-04
- **Finished:** 2026-11-04

Follow-up to host code review findings #2, #3, #8 (IPC half) and #9 (contract half). Earlier
Phase 4 sections stand.

**Changed**
- `src/shared/ipc-contract.ts` — `CallView` completions are `CompletionSummary` (no body). New
  `ListCallsResult` (`{ ok: true, calls }` | `{ ok: false, message }`). `SendResult` success
  carries `send` and the full `completion` instead of a `CallView`.
- `src/main/ipc.ts` — one call store per connected `Db` (a `WeakMap`), so index creation runs once
  (#8). `listCalls` catches query failures and returns `{ ok: false, message }` (#3). History rows
  are built without bodies.
- `src/renderer/app.tsx` — `send` catches a rejected invoke and shows it as `unexpected` (#2).
  `refreshHistory` never rejects; a failure is shown as "History could not be loaded: …" above the
  list (#3). The result view reads the full completion from `SendResult`.

**Not exercised:** the failure branches of #2 and #3 (a rejected invoke, and a query failing while
status is still `up`) have no automated test and were not observed. The success paths ran in the
e2e journey below. #8's per-`Db` caching was checked by reading the code only.

## Phase 5 — The send → history journey holds in the built app, against a test database

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-04
- **Finished:** 2026-11-04

Follow-up to host code review finding #10. Earlier Phase 5 sections stand.

**Changed**
- `test-support/e2e-database.ts` — `.env` is parsed with `node:util` `parseEnv`, the same parser
  `process.loadEnvFile` uses. Checked: `parseEnv('A="q v"\r\nB=x\r\n  C=y\n')` →
  `{"A":"q v","B":"x","C":"y"}`.

**Verification (all code review fixes, run together)**

```
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:unit
 Tests 69 passed (69)
$ npm run test:integration
 Tests 38 passed (38)
$ npm run test:e2e                       (run 1, fresh package)
  ✓  1 e2e/send-and-record.spec.ts:29:5 › each send shows its response and adds its own row to history (360ms)
  ✓  2 e2e/smoke.spec.ts:16:5 › the app window renders the React root (25ms)
  ✓  3 e2e/smoke.spec.ts:20:5 › the production build carries a Content-Security-Policy meta tag (11ms)
  3 passed (5.7s)
$ npx playwright test                    (runs 2 and 3)
  3 passed (3.3s)
  3 passed (5.2s)
$ listDatabases
[ 'admin', 'config', 'digital_pigeon', 'local' ]
```

PASS — the nine fixed findings each have a red-then-green test or (for #2, #3, #8) a stated reason
they are verified by type and journey only.

**Drift:** decision — host code review findings fixed after `review.md` was written; the IPC
contract changed shape (`SendResult`, `ListCallsResult`, body-less history rows). Finding #4
(bodies over 16 MB) was not fixed: it is plan Out of scope, GridFS arrives in slice 3.

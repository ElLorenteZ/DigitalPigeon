---
change_id: send-and-record
status: draft
produced-by: lz-plan
created: 2026-11-03
updated: 2026-11-03
inputs: [change.md, spike-main-bundle.md, plan review 2026-11-03, foundation/prd.md, foundation/tech-stack.md, foundation/test-strategy.md, foundation/roadmap.md, foundation/lessons.md, archive/test-harness/record.md]
---

# Plan: Send a REST request from the app and record every send as its own call record

## Approach

The core lives in `src/core/`, plain TypeScript with no `electron` import, so integration tests run
it in Node against the Compose MongoDB and the capture server (`AGENTS.md`; test-strategy Layer
contract). The core has three parts:
- `call-store` writes and reads call documents.
- `send` turns a request into wire bytes, records it and dispatches it.
- `db` resolves configuration and connects with retry.

`src/main/` is the thin Electron layer: IPC handlers validated with `zod` against a shared contract
in `src/shared/`, plus `src/preload.ts` exposing a named API. The renderer gets a request form, a
plain-text response view, a history list and a database status indicator.

A call is two insert-only documents (author decision, this session):
- A **send** document is written *before* the request goes on the wire. It holds the request
  exactly as it will be sent.
- A **completion** document, linked by the send document's `_id`, holds the response or the error,
  with timing.

Nothing updates either document. A send with no completion is one of two states:
- **In flight:** the main process holds the set of send ids whose requests are still running, and
  `listCalls` marks those.
- **Interrupted:** any other send with no completion. This covers a crash mid-request, and a
  completion insert that failed after the response arrived. In the second case the `send` call
  returns a distinct error, "response received but not recorded", and the renderer shows it with
  the response.

**Wire contract.** undici 8.12.3 normalises headers: it writes `host` in lowercase, adds
`connection: keep-alive`, and adds `content-length: 0` to a bodiless `POST` (plan review probe,
2026-11-03). So the core builds the exact header list undici will write, and the send document
records that list:
1. `host`, lowercase, valued from the URL, or from a user-typed `Host` header. That header's case
   is not preserved.
2. `connection`, lowercase: `keep-alive`, or the value of a user-typed `Connection` header.
3. The user's other headers, in their order and case.
4. `content-length: 0` for `POST`, `PUT` and `PATCH`.

When the list is passed in this form, the wire matched it exactly in the probe. The T1.3
integration test compares the capture server's view of each method against the send document. A
change in undici's normalisation (for example on upgrade) fails that test.

**URL.** The typed URL is sent as typed, including any query string it already has. Query parameter
rows are appended after it in row order, with names and values encoded by `encodeURIComponent`
(space becomes `%20`).

**Timeouts and cancel** (author decision, this session):
- Headers and body each time out after 30 s.
- A Cancel button aborts the send in flight.

A timeout, a cancel and a network error each produce an error completion with a distinct code
(`timeout`, `cancelled`, `network`). The timeouts are parameters of the core, so tests use short
ones.

Sending is blocked when MongoDB is unreachable (author decision, this session):
- If the send document cannot be inserted, nothing is dispatched.
- The core's client uses `serverSelectionTimeoutMS: 2000`, so an insert against a database that just
  went down fails within about 2 s, not the driver's default 30 s.
- After startup, database status follows the driver's server heartbeat events, since the driver
  reconnects by itself. The renderer polls `dbStatus` every 2 s and disables Send unless it is `up`.

Configuration is resolved in this order:
1. Environment variables: `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`, `DP_MONGO_DB`.
2. `config.json` in Electron's `userData` directory (author decision, this session), because a
   Finder-launched packaged app has no shell environment and no repo `.env`.

The database name defaults to `digital_pigeon`. e2e sets `DP_MONGO_DB` to a `dp_test_*` name
(constraint from `archive/test-harness/record.md` §5).

Response bodies cross IPC as `Uint8Array`, not `Buffer`. The sandboxed renderer has no Node
`Buffer`, and structured clone turns a `Buffer` into a `Uint8Array` anyway. Response headers are
recorded as undici reports them: a lowercased object, which keeps the arrival order of distinct
names. The PRD asks for "response headers", not their case. undici 8's handler API does not expose
raw response header pairs.

`undici` is pinned from npm (8.12.3), not taken from the runtime. Electron 45.2.1 runs Node 24.22.1
and tests run under Node 22.22.2, so a pinned package is the only way both run the same HTTP client.
undici 8.12.3 requires Node ≥22.19.0, which both satisfy.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| One record written once, after completion | Author chose send + completion: a crash mid-request would leave no trace of a send that reached the wire. |
| Pending document updated in place on completion | An update path on call data contradicts T1.1 (no overwrite) and makes immutability depend on discipline rather than on the store having no update function. |
| Record the request as composed and trust undici not to change it | Probe, 2026-11-03: undici lowercased `Host`, added `connection: keep-alive`, and added `content-length: 0` to `POST`. The record would claim bytes that were not sent (T1.3). |
| Record the header block from the `undici:client:sendHeaders` diagnostics channel | It omits `content-length` (probe, 2026-11-03), and it arrives after the bytes are written, so it cannot be the record written before sending. |
| Capture the request bytes on a raw socket inside the app | Needs a hand-written HTTP serializer or a proxy between undici and the network; the normalisation contract plus the T1.3 test covers the same risk. |
| Record response headers in received case and order | undici 8's `request()` and handler API (`onResponseStart`) give only a lowercased object (probe, 2026-11-03); the PRD asks for "response headers". |
| Renderer `fetch` | CORS and the browser's forbidden-header rules change what is sent (`tech-stack.md`). |
| Credentials from the environment only | A Finder-launched packaged app has no shell environment (author decision, this session). |
| Pointing the app at the repo `.env` | Couples the installed app to where the repo lives. |
| Starting the Mongo container from the app when it is down | Rejected by the author this session; `infrastructure.md` already deferred it. |
| Undici bundled in the runtime (`process.versions.undici`) | Node 22 ships undici 6.24.1 and Electron's Node 24 ships a different one; tests would exercise a different client than the app. |
| Main pushes "history changed" events to the renderer | One window, one sender: the renderer re-fetches the list after each send. Push adds an IPC direction for no observable gain in this slice. |

## Out of scope

- Request bodies. Every request in this slice has an empty body; `Content-Length` handling for
  bodies arrives with slice 3. `GET`, `HEAD`, `DELETE`, `OPTIONS` and bodiless `POST`/`PUT`/`PATCH`
  are sendable.
- Showing or opening a single past call beyond its history row (status, method, URL, time). Opening
  a call is slice 2.
- Response bodies over 16 MB. The completion document stores the body inline; GridFS is slice 3.
  A response that would exceed the limit fails to record and shows an error. Recorded as a known
  gap, not handled here.
- Following redirects. undici does not follow by default; a 3xx is recorded as received.
- A config-file editor in the UI. When `config.json` is missing the status indicator shows its path.
- Updating `AGENTS.md` with the config-file location and the new structure. That is `/lz-onboard`
  after this change.
- Preserving the case of a user-typed `Host` header. undici always writes `host`, and the record
  shows `host`.
- Several sends in flight from one window. The form has one send in flight at a time: Send becomes
  Cancel until it completes.
- Proxy, TLS options, client certificates (later milestone).
- MongoDB driver features whose optional modules are not bundled: Kerberos, `zstd`/`snappy`
  compression, client-side field-level encryption, AWS/GCP authentication, SOCKS proxying. They
  fail with `MongoMissingDependencyError` in the packaged app (`spike-main-bundle.md`).

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | `mongodb` 7.8 and `undici` 8.12.3 bundle into the Forge Vite main build (`.vite/build/main.cjs`) and run in the packaged Electron 45 app. The driver's optional peers (`kerberos`, `snappy`, `@mongodb-js/zstd`, `mongodb-client-encryption`, `aws4`, `socks`, `gcp-metadata`) are not resolvable at build time. | Phases 4–5 cannot run the app with storage. | yes — **verified 2026-11-03** (`spike-main-bundle.md`): default Forge Vite config; packaged app connected, inserted, read, dropped and sent `undici.request`. Vite 8 stubs the optional peers to throw only when called; the driver catches them. |
| A2 | Passed a header list in the wire-contract form (`host` and `connection` lowercase first, user headers in order and case, `content-length: 0` for `POST`/`PUT`/`PATCH`), undici 8.12.3 writes exactly that list. | T1.3 fails and phase 2 stalls. | yes — **verified for `GET`, `DELETE`, `POST`** (plan review probe, 2026-11-03). The original form of A2 (explicit headers, nothing added) was **false**. `PUT`, `PATCH`, `HEAD` and `OPTIONS` are covered by phase 2's T1.3 cases. |
| A3 | undici 8 reports a headers or body timeout and an `AbortSignal` abort as distinguishable errors (`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, an abort error). | The `timeout` and `cancelled` codes collapse into `network`; phase 2's tests show it. | no |
| A4 | Same undici version behaves the same under Node 22 (tests) and Node 24 (Electron). | A wire difference appears only in the app. Phase 5's e2e journey uses the capture server, so it would show. | no |
| A5 | `app.getPath('userData')` is `~/Library/Application Support/DigitalPigeon` when launched as `npm start`, the packaged app and e2e (`args: ['.']`). | The config file is looked for elsewhere; the status indicator shows the path, so it is visible. | no |

A1 was settled by `/lz-spike`, and A2 by the plan review's probe in its corrected form. No load-bearing
assumption is unverified. If a T1.3 case for an unprobed method fails, phase 2 records a defect
drift.

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | Call documents are insert-only and list back as calls, newest first, with in-flight and interrupted sends distinguished | `src/core/call-schema.ts`, `src/core/call-store.ts`, tests beside them, `package.json` (`zod`) | lz-tdd | `npm run test:unit`, `npm run test:integration` |
| 2 | A request sent through the core reaches the wire exactly as its send document says, and every outcome (response, timeout, cancel, network error) is recorded | `src/core/send.ts`, `src/core/wire.ts`, tests beside them, `package.json` (`undici`) | lz-tdd | `npm run test:unit`, `npm run test:integration` (T1.1–T1.3 cases) |
| 3 | The core resolves its database, retries on startup, and refuses to send while the database is down | `src/core/db-config.ts`, `src/core/db-connection.ts`, tests beside them | lz-tdd | `npm run test:unit` (T2.8), `npm run test:integration` (T1.6) |
| 4 | The app sends a request typed in the window and shows the response and a growing history list | `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer.tsx`, renderer components | lz-build | `npm run typecheck`; `npm start` observation; packaged-app observation |
| 5 | The send → history journey holds in the built app, against a test database | `e2e/send-and-record.spec.ts`, `e2e/` helpers | lz-e2e | `npm run test:e2e` |

### Phase 1 — Call documents are insert-only and list back as calls

**Changes:**
- `package.json`: add `zod` (4.x) as a dependency.
- `src/core/call-schema.ts`: `zod` schemas for the send document (`schemaVersion: 1`, `_id`,
  `sentAt`, `request: { method, url, headers: [name, value][] , body: null }`) and the completion
  document (`schemaVersion: 1`, `sendId`, `completedAt`, `durationMs`, and either
  `response: { status, headers: [name, value][] (lowercased, as undici reports), body: bytes }` or
  `error: { code: 'timeout' | 'cancelled' | 'network', message }`). Types derived from the schemas;
  bodies typed as `Uint8Array`.
- `src/core/call-store.ts`: `insertSend`, `insertCompletion`, `listCalls(limit, inFlightIds)`, reading
  both collections and joining in the store, newest `sentAt` first. A send with no completion appears
  with `state: 'in-flight'` when its id is in `inFlightIds`, otherwise `state: 'interrupted'`. Every
  document read is parsed with its schema. No update or delete function exists. Indexes on
  `sentAt` and `sendId` are created on first use.
- Unit (`call-schema.test.ts`, T2.2): a v1 fixture parses; a document with an unknown
  `schemaVersion` or missing field is rejected with a schema error.
- Integration (`call-store.int.test.ts`, T1.1 store half): two sends of identical content produce two
  listed calls with distinct `_id` and `sentAt`; completion attaches to the right send; a send with
  no completion lists as in-flight when its id is passed and interrupted otherwise; the store
  module exports no update or delete.

**Verification:**
```
$ npm run test:unit && npm run test:integration
expected: exit 0; call-schema and call-store tests listed and passing
```

**Done when:** both commands exit 0, and making `insertSend` upsert by request content makes the T1.1
test fail.

**Executor:** lz-tdd — decidable store behaviour, specified as cases before the code.

### Phase 2 — A request reaches the wire exactly as its send document says

**Changes:**
- `package.json`: add `undici` 8.12.3 (exact) as a dependency.
- `src/core/wire.ts`: pure function from `{ method, url, queryRows, headerRows }` to the wire request
  `{ method, url, headers: [name, value][] }` per the wire contract in Approach. Unit tests
  (`wire.test.ts`): host from URL and from a typed `Host`; `connection` default and typed; user
  header order and case kept; `content-length: 0` only for `POST`/`PUT`/`PATCH`; query rows
  appended after an existing query with `%20` for spaces.
- `src/core/send.ts`: `sendAndRecord(store, input, { signal, headersTimeoutMs = 30_000,
  bodyTimeoutMs = 30_000 })`:
  - Builds the wire request with `wire.ts` and inserts the send document.
  - Only after that insert succeeds, dispatches with `undici.request`, passing the wire headers as
    a flat list.
  - On a response, reads the full body and inserts a completion with status, headers, body bytes
    and duration.
  - On a timeout, an abort or a network error, inserts a completion with `timeout`, `cancelled` or
    `network`.
  - If the completion insert fails, rejects with a "response received but not recorded" error
    that carries the response.
  - Returns the joined call.
- `src/core/send.int.test.ts` against the capture server and a test database:
  - T1.3: for each of `GET`, `HEAD`, `DELETE`, `OPTIONS`, `POST`, `PUT`, `PATCH`, the capture
    server's method, path and query, header names and values in order and case, and empty body
    equal the send document's `request`.
  - T1.1: the same input sent twice gives two sends and two completions.
  - T1.2: a completed call has status, response headers, body bytes, `durationMs`, `sentAt`,
    `completedAt`.
  - A refused connection (closed port) is recorded with a `network` error completion.
  - A server that accepts and never responds (a test-local `net` server), with
    `headersTimeoutMs: 200`, is recorded with a `timeout` completion.
  - Aborting the signal while that server hangs is recorded with a `cancelled` completion.
  - A send whose send-document insert fails reaches the capture server zero times.

**Verification:**
```
$ npm run test:unit && npm run test:integration
expected: exit 0; wire and send tests listed and passing
```

**Done when:** all send tests pass. Each of these mutations must make a test fail:
- dispatching before the send-document insert
- recording the input headers instead of the built wire headers
- dropping the `content-length` rule

**Executor:** lz-tdd — the wire contract is specifiable as cases against the capture server.

### Phase 3 — The core resolves its database, retries, and refuses to send while it is down

**Changes:**
- `src/core/db-config.ts`: resolves `{ user, password, database, host: 127.0.0.1, port: 27017 }`
  from environment first, then a `config.json` at a path passed in (the main process passes
  `userData`); `database` defaults to `digital_pigeon`; a missing or invalid file yields a typed
  "not configured" result naming the path. Pure apart from reading the file.
- `src/core/db-connection.ts`:
  - Connects with retry (bounded attempts, delay between them), using
    `serverSelectionTimeoutMS: 2000`.
  - Exposes `status(): 'connecting' | 'up' | 'down' | 'not-configured'`.
  - After startup, status follows the driver's server heartbeat succeeded and failed events.
- Unit (T2.8): with a fake connector refusing N times then succeeding, connection ends `up` after N
  retries; refusing past the bound ends `down`; heartbeat-failed then heartbeat-succeeded events
  move status `up` → `down` → `up`. Config precedence and default cases.
- Integration (T1.6): with the database unreachable (client pointed at a closed port), `sendAndRecord`
  rejects with a database-unavailable error within 5 s and the capture server receives zero
  requests.

**Verification:**
```
$ npm run test:unit && npm run test:integration
expected: exit 0; db-config, db-connection and T1.6 tests passing
```

**Done when:** both pass, and removing the "insert before dispatch" ordering makes T1.6 fail.

**Executor:** lz-tdd — retry and precedence are pure logic with cases; T1.6 is a specifiable
integration case.

### Phase 4 — The app sends a request typed in the window and shows the response and history

**Changes:**
- `src/shared/ipc-contract.ts`: channel names and `zod` schemas for:
  - `send(clientRequestId, input)`
  - `cancel(clientRequestId)`
  - `listCalls`
  - `dbStatus`

  Request and response types are derived from them (T2.1 is the compiler). Bodies are
  `Uint8Array`; no `Buffer` in any contract type.
- `src/main/ipc.ts`: handlers that validate input with the contract, call the core, and return
  validated output. Main keeps an `AbortController` per `clientRequestId` and the in-flight send ids
  for `listCalls`. `src/main.ts` resolves config from `userData`, starts the connection, registers
  handlers. No `undici` or `mongodb` import outside `src/core/` and `src/main/`.
- `src/preload.ts`: `contextBridge.exposeInMainWorld('pigeon', { send, cancel, listCalls, dbStatus })`
  — four named functions, no raw `ipcRenderer`.
- Renderer:
  - Request form: method select, URL, query parameter rows, header rows.
  - Send button: disabled unless status is `up`. It becomes Cancel while a send is in flight.
  - Status indicator, polled every 2 s. It shows the config path when not configured.
  - Response view: status, headers, body as plain text (UTF-8, with replacement characters), and
    duration.
  - Error view: shows `timeout`, `cancelled` and `network`, and "response received but not
    recorded".
  - History list: method, URL, status or in-flight/interrupted/error, and time. Re-fetched after
    each send completes or fails.

**Verification:**
```
$ npm run typecheck && npm run lint
expected: exit 0
$ npm start   (with config.json in userData; docker compose up -d)
observe: send GET to a local server twice → response shown each time, history shows two rows
observe: send to a server that hangs, press Cancel → error "cancelled" shown, history row shows it
$ docker compose stop mongo   (app running)
observe: status shows down within ~4 s, Send disabled; docker compose start mongo → up again
$ npm run package && open out/DigitalPigeon-darwin-arm64/DigitalPigeon.app
observe: same send succeeds and appears in history
```

**Done when:** all observations hold and are recorded with what was seen.

**Executor:** lz-build — IPC, preload and UI wiring; the behaviour behind it is already tested in
phases 1–3, and the journey is phase 5.

### Phase 5 — The send → history journey holds in the built app

**Changes:**
- `e2e/send-and-record.spec.ts` (T2.7): start a capture server in the test process; launch the app
  with `DP_MONGO_DB=<dp_test_ name>` and credentials from `.env` in its environment; type the
  capture server URL and a header, send; assert the response status shows and history has one row;
  send again; assert two rows. Drop the test database afterwards through `assertTestDbName`.
- `e2e/` helper for app launch with environment, if the spec needs one.

**Verification:**
```
$ npm run test:e2e
expected: smoke spec and send-and-record spec pass; no dp_test_ database remains
```

**Done when:** the spec passes, and it fails when the renderer does not re-fetch history after send.

**Executor:** lz-e2e — the journey across renderer, preload and main is the e2e layer's risk (T2.7).

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| An optional driver feature (Kerberos, compression, field-level encryption, AWS/GCP auth, SOCKS) is enabled by a later change | low | `MongoMissingDependencyError` in the packaged app only | Recorded in Out of scope; the connection string uses SCRAM to `127.0.0.1` with no compression option |
| undici's header normalisation changes (upgrade, or an unprobed method) | low with the exact pin | The record stops matching the wire | T1.3 cases for every method fail on any divergence; undici pinned exactly |
| e2e writes into the real history database | low | Irreversible pollution of history | `DP_MONGO_DB` set to a `dp_test_*` name; database dropped via `assertTestDbName` |
| A response body near 16 MB fails to insert | low in this slice | That call shows an error instead of a record | Recorded in Out of scope; GridFS in slice 3 |
| Two-document reads become slow at real history size | low | Sluggish history list | `listCalls` limited; indexes on `sentAt` and `sendId` |

## For the reviewer

- **Weakest link:** the wire contract. It encodes undici 8.12.3's normalisation, probed for `GET`,
  `DELETE` and `POST` only. Check the T1.3 cases are the right guard, and that losing a typed
  `Host` header's case is acceptable.
- In flight versus interrupted depends on main's in-memory set. Check that a crash of main, which
  empties the set, rightly turns every pending send into interrupted.
- The 2 s server-selection timeout, plus status polling every 2 s: check that Send pressed in that
  window fails fast and visibly rather than looking hung.

## References

- `spike-main-bundle.md` — A1 holds with the default Forge Vite config; optional driver peers stubbed.
- Plan review probe, 2026-11-03 (undici 8.12.3 against `test-support/capture-server.ts`):
  - **`GET` and `DELETE`:** explicit `[Host, X-Zeta, accept, Authorization]` went out as
    `[host, connection: keep-alive, X-Zeta, accept, Authorization]`.
  - **`POST`:** also gained `content-length: 0`.
  - **Wire-contract form:** a list passed with lowercase `host` and `connection` went out exactly as
    passed.
  - **Diagnostics channel:** `undici:client:sendHeaders` omits `content-length`.
  - **Response headers:** `request()` and `onResponseStart` give a lowercased headers object.

- `context/archive/test-harness/record.md` §3, §5 — rejected e2e-on-packaged-app; constraint that the
  app reads its database name from the environment; capture server and `openTestDb` available.
- `context/foundation/test-strategy.md` — T1.1, T1.2, T1.3, T1.6, T2.1, T2.2, T2.7, T2.8 and their
  layers.
- `context/foundation/tech-stack.md` — `undici` in main only; `zod` at IPC and on documents;
  schema version on every record.
- `src/main.ts:19-21` — hardening flags, unchanged by this plan.
- `src/preload.ts` — empty today.

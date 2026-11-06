---
change_id: preview-replay-export
produced-by: lz-tdd
plan: plan.md
updated: 2026-11-06
---

# Progress: Open a past call, replay it exactly or edit and resend it, and export a request as curl

## Phase 1 — A header undici would refuse is refused before anything is recorded, values are trimmed, and anything undici still rejects is recorded as `invalid-request`

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/core/wire.ts` — `InvalidHeaderError` (names the header). `buildWireRequest` checks every row:
  the name must be an RFC 9110 token, and the value, after trimming space and tab, must be tab or
  printable ASCII. Trimmed values are what the wire request and the record hold.
- `src/core/send.ts` — `classifySendError` maps `UND_ERR_INVALID_ARG` to `invalid-request`.
- `src/core/call-schema.ts` — `invalid-request` added to the error code enum of both completion
  schemas. `schemaVersion` stays 1.
- `src/main/ipc.ts` — `InvalidHeaderError` returns the `invalid-input` result.
- `src/core/wire.test.ts` — 19 new unit tests. Refused: `zażółć`, `🐦`, `café`, LF, CRLF, trailing LF,
  leading CR, no-break space, NUL, DEL, names `X V`, `X:V`, `Xż` and empty, a typed `Host` and
  `Connection`. The error names the header. Accepted: printable ASCII, tab inside a value, empty
  value, duplicate names. Trimmed: padded, whitespace-only, typed `Host`.
- `src/core/send.test.ts`, `src/core/call-schema.test.ts` — one new case each.
- `src/core/send.int.test.ts` — T1.2: a non-ASCII value, a line feed and an invalid name each reject
  with `InvalidHeaderError`, leave no send document, and send nothing. T1.3: an empty value, a tab,
  duplicate names and a padded value reach the capture server as recorded (list comparison).

**Cycles**
1. Tests first, against a stub `InvalidHeaderError` that nothing threw:
   - unit: 19 failed
   - integration: 4 failed (`promise resolved "{ send: { …(4) }, completion: { …(6) } }" instead of
     rejecting` ×3; the padded value's recorded list differed from the received list)

   Passed against the stub and not seen red: the accepted-values test, and the T1.3 cases for an
   empty value, a tab and duplicate names. They describe behaviour that already held; they exist to
   stop the new check refusing too much, and mutation M1 below does not exercise them.
2. Added before implementing: trailing LF, leading CR and no-break space, because
   `String.prototype.trim` would strip them and hide input that must be refused.
3. Implementation: unit 61 and integration 33 passed on the files touched.
4. Done-when mutations, each reverted (`cmp` confirmed):
   - M1, check removed → 20 failed (`above U+00FF`, `emoji`, `latin1 range`, …)
   - M2, a send document inserted before the check → 3 failed (each T1.2 refusal case)
   - M3, trim removed → 4 failed (`surrounding whitespace is trimmed from a value`, …)
   - M4, `String.prototype.trim` used → 3 failed (`trailing line feed`, `leading carriage return`,
     `no-break space`)

**Verification**

```
$ npm run test:unit && npm run test:integration
unit exit 0 :: Tests 92 passed (92)
integration exit 0 :: Tests 45 passed (45)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
```

PASS — a header undici would refuse leaves no record and sends nothing; a value's surrounding
whitespace is not recorded; the `invalid-request` code exists and is mapped.

**Not exercised here:** the `invalid-input` mapping in `src/main/ipc.ts` (phase 5's observation), and
a real `invalid-request` completion (phase 2's replay of a seeded old record).

**Drift:**
- decision — the plan review's two additions (refusing control characters and invalid names; trimming)
  were built as planned. The author did not choose them directly; asked to object, the author
  proceeded. `change.md`'s boundary line now says so.
- decision — the check trims only space and tab, not `String.prototype.trim`'s wider set, and three
  refusal cases were added for it. The plan said "trimmed of leading and trailing whitespace".

## Phase 2 — A past call can be read in full and replayed exactly as a new call, leaving the original unchanged

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/core/call-store.ts` — `getCall(sendId, inFlight)` returns one call with full bodies, or `null`.
  The row logic moved into a shared `toCall`, also used by `listCalls`.
- `src/core/send.ts` — `sendWireAndRecord` extracted from `sendAndRecord`. New `replayCall(store,
  sendId, options)` and `CallNotReplayableError`. Replay passes the recorded `method`, `url` and
  `headers` to `sendWireAndRecord` unchanged. A driver error from reading the call becomes
  `DatabaseUnavailableError`.
- `src/core/call-store.int.test.ts` — 4 `getCall` tests. The test pinning the store's keys gains
  `getCall` and still asserts no update or delete.
- `src/core/replay.int.test.ts` — new, 13 tests:
  - T1.3: for all seven methods, the replay's method, URL, raw headers and body equal the original's
    at the capture server, and its send document's request equals the original's
  - T1.1: a replay is a new call, and `getCall(original)` is deep-equal before and after
  - a recorded untrimmed value stays untrimmed
  - an old record with `zażółć` records `invalid-request` and sends nothing
  - an old record with `café` sends byte `e9`
  - an unknown or unreadable call rejects and sends nothing

**Cycles**
1. Extraction first, with existing tests as the net: 32 passed, no test changed.
2. Tests first, against stubs:
   - `getCall` returning `null`: 3 failed on assertions (`expected null to match object { state:
     'completed' }`, …). `is null for an unknown id` and the store-keys test passed against the stub;
     not seen red.
   - `replayCall` throwing: 13 failed, 11 of them with `replayCall is a stub` or the wrong error class.
     This red shows only that replay did not exist, so the mutations below are its real evidence.
3. Implementation: 51 passed across the replay, store, send and db-down files.
4. Done-when mutations, each reverted (`cmp` confirmed):
   - M1, replay rebuilt through `buildWireRequest` → the first run failed only the two non-ASCII cases.
     `a replay sends the recorded list even when wire.ts would build another` still passed, because
     a rebuild keeps a typed `connection: close`: the test did not prove its name.
   - M2, `insertSend` updating a matching document → 10 failed, including T1.1.
5. Replacing that test:
   - A list with `connection` after a custom header failed unmutated: `expected [ 'host',
     'connection', 'X-V' ] to deeply equal [ 'host', 'X-V', 'connection' ]`. undici moves
     `connection` up itself. `wire.ts` always puts it second, so no list the app records has that
     order.
   - The final test uses a record written before trimming: value `  a  `, which a rebuild would trim.
     Unmutated: 13 passed. M1: 3 failed, including this test.

**Verification**

```
$ npm run test:integration
exit 0
 Test Files  6 passed (6)
      Tests  62 passed (62)
$ npm run test:unit
      Tests  92 passed (92)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
```

PASS — a past call reads back in full, including in-flight state; a replay sends what the original
sent for all seven methods, as a new call, leaving the original deep-equal.

**Drift:** decision — the plan said replay rejects for an "unknown or unreadable call". A call whose
send document is readable but whose completion is not is also `unreadable`, so it cannot be replayed,
although its request is known. Accepted as the simpler rule; `getCall` shows the schema error.

Finding for the wire contract: undici reorders `connection` to second place whatever position it is
given. A1 holds for every list `wire.ts` produces.

## Phase 3 — A recorded request turns into form input that, sent again, reproduces the request; editing it creates a new call

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/core/form-from-call.ts` — new. `formFromCall(request)` returns the method, the recorded URL,
  no query rows, and the headers minus managed ones equal to what `wire.ts` generates (`host` equal to
  the URL host; `connection` `keep-alive`, or `close` on `HEAD`; `content-length: 0` on `POST`, `PUT`,
  `PATCH`).
- `src/core/wire.ts` — `METHODS_WITH_LENGTH` exported and reused (refactor; no test changed).
- `src/core/form-from-call.test.ts` — new, 18 unit tests: round trip for 12 request shapes; managed
  headers hidden; a typed `Host` and `Connection` kept; changing the URL or method afterwards
  recomputes managed headers.
- `src/core/replay.int.test.ts` — T1.1 edit half: a loaded call with one changed header is a new call
  carrying the change, reaches the capture server, and `getCall(original)` is deep-equal to before.

**Cycles**
1. Tests first, against a stub returning no header rows: 8 unit failed, and the edit test failed with
   `expected [ [ 'host', '127.0.0.1:54122' ], …(1) ] to deep equally contain [ 'X-Zeta', 'changed' ]`.
   10 unit passed against the stub and were not seen red, because they involve no typed or managed
   header difference (for example `no typed headers`, `PUT`, `changing the URL after loading`).
2. Implementation: unit 18, replay integration 14 passed.
3. Done-when mutation, reverted (`cmp` confirmed): treating every `host` as generated → 2 failed (`a
   typed Host`, `keeps a typed Host and a typed Connection as rows`).

**Verification**

```
$ npm run test:unit && npm run test:integration
      Tests  110 passed (110)
      Tests  63 passed (63)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
```

PASS — a recorded request round-trips through the form for every shape tested, and edit-and-send is a
new call with the original unchanged.

**Drift:** none

## Phase 4 — A curl command exported from a recorded request sends the same method, URL and headers when run in a shell

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/core/curl.ts` — new. `toCurl(request)` produces `curl --http1.1 -sS --globoff`, `-X '<METHOD>'`
  or `--head`, the quoted URL, `-H 'User-Agent:' -H 'Accept:'`, then one `-H` per header (`-H 'Name;'`
  for an empty value). Arguments are single-quoted with `'` as `'\''`. Pure.
- `src/core/wire.ts` — `checkedHeaderValue` exported and used by both `buildWireRequest` and `toCurl`
  (refactor; no test changed).
- `src/core/curl.int.test.ts` — new, 27 tests, each running the export through `sh -c` and the system
  curl via async `execFile` against the capture server:
  - all seven methods
  - URLs with brackets, braces and brackets in the path send one request as written
  - an empty value, duplicates, a typed `User-Agent`, `Accept` and `Host`, and a tab
  - spaces, double quotes, single quotes, `$HOME $(echo x) `echo y``, and backslashes
  - a single quote in the URL; `HEAD` with an empty value
  - `café`, `zażółć` and a line feed are refused, naming the header
  - an old record's whitespace-only value is exported as empty

  Headers compare as sorted lists with names lowercased, so a lost duplicate fails.

**Cycles**
1. Tests first, against a stub returning the no-op command `true`: 27 failed (`expected [] to have a
   length of 1 but got +0`, `expected function to throw an error`, …).
2. Implementation: 27 passed.
3. Done-when mutations, each reverted (`cmp` confirmed):
   - no `-H 'User-Agent:'` → 21 failed
   - no `--globoff` → 3 failed (each bracket and brace URL)
   - empty value as `-H 'Name: '` → 3 failed
   - quoting without `'\''` → 1 failed (`a value with single quotes survives the shell`)

**Verification**

```
$ npm run test:integration
exit 0
 Test Files  7 passed (7)
      Tests  90 passed (90)
$ npm run test:unit
      Tests  110 passed (110)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npx vitest run --project integration src/core/curl   (x5)
.....
```

PASS — the export sends what was recorded for every method and every URL and value shape the spike and
plan review found problems with. curl 8.7.1 on macOS only.

**Drift:** decision — `toCurl` refuses anything `buildWireRequest` would refuse, not only non-ASCII
values as the plan said. A line feed in an old record would otherwise go into a shell command.

## Phase 5 — In the app, a history row opens the call; Replay, Edit and Copy as curl work from it

- **Executor:** lz-tdd → routed to lz-build
- **Status:** in-progress

**Routed:** IPC, preload and renderer wiring verified by scripted observation; the behaviour behind it
is tested in phases 1–4. The plan assigns it to lz-build. Run `/lz-build preview-replay-export`.

Carried forward:
- the `invalid-input` mapping for `InvalidHeaderError` (`src/main/ipc.ts`) has not been exercised
- `invalid-request` needs nothing new in the renderer's `outcome`, but should be seen in a row
- the renderer imports `wire.ts`, `curl.ts` and `form-from-call.ts`, all pure; phase 5 repeats the
  bundle check

## Phase 5 — In the app, a history row opens the call; Replay, Edit and Copy as curl work from it

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/shared/ipc-contract.ts` — channels `getCall` and `replay`; `ReplayInput`, `CallDetail` (full
  completion) and `GetCallResult`. `PigeonApi` gains both.
- `src/main/ipc.ts` — `send` and `replay` share one `recorded` path (`AbortController`, in-flight ids,
  failure mapping). `CallNotReplayableError` and `InvalidHeaderError` both return `invalid-input`.
  `getCall` passes the in-flight set and returns bodies as plain `Uint8Array`.
- `src/preload.ts` — six named functions.
- `src/renderer/app.tsx`:
  - form state moved from `RequestForm` up to `App`, and `RequestForm` is controlled
  - history rows are buttons, except unreadable rows
  - `CallPanel` shows state, request line, request headers in order, completion time, and the
    response through `CompletionView`, as text only
  - **Replay** is disabled unless status is `up` and while anything is in flight; **Edit** fills
    the form through `formFromCall`; **Copy call as curl** on the panel and **Copy as curl** on the
    form
  - `CurlView` shows the command in a `<pre>` with "Copied." or "Select the command to copy it:", or
    the refusal reason
- `src/index.css` — `.history-row`.

**Verification**

```
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:unit && npm run test:integration
      Tests  110 passed (110)
      Tests  90 passed (90)
$ npm run test:e2e
  3 passed
$ grep -c MongoClient / undici in the preload and renderer bundles
.vite/build/preload.cjs MongoClient:0 undici:0
.vite/renderer/main_window/assets/index-qFlB8FW0.js MongoClient:0 undici:0
$ grep for dangerouslySetInnerHTML, innerHTML, srcdoc in src/
no HTML rendering APIs
```

Observations, scripted with a throwaway Playwright spec (`.probe/`, deleted) against the built app, on
a `dp_test_*` database through `launchWithTestDatabase()`, with a capture server and a TCP server that
never responds. First run, 1 passed (5.1s):

```
OBSERVE open: state=Completed
OBSERVE open: line=GET http://127.0.0.1:55386/orders?filter[a]=1
OBSERVE open: request headers=["host: 127.0.0.1:55386","connection: keep-alive","X-Zeta: 1","Authorization: Bearer t"]
OBSERVE open: response=201 · N ms | body {"id":7}
OBSERVE replay: rows=2; panel unchanged=true; capture requests=2; raw headers equal=true
OBSERVE curl: curl --http1.1 -sS --globoff -X 'GET' 'http://127.0.0.1:55386/orders?filter[a]=1' -H 'User-Agent:' -H 'Accept:' -H 'host: 127.0.0.1:55386' -H 'connection: keep-alive' -H 'X-Zeta: 1' -H 'Authorizat…
OBSERVE curl: clipboard said="Copied."
OBSERVE curl: ran; capture requests +1 url=/orders?filter[a]=1
OBSERVE edit: url=http://127.0.0.1:55386/orders?filter[a]=1 rows=["X-Zeta","Authorization"] row3 exists=0
OBSERVE edit: new row; X-Zeta at capture=changed
OBSERVE refused send: Not sent: Invalid header "X-Zeta": use printable ASCII with no line breaks | rows unchanged=true
OBSERVE refused form curl: Cannot export as curl: Invalid header "X-Zeta": use printable ASCII with no line breaks
OBSERVE in-flight row opened: state=In flight; Replay disabled=true
OBSERVE cancelled; Replay disabled now=false
OBSERVE old record curl: Cannot export as curl: Invalid header "X-Old": use printable ASCII with no line breaks
OBSERVE old record replay: row=GET http://127.0.0.1:55386/old — invalid-request | capture +0
```

PASS — every observation the plan names held. This also exercises what phases 1–4 left open: the
`invalid-input` message, a real `invalid-request` row, and A4 ("Copied." in the sandboxed renderer
under the production CSP). The managed headers stayed out of the form on Edit.

**Not observed:** the packaged `.app`, because its fuses block automation. Dev mode (`npm start`).

**Drift:**
- decision — the plan named one Copy as curl on the panel and one on the form. The panel's is labelled
  **Copy call as curl** so the two are distinct accessible names.
- decision — the observation run wrote a curl command with a test token to the author's system
  clipboard. No real credentials were involved.

## Phase 6 — The journey send → open → replay → a new row, with the original unchanged, holds in the built app

- **Executor:** lz-build → routed to lz-e2e
- **Status:** in-progress

**Routed:** the journey across renderer, preload and main is the e2e layer's risk (test-strategy T2.7,
replay half); the plan assigns it to lz-e2e. Run `/lz-e2e preview-replay-export`. Phase 5's
observations give the selectors (`getByTestId('history').getByRole('listitem')`, `getByRole('button',
{ name: 'Replay', exact: true })`, `getByTestId('call-panel')`, `getByTestId('call-request-line')`).

## Phase 6 — The journey send → open → replay → a new row, with the original unchanged, holds in the built app

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Risk:** a user opens a past call and presses Replay, but no new row appears, or the original's
details change or disappear, because the wiring between the panel, preload and main breaks. This is
test-strategy T2.7, replay half, assigned to e2e.

**Gate:** only this journey passed. Not written as e2e:
- wire and store behaviour of replay: `src/core/replay.int.test.ts`
- what curl sends: `src/core/curl.int.test.ts`
- Edit's mapping: `src/core/form-from-call.test.ts`
- the panel's other actions and the refusal messages: scripted observation in phase 5. The plan names
  no e2e risk for them, so they have no durable test.

**Changed**
- `e2e/replay.spec.ts` — new, 1 scenario, through `launchWithTestDatabase()` with a capture server:
  1. Send with an `Authorization` header to a URL with `?filter[a]=1`; server answers `first
     response`.
  2. Open the row; the panel shows the header and the body.
  3. The server now answers `202 second response`; press Replay. History has two rows, the newest
     `… — 202`. The server received two requests with equal URL and raw headers.
  4. Open the new row: `second response`.
  5. Open the original: `first response`, the same request line, row still `— 200`.

  Selectors: `getByRole('button', { name, exact: true })`, `getByLabel`, `getByRole('listitem')`, and
  `data-testid` where no role fits. No wait on a duration.

**Proof the scenario can fail**
The behaviour already existed, so it was broken deliberately, rebuilding each time:

```
M1, Replay bypasses the history re-fetch:
  ✘  1 e2e/replay.spec.ts:24:5 › replaying a past call adds a row and leaves the original as recorded (5.4s)
    Error: expect(locator).toHaveCount(expected) failed
    Expected: 2
    Received: 1
M2, the panel keeps the first call it opened:
  ✘  1 e2e/replay.spec.ts:24:5 › replaying a past call adds a row and leaves the original as recorded (5.4s)
    Error: expect(locator).toHaveText(expected) failed
    Expected: "second response"
    Received: "first response"
```

The renderer was restored (`cmp` byte-identical) and the app rebuilt.

**Verification**

```
$ npm run test:e2e                       (run 1, fresh package)
  ✓  1 e2e/replay.spec.ts:24:5 › replaying a past call adds a row and leaves the original as recorded (719ms)
  ✓  2 e2e/send-and-record.spec.ts:29:5 › each send shows its response and adds its own row to history (2.5s)
  ✓  3 e2e/smoke.spec.ts:16:5 › the app window renders the React root (25ms)
  ✓  4 e2e/smoke.spec.ts:20:5 › the production build carries a Content-Security-Policy meta tag (3ms)
  4 passed (8.5s)
$ npx playwright test e2e/replay.spec.ts  (runs 2–4, same build)
 1 passed (1.9s)
 1 passed (4.7s)
 1 passed (1.8s)
$ npm run test:e2e                       (run 5, rebuilt after the mutations were reverted)
  4 passed (7.6s)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:unit && npm run test:integration
      Tests  110 passed (110)
      Tests  90 passed (90)
$ listDatabases after all runs, including the failing ones
[ 'admin', 'config', 'digital_pigeon', 'local' ]
$ grep -rn waitForTimeout e2e
no waitForTimeout
```

PASS — 5 clean runs. The scenario fails when Replay does not refresh history and when the panel does
not show the opened call, and every run removed its test database.

**Drift:** decision — the plan's scenario asserted "the capture server received two identical
requests" and "details unchanged". It also changes the server's response before replaying and opens
the replay's row first, so "unchanged" cannot pass on a panel that never re-reads.

## Phase 6 — The journey send → open → replay → a new row, with the original unchanged, holds in the built app

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

Follow-up to review finding F2. The earlier Phase 6 sections stand.

**Changed**
- `e2e/edit-and-export.spec.ts` — new, 1 scenario, through `launchWithTestDatabase()` with a capture
  server:
  1. Send a request with a header, then clear the form so that what Edit puts there can only come from
     the call.
  2. Open the row; Copy call as curl shows a command with `--globoff`, the URL and the header.
  3. Edit fills the URL and one header row, and no managed header.
  4. Change the value and Send: two rows; the open original still shows `original`, and the new row
     shows `changed`.
  5. Type `zażółć`: Send shows `Not sent` naming the header and adds no row. Copy as curl shows the
     refusal naming the header.

  `navigator.clipboard.writeText` is stubbed in the page, so an e2e run does not overwrite the system
  clipboard. Phase 5's observation covered the real clipboard.

**Proof the scenario can fail** (each rebuilt, then reverted; `cmp` confirmed)

```
M1, Edit does nothing:
    Error: expect(locator).toHaveValue(expected) failed
    Expected: "http://127.0.0.1:57486/orders?filter[a]=1"
    Received: ""
M2, Copy call as curl does nothing:
    Error: expect(locator).toContainText(expected) failed
    Expected substring: "--globoff"
M3, header refusal removed from wire.ts:
    Error: expect(locator).toContainText(expected) failed
    Expected substring: "Not sent"
    Received string:    "invalid-request: invalid X-Zeta header (0 ms)"
```

M3 also shows the fallback working in Electron: with the check gone, undici's refusal is recorded as
`invalid-request`.

**Verification**

```
$ npm run test:e2e                       (run 1, fresh package)
  ✓  1 e2e/edit-and-export.spec.ts:29:5 › edit a past call, export it as curl, and see a refused header explai…
  5 passed (8.2s)
$ npx playwright test e2e/edit-and-export.spec.ts   (runs 2–4, same build)
 1 passed (1.8s)
 1 passed (1.8s)
 1 passed (1.9s)
$ npm run test:e2e                       (rebuilt after the mutations were reverted)
exit 0
  5 passed (8.2s)
$ npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
typecheck 0
lint 0
      Tests  110 passed (110)
      Tests  90 passed (90)
$ listDatabases
[ 'admin', 'config', 'digital_pigeon', 'local' ]
```

PASS — a wiring break in Edit, Copy call as curl or the refusal message now fails a gate.

**Drift:** decision — the review's F2 said Copy call as curl "shows a command". The spec stubs the
clipboard so that a durable test does not overwrite the system clipboard on every run.

## Phase 5 — In the app, a history row opens the call; Replay, Edit and Copy as curl work from it

- **Executor:** lz-build
- **Status:** in-progress
- **Started:** 2026-11-06
- **Finished:** —

Follow-up to review finding F3. The earlier Phase 5 sections stand. Waiting on the author's check of
the packaged `.app`.

**Scripted** (throwaway Playwright spec, `.probe/`, deleted), against the built app on a `dp_test_*`
database, with a TCP server that never responds; a `crashed` send document with no completion was
seeded:

```
OBSERVE replay in flight: Cancel visible, in-flight row shown, Replay disabled=true, rows=2
OBSERVE replay cancelled: rows=2 | ["GET http://127.0.0.1:57569/hang — cancelled","GET http://127.0.0.1:57569/hang — cancelled"]
OBSERVE result: cancelled: This operation was aborted (N ms)
OBSERVE interrupted row: GET http://127.0.0.1:57569/hang/crashed — interrupted
OBSERVE interrupted opened: Interrupted: no response was recorded | line=GET http://127.0.0.1:57569/hang/crashed | response section=0
  1 passed (3.8s)
```

**Pending:** the author opens `out/DigitalPigeon-darwin-arm64/DigitalPigeon.app` and tries Open, Replay
and Copy as curl.

**Drift:** none

## Phase 5 — In the app, a history row opens the call; Replay, Edit and Copy as curl work from it

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

Completes review finding F3, and fixes a defect the author's check led to. The earlier Phase 5 sections
stand.

**The author's packaged-app check**
- First attempt: "when I click on history row nothing happens". Cause: the `.app` process from
  2026-11-03 22:09 was still running, so `open` brought forward a build whose rows were not clickable.
- After Cmd+Q and reopening (process started 01:34, build 01:27), the author ran a command copied from
  the app: `curl --http1.1 -sS --globoff -X 'GET' 'http://www.onet.pl' -H 'User-Agent:' -H 'Accept:'
  -H 'host: www.onet.pl' -H 'connection: keep-alive'`. Its shape is what `toCurl` produces. It printed
  nothing because the server answered `301` with `Content-Length: 0` (checked separately).
- Open and Replay in the packaged app: asked directly, the author replied "ok, continue". That is the
  whole evidence. No detail of what was seen was reported.

**Changed**
- `src/renderer/app.tsx` — the open-error message and `CallPanel` sit in a region that scrolls into view
  when a call opens or fails to open.
- `e2e/replay.spec.ts` — new scenario: 30 sends, open the first row, the panel's heading is in the
  viewport.

**Cycles**
1. Measurement (throwaway script) with 5 rows and a long response: panel top 740 in a 768 window, no
   scroll.
2. First test, 8 rows with long responses: passed with no fix. Playwright scrolls the clicked row to
   mid-window, and a short list keeps the panel in view. That test proved nothing and was replaced.
3. 30 rows, against unfixed code: failed, `expect(locator).toBeInViewport() failed … Received: viewport
   ratio 0`.
4. Fix: passed.

**Verification**

```
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:unit && npm run test:integration
      Tests  110 passed (110)
      Tests  90 passed (90)
$ npm run test:e2e   (fresh package)
  ✓  1 e2e/edit-and-export.spec.ts:29:5 › edit a past call, export it as curl, and see a refused hea
  ✓  2 e2e/replay.spec.ts:24:5 › replaying a past call adds a row and leaves the original as recorde
  ✓  3 e2e/replay.spec.ts:80:5 › opening a call brings its panel into view, even from a long history
  ✓  4 e2e/send-and-record.spec.ts:29:5 › each send shows its response and adds its own row to histo
  ✓  5 e2e/smoke.spec.ts:16:5 › the app window renders the React root (18ms)
  ✓  6 e2e/smoke.spec.ts:20:5 › the production build carries a Content-Security-Policy meta tag (3ms
  6 passed (11.3s)
$ npx playwright test e2e/replay.spec.ts   (runs 2 and 3)
  2 passed (3.7s)
  2 passed (4.8s)
```

PASS — the panel opens in view from a long history. F3 is closed as far as the author's report goes:
Copy call as curl in the packaged app has direct evidence; Open and Replay rest on "ok, continue".

**Mutation**

Removed the `scrollIntoView` call and ran `npm run test:e2e`. Exit 1, with one scenario failing:

```
✘  3 e2e/replay.spec.ts:80:5 › opening a call brings its panel into view, even from a long history (6.0s)
Error: expect(locator).toBeInViewport() failed
Received: viewport ratio 0
1 failed
5 passed (14.9s)
```

Restored the file (`cmp` identical) and ran `npm run test:e2e` again: exit 0, `6 passed (11.0s)`. That run
also rebuilt the packaged `.app` with the fix (2026-11-06 01:46).

**Not re-checked:** the scroll fix in the packaged `.app`. It is renderer code covered by the e2e test on
the same production build output.

**Drift:** defect — the plan placed the panel below the history list and verified it through selectors
that find an element wherever it is. Neither the plan nor the scripted observations could see that it
opened off-screen. One defect in this change; no other phase is affected.

## Follow-up — Code review findings 1–8

- **Executor:** lz-tdd (core), lz-e2e (renderer)
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

Source: `/code-review` run by the author, triaged in `review.md` as R1–R10. The author replied "go ahead
with 1–8, accept 9 and 10". Statuses of phases 1–6 are unchanged by this section.

**Probe before fixing**

`Transfer-Encoding`, `Keep-Alive`, `Upgrade`, an empty `Connection` and `Expect` threw before anything
reached a capture server. `Connection: Upgrade` and `Connection: Keep-Alive` went out as
`connection: keep-alive`. `node_modules/undici/lib/core/request.js` (`processHeader`) shows why: the
Connection value is only checked as a comma-separated token list, and `close` in it selects the value
written.

**Changed**
- `src/core/send.ts` — the 30 s defaults moved into `sendWireAndRecord`, so a replay has them (R1).
  `UND_ERR_NOT_SUPPORTED` classifies as `invalid-request` (R3).
- `src/core/wire.ts` — `checkedHeaderValue` refuses the four names and an invalid Connection list, which
  `toCurl` inherits (R2). The recorded `connection` is what undici writes: `close` when listed, else
  `keep-alive` (R4).
- `src/core/curl.ts` — the user and password are left out of the exported URL (R6).
- `src/renderer/app.tsx` — Replay and Edit scroll to the form, a result scrolls into view (R5); a failed
  open clears the panel (R7); only the latest open can set the panel (R8).
- Tests: `src/core/{wire,form-from-call,send}.test.ts`, `src/core/{send,replay,curl}.int.test.ts`, new
  `e2e/panel-actions.spec.ts` and `e2e/open-call-failures.spec.ts`.

**Red, on the unfixed code**

```
$ npm run test:unit
Tests  17 failed | 113 passed (130)
$ npm run test:integration
Tests  12 failed | 100 passed (112)
$ npm run test:e2e
✘ a failed open … › the database query fails      toHaveCount: Received: 1
✘ a failed open … › the call to main rejects      toHaveCount: Received: 1
✘ when two opens overlap, the last click wins     toContainText failed
✘ Replay brings Cancel into view …                toBeInViewport: viewport ratio 0
✘ the result of a replay comes into view …        toBeInViewport: viewport ratio 0
✘ Edit brings the loaded form into view           toBeInViewport: viewport ratio 0
6 failed, 6 passed
```

Passing in that run, and not seen failing: `undici itself refuses what wire.ts refuses` (7 cases, guards
the pinned version), `a user and password in the URL add no header` (1), `a URL with no user or password
is exported as recorded` (1), `a send` has the timeouts (1), and the round trip with an ignored Connection
(1).

The first failure in `panel-actions.spec.ts` left state behind for the next two, so each of its fixes was
also removed on its own. Each run failed only its own scenario:

```
no scroll on Replay  → ✘ Replay brings Cancel into view …             1 failed, 2 passed
no scroll on Edit    → ✘ Edit brings the loaded form into view        1 failed, 2 passed
no scroll to result  → ✘ the result of a replay comes into view …     1 failed, 2 passed
```

**Verification**

```
$ npm run typecheck && npm run lint
exit 0, exit 0
$ npm run test:unit
Tests  130 passed (130)
$ npm run test:integration
Tests  112 passed (112)
$ npm run test:e2e   (after restoring the file, cmp identical)
12 passed (16.1s)
$ npx playwright test e2e/panel-actions.spec.ts e2e/open-call-failures.spec.ts   (3 repeats)
6 passed (9.5s), 6 passed (5.1s), 6 passed (5.2s)
listDatabases → admin, config, digital_pigeon, local   (no dp_test_* left)
```

PASS — each of R1–R8 has a test that failed without its fix, except the gaps below.

**Not verified**
- A replay hanging until a real timeout. The test checks the values handed to undici.
- The guard in `openCall`'s catch branch for an out-of-date rejection. The overlap test covers an
  out-of-date answer only.
- These fixes in the packaged `.app`, and the changed code under a second `/code-review`.

**Drift:** decision — three choices beyond the findings' wording:
- The result scroll also applies to Send. It has no effect when the result is already in view.
- `send.test.ts` mocks undici to read the timeouts, because a real 30 s wait is too slow for a gate.
- `open-call-failures.spec.ts` replaces the get-call handler in the launched app, because a failing
  database and response order cannot be arranged from outside.

Old records are unchanged: replay sends them as recorded. One holding a typed `Connection` exports that
literal value in curl (R4).

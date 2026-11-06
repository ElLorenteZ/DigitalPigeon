---
change_id: request-bodies-and-storage
produced-by: lz-build
plan: plan.md
updated: 2026-11-07
---

# Progress: Send, replay and export request bodies, and store bodies over 16 MB in full

Work started on branch `preview-replay-export`, with the slice 2 wrap-up uncommitted in `context/`. The author ran this skill without
committing it or opening the pull requests.

## Phase 1 — A request with a body reaches the wire as recorded, and history stays body-less

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/core/wire.ts` — `BodyInput` (`none`, `json`, `xml`, `text`, `form`), `WireRequest.body` as bytes or `null`, `GENERATED_CONTENT_TYPE`, and `InvalidBodyError`
  for `HEAD` with a body. A body adds `content-type` after the typed headers unless one was typed, in any case, then `content-length` last. An empty
  text box or no rows is `null`, with no `content-type`.
- `src/core/call-schema.ts` — `request.body` is bytes or `null`; new `SendSummarySchema` without a body.
- `src/core/call-store.ts` — `listCalls` projects out `request.body` and parses rows with the summary schema. `Call` is generic in its send type, so `getCall`
  returns the full document.
- `src/shared/ipc-contract.ts` — `CallViewSchema` uses `SendSummarySchema`.
- `src/core/send.ts` — the send document records the wire request, and undici receives its bytes. `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH` classifies as
  `invalid-request`. `replayCall` still passes `body: null`; phase 2 replaces it.
- `src/core/curl.ts`, `src/core/form-from-call.ts` — signatures take a request without a body until phases 2 and 3. Types only.
- Tests: `wire.test.ts`, `send.test.ts`, `call-schema.test.ts`, `send.int.test.ts` (24 method and type combinations through the capture server), `call-store.int.test.ts`.

**Cycles**
1. Tests first, against a stub `InvalidBodyError` and `SendSummarySchema = SendDocSchema`:
   - unit: 19 failed
   - integration: 27 failed. The 24 T1.3 cases failed on `Buffer.from(recorded.body)` with the recorded body `null`, which shows only that no body was recorded; the mutations below
     are their stronger evidence. Also: `expected null to deeply equal Buffer[…]`, and `promise resolved … instead of rejecting` for `HEAD`.

   Passed against the stubs, not seen red: `rejects text as a body` (already refused by `z.null()`), `an empty text box sends nothing` and `a document written before bodies existed`. They
   guard behaviour that already held.
2. Implementation: unit 150 and integration 141 passed. `npm run typecheck` then failed: `Uint8Array<ArrayBufferLike>` is not assignable to the schema's `Uint8Array<ArrayBuffer>`. Fixed by narrowing
   `WireRequest.body`.
3. Done-when mutations, each restored (`cmp` confirmed):
   - record the text instead of the bytes → integration 25 failed
   - drop the `request.body` projection → integration 8 failed, including `history rows carry no request body`
   - `content-length` counted in characters → unit 1 failed, integration 12 failed
   - let `HEAD` carry a body → unit 1 failed, integration 1 failed
   - `CallViewSchema` left on `SendDocSchema`, the first plan review's finding → e2e 6 failed, 2 passed (`toHaveCount … Received: 0`)

**Verification**

```
$ npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e
typecheck 0
      Tests  150 passed (150)
      Tests  141 passed (141)
e2e 0
  12 passed (16.1s)
$ npm run lint
lint 0
$ listDatabases
[ 'admin', 'config', 'digital_pigeon', 'local' ]
```

PASS — a body on any of six methods and four types reaches the capture server as recorded, in bytes and in header order. History rows carry no request body, and the built app still lists calls.

**Not exercised here:** `InvalidBodyError` in `src/main/ipc.ts`, which phase 5 maps. The form cannot type a body until phase 5, so `replayCall` dropping a body and `toCurl` ignoring one cannot be reached yet.

**Drift:** decision — the plan listed `src/main/ipc.ts` for this phase ("`toView` follows") → the file did not change until phase 4, because `toView` already drops the response body and `listCalls` projects out the request body. Recorded after review, 2026-11-06.

## Phase 2 — A call with a body replays with the same bytes, and loads into the form for editing

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/core/send.ts` — `replayCall` passes the recorded request, body included, unchanged.
- `src/core/form-from-call.ts` — returns a `body`. The type comes from `Content-Type`; an unknown one loads as Text and keeps its row. `Content-Type` is hidden only when it is lowercase, second to last and equal to what the
  type generates. `content-length` is hidden when it equals the body's size. Form rows are recovered only when re-encoding gives the same text and no row is nameless. Decoding keeps a byte order mark.
- `src/shared/ipc-contract.ts` — `SendInputSchema` gains an optional `body`.
- Tests: `form-from-call.test.ts`, `replay.int.test.ts` (24 method and type combinations; T1.1 with a body).

**Cycles**
1. Tests first, against the phase 1 code: unit 19 failed (`expected undefined to deeply equal { type: 'json', text: '{}' }`, round trips differing in their body), integration 24 failed (the replay's raw headers lacked `content-type`, or held `content-length: 0`).

   Passed and not seen red: `T1.1 — a replay and an edit of a call with a body leave the original unchanged`. Mutation M1 does not fail it either, so it guards only that the original stays deep-equal.
2. Implementation: unit 169 and integration 166 passed.
3. Done-when mutations, each restored (`cmp` confirmed):
   - M1, replay drops the body → integration 24 failed
   - M2, rows kept with no re-encoding check → unit 4 failed (each `form content that does not re-encode exactly`)
   - M3, byte order mark dropped → unit 1 failed
   - M4, any matching `Content-Type` hidden, wherever it sits → unit 2 failed

**Verification**

```
$ npm run test:unit && npm run test:integration
      Tests  169 passed (169)
      Tests  166 passed (166)
$ npm run typecheck && npm run lint && npm run test:e2e
typecheck 0
lint 0
e2e 0
  12 passed (17.2s)
```

PASS — a replay sends the original's bytes and headers for 24 method and type combinations, and a recorded request round-trips through form input, including a byte order mark and form values with spaces, `&`, `=`, `+` and non-ASCII.

**Drift:** decision — `src/shared/ipc-contract.ts` gained `body` on `SendInput` in this phase, not phase 5. `formFromCall` now returns a `body`, and Edit puts it into the form state, so a strict schema without the field would have rejected every Send after Edit. The form still has no body controls until phase 5.

## Phase 3 — A curl export sends the recorded body, and refuses one too long for a command

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/core/curl.ts` — exports a body with `--data-raw`, adds `-H 'Content-Type:'` only when the list holds none, and refuses a command over 900 KiB, a NUL byte and invalid UTF-8 with a stated reason.
- `src/core/curl.int.test.ts` — the T2.4 tests.

**Red step not observed.** The tests' first run hung on an unbounded loop in a test helper. The rerun did not execute (`timeout` does not exist on macOS). The implementation was written next, so these tests were not seen failing before the code. The mutations below are the substitute evidence, including one that restores the behaviour before this phase.

**Test defect found:** `a command at the limit sends` failed because the helper ignored that the digits of `content-length` grow with the body. The helper now steps down from just over the budget.

**Mutations, each restored (`cmp` confirmed):**
- no refusal → 2 failed
- `--data-binary` → 1 failed (`a body starting with @ arrives as text, and no file is read`)
- no `Content-Type` suppression → 1 failed
- measuring the body instead of the command → 2 failed
- no NUL check → 1 failed
- non-fatal decoding → 1 failed
- byte order mark dropped → 1 failed
- body ignored, the code before this phase → 39 failed

**Verification**

```
$ npm run typecheck && npm run lint && npm run test:integration
typecheck 0
All matched files use the correct format.
      Tests  205 passed (205)
```

PASS — the curl tests run through `sh -c`, and the bytes and headers received equal the record.

**Drift:** decision — the done-when list named four mutations; four more were run, because the red step was missing.

## Phase 4 — A body over 16 MB is stored in full and can be read back by range

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- New `src/core/body-store.ts`: the `bodies` bucket, with `openUpload`, `writeBytes`, `readRange` and `readAll`. The only removal is `abort()` of an unfinished upload.
- `src/core/call-schema.ts`: a stored body is bytes or `{ fileId, length }`, and the error code `storage` exists.
- `src/core/send.ts`: a request over 1 MiB goes to a file before its send document. A response is held up to 1 MiB, then streamed in one read loop. Every failure aborts the upload. A replay writes a stored request body to its own file.
- `src/core/curl.ts` refuses a stored body and `src/core/form-from-call.ts` throws `BodyNotLoadableError` for one.
- `src/main/ipc.ts` passes both shapes. `src/renderer/app.tsx` shows a stored response's size in place of its text.
- New tests: `src/core/body-store.int.test.ts`, `src/core/large-bodies.int.test.ts`, plus additions to the schema, form and curl tests.

**Cycles:**
1. Red, against a stub whose functions throw `not implemented`: body store 17 failed; `large-bodies` 10 failed, for example `Response received but not recorded` for a 17 MiB response, and `promise resolved … instead of rejecting` for the failed upload. Schema, form and curl tests: 4 failed.
   - The first run also held a test defect: the pattern helper wrote past the end of a buffer (`RangeError`). It was fixed and the red step repeated.
   - Six `large-bodies` tests passed and were not seen red: the two "exactly 1 MiB" tests, the timeout test, `getCall returns the references`, the unrecorded completion test and `getCall and listCalls work with the files gone`. Two of those were weak, because `toMatchObject({ length })` also matches bytes. They now require a `fileId`. Each of the six fails under a mutation listed below.
2. Green: unit 178 passed, and integration 238 passed with 1 failed, `a file whose chunks are gone is reported as missing`. A range read with its chunks gone returns short with no error. `readRange` now compares the bytes received with the range.

**Mutations, each restored (`cmp` confirmed):**
- send document before the file → 3 failed, including T1.6
- no `abort()` on failure → 4 failed: cancel, server dying, timeout, storage failure
- file shared on replay → 1 failed
- range off by one at the end → 5 failed; at the start → 10 failed
- `end` not clamped → 4 failed
- response threshold off by one → 1 failed; request threshold off by one → 1 failed
- no `error` listener on the upload → all 33 tests passed, and the run reported Unhandled Errors, which fails the run
- storage failure not classified → 1 failed
- everything held inline → 2 failed (`getCall returns the references`, the unrecorded completion test)
- `getCall` reads the file → 1 failed (`getCall and listCalls work with the files gone`)

**Verification**

```
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:unit
      Tests  178 passed (178)
$ npm run test:integration
      Tests  239 passed (239)
$ npm run test:e2e
  12 passed (13.2s)
e2e 0
```

PASS — a 17 MiB response and a 17 MiB request body read back with equal SHA-256, and each document is under 64 KiB. A real server-side refusal of chunks, through a collection validator, records `storage`, closes the transfer and leaves no chunks. The built app still lists and opens calls. No e2e test yet opens a call with a stored body: phase 6 covers that.

**Drift:** decision — the plan described the body store on its own → `createCallStore` returns `bodies`, because `send.ts` then reaches the files through the store it already takes. The store-keys test gained `bodies`, and a new test lists the body store's keys.
**Drift:** decision — `send.test.ts`'s undici mock used `arrayBuffer` → it is an async iterable, because the response is now read in a loop.
**Drift:** decision — the plan said `formFromCall` "reports" a stored body → it throws `BodyNotLoadableError`, because that matches `toCurl`'s refusal and keeps `WireInput` as the return type.
**Drift:** decision — no plan entry for Edit before phase 5 → Edit on a stored request body showed the reason through the curl message and left the form alone, until phase 5 replaced it.
**Drift:** decision — the plan's storage failure test used "a store that fails" → the test uses a real MongoDB refusal, through a collection validator on `bodies.chunks`, because a fake store would not exercise the driver's `error` event. Recorded after review, 2026-11-06.
**Drift:** decision — the Approach calls the threshold and the display page one number → two constants hold it, `INLINE_BODY_LIMIT` in `src/core/body-store.ts` and `BODY_PAGE_BYTES` in `src/shared/ipc-contract.ts`, because `body-store.ts` imports `mongodb` and the renderer cannot import it. A divergence would not corrupt anything, because a body in its document is shown whole. Recorded after review, 2026-11-06.
**Drift:** defect (fixed) — the spike did not cover chunks removed under a file document: a read returns short with no driver error. `readRange` now compares the bytes received with the range. No phase was invalidated.

## Phase 5 — In the app, a body can be typed and sent, and a large one read through Load more

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Changed**
- `src/shared/ipc-contract.ts` — `readBody` channel, `ReadBodyInputSchema` limited to 1 MiB per read, `ReadBodyResultSchema`.
- `src/main/ipc.ts` — `readBody` handler on the `bodies` bucket; `InvalidBodyError` returns `invalid-input`.
- `src/preload.ts` — `readBody`, the seventh named function.
- `src/renderer/app.tsx` — Body type selector, text box, rows editor for Form; the request body in `CallPanel`; `BodyText` and `PagedBodyText` with Load more and a remaining count; Edit's refusal in its own message.

**Verification**

```
$ npm run typecheck && npm run lint
typecheck 0
All matched files use the correct format.
```

Scripted observation: a throwaway Playwright spec against the built app, on a `dp_test_` database, deleted afterwards. Output:

```
OBS json received "{\"a\":\"é\"}" application/json
OBS xml received "<a/>" application/xml
OBS text received "hello" text/plain
OBS form received a+b=1%262%3D%C3%A9 application/x-www-form-urlencoded
OBS panel request {"x":1} | response the response
OBS replay equal bytes true equal headers true
OBS edit type json text {"x":1}
OBS curl body {"x":1} count+1 true
OBS curl @ body @/etc/hosts
OBS curl over limit Cannot export as curl: The command is too long for a shell: 951 KiB, limit 900 KiB
OBS HEAD Not sent: HEAD cannot carry a body: curl cannot export it reliably rows same true requests same true
OBS first page {"length":1048576,"nodes":1,"start":"START-MARKER","end":"aaaaaaaaaaaa","bad":false,"euro":false} 16,777,240 of 17,825,816 bytes not loaded
OBS loaded 17 clicks {"length":17825816,"nodes":18,"start":"START-MARKER","end":"FINAL-MARKER","bad":false,"euro":false}
OBS split char: first page {"length":1048575,"nodes":1,...,"euro":false} final {"length":1048676,"nodes":2,...,"bad":false,"euro":true}
OBS double click remaining 1048576 text 2097152
OBS received 2097157
OBS panel pages 1,048,581 of 2,097,157 bytes not loaded
OBS replay equal true
OBS edit Cannot edit this call: The body is too large to edit: 2.0 MiB
OBS curl Cannot export as curl: The body is too long for a shell command: 2.0 MiB
OBS row GET http://127.0.0.1:54261/ — cancelled · 11/6/2026, 11:11:47 PM
  6 passed (19.1s)
$ grep -c 'MongoClient' / 'undici' / 'GridFSBucket' .vite/build/preload.cjs .vite/renderer/main_window/assets/*.js
preload MongoClient 0, undici 0, GridFSBucket 0
renderer MongoClient 0, undici 0, GridFSBucket 0
```

Regression gates after the script was deleted:

```
$ npm run test:unit
      Tests  178 passed (178)
$ npm run test:integration
      Tests  239 passed (239)
$ npm run test:e2e
  12 passed (16.2s)
```

PASS — every observation in the plan held in the built app. A4 holds: `GridFSBucket` works in the bundled main process. A7 holds for 18 text nodes holding 17 MiB: Load more stayed usable to the end. The memory and scrolling feel of that page were not measured.

The observation script's first run failed on its own race: Copy was pressed before `getCall` answered, so it exported the call still shown. The panel keeps showing the previous call until the answer arrives, as before this change. The script now waits after opening.

**Drift:** decision — the plan routed "curl's refusal" through `CurlView` and said Edit "says why" → the curl refusal uses `CurlView`, and Edit has its own `call-edit-error`, because phase 4's temporary use of the curl message would have read "Cannot export as curl".
**Drift:** decision — the plan did not state when a stored body's first page is read → it is read when the body is shown, so "the first page and the remaining count" appears with no click.
**Drift:** decision — the plan did not cover nameless Form rows → they are dropped before sending, as for query and header rows, and `requestOf` holds this for Send and Copy as curl.
**Drift:** decision — the plan did not cover changing the body type → None and Form discard typed text, and JSON, XML and Text share it.

## Phase 6 — The journeys with a body and with a 17 MiB response hold in the built app

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-06
- **Finished:** 2026-11-06

**Risks that passed the gate (`test-strategy.md`):**
- T2.7: the form, panel and history do not connect to the tested core, so a typed body is not sent, shown, replayed or edited.
- T2.9: an action on a body changes something out of view, so it appears to do nothing.
- T2.10: a page read for one body appears under the next call.

**Routed, no scenario written:** encoding, stored bytes, range reads, refusals and failure paths are covered at integration and unit in phases 1 to 4.

**Changed**
- `e2e/bodies.spec.ts` — new, 5 scenarios: T2.7 journey with Replay and Edit; Form rows; HEAD refusal in view; 17 MiB response through Load more; a large typed body with Replay and the Edit and curl refusals in view.
- `e2e/open-call-failures.spec.ts` — 1 scenario added: T2.10, a held read for a body no longer shown is ignored. The `getCall` stub gained an optional request body.

**A failure and its cause.** The 17 MiB scenario failed on the viewport check at page 11. A probe measured the `<pre>` width changing from 960 to 481 at that moment. DevTools opens when the app is not packaged (`src/main.ts:45`), and docking takes half the window some time after launch. The reflow left the new page out of view. It was first attributed to text length, and a scroll correction was added to `app.tsx`. The width measurement disproved that, and the correction was removed before the entry below was recorded: phase 6 made no net change to `src/`. The scenario file now waits for DevTools to open, closes it, and waits until the page fills the window before any position check.

**Mutations, each rebuilt with `npm run package` and restored (`cmp` confirmed):**
```
[Load more reads the same page twice]         2 failed (17 MiB; held read)
[panel body is not the stored one]            4 failed (T2.7; Form; large typed body; held read)
[held read applied to another call (no key)]  1 failed (held read)
[Load more moves the view away]               1 failed (17 MiB)
[no one-read-at-a-time guard]                 9 passed
```

The last mutant survived. In the production build a click disables Load more before a second click can land, so the disabled button also stops a double read. The `busy` ref is otherwise relevant only under `StrictMode`'s double effect in development. Phase 5's observation of a double click reading one page holds with or without the ref. The plan's done-when does not name this mutation.

**Verification**

```
$ npx playwright test e2e/bodies.spec.ts e2e/open-call-failures.spec.ts   (three runs)
[clean run 1]  9 passed (16.6s)
[clean run 2]  9 passed (15.8s)
[clean run 3]  9 passed (19.0s)
$ npm run typecheck && npm run lint
typecheck 0
lint 0
$ npm run test:e2e
  18 passed (27.3s)
dp_test_ databases remaining: 0
```

PASS — all specs pass, the new scenarios ran 3 times clean, and no `dp_test_` database remains. Unit and integration were last run in phase 5; `src/core/` has not changed since.

**Observation, not changed:** the first page of a stored response is 1 MiB of text, about 131,000 px tall at full width in the probe. In the result view it sits above History, so reaching History after such a send takes a long scroll. A body just under 1 MiB shows whole with the same effect. The plan does not address it. T3.2 covers appearance through daily use.

**Drift:** decision — the plan listed the scenarios → `bodies.spec.ts` also waits for DevTools and closes it before any position check, because docking changes the width under that check.
**Drift:** decision — the plan's T2.10 scenario did not name its data → it uses stubbed `getCall` and `readBody` answers, following the file's existing pattern, because the order of answers cannot be arranged from outside.

## Follow-up — Code review findings 1, 2, 4, 5, 8 and 9

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-07
- **Finished:** 2026-11-07

Source: `/code-review` run by the author, 10 findings. The author replied "go ahead with 1, 2, 4, 5, 8, 9, accept the rest". Statuses of phases 1 to 6 are unchanged by this section. `review.md` predates these findings.

**Changed**
- `src/core/body-store.ts` — finding 1: `abort()` removes the chunks by `files_id` after a failed `finish()`, because the driver's `abort()` refuses a stream already ended. It does nothing after a successful `finish()`. Finding 4: `write`, `writeBytes`, `readRange` and `readAll` take a signal, checked per piece and per part.
- `src/core/send.ts` — finding 4: new `SendCancelledError`, raised when a cancel stops a large body before a send document exists. A small request is still recorded as `cancelled`. Finding 9: uses the shared error type.
- `src/core/form-from-call.ts` — findings 2 and 5: rows are recovered only when no name is blank after trimming and no name or value holds a line break. Otherwise the body loads as Text.
- `src/core/call-schema.ts` — finding 9: one `CompletionErrorSchema`, used by both completion schemas.
- `src/main/ipc.ts` — finding 8: `plainSend` copies the request body on send, replay and open. Finding 4: `SendCancelledError` returns the new kind `cancelled`.
- `src/shared/ipc-contract.ts` — the kind `cancelled`. The renderer shows it through the existing "Not sent" result.
- Tests: new `src/main/ipc.int.test.ts`, additions to `body-store.int.test.ts`, `large-bodies.int.test.ts` and `form-from-call.test.ts`.

**Red, on the unfixed code, against a stub `SendCancelledError`**

```
$ npx vitest run --project unit src/core/form-from-call.test.ts
      Tests  6 failed | 39 passed (45)
AssertionError: expected { type: 'form', …(1) } to deeply equal { type: 'text', text: '+=1&a=2' }
$ npx vitest run --project integration src/core/large-bodies.int.test.ts src/main/ipc.int.test.ts
      Tests  5 failed | 17 passed (22)
AssertionError: expected { files: +0, chunks: 5 } to deeply equal { files: +0, chunks: +0 }
AssertionError: promise resolved "{ send: { …(4) }, completion: { …(6) } }" instead of rejecting
AssertionError: expected true to be false // Object.is equality
AssertionError: expected { ok: true, send: { …(4) }, …(1) } to match object { ok: false, …(1) }
$ npx vitest run --project integration src/core/body-store.int.test.ts
      Tests  4 failed | 18 passed (22)
AssertionError: expected { files: +0, chunks: 2 } to deeply equal { files: +0, chunks: +0 }
AssertionError: promise resolved "Uint8Array[ 0, 31, 62, 93, 124, …(1305446) ]" instead of rejecting
```

The first `body-store` run failed on a missing `afterEach` import in the test file. It was fixed and the red step repeated.

Passed before the fix, not seen red: `and aborting a finished upload still removes nothing` and `a small request is still recorded as cancelled, as before`. Both guard behaviour that already held. The first fails under the mutation below. Finding 9 is a refactor with no behaviour change: the existing tests are its net, and no test was edited for it.

**Mutation, restored (`cmp` confirmed):** `abort()` no longer stops at a finished file → 2 failed (`and aborting a finished upload still removes nothing`, `the body store offers no way to remove a finished file`).

**Verification**

```
$ npm run typecheck
typecheck 0
$ npm run lint
All matched files use the correct format.
$ npm run test:unit
      Tests  184 passed (184)
$ npm run test:integration
      Tests  250 passed (250)
$ npm run test:e2e
  18 passed (26.6s)
```

PASS — each fix has a test seen failing first. **Not observed in the app:** the `cancelled` result on screen. The IPC test proves the result, and the renderer's "Not sent" branch handles every kind other than `not-recorded`, but pressing Cancel during a large write has no e2e test.

**Accepted by the author, with no code change:**
- Finding 3 — a finished body file stays when the insert of its document then fails. The plan's Out of scope excludes this cleanup. **Slice 7 must extend its orphan sweep:** these files have a file document and no call refers to them, so looking in `bodies.chunks` for chunks with no file document misses them.
- Finding 6 — `MAX_COMMAND_BYTES` fits macOS only. Linux caps one argument at 128 KiB, so a command between 128 KiB and 900 KiB is offered there and fails. Revisit when the work machine's OS is decided. The PRD requires that machine.
- Finding 7 — `durationMs` includes time spent writing to GridFS. Storage slows the read loop, so timing the transfer separately would remove only the final `finish()` and still read as more exact than it is.
- Finding 10 — the `'fileId' in body` check is repeated in five files. Duplication only.

**Drift:** decision — the plan listed no `cancelled` result kind → `SendResult` gained it, because a cancel during a large body happens before a send document exists, so no `cancelled` completion can be recorded.
**Drift:** decision — the plan said `abort()` removes an upload through the driver → after a failed `finish()` the store deletes the chunks itself, because the driver refuses to abort an ended stream. The spike tested `abort()` only before the stream ended.

## Follow-up — Second code review findings 1, 2, 4, 5 and 7

- **Executor:** lz-tdd (core), lz-e2e (renderer)
- **Status:** done
- **Started:** 2026-11-07
- **Finished:** 2026-11-07

Source: a second `/code-review` run by the author on the code after the first follow-up, 10 findings. The author chose the option "Fix first, then draft" at `/lz-pr`, which fixes 1, 2, 4, 5 and 7 and accepts 3, 6, 8, 9 and 10. Statuses of phases 1 to 6 are unchanged by this section. `review.md` predates these findings.

**Probe before fixing finding 2** (standing rule, undici 8.12.3): a throwaway script sent a 30 MiB `Uint8Array` to a local server reading 1 MiB per second, then was deleted.

```
headersTimeout 2000   failed UND_ERR_HEADERS_TIMEOUT 2507 ms
headersTimeout 40000  ok done 31457280 30288 ms
```

The headers timer runs during the upload, as the finding stated.

**Changed**
- `src/renderer/app.tsx` — finding 1: `readNext` depends on `file.fileId` and `file.length`, so reopening a call does not load another page. Finding 5: new `InlineBodyText` memoizes the decoded text.
- `src/core/send.ts` — finding 2: the headers timeout gains one second per whole MiB of request body, so a body under 1 MiB keeps 30 s. The body timeout is unchanged.
- `src/main/ipc.ts` — finding 7: one `plainBody`, used by `plainBytes` and `plainSend`.
- `e2e/bodies.spec.ts` — finding 4: the clipboard is stubbed. A new scenario covers finding 1.
- `src/core/send.test.ts` — the timeout tests for finding 2.

**Red, on the unfixed code**

```
$ npx vitest run --project unit src/core/send.test.ts
 FAIL  every request has the 30 s timeouts > a larger body adds one second per MiB to the headers timeout only
      Tests  1 failed | 12 passed (13)
$ npx playwright test e2e/bodies.spec.ts -g "already shown"
 ✘  opening the call already shown does not load another page (second review, finding 1)
    Expected: "2097152"
    Received: "1048576"
```

Passed before the fix, not seen red: `a body under 1 MiB keeps the 30 s`, which guards behaviour that already held. Findings 5 and 7 change no behaviour, so the existing tests are their net: no test shows that the memoization avoids a decode. Finding 4 has no failing state, since the export in that spec is refused before the clipboard.

**Verification**

```
$ npm run typecheck
typecheck 0
$ npm run lint
lint 0
$ npm run test:unit
      Tests  186 passed (186)
$ npm run test:integration
      Tests  250 passed (250)
$ npm run test:e2e
  19 passed (21.5s)
$ npx playwright test e2e/bodies.spec.ts   (three runs)
  6 passed (11.3s)
  6 passed (11.4s)
  6 passed (11.5s)
```

PASS — findings 1 and 2 each have a test seen failing first. **Not tested:** a real slow upload through `sendAndRecord`. The unit test reads the value undici is given, and the probe above shows that a longer value lets the upload finish.

**Accepted, with no code change:**
- Finding 3 — a `Content-Type` typed last and in lowercase looks generated, so Edit drops its row, and changing the body type then changes the header. The plan chose this rule, and the record cannot tell typed from generated.
- Finding 6 — `includeBodies` has no production caller. It predates this change and belongs in its own cleanup.
- Finding 8 — the error mapping is written twice, and a file removed between two steps of a read reports the database as unavailable. Nothing can remove a file until slice 7. **Slice 7 must recheck this path.**
- Finding 9 — replay loads the whole call. The plan's Alternatives rejected a separate `getSend`.
- Finding 10 — the MiB message and the decoder setup are repeated. The Monaco change reworks these readers.

**Drift:** decision — T2.11 and the plan state a 30 s headers timeout → a request body adds one second per whole MiB, because the timer runs during the upload (probe above) and a large body would otherwise be recorded as a timeout before the server could answer. A slower link than about 8 Mbit/s can still time out. `test-strategy.md` T2.11 needs this stated.

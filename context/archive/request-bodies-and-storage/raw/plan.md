---
change_id: request-bodies-and-storage
status: draft
produced-by: lz-plan
created: 2026-11-06
updated: 2026-11-06
inputs: [change.md, author answers 2026-11-06, plan review 2026-11-06, spike-undici-bodies.md, spike-curl-bodies.md, spike-gridfs-streaming.md, foundation/prd.md, foundation/tech-stack.md, foundation/test-strategy.md, foundation/roadmap.md, foundation/lessons.md, archive/send-and-record/record.md, archive/preview-replay-export/record.md]
---

# Plan: Send, replay and export request bodies, and store bodies over 16 MB in full

## Approach

**A stored body is either bytes in the document or a reference to a GridFS file, and every reader handles
both.** `request.body` and `response.body` become one shared shape: bytes for a body up to 1 MiB, or
`{ fileId, length }` above it. Text typed in the form is encoded to UTF-8 once, in main, and those bytes are
what is recorded and sent. The threshold is well under MongoDB's 16 MB limit and equals the display page, so
every inline body is shown whole and every GridFS body is paged. Existing documents (`body: null` on a send,
bytes on a completion) still parse, so `schemaVersion` stays 1 and nothing is migrated (records are
immutable).

**The insert-only order holds: bytes first, then the document that refers to them.** A request body over the
threshold goes to GridFS before its send document, which is still written before dispatch (T1.2). A response
is held in memory up to the threshold, then streamed into GridFS (author decision), so main's memory stays
bounded at any size. The completion is written once the file is finished. A cancel or failure mid-stream
aborts the upload and removes its chunks, so no document ever refers to a partial file. A GridFS file is
never changed. A replay copies a stored request body to a new file, so each call owns its bytes and slice 7
can delete a call without counting references.

**The form gets a Body type: None, JSON, XML, Text, Form.** JSON, XML and Text use one text box; Form
reuses the rows editor (author decision) and encodes with `URLSearchParams`. A chosen type adds its
`Content-Type` to the wire list unless one was typed, then `content-length` with the byte count, last
(`spike-undici-bodies.md`). An empty text box records `body: null`, which is identical on the wire, and generates no `Content-Type`: no
body, no header about one (plan review). `HEAD` with
a body is refused before anything is recorded, because curl cannot export it reliably: `--head` exits 2 with a
body (`spike-curl-bodies.md`). The record holds bytes only. `formFromCall` recovers the type from `Content-Type`, and for Form recovers rows only
when re-encoding them gives the recorded bytes; otherwise the body loads as Text.

**A large body is read in pages (author decision).** A new IPC call `readBody({ fileId, offset, length })`
returns up to 1 MiB from the `bodies` GridFS bucket. A shared `BodyText` component shows inline bytes at once,
and shows a GridFS body one page at a time with **Load more** and a count of what remains, using a streaming
`TextDecoder` so a multi-byte character across a page boundary decodes correctly. Pages are held as a list with one
text node each, not appended to one string: V8's limit of 536,870,888 characters would otherwise apply to paging too
(plan review). Renderer memory is still limited by how much is loaded, so very large bodies are reachable page by page
only as far as memory allows. Decoding keeps a byte order
mark (`ignoreBOM: true`), because dropping it would make Edit change the bytes (plan review). Each read belongs to
the body it was requested for: one read at a time, and an answer for a body no longer shown is ignored, as for
opening a call (T2.10). The next change's editor
can reuse the same call.

**Curl gains `--data-raw`** for a body held inline. `--data-binary` is ruled out: a body starting with `@` makes
it send a local file (`spike-curl-bodies.md`). A command over 900 KiB is refused with a stated reason (author
decision), as a bad header is. `ARG_MAX` here is 1 MiB and includes the environment, and sending failed between
1000 KiB and 1023 KiB. The limit applies to the whole command, because quoting makes it longer than the body, so
the curl exit criterion holds up to that size. A GridFS body is always above it.

This follows `archive/preview-replay-export/record.md`: replay sends what was recorded, refused input leaves
no record, and T2.4 runs curl for real. The standing undici rule applies: every request shape below is an
assumption until probed. A1 and A3 were probed; A2's probe changed the flag.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Buffer the whole response in memory, then store it | Author chose streaming. A response larger than available memory could crash main, so "any size" would not hold. |
| Send the whole body over IPC into one `<pre>` | Author chose pages. Tens of MB are slow, and above about 512 MB a body cannot be decoded into one string. |
| Append each page to one string | Reaches the same 536,870,888-character limit. A list of pages does not. |
| A raw text box for form-urlencoded | Author chose rows: no hand-encoding, and it matches Query and Header. |
| `--data-binary`, the flag first planned | A body starting with `@` sends that local file to the server (`spike-curl-bodies.md`): a false export and a data leak. |
| A body on `HEAD` | undici sends it, but `--head` exits 2 with a body and `-X HEAD` may wait for a response body. Refusing means no record exists that cannot be exported. Dropping it silently would make the record false. |
| Save the body to a file and export `--data-binary @file` | Author chose refusing: a save dialog and a file path inside the copied command, for a case a command line cannot hold. |
| All bodies in GridFS, nothing inline | A round trip per opened call and a file per small body, for no gain below the limit. |
| Inline threshold near 16 MB | Every history read would have to exclude larger documents, and a document's other fields count toward the limit. 1 MiB also makes the threshold and the display page one number. |
| A replay's send document referring to the original's GridFS file | Slice 7's delete would need reference counts, or deleting one call would break another. Copying costs storage, which the PRD accepts. |
| Streaming a stored request body to undici on replay | Request bodies reach main in memory through IPC anyway, and a replay of one is bounded by what was once typed. Less code; loaded into memory. |
| Storing decoded text beside the bytes for slice 6's search | Out of this change. See Risks: slice 6 can add a derived collection without changing this shape. |
| A separate `getSend` read for replay (R10 in `archive/preview-replay-export`) | Stored responses are no longer read by `getCall`, so the cost remains only for older inline bodies. A call with a corrupt completion stays non-replayable, as already decided. Revisit if it matters. |
| `schemaVersion: 2` | The change only adds allowed values, as `invalid-request` did. Old documents parse unchanged. |

## Out of scope

- Editing a call whose request body is in GridFS. Edit shows why and leaves the form alone: the text box would
  hold the whole body in the renderer. Replay and Copy still follow their own rules.
- Exporting a stored response or a large request body by any route other than curl's refusal.
- Character sets. Typed text is sent as UTF-8, and `Content-Type` carries no `charset`. Responses are decoded
  as UTF-8 for display, as today; a Latin-1 or binary response shows replacement characters, with its bytes
  stored unchanged.
- Choosing a file as a request body. Slice 4 brings files.
- Removing GridFS files left by a crash mid-stream or by a send document that failed to insert. Nothing refers
  to them. Slice 7 owns deletion, and must look in `bodies.chunks` as well as `bodies.files`: a crash leaves chunks with no file document
  (`spike-gridfs-streaming.md`).
- A progress indicator during a large transfer. Cancel keeps working.
- Freeing or windowing loaded pages. A body loaded far enough can exhaust renderer memory; the stored bytes are unaffected.
- Updating `test-strategy.md`, `AGENTS.md` and `roadmap.md`: their producers do it afterwards.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | undici 8.12.3, given a `Uint8Array` body, sends those exact bytes with `content-length: <bytes>` last, keeps a listed `Content-Type` in place with its case, and leaves `connection` as today, for all seven methods. | Records differ from the wire, the tier-1 failure; phases 1 and 2 stall. | yes — **verified 2026-11-06** (`spike-undici-bodies.md`), Node 22.22.2. Phase 1's T1.3 tests repeat it. |
| A2 | curl 8.7.1 with `--data-raw` sends the recorded bytes and only the recorded headers on `GET`, `DELETE`, `OPTIONS`, `POST`, `PUT` and `PATCH`, given `-H 'Content-Type:'` when none is recorded. No `Expect` appears at any size a command can hold. A command up to 900 KiB runs through `sh -c`. | The curl promise fails for bodies; phase 3 changes. | yes — **verified 2026-11-06** (`spike-curl-bodies.md`); `--data-binary` failed. The limit holds for this machine's environment. Not tested: pasting into a terminal, which may have a lower limit. |
| A3 | Driver 7.8.0's `GridFSBucket` takes a string id, removes chunks when `abort()` is called, reads a range when `end` is explicit and at most the file's length, and streams 17 MiB with undici's body as the source. | Phase 4's order or its range reads change. | yes — **verified 2026-11-06** (`spike-gridfs-streaming.md`), not in the bundled main process (A4). |
| A4 | `GridFSBucket` works in the bundled main process, as the driver does (`archive/send-and-record` A1). | Phase 5 cannot observe large bodies in the app. | no — covered by phases 5 and 6 on the production build |
| A5 | Existing documents parse under the widened schemas, and `promoteBuffers` returns a nested body as bytes. | Old calls list as unreadable. | no — phase 1's T2.2 fixtures show it |
| A6 | Rows encoded with `URLSearchParams`, parsed and encoded again, give the same bytes for values with spaces, `&`, `=`, `+` and non-ASCII. | Edit falls back to Text more often than expected. The record is unaffected. | no — phase 2's test |
| A7 | 17 one-MiB text nodes in a `<pre>` stay usable. | Paging needs a window, showing only some pages at a time. | no — phase 6 runs it |

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | A request with a body reaches the wire as recorded, and history stays body-less | `src/core/wire.ts`, `src/core/send.ts`, `src/core/call-schema.ts`, `src/core/call-store.ts`, `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, tests beside them | lz-tdd | `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e` |
| 2 | A call with a body replays with the same bytes, and loads into the form for editing | `src/core/send.ts`, `src/core/form-from-call.ts`, tests beside them | lz-tdd | `npm run test:unit`, `npm run test:integration` |
| 3 | A curl export sends the recorded body, and refuses one too long for a command | `src/core/curl.ts`, `src/core/curl.int.test.ts` | lz-tdd | `npm run test:integration` |
| 4 | A body over 16 MB is stored in full and can be read back by range | new `src/core/body-store.ts`, `src/core/send.ts`, `src/core/call-store.ts`, `src/core/call-schema.ts`, `src/core/curl.ts`, `src/core/form-from-call.ts`, `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/renderer/app.tsx`, tests beside them | lz-tdd | `npm run typecheck`, `npm run test:integration`, `npm run test:e2e` |
| 5 | In the app, a body can be typed and sent, and a large one read through Load more | `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/app.tsx` | lz-build | `npm run typecheck`, `npm run lint`; scripted observation against the built app |
| 6 | The journeys with a body and with a 17 MiB response hold in the built app | new `e2e/bodies.spec.ts`, `e2e/open-call-failures.spec.ts` | lz-e2e | `npm run test:e2e` |

### Phase 1 — A request with a body reaches the wire as recorded, and history stays body-less

**Changes:**
- `src/core/wire.ts`: `WireInput` gains a body (type and text, or rows). `buildWireRequest` encodes it to bytes,
  adds the generated `Content-Type` after the typed headers unless one was typed, and lists `content-length: <bytes>` last. An empty text box is
  `body: null`, with the existing `content-length: 0` rule. `HEAD` with a body throws a new `InvalidBodyError`, shown as "Not sent". `WireRequest`
  gains `body`. A typed `Content-Length` is still replaced.
- `src/core/call-schema.ts`: `request.body` accepts bytes as well as `null`. A new `SendSummarySchema` has no body.
- `src/core/call-store.ts`: `listCalls` projects out `request.body` as well as `response.body` (`:83`), and rows use
  the summary schema. Up to 200 send documents must not load their bodies (slice 1 review #9).
- `src/shared/ipc-contract.ts`, `src/main/ipc.ts`: `CallViewSchema` uses the summary schema (`:57`) and `toView` follows, so history keeps working with the
  body projected out. Without this, `ListCallsResultSchema.parse` rejects every row.
- `src/core/send.ts`: `sendWireAndRecord` passes the bytes to undici. `classifySendError` maps `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH` to `invalid-request`.
- Tests:
  - T1.2 and T1.3: for all six methods other than `HEAD` and each body type, what the capture server received (bytes, headers in
    order) equals the send document. The comparison covers the whole request, per the 2026-11-04 observation.
  - Non-ASCII text arrives as its UTF-8 bytes. An empty body with a type selected records `body: null` and no `Content-Type`.
  - T1.2: `HEAD` with a body is refused, leaves no send document and sends nothing.
  - T2.2: a `body: null` fixture and an old completion still parse.
  - `listCalls` returns no body.

**Verification:**
```
$ npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e
expected: exit 0; new wire, send, schema and store tests listed and passing; history still lists in the built app
```

**Done when:** both pass, and each of these fails a test: recording the text instead of the sent bytes, dropping the
projection, a wrong `content-length`, and letting `HEAD` carry a body.

**Executor:** lz-tdd — T1.2 and T1.3 are integration risks, specifiable before the code.

### Phase 2 — A call with a body replays with the same bytes, and loads into the form

**Changes:**
- `src/core/send.ts`: `replayCall` passes the recorded body with the recorded header list.
- `src/core/form-from-call.ts`: returns the body type and text or rows. `Content-Type` is hidden when it equals what the
  type generates and sits where `wire.ts` generates it, so a typed one keeps its row and position. `content-length` is hidden when it equals the body's size. Rows are recovered only when re-encoding gives the recorded bytes; otherwise the type is Text and a
  non-matching `Content-Type` stays a row.
- Tests:
  - T1.3: a replay's bytes and headers at the capture server equal the original's
  - T1.1: a replay and an edit-and-send leave `getCall(original)` deep-equal
  - round trip through the form for each type, including values with spaces, `&`, `=`, `+` and non-ASCII, and a text body starting with a byte order mark

**Verification:**
```
$ npm run test:unit && npm run test:integration
expected: exit 0
```

**Done when:** both pass, and replaying with the body dropped, and rows that do not re-encode exactly being kept as rows,
each fail a test.

**Executor:** lz-tdd.

### Phase 3 — A curl export sends the recorded body, and refuses one too long for a command

**Changes:**
- `src/core/curl.ts`: `--data-raw` with single-quoted text, and `-H 'Content-Type:'` when the list holds no `Content-Type`. A refusal with a stated
  reason for a command over 900 KiB, measured in bytes, and for bytes a shell cannot hold (NUL or invalid UTF-8, from an old or future source).
- `src/core/curl.int.test.ts` (T2.4): through `sh -c`, for `GET`, `DELETE`, `OPTIONS`, `POST`, `PUT`, `PATCH` and each body type, the bytes and headers received equal
  the record. A body with newlines, CRLF and `'`, `"`, `$`, `\` arrives unchanged. **A body starting with `@` arrives as text, and no file is read.** A command just
  under the limit sends, and one just over is refused. Repeated quotes count toward the limit.

**Verification:**
```
$ npm run test:integration
expected: exit 0; curl tests listed and passing
```

**Done when:** tests pass, and each of these fails a test: using `--data-binary`, removing the `Content-Type` suppression, measuring the body instead of the command, and removing the refusal.

**Executor:** lz-tdd.

### Phase 4 — A body over 16 MB is stored in full and can be read back by range

**Changes:**
- `src/core/body-store.ts`: new, on a `bodies` bucket. Writes bytes, streams with abort, and reads a range. Writes only, plus
  removal of its own unfinished upload. No function removes a finished file.
- `src/core/call-schema.ts`: `request.body` and `response.body` accept `{ fileId, length }`. The store-keys test still asserts
  no update or delete.
- `src/shared/ipc-contract.ts`, `src/main/ipc.ts`: the views and `plainBytes` accept both shapes.
- `src/core/curl.ts`: refuses a body held in GridFS with a stated reason. `src/core/form-from-call.ts`: reports a stored body as not loadable, so Edit can say why in phase 5. `app.tsx` passes the recorded request to both (`:44`, `:244`).
- `src/renderer/app.tsx`: `CompletionView` shows a stored body's size in place of its text, until phase 5 adds pages. No renderer path decodes a reference.
- `src/core/send.ts`:
  - a request body over 1 MiB goes to GridFS before its send document; a failed upload raises `DatabaseUnavailableError` for a driver error, as `insertSend` does, and nothing is dispatched
  - a response stays in memory up to 1 MiB, then streams to a file, in one read loop with no `break`, since leaving a `for await` destroys undici's body. The upload's `error` listener is attached before the first write, since an unhandled one crashes main
  - a cancel, timeout or network failure mid-body calls `abort()` explicitly, because `pipeline` leaves the chunks, and records the usual error
  - a storage failure mid-body records a new error code, `storage`, and stops the transfer
  - a replay copies a stored request body to a new file; a missing file raises `CallNotReplayableError`, with no send document written
- Tests:
  - T1.5: a 17 MiB response and a 17 MiB request body read back byte for byte (compare by SHA-256), and each document is well
    under the limit
  - a body at exactly 1 MiB stays inline, and 1 MiB + 1 goes to GridFS
  - range reads across chunk boundaries and at the end; a read at or past the end returns nothing; an unknown file is an error
  - a cancel and a server dying mid-body each leave no chunks in `bodies.chunks`, and no document refers to a file
  - T1.6: a failed request-body upload dispatches nothing and reports the database as unavailable
  - a storage failure mid-stream, through a store that fails, records `storage` and does not crash the process
  - a replay whose stored request file is gone rejects and sends nothing
  - T1.1: a replay of a large request has its own file, and the original's document and file are unchanged
  - `listCalls` and `getCall` never read file contents
  - `toCurl` refuses a stored body, and `formFromCall` reports one

**Verification:**
```
$ npm run typecheck && npm run test:integration && npm run test:e2e
expected: exit 0; T1.5 tests listed and passing; the built app still lists and opens calls
```

**Done when:** tests pass, and each of these fails a test: writing the send document before the file, not calling `abort()` on cancel,
sharing the file on replay, an off-by-one in the range, and not clamping `end` to the length.

**Executor:** lz-tdd — T1.5 is assigned to integration, and only a real MongoDB enforces the limit.

### Phase 5 — In the app, a body can be typed and sent, and a large one read through Load more

**Changes:**
- `src/shared/ipc-contract.ts`: body fields on `SendInput` and in the views; a `readBody` channel with its schema.
- `src/main/ipc.ts`: a `readBody` handler limited to the `bodies` bucket and to 1 MiB per read; `InvalidBodyError` returns `invalid-input`, like `InvalidHeaderError`.
- `src/preload.ts`: `readBody`, the seventh named function.
- `src/renderer/app.tsx`:
  - a Body type selector, a text box, and the rows editor for Form
  - the request body in `CallPanel`
  - `BodyText` for request and response bodies, as text only, with Load more and the remaining count. Pages are a list with one text node each. One read at a time, an answer for a body no longer shown is ignored, and decoding keeps a byte order mark
  - Edit fills the body, or says why it cannot for a stored body
  - curl's refusal shown through the existing `CurlView`
  - `HEAD` with a body shows "Not sent", through the existing result

**Verification:**
```
$ npm run typecheck && npm run lint
expected: exit 0
$ scripted observation against the built app (throwaway Playwright script, deleted afterwards), dp_test_ database:
observe: type each body type, Send → the capture server received the bytes, with the Content-Type
observe: open the call → the request body and response shown; Replay → same bytes received; Edit → form filled
observe: Copy call as curl → the command runs and delivers the body; a body over the limit shows the refusal; a body starting with @ arrives as text
observe: HEAD with a body → "Not sent" and no new row
observe: a 17 MiB response → the first page and the remaining count; Load more to the end; the last bytes visible
observe: a body over 1 MiB typed in the form → sent and stored; the panel pages it; Replay sends the same bytes; Edit and Copy call as curl each show their refusal
observe: a multi-byte character across a page boundary displays correctly
observe: a double click on Load more reads one page, with no text repeated
observe: Cancel during a large response → a cancelled row
$ grep -c 'MongoClient' / 'undici' / 'GridFSBucket' in the preload and renderer bundles
expected: 0
```

**Done when:** all observations hold and are recorded with output.

**Executor:** lz-build — IPC, preload and renderer wiring over behaviour tested in phases 1–4.

### Phase 6 — The journeys with a body and with a 17 MiB response hold in the built app

**Changes:** `e2e/bodies.spec.ts` and `e2e/open-call-failures.spec.ts`, through `launchWithTestDatabase()`:
- T2.7: send a JSON body, open the row, Replay; two rows, and the server received equal bytes twice. Edit changes the text and
  sends; the original still shows its body.
- A Form body through rows arrives encoded.
- A 17 MiB response: Load more until nothing remains, the final marker is in the text, and the response's start remains. These read the remaining count and the text's ends through
  `evaluate`, because `toContainText` would carry the whole body across the Playwright bridge on every retry.
- T2.10, in `open-call-failures.spec.ts`: with the read-body handler holding its answer, press Load more and open another call, then release the answer. The panel shows only the new call's body.
- T2.9: what each new action changes is in the viewport.

**Verification:**
```
$ npm run test:e2e
expected: all specs pass; 3 clean runs of the new spec; no dp_test_ database remains
```

**Done when:** the spec passes three times, and fails when Load more reads the same page twice, when the panel's body is
not the stored one, and when a held read is applied to a different call.

**Executor:** lz-e2e — T2.7 and T2.9 are e2e risks.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| A body on `GET`, `DELETE` or `OPTIONS` is dropped or rejected by a server or proxy | possible | The call shows what happened; undici sends it | Nothing refused here: the record is true either way. Only `HEAD` is refused |
| A body under 1 MiB is refused by curl because the command is over 900 KiB | expected | No export for that call; replay still works | The reason is shown; recorded as the limit of the exit criterion |
| A crash mid-stream leaves chunks or a file nothing refers to | low | Wasted storage; no false record, because the completion is written last | Out of scope; recorded for slice 7 |
| The 17 MiB tests slow the gate | likely | Integration and e2e take longer | Bodies are generated, not stored; one test each per direction |
| Slice 6 needs to search bodies, and bytes or GridFS files cannot match `$regex` | certain | Search needs another source | Not this change. A derived collection of extracted text can be added by slice 6 without changing these documents. Named for that plan |
| Old records' `null` and bytes fail the widened schema | low | Old calls list as unreadable | T2.2 fixtures in phase 1 |
| `readBody` becomes a way to read arbitrary data | low | Renderer reads beyond call bodies | Limited to the bucket and 1 MiB, validated with `zod`; bytes are shown as text only |
| A stored body is opened on a database whose file is gone | low | Load more fails; replay refuses | The error is shown, the call's documents stay readable, and a replay records nothing |

## For the reviewer

- **Weakest link:** phase 4's failure paths. The spike showed that `pipeline` leaves chunks on a cancel. A storage failure mid-stream is specified but not probed, and a crash is not tested.
- **Four choices the author did not make directly:** the 1 MiB threshold, a Body type selector that generates `Content-Type`, Edit refusing a stored request body, and
  refusing a body on `HEAD`. The plan review named them and found nothing against them; the author proceeded without objecting. The spike hand-off recommended "the form offers no body on `HEAD`"; the plan refuses in `wire.ts` instead, so no input can record one and no silent drop
  exists.
- **The 900 KiB limit** is a margin below one machine's measurement, and pasting into a terminal is untested. A lower real limit would make some exports fail in the terminal with the record unaffected.
- **Phase 4 is the largest:** storage, streaming, failure handling, replay's copy and the first renderer branch in one phase. It verifies without phase 5, through the test suites and an unchanged journey in the built app.
- **Order:** storage comes after replay and curl because phases 1–3 prove the inline shape first. The opposite order would settle the storage
  shape earlier. The cost of this order is widening the schema twice.
- **The new `storage` error code** is added beside `timeout`, `cancelled`, `network`, `invalid-request`. Check that a mid-stream database failure
  should be a recorded call rather than `not-recorded` when the completion insert can still succeed.
- `archive/preview-replay-export` stored only bodiless requests. `formFromCall` and `toCurl` now branch on a body, so their old tests are the
  net for bodiless calls.

## References

- `spike-undici-bodies.md`, `spike-curl-bodies.md`, `spike-gridfs-streaming.md` — A1, A2, A3.
- `context/foundation/lessons.md` — standing rule: probe undici; observation 2026-11-04: compare everything the record claims.
- `context/foundation/tech-stack.md` — GridFS above a threshold, tested with a body over 16 MB.
- `context/foundation/test-strategy.md` — T1.1, T1.2, T1.3, T1.5, T2.2, T2.4, T2.7, T2.9.
- `context/archive/preview-replay-export/record.md` §2, §3, §5 — replay sends the record; curl flags; load-bearing `wire.ts`.
- `context/archive/send-and-record/record.md` — insert-only store, send document before dispatch; slice 1 review #9, body-less history.
- `src/core/call-schema.ts:17` — `body: z.null()` on a send.
- `src/core/call-store.ts:83` — the projection for history rows.
- `src/renderer/app.tsx:517` — bodies decoded into a `<pre>` today.

---
change_id: multipart-with-file-copies
status: draft
produced-by: lz-plan
created: 2026-11-08
updated: 2026-11-08
revision: 3 — answers the second plan review of 2026-11-08 (verdict accept, three findings). R1 Edit of a stored multipart call: the latest Edit wins and a failed page read leaves the form unchanged, both tested (phase 6). R2 test-strategy.md rows updated in phase 6. R3 an inline body with a multipart content type that does not parse loads as it did before this change (phase 4). Phase numbers unchanged; no phase was verified. Revision 2 — answers the plan review of 2026-11-08 (verdict revise). B1 settled by spike-file-input-ipc.md (holds); A3 and A4 rewritten from it. W1 probe moved into the change folder (probe-undici-curl-multipart.md). W2 field values holding CR or LF refused by Edit (phase 4). W3 the T1.4 case uses a stored body (phase 1). W4 boundary randomness named; Copy as curl from the form accepted as picking its own boundary. W5 a failed file read shown in its row (phase 5). W6 blank parts dropped as blank rows are (phase 5). Phase numbers unchanged; no phase was verified.
inputs: [change.md, roadmap.md, test-strategy.md, lessons.md, tech-stack.md, archive/request-bodies-and-storage/record.md, archive/editor-and-formatting/record.md, probe-undici-curl-multipart.md, spike-file-input-ipc.md, answers given 2026-11-08]
---

# Plan: Send multipart requests with files, keeping a stored copy so replay survives file deletion

## Approach

A multipart request becomes one more `BodyInput` type, `multipart`, holding ordered parts: text fields
(name, value) and file parts (name, filename, content type, bytes). `wire.ts` encodes it to the full
`multipart/form-data` body as bytes, with a boundary, and adds `content-type: multipart/form-data; boundary=…`.
From there the existing body path does everything else unchanged: the send document records the bytes inline up to
1 MiB or as a GridFS file above it (`src/core/send.ts:102-113`), replay reads the recorded bytes and sends them
again (`src/core/send.ts:239-260`), and curl export receives a `StoredBody` like any other. The copy of each
uploaded file is the recorded body itself (author, 2026-11-08: "Whole body as bytes").

The file reaches the app through an `<input type="file">` in the renderer. The renderer reads the bytes with the
web File API at pick time and keeps them in form state, and they cross IPC inside `SendInput` (author, 2026-11-08).
In this app's production build, a 17 MiB and a 256 MiB file arrived in main byte-equal, as a plain `Uint8Array`
(`spike-file-input-ipc.md`). Main never opens a path the renderer names, so no new file-reading channel exists. A
file part loaded by Edit from a record has the same shape as a picked one, bytes included, so edit-and-send works
after the original file is deleted (author, 2026-11-08: "Load parts, files from record").

The property that makes this the right shape: the record stays exactly the bytes that went on the wire. Nothing
about parts is stored beside them. Parsing parts back out, for the panel's parts list and for Edit, is a
pure, incremental parser in `src/core/multipart.ts` that runs over the recorded bytes. A parser defect can be
fixed later without touching any record. The cost is that a body stored in GridFS has to be read to list its parts.
That read happens in main through one new named preload function, `describeBody`, which streams the file one page at a
time, so neither process holds the whole body to show the list.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Each file in its own GridFS file, parts recorded as structured data, body rebuilt on replay | Replay would rebuild bytes instead of resending them. The boundary and every byte of framing would need recording and re-deriving exactly, which is the T1.3 failure this product exists to prevent. Author chose whole body as bytes. |
| A main-process file dialog returning a token, main reads the file at send | Adds a channel and a token store in main, and main reads a file the renderer chose at a later time than the user saw it. Bytes over IPC are already how large text bodies travel (`archive/request-bodies-and-storage/record.md` §3), and the spike showed files do the same. Author chose the file input. |
| Part summaries recorded in the send document at send time | Opening a call would need no body read, but a parser defect would be written into immutable records, and the schema grows a derived field that can disagree with the bytes. |
| Parts list built in the renderer from pages as Load more fetches them | No new channel, but a text field after a 17 MiB file part stays hidden until 17 pages are loaded. The list would read as complete when it is not. |
| curl `-F name=@path` for file parts | Puts a local path in a copied command and reads whatever is at that path when run. The same reason `--data-binary` lost in slice 3a. |
| A new boundary on every edit-and-send | Sending an edited call unchanged would send different bytes, the T2.12 failure. The recorded boundary is carried into the form and reused when it is still absent from the parts. |
| Refuse Edit on a multipart call | Cheaper, but rebuilding a multipart request by hand after the file is gone defeats the slice. Author chose loading parts. |

## Out of scope

- Editing a file part's bytes, or its content type, in the form. A file part is replaced by picking another file or removed. Its content type is what the browser reports for the file, which comes from the extension: `.bin` gives `application/macbinary` (`spike-file-input-ipc.md`).
- Per-part headers other than `Content-Disposition` and a file part's `Content-Type`.
- `filename*` (RFC 5987) parameters. Names and filenames are UTF-8 with `"`, CR and LF percent-escaped, as browsers send them (WHATWG HTML, "multipart/form-data encoding algorithm").
- Showing a file part's content in a viewer of its own (image preview, hex). The raw view keeps showing the whole body.
- Reading a non-multipart body over 1 MiB into Edit. That refusal stays (`src/core/form-from-call.ts:58-62`); this plan lifts it for multipart bodies only.
- Editing a multipart body whose parser round trip does not reproduce the recorded bytes, such as one from outside this app's encoder. An inline one loads as it did before this change (Text, through `loadedBody`, `form-from-call.ts:36-47`); a stored one is refused with a reason. Replay and the raw view work for both.
- The same boundary for Copy as curl from the form and the Send after it. Each builds the wire request and picks its own boundary; each sends bytes consistent with its own `content-type`. A recorded call's export uses the recorded boundary.
- Streaming request bodies to undici. Bodies stay in memory in main, as in slice 3a.
- A size limit on picked files. None exists for other bodies; a file the renderer cannot read shows the error in its row (phase 5).

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | undici 8.12.3 sends a `Uint8Array` multipart body unchanged, with `content-type` and `content-length` as given, in order, after `host` and `connection`. **Partly verified** in a standalone Node 22 script (`probe-undici-curl-multipart.md`): a 276-byte body with a CRLF field value and a binary part arrived byte-equal with headers in that order. Depends on its Not tried items: Electron's Node 24, a body over 1 MiB, methods other than `POST`. Phase 1 (methods, Electron-independent) and phase 2 (over 1 MiB) test them; phase 5 sends through Electron. | The record would state something false about the wire. Phase 1 stalls. | yes |
| A2 | curl `--data-raw` with the recorded `content-type` sends a text-only multipart body unchanged, CRLF included. **Partly verified** in the same probe, 123 bytes through `sh -c`. Not tried: a non-ASCII field value, a binary part. Phase 3 tests both. | Multipart export is refused outright instead of exported for text bodies. Phase 3 changes, nothing else does. | no |
| A3 | A file's bytes pass renderer → main through `ipcRenderer.invoke`, arrive as a plain `Uint8Array` (not a `Buffer`), and pass `z.instanceof(Uint8Array)` alone and nested in a `z.strictObject`, with equal SHA-256. **Verified** in this app's production build (`.vite/build`, production CSP, Electron 45.2.1) at 7 B, 17 MiB and 256 MiB (`spike-file-input-ipc.md`). Not tried there: the real `send` handler with `SendInputSchema`; phase 5's e2e test sends through it. | — | yes, verified |
| A4 | `File.arrayBuffer()` works in the sandboxed renderer under the production CSP, and Playwright's `setInputFiles` drives `<input type="file">`. **Verified** in the same spike, with no console or page errors. Not tried: a person picking through the native dialog (manual check at the end of phase 5). | — | yes, verified |
| A5 | undici's headers timer runs during a multipart upload exactly as for other `Uint8Array` bodies, so the existing 1 s per MiB extension (`src/core/send.ts:137-139`) covers it. The body is the same type, so the code path is the same. | A large file records `timeout` on a link the limit was sized for. | no |
| A6 | A random boundary of 30 characters from `[0-9a-z]`, drawn with `globalThis.crypto.getRandomValues` and prefixed `----dp`, is absent from the parts in practice; the encoder checks every part and draws again if not. `globalThis.crypto` exists in the renderer and in Node 22 and later, so `wire.ts` stays importable by both (`app.tsx:267` builds a wire request for Copy as curl). | None: the check makes this hold by construction. | no |

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | A multipart request with a text field and a file part is sent, recorded byte-equal to the wire, and replayed byte-equal after the source file is deleted | `src/core/multipart.ts`, `src/core/wire.ts`, tests | lz-tdd | unit + `send.int.test.ts`, `replay.int.test.ts` |
| 2 | A file part over 16 MiB is stored in GridFS and replays with equal bytes; the headers timeout grows with it | `src/core/large-bodies.int.test.ts`, `src/core/send.test.ts` | lz-tdd | `large-bodies.int.test.ts`, `send.test.ts` |
| 3 | A text-only multipart call exports as curl and sends the same bytes; one with a binary part is refused with the reason | `src/core/curl.ts`, `src/core/curl.int.test.ts` | lz-tdd | `curl.int.test.ts` |
| 4 | A recorded multipart body parses into part summaries page by page, and Edit loads it so sending unchanged sends the same bytes | `src/core/multipart.ts`, `src/core/form-from-call.ts`, tests | lz-tdd | `multipart.test.ts`, `form-from-call.test.ts` |
| 5 | In the app: pick a file, send multipart, delete the file, replay, the server receives the same bytes | `src/shared/ipc-contract.ts`, `src/renderer/app.tsx`, `e2e/multipart.spec.ts` | lz-e2e | `npx playwright test e2e/multipart.spec.ts` |
| 6 | In the app: the call panel lists parts for inline and stored bodies, and Edit loads a multipart call, including a stored one, and resends the same bytes | `src/main/ipc.ts`, `src/preload.ts`, `src/shared/ipc-contract.ts`, `src/renderer/app.tsx`, tests, `test-strategy.md` | lz-e2e | `ipc.int.test.ts`, `e2e/multipart.spec.ts` |

### Phase 1 — a multipart call is sent, recorded and replayed with no file on disk

**Changes:**
- `src/core/multipart.ts` (new): `encodeMultipart(parts, boundary)` returns the body bytes; `chooseBoundary(parts)` returns a boundary absent from every part, drawn with `globalThis.crypto.getRandomValues` (A6); tests pass a fixed boundary to `encodeMultipart` directly. Names and filenames are UTF-8 with `"` → `%22`, CR → `%0D`, LF → `%0A`. A file part writes `Content-Type` from the part, `application/octet-stream` when empty. Pure; no Node or DOM imports beyond `globalThis.crypto`, so the renderer can import it.
- `src/core/wire.ts`: `BodyInput` gains `{ type: 'multipart'; parts: Part[]; boundary?: string }`, where `Part` is `{ kind: 'field'; name; value } | { kind: 'file'; name; filename; contentType; bytes: Uint8Array }`. `encodedBody` (`wire.ts:103-112`) encodes it, using `boundary` when given and absent from the parts, otherwise `chooseBoundary`. `GENERATED_CONTENT_TYPE` (`wire.ts:28-33`) cannot hold a value with a boundary, so the multipart content type is built beside it. No parts is no body, as an empty form is. A typed `Content-Type` with a multipart body throws `InvalidBodyError` with its own message: a boundary the body does not use would make the server misread it. `HEAD` with a multipart body is refused as for other bodies (`wire.ts:124`).
- `src/core/multipart.test.ts` (new), `src/core/wire.test.ts`: encoding of fields, file parts, escaping, an empty filename, an empty content type (→ `application/octet-stream`), a browser-reported type such as `application/macbinary` written unchanged, a boundary found inside a part, the typed `Content-Type` refusal.
- `src/core/send.int.test.ts`: T1.2 and T1.3 for multipart on `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` and `GET`: the send document's headers and body equal what the capture server received, compared in full (lessons, 2026-11-04).
- `src/core/replay.int.test.ts`: T1.4, twice: once with a small file part (inline body) and once with a file part over 1 MiB, so the body is a GridFS file as `test-strategy.md` T1.4 requires. Each case writes a temporary file, reads its bytes into a file part as the renderer would, sends, deletes the file, replays, and compares the capture server's two requests byte for byte.

**Verification:**

```
$ npx vitest run --project unit src/core/multipart.test.ts src/core/wire.test.ts
expected: all pass, including the new multipart cases
$ npx vitest run --project integration src/core/send.int.test.ts src/core/replay.int.test.ts
expected: all pass; both T1.4 cases delete the file before replaying (asserted with fs.existsSync), and the larger one's send document holds a fileId
```

**Done when:** each multipart T1.3 case compares method, URL, raw headers and body with the record, and both T1.4
replays' bodies at the capture server equal the originals with the source file absent from disk.

**Executor:** lz-tdd — encoding is pure and the wire comparisons follow the existing T1.3 pattern; both can be
written red first. Tier 1 (T1.2, T1.3, T1.4), integration layer.

### Phase 2 — a file part over 16 MiB

**Changes:**
- `src/core/large-bodies.int.test.ts`: T1.5 for uploads. A 17 MiB file part sends, the send document holds a file reference, the capture server's body has the same SHA-256 as the encoded body, and a replay sends the same SHA-256.
- `src/core/send.test.ts`: T2.11. The headers timeout handed to undici for a 17 MiB multipart body is 30 s + 17 s.

No production change is expected. If one is needed, the phase records it as drift.

**Verification:**

```
$ npx vitest run --project integration src/core/large-bodies.int.test.ts
$ npx vitest run --project unit src/core/send.test.ts
expected: all pass
```

**Done when:** both tests exist, were seen failing against a deliberately broken expectation or before the case was wired, and pass.

**Executor:** lz-tdd — tests over an existing path; Tier 1 T1.5 and Tier 2 T2.11.

### Phase 3 — curl export of a multipart call

**Changes:**
- `src/core/curl.int.test.ts`: T2.4 for multipart. A text-only multipart call (fields, and a file part with UTF-8 text content and a non-ASCII field value) exports, runs through `sh -c`, and the capture server receives the same method, headers and body as the record. A call with a binary file part is refused.
- `src/core/curl.ts`: the refusal for a body that is not text names the multipart case: "A file part holds bytes a shell command cannot hold". Nothing else changes; the recorded `content-type` carries the boundary.

**Verification:**

```
$ npx vitest run --project integration src/core/curl.int.test.ts
expected: all pass
```

**Done when:** the text case is byte-equal at the capture server and the binary case throws `CurlRefusedError` with the multipart wording.

**Executor:** lz-tdd — Tier 2 T2.4, integration by the layer contract.

### Phase 4 — parts from a recorded body, and Edit's round trip

**Changes:**
- `src/core/multipart.ts`: `createPartScanner(boundary)` takes pages with `push(bytes)` and `end()`, and returns part summaries `{ name, filename?, contentType?, offset, length }` as each part closes. It holds at most one page plus a boundary's length between pushes, the same discipline as `body-format.ts`. `parseMultipart(bytes, boundary)` collects full parts for Edit. A body the scanner cannot read reports that, instead of guessing.
- `src/core/form-from-call.ts`: a recorded `multipart/form-data` body loads as `{ type: 'multipart', parts, boundary }` using the boundary from the recorded `content-type`. The generated `content-type` is left out of the header rows (`form-from-call.ts:70-78`). A body is not loaded as multipart when either holds:
  - `encodeMultipart(parts, boundary)` does not reproduce the recorded bytes;
  - a field value holds CR or LF. A row's `<input>` strips line breaks, so sending it unchanged would send different bytes; `form-from-call.ts:24-33` refuses the same content for form rows. Names and filenames cannot hold a raw CR or LF after parsing, because the encoder writes them as `%0D` and `%0A`.

  In that case an inline body loads as it does today: `loadedBody` (`form-from-call.ts:36-47`) has no entry for a multipart content type and loads it as Text, with the typed `Content-Type` kept as a row. A call recorded before this change with the Text type and a typed multipart `Content-Type` therefore still loads. A stored body throws `BodyNotLoadableError` with the reason, as stored bodies do today.

  `formFromCall` takes the body's bytes; reading a stored body for it is phase 6.
- `src/core/multipart.test.ts`, `src/core/form-from-call.test.ts`: the scanner returns the same summaries for every split of a body into pages, including splits inside a boundary and inside a CRLF; T2.12 round trip for a multipart call (form → wire → record → form → wire gives equal bytes); an inline foreign body, and an inline body with a field value holding CR or LF, each load as Text with the recorded bytes unchanged on resend (T2.12); a stored one of either kind is refused; a slice 3a-shaped record (Text body, typed `Content-Type: multipart/form-data` as the last typed row) loads as before.

**Verification:**

```
$ npx vitest run --project unit src/core/multipart.test.ts src/core/form-from-call.test.ts
expected: all pass
```

**Done when:** the round-trip test sends equal bytes for a body with fields and two file parts, the scanner's split
test covers every split offset of a small body, and the Text fallback and the stored refusal are each tested.

**Executor:** lz-tdd — pure functions; Tier 2 T2.12, unit.

### Phase 5 — pick a file, send, delete it, replay

**Changes:**
- `src/shared/ipc-contract.ts`: `BodyInputSchema` (`ipc-contract.ts:34-41`) gains the multipart shape, with file bytes as `z.instanceof(Uint8Array)`. Main-side code treats the bytes as `Uint8Array`, never `Buffer` (A3).
- `src/renderer/app.tsx`: `BODY_TYPES` (`app.tsx:389-395`) gains Multipart. `BodyEditor` (`app.tsx:406-449`) shows rows of parts: a field row (name, value) and a file row (name, a file input, then the filename, type and size once picked). Picking reads `File.arrayBuffer()` and stores the bytes in the part. When the read rejects, the row shows the error and the part holds no file. `bodyOfType` (`app.tsx:398-404`) keeps parts when switching away and back. `requestOf` (`app.tsx:93-99`) drops parts with a blank name, as it drops blank rows today, and drops file rows with no file picked.
- `e2e/multipart.spec.ts` (new): the roadmap outcome. Write a temporary file, pick it with `setInputFiles`, add a text field, send to the capture server, delete the file, open the call, Replay; the server's second body equals the first. A second test sends a 17 MiB file through the UI and the real `send` handler, closing A3's Not tried item. The spec records `console` errors and `pageerror` together, as `e2e/body-safety.spec.ts` does (lessons, 2026-11-08).

**Verification:**

```
$ npm run package && npx playwright test e2e/multipart.spec.ts
expected: all pass; the replay test asserts the file is absent before Replay
```

Manual, once, on the built app: pick a file through the native file dialog and send it (A4's Not tried item).
Recorded in `progress.md`.

**Done when:** the e2e replay test passes against the production build with the file deleted, the 17 MiB send records
a file reference, and the native dialog check is recorded.

**Executor:** lz-e2e — the risks (form state, the real send handler, replay from the panel) are observable only in the
assembled app. Tier 2 T2.7.

### Phase 6 — the parts list and Edit in the app

**Changes:**
- `src/main/ipc.ts`, `src/preload.ts`, `src/shared/ipc-contract.ts`: an eighth named function, `describeBody({ fileId, boundary })`, streams the GridFS file through `readRange` one page at a time (`src/core/body-store.ts:92-132`) into the part scanner and returns the summaries. Main validates input and output with `zod` like `readBody` (`ipc.ts:254-272`). The preload comment's count (`preload.ts:1`) changes to eight.
- `src/renderer/app.tsx`: for a request whose `content-type` is `multipart/form-data`, the call panel shows a parts list above the body: name, filename, content type, size. An inline body is scanned in the renderer; a stored one calls `describeBody`. Edit on a multipart call loads parts into the form; a stored body is read through `readBody` pages first. Edit's existing refusal for other bodies in a file stays.
  - **Only the latest Edit loads (T2.10).** Reading a stored body takes up to one IPC call per MiB. When Edit is pressed on another call, or on the same one again, before the read finishes, the earlier read's result is discarded. The form never receives a body from a call other than the one last edited.
  - **A failed page read leaves the form unchanged.** The panel shows the read's message where Edit's refusals already appear, and the form keeps what it held.
- `src/main/ipc.int.test.ts`: `describeBody` returns the summaries of a stored 17 MiB body, and a message for a missing file.
- `e2e/multipart.spec.ts`: the panel lists the parts of an inline and of a stored call; Edit on each, then Send unchanged, gives the server the same body; the parts list and the form after Edit are in view (T2.9). Edit on stored call A, then Edit on call B while A's read is held back, leaves B in the form after A's read completes; held back the way `e2e/open-call-failures.spec.ts` arranges answer order for T2.10. Edit on a stored call whose chunks are removed shows the message and leaves the form unchanged.
- `context/foundation/test-strategy.md`: the Covered column for T1.2, T1.3, T1.4, T1.5, T2.4, T2.10, T2.11 and T2.12 names the multipart tests; T1.4 leaves the gap list, and the gap entries for slice 4 are removed; a `revised:` line records the change. Each phase's test names are copied from `progress.md` at this point.

**Verification:**

```
$ npx vitest run --project integration src/main/ipc.int.test.ts
$ npm run package && npx playwright test e2e/multipart.spec.ts
expected: all pass
$ npm run test:unit && npm run test:integration && npm run test:e2e && npm run typecheck && npm run lint
expected: all gates exit 0
```

**Done when:** the e2e Edit test sends equal bytes for both an inline and a stored multipart call, the latest-Edit and failed-read tests pass, `test-strategy.md` no longer lists a slice 4 gap, and all gates pass.

**Executor:** lz-e2e — panel and Edit wiring is render state (T2.9, T2.10); the `describeBody` handler's integration test is written within the phase.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| A large file held in renderer state, in IPC and in main at once exhausts memory | low | Send fails for large files | Transfer is verified to 256 MiB (`spike-file-input-ipc.md`); memory was not measured. Phase 5 sends 17 MiB through the real handler. Larger sizes stay under T3.10's manual treatment. |
| Edit of a large stored multipart call reads the whole body into the renderer | medium | Slow Edit, memory, at sizes beyond 17 MiB | Accepted: Edit holds file bytes by design. Measured in phase 6 at 17 MiB. |
| The scanner splits a part wrongly when a page boundary falls inside the multipart boundary | medium | Wrong parts list or Edit refusal | Phase 4's every-split test. |
| An Edit round trip changes bytes through line endings or encoding of field values | medium | T2.12 failure | Phase 4 refuses a body that does not re-encode to the recorded bytes, and a field value a row cannot hold. |
| Edit's multi-page read of call A finishes after Edit on call B, loading A into the form | medium | Send goes to the wrong target (T2.10) | Phase 6: only the latest Edit loads, with an e2e test that holds A's read back. |
| `describeBody` streaming fails mid-file (chunks removed) | low | Parts list shows an error | `readRange` already reports a short read as missing (`body-store.ts:129-130`); phase 6 tests the message. |
| The headers timer differs for multipart (A5) | low | `timeout` on a slow upload | Phase 2's T2.11 case. |

## For the reviewer

- **Phase 6 is the largest and the least certain.** It adds an IPC channel, a parts list, and Edit for stored
  bodies. If it runs long, the parts list and Edit can split into two phases; the plan keeps them together because
  both need the scanner and the stored-body read in the renderer.
- **Lifting Edit's refusal for stored multipart bodies** reverses a 3a decision for one body type. The 3a reason was the
  text box holding the whole body; file parts are not shown in a text box, but their bytes are still held. Check that
  the reason does not still apply.
- **A file part's content type is the browser's guess from the extension**, and it is recorded as sent. The plan does
  not let it be edited. Check that this is acceptable for real APIs that inspect it.
- **The boundary carried through Edit** is the one place where form state holds a value from the record that the user
  did not type. It is there for T2.12 only.

## References

- `src/core/send.ts:102-113` — the body is stored before the send document; inline up to 1 MiB, GridFS above.
- `src/core/send.ts:137-139` — headers timeout extension per MiB of request body.
- `src/core/send.ts:239-260` — replay reads recorded bytes and sends them unchanged.
- `src/core/wire.ts:15-33`, `103-112`, `118-153` — `BodyInput`, `GENERATED_CONTENT_TYPE`, `encodedBody`, `buildWireRequest`.
- `src/core/curl.ts:28-43`, `45-86` — text-only bodies via `--data-raw`; refusals.
- `src/core/form-from-call.ts:24-33`, `52-106` — form rows refuse line breaks; Edit mapping and the stored-body refusal.
- `src/core/body-store.ts:92-132` — range reads and missing-chunk detection.
- `src/shared/ipc-contract.ts:34-50`, `src/preload.ts` — the body schema and the seven preload functions.
- `src/main/ipc.ts:254-272` — `readBody`, the pattern for `describeBody`.
- `src/renderer/app.tsx:93-99`, `267` — `requestOf` drops blank rows; Copy as curl builds a wire request in the renderer.
- `context/changes/multipart-with-file-copies/probe-undici-curl-multipart.md` — A1, A2.
- `context/changes/multipart-with-file-copies/spike-file-input-ipc.md` — A3, A4, content types from extensions.
- `context/archive/request-bodies-and-storage/record.md` — whole bodies in memory through IPC; `--data-binary` rejected; replay copies stored bodies.
- `context/archive/editor-and-formatting/record.md` — incremental formatter design that the scanner follows; `pageerror` check.
- `context/foundation/lessons.md` — undici probe rule (A1), spike Not tried rule, full-record comparisons.

---
change_id: multipart-with-file-copies
produced-by: lz-tdd
plan: plan.md
updated: 2026-11-09
---

# Progress: Send multipart requests with files, keeping a stored copy so replay survives file deletion

## Phase 1 — a multipart call is sent, recorded and replayed with no file on disk

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-09
- **Finished:** 2026-11-09

**Changed**
- `src/core/multipart.ts` (new) — `Part`, `encodeMultipart`, `boundaryOccursIn`, `chooseBoundary`. Names and filenames escape `"`, CR and LF; values and file bytes are written unchanged; an empty file content type is written as `application/octet-stream`. Holds its own `concatBytes`, because `body-store.ts` imports the mongodb driver and the renderer imports this module.
- `src/core/wire.ts` — `BodyInput` gains `multipart` with an optional carried `boundary`; `encodedBody` returns bytes and the content type to generate; a given boundary is used unless it occurs in a part; no parts is no body; a typed `Content-Type` with a multipart body throws `InvalidBodyError` with its own message (the constructor now takes a message, defaulting to the HEAD one).
- `src/core/multipart.test.ts` (new) — 12 cases: framing, binary bytes, UTF-8, escaping, line breaks in values, empty filename, empty and browser-reported content types, boundary shape, redraw when the boundary occurs in a file, a value or a name.
- `src/core/wire.test.ts` — 6 multipart cases: encoded body and header order, chosen boundary named in the header, a given boundary that occurs in a part replaced, no parts, typed `Content-Type` refused, HEAD refused.
- `src/core/send.int.test.ts` — T1.2 and T1.3 for multipart on GET, DELETE, OPTIONS, POST, PUT and PATCH (method, URL, raw headers and body against the record, and the body framed with the boundary its header names); the record reads back unchanged; a typed `Content-Type` leaves no send document and sends nothing.
- `src/core/replay.int.test.ts` — T1.4: a 64 KiB file (inline body) and a 3 MiB + 7 B file (GridFS body) are read, sent, deleted (`existsSync` false), replayed; the two requests' headers and bodies are equal and contain the file's bytes.
- `src/shared/ipc-contract.ts` — `BodyInputSchema` gains the multipart shape, file bytes as `z.instanceof(Uint8Array)`.
- `src/renderer/app.tsx` — `bodyOfType` keeps parts for the multipart type. Not reachable: `BODY_TYPES` does not list Multipart yet.
- `src/core/form-from-call.ts` — the generated-Content-Type check excludes the multipart type, which has no entry in `GENERATED_CONTENT_TYPE`.

**Verification**

```
$ npx vitest run --project unit src/core/multipart.test.ts src/core/wire.test.ts
 Test Files  2 passed (2)
      Tests  93 passed (93)
$ npx vitest run --project integration src/core/send.int.test.ts src/core/replay.int.test.ts
 Test Files  2 passed (2)
      Tests  120 passed (120)
$ npm run test:unit
      Tests  258 passed (258)
$ npm run test:integration
      Tests  260 passed (260)
$ npm run typecheck   → exit 0
$ npm run lint        → exit 0
```

PASS — multipart requests are recorded byte-equal to the wire on six methods, and a replay after the source file is
deleted sends the same bytes for an inline and a GridFS-stored body.

**Red evidence**
- `multipart.test.ts`: all 12 seen failing against a stub that threw `not implemented` (a first run failed on the missing module, which is not a behavioural failure; the stub replaced it).
- `wire.test.ts`: 5 of 6 seen failing on assertions before `wire.ts` changed. "HEAD with a multipart body is refused" passed before the change, for an unrelated reason: the old `encodedBody` encoded the missing `text` field as the string `undefined`, a non-empty body. Not seen failing for the right reason.
- `send.int.test.ts` multipart cases: written after `wire.ts`, so they passed on first run. Mutation: the generated Content-Type named `${boundary}X`; the six method cases failed, the read-back and refusal cases passed (they do not depend on the boundary). Restored.
- `replay.int.test.ts` T1.4: written after the send path existed. Mutation: `replayCall` sent `body: null`; both cases failed. Restored.

**Drift:** decision — the plan placed the IPC schema for multipart in phase 5 → added in phase 1, with a non-reachable multipart branch in `bodyOfType` and a type guard in `form-from-call.ts`, because adding `multipart` to `BodyInput` broke `npm run typecheck` in the renderer and the contract, and a phase should not leave the typecheck gate red. No UI change is visible.

**Notes**
- A first green attempt checked a carried boundary by calling `chooseBoundary` with a draw that returned that boundary every time; when it occurred in a part, the loop never ended and the unit run hung. Replaced by `boundaryOccursIn`. The hang came from the code, not a test helper, and no test covers it: the "a given boundary that occurs in a part is replaced" case is the one that hung, and now passes.
- `chooseBoundary` maps random bytes with `% 36`, so characters are not uniform. Absence from the parts is checked, which is the property the boundary needs.

## Phase 2 — a file part over 16 MiB

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-09
- **Finished:** 2026-11-09

**Changed**
- `src/core/large-bodies.int.test.ts` — T1.5 for uploads: a 17 MiB patterned file part with a text field is sent; the send document holds a file reference whose length equals the bytes the capture server received; the GridFS file's SHA-256 equals the received body's; the received body contains the file; the send document stays under 64 KiB; a replay sends a body with the same SHA-256.
- `src/core/send.test.ts` — T2.11: a 17 MiB multipart file part gives undici `headersTimeout: 47_000` and `bodyTimeout: 30_000`. The assertion reads the two values from the mock's last call instead of `toHaveBeenCalledWith`, which on failure prints the 17 MiB body and exhausted the worker's heap (see red evidence).

No production change.

**Verification**

```
$ npx vitest run --project integration src/core/large-bodies.int.test.ts
 Test Files  1 passed (1)
      Tests  21 passed (21)
$ npx vitest run --project unit src/core/send.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — an uploaded file over 16 MiB is stored in full, sent and replayed byte-equal, and extends the headers timeout
by one second per MiB.

**Red evidence** — both tests cover an existing path, so they passed on first run; mutations stand in, as the plan's
done-when allows.
- `UPLOAD_MS_PER_MIB = 0` in `send.ts`: the first form of the T2.11 test (`toHaveBeenCalledWith`) crashed the Vitest worker with "Reached heap limit" instead of failing; the rewritten test failed with `headersTimeout: 30000` against `47000`, and the existing 5 MiB text test failed too. Restored.
- `send.ts` never storing a request body in GridFS: the T1.5 upload test failed (`RangeError: offset is out of bounds` from the driver). Restored.

**Drift:** none

**Notes**
- The existing T2.11 text-body test ("a larger body adds one second per MiB") still uses `toHaveBeenCalledWith` with a 5 MiB string. Under the mutation it failed normally; a larger body there would crash the same way. Left unchanged: outside this phase.

## Phase 3 — curl export of a multipart call

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-09
- **Finished:** 2026-11-09

**Changed**
- `src/core/curl.int.test.ts` — T2.4 for multipart: on POST, PUT, PATCH and DELETE, a body of a field with non-ASCII, quotes and `$HOME`, an empty field, and a text file part holding CRLF, LF and `@/etc/hosts` is exported, run through `sh -c`, and arrives with the recorded method, URL, headers and body. A file part holding a NUL byte, and one holding invalid UTF-8, are each refused with "A file part holds bytes a shell command cannot hold".
- `src/core/curl.ts` — `bodyText` takes whether the recorded `Content-Type` is `multipart/form-data`, and words its two refusals for that case.

**Verification**

```
$ npx vitest run --project integration src/core/curl.int.test.ts
 Test Files  1 passed (1)
      Tests  75 passed (75)
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — a text-only multipart call exports and sends the recorded bytes; one with a binary file part is refused with
the multipart wording.

**Red evidence**
- The two refusal cases were seen failing on the message before `curl.ts` changed (the old wording was thrown).
- The four export cases passed on first run with no code change: the recorded `content-type` already carries the boundary, and `--data-raw` sends CRLF unchanged. This is the outcome A2 predicted; the probe's Not tried items (a non-ASCII field value, more methods) now hold. Not seen failing: no mutation was run for them, because the code path is the existing body export, which the existing T2.4 body cases already cover.

**Drift:** none

**Notes**
- The multipart wording also applies when a field value, not a file part, holds a NUL byte. A field value comes from a text input, so this is unlikely; the message would then name the wrong part.

## Phase 4 — parts from a recorded body, and Edit's round trip

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-09
- **Finished:** 2026-11-09

**Changed**
- `src/core/multipart.ts` — `multipartBoundary(contentType)`; `MultipartScanError`; `PartSummary`; `createPartScanner(boundary)` with `push(page)`, `end()` and `held()`, a state machine over the delimiter that keeps at most `delimiter.length - 1` bytes of content between pushes and caps a part head at 16 KiB; `parseMultipart(body, boundary)`. Name, filename and escapes are kept as written (`%22`, `%0D`, `%0A`), so encoding the result gives the recorded bytes. Bytes after the close delimiter are ignored.
- `src/core/form-from-call.ts` — `formFromCall(request, { storedBody? })`. A body loads as `{ type: 'multipart', parts, boundary }` only when the Content-Type is the generated one, second to last, with the exact `multipart/form-data; boundary=…` form; the body parses; no part name is blank; no field value holds CR or LF; and the parts encode back to the recorded bytes. Otherwise an inline body loads as before (`loadedBody`, Text) and a stored one throws `BodyNotLoadableError` "The multipart body cannot be edited: <reason>". A stored body with no `storedBody` given, or not multipart, keeps the existing "too large to edit" refusal.
- `src/core/multipart.test.ts` — `multipartBoundary` (8 cases); the scanner on one page, on every two-page split of a 4-part body that includes a delimiter-like sequence (`\r\n--BN`, `--BNE`) in a file, on one-byte pages, returning a part at the push that closes it, holding a bounded amount for a 3 MiB part in 1 MiB pages; 6 malformed bodies reported with `MultipartScanError`; `parseMultipart` round trip.
- `src/core/form-from-call.test.ts` — T2.12 round trip for a body with a field and two file parts with the same name; Text fallback for an unparseable body, for a field value with LF and with CR, and for a blank part name, each resending the same request; a record from before this change (Text, typed `Content-Type: multipart/form-data` as the last row) loading as before; a stored body read by the caller loading its parts; stored refusals naming the multipart reason; a stored body nobody read keeping "too large to edit".

**Verification**

```
$ npx vitest run --project unit src/core/multipart.test.ts src/core/form-from-call.test.ts
 Test Files  2 passed (2)
      Tests  88 passed (88)
$ npm run test:unit
      Tests  290 passed (290)
$ npm run test:integration
      Tests  267 passed (267)
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — the round trip sends equal bytes for a body with fields and two file parts, the scanner's split test covers every
split offset, and the Text fallback and the stored refusal are each tested.

**Red evidence**
- Scanner, parse and `multipartBoundary`: 21 tests seen failing against stubs that threw `not implemented`. The malformed-body cases failed because the stub threw a plain `Error`, not `MultipartScanError`.
- `formFromCall`: the round trip and the stored load were seen failing. The stored refusals first passed for the wrong reason (the old "too large to edit" error); they were tightened to require "The multipart body cannot be edited:" and then seen failing.
- Green was written in two steps: multipart loading first, without the blank-name and line-break checks, which turned the three Text-fallback tests and one stored refusal red for the right reason; then the checks.
- The Text fallback for an unparseable body, and the record from before this change, passed before and after: they guard behaviour that already existed (R3), and would fail if multipart loading took them over.

**Drift:** decision — the plan said `formFromCall` "takes the body's bytes" and left reading a stored body to phase 6 → it takes the record as before plus an optional `storedBody`, because the reason a stored body is refused depends on knowing it was stored. Phase 6 passes the bytes it reads.

**Drift:** decision — the plan's R3 test reads "a slice 3a-shaped record … loads as before". A typed `Content-Type` that matches the generated form exactly, in the generated place, over a body that parses, now loads as multipart; resending it sends the same request either way. The test uses a body that does not parse (`{"a":1}`), which is the form such a record takes in practice.

**Notes**
- One test was corrected after being written: "a large file part is held only a page plus the boundary" expected the summary from `end()`, while the scanner returns it from the `push` that closes the part, as the "returned when it closes" test specifies.
- `held()` is checked against a loose bound (one page plus 64 bytes); after each push it holds at most the delimiter length minus one.

## Phase 5 — pick a file, send, delete it, replay

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the phase's risks (the file input and form state in the renderer, bytes through the real `send` handler,
replay from the panel) are observable only in the assembled app, which is lz-e2e's discipline (`test-strategy.md`
T2.7; plan.md names lz-e2e). Run `/lz-e2e multipart-with-file-copies` to execute it. Phase 1 already added the
multipart shape to `BodyInputSchema`.

## Phase 6 — the parts list and Edit in the app

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** panel and Edit wiring is render state (`test-strategy.md` T2.9, T2.10), lz-e2e's discipline; plan.md names
lz-e2e, with the `describeBody` handler's integration test written within the phase. `formFromCall` takes the stored
bytes through `{ storedBody }` (phase 4 drift).

## Phase 5 — pick a file, send, delete it, replay

- **Executor:** lz-e2e
- **Status:** in-progress
- **Started:** 2026-11-09
- **Finished:** —

**Risks through the gate** (test-strategy.md T2.7): a file picked in the form reaches the server through the
real send handler; a recorded multipart call replays from the panel after the file is deleted. Encoding, recording
and replay bytes are covered below (phases 1–2); not repeated here beyond what the journey shows.

**Changed**
- `src/renderer/app.tsx` — `BODY_TYPES` gains Multipart. `PartsEditor`: rows of parts with "Part name N", and "Part value N" for a field or a file input "Part file N" plus a summary (`part-file-N`: filename, content type, size) for a file; "Add field", "Add file", "Remove". Picking reads `File.arrayBuffer()` into the part; a rejected read shows `Could not read <name>: <reason>` in the row (`role="alert"`) and leaves the part with no file. `requestOf` drops parts with a blank name and file rows with no file picked.
- `e2e/multipart.spec.ts` (new) — two scenarios against the production build, each recording `console` errors and `pageerror` and asserting none: (1) pick a 64 KiB file, add a field, send, delete the file (`existsSync` false), open the call, Replay; a second row appears and the server's second request has the same raw headers and body, which contains the file; (2) a 17 MiB file through the form and the real send handler reaches the server in full.

**Verification**

```
$ npm run package && npx playwright test e2e/multipart.spec.ts
  2 passed (3.9s)
$ npx playwright test e2e/multipart.spec.ts --repeat-each=3
  6 passed (11.1s)
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS for the scenarios, each run 4× clean. The manual check is outstanding.

**Red evidence**
- Before the UI existed, both scenarios failed at `getByLabel('Body type').selectOption('multipart')`: no such option.
- Mutation: the picked file truncated to 10 bytes in `PartsEditor`. Scenario 1 failed on `first.body.includes(file)`; scenario 2 failed with 301 bytes received against more than 17,825,792. Restored and rebuilt.

**Outstanding — manual, by a person:** on the built app, pick a file through the native file dialog (not
`setInputFiles`) in a Multipart body and send it (A4's Not tried item). Record the result here. The phase stays
`in-progress` until then.

**Drift:** none

**Notes**
- A file row picked with an empty file and an empty name is indistinguishable from a row with no file; the browser always gives a picked file a name, so this arises only for a part loaded by Edit from a foreign body.
- `pick` updates the part list captured when the file input changed. An edit made to another row while a large file is being read is overwritten when the read completes. Reading took 308 ms for 256 MiB in the spike.

## Phase 6 — the parts list and Edit in the app

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-09
- **Finished:** 2026-11-09

**Risks through the gate:** T2.9 (the parts list and the form after Edit in view), T2.10 (a slower Edit read must not
load another call into the form), and the Edit → Send journey for inline and stored multipart calls (T2.7, T2.12 at
the assembled app). Routed below: `describeBody`'s handler to an integration test in this phase (layer contract:
main-process handlers run in plain Node), the scanner and Edit mapping to phase 4's unit tests.

**Changed**
- `src/shared/ipc-contract.ts` — channel `describeBody`; `DescribeBodyInputSchema` (`fileId`, `boundary`); `DescribeBodyResultSchema` (part summaries, or a message); `PigeonApi.describeBody`.
- `src/main/ipc.ts` — the `describeBody` handler: validates input, reads the GridFS file through `readRange` one `BODY_PAGE_BYTES` page at a time into `createPartScanner`, validates output; a failure becomes a message.
- `src/preload.ts` — the eighth named function, `describeBody`; the header comment says eight.
- `src/renderer/app.tsx` — `PartsList` above the request body when the recorded Content-Type is `multipart/form-data`: one line per part (`name · text · size`, or `name · filename · content type · size`), scanned in the renderer for an inline body and listed by `describeBody` for a stored one, ignoring an answer for a body no longer shown. `editCall`: for a stored multipart body, reads the whole body through `readBody` pages (`readWholeBody`; a failed or empty page is an error), then `formFromCall(request, { storedBody })`; a counter discards an Edit that is not the latest, and opening a call also ends a pending Edit.
- `src/main/ipc.int.test.ts` — `describeBody` on a stored 17 MiB multipart body sent through `channels.send` (three parts with names, filename, content type and lengths); a missing file and a non-multipart stored body as messages; invalid input refused.
- `e2e/multipart.spec.ts` — two scenarios (inline 1 KiB, stored 3 MiB): the panel lists both parts and is in view; Edit fills the form (field value, file summary) and brings it into view; Send gives the server the same raw headers and body as the original.
- `e2e/multipart-edit-failures.spec.ts` (new) — replaces main's read-body handler with one serving the bytes the capture server received: (1) Edit on stored call A with its first page held, then Edit on stored call B; after A's read is released the form still holds B; (2) a read that fails shows "The stored body <id> is missing" under "Cannot edit this call", in view, and the URL and Body type are unchanged.
- `context/foundation/test-strategy.md` — `revised:` line; Covered column for T1.2, T1.3, T1.4, T1.5, T2.4, T2.7, T2.10, T2.11 and T2.12; T1.4 and the slice 4 entries removed from the gap list; known limits added for Edit of a stored multipart body, the browser-reported content type, and the native dialog.

**Verification**

```
$ npx vitest run --project integration src/main/ipc.int.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
$ npm run package && npx playwright test e2e/multipart.spec.ts e2e/multipart-edit-failures.spec.ts --repeat-each=3
  18 passed (33.7s)
$ npm run test:unit
      Tests  290 passed (290)
$ npm run test:integration
      Tests  270 passed (270)
$ npm run test:e2e
  32 passed (35.5s)
$ npm run typecheck → exit 0
$ npm run lint → exit 0 (after lint:fix formatted e2e/multipart-edit-failures.spec.ts; that spec rerun: 2 passed)
```

PASS — the parts list and Edit → Send work for an inline and a stored multipart call, the later of two overlapping
Edits stays in the form, a failed read leaves the form unchanged, `test-strategy.md` lists no slice 4 gap, and all
gates pass. Each new scenario ran 4× clean (one run, then three repeats).

**Red evidence**
- `describeBody`: all three seen failing with "no handler for pigeon:describe-body". The 17 MiB case then failed once on the test's own expected length (9 for `zażółć`, which is 10 bytes in UTF-8); the test now computes it.
- e2e: the scenarios were written after the code. Three mutations at once, each guarding one scenario: the latest-Edit guard removed (after the read, and on open); a failed page read treated as the end of the body; a stored body's parts never listed. Exactly those three scenarios failed (`toHaveValue` on the form, `toContainText` on the edit error, `toHaveText` on the parts list); the other three passed. Restored and rebuilt.

**Drift:** decision — the plan said only a later Edit discards an earlier one → opening another call also ends a
pending Edit, because a failed read's error would otherwise appear under the call opened since. Pressing Edit and then
opening another call before the read finishes leaves the form unchanged.

**Drift:** decision — the plan put the latest-Edit and failed-read scenarios in `e2e/multipart.spec.ts` → they are in
a new file, `e2e/multipart-edit-failures.spec.ts`, because they replace main's read-body handler for the rest of the
app launch, which would break the other multipart scenarios; `e2e/open-call-failures.spec.ts` is separate for the same
reason. Recorded at review (review.md F2).

**Drift:** decision — the plan's failed-read scenario removes the stored chunks → the read-body handler is replaced to
return the message `readRange` gives for missing chunks ("The stored body <id> is missing"), because removing chunks
needs database access the e2e harness does not expose. The real path from missing chunks to that message is covered
by `body-store.int.test.ts` and phase 6's `describeBody` missing-file test.

**Notes**
- The inline scenario's file is 1 KiB and the stored one 3 MiB; Edit's renderer memory was not measured beyond that (`test-strategy.md`, known limits).
- Phase 5 is still `in-progress`, waiting for the manual native-dialog check.

## Code review follow-up — /code-review, first pass (2026-11-09)

- **Executor:** lz-tdd (core findings), lz-e2e (renderer findings)
- **Status:** done
- **Started:** 2026-11-09
- **Finished:** 2026-11-09

Ten findings; dispositions by the author (2026-11-09): fix #1, #2, #4, #5, #6, #7, #10; accept #3 and #8; defer #9.
Triage is recorded in `review.md`, "Code review findings".

**Changed**
- `src/core/wire.ts` — #5: a typed `Content-Type` is refused only when the multipart body has parts. #6: a carried boundary is used only when it is 1–70 RFC 2046 characters without a space, else a chosen one replaces it; a file part's content type outside printable ASCII throws `InvalidBodyError` before anything is recorded.
- `src/core/form-from-call.ts` — #4: an inline multipart body that cannot load as parts falls back to Text only when it decodes as UTF-8; otherwise `BodyNotLoadableError` with the reason.
- `src/core/multipart.ts`, `src/core/curl.ts` — #10: `contains` removed in favour of `indexOfBytes`; curl's multipart check uses `multipartBoundary`.
- `src/renderer/app.tsx` — #1 and #7: `PartsEditor` keys rows by a stable id held in a ref; a finished read finds its row by id and applies to the latest parts and `onChange` (so the latest form), and a row removed meanwhile receives nothing; a file input is keyed by its part's file, so Edit gives a fresh one. #2: Edit on a stored multipart body shows "Loading the call into the form…" (`call-edit-status`); changing the form, sending or opening a call ends the pending Edit.
- `src/core/wire.test.ts` — 13 cases for #5 and #6. `src/core/form-from-call.test.ts` — 1 case for #4.
- `e2e/multipart.spec.ts` — "the parts editor": edits during a held read are kept; a read for a removed row lands nowhere; after a removal no input shows the removed file. `e2e/multipart-edit-failures.spec.ts` — a form change during a held Edit read keeps the change, with the status shown meanwhile.

**Verification**

```
$ npx vitest run --project unit src/core/wire.test.ts            → 95 passed (13 new, all seen failing first)
$ npx vitest run --project unit src/core/form-from-call.test.ts  → 56 passed (1 new, seen failing first)
$ npm run package && npx playwright test e2e/multipart.spec.ts e2e/multipart-edit-failures.spec.ts
  4 new scenarios seen failing on the build before the renderer fix (status not found; name and row reverted ×2; input still held first.txt)
  10 passed (15.4s)
$ npx playwright test e2e/multipart.spec.ts e2e/multipart-edit-failures.spec.ts --repeat-each=3
  30 passed (42.8s)
$ npm run test:unit         → 305 passed
$ npm run test:integration  → 270 passed
$ npm run test:e2e          → 36 passed (36.1s)
$ npm run typecheck → exit 0;  npm run lint → exit 0
```

PASS — every fixed finding has a test seen failing first; #10 is a refactor covered by the existing unit and curl
tests (unit 305, curl and send integration 153 passed after it).

**Drift:** decision — #6 replaces an invalid carried boundary instead of refusing the send. The boundary is not
visible in the form, so a refusal would name something the user cannot change; a chosen boundary is recorded, so
nothing invalid reaches the record.

**Notes**
- The #1 scenarios hold the file read by wrapping `File.prototype.arrayBuffer` in the page and restore it afterwards. This arranges timing only; F3's untested read error is still untested.
- `PartsEditor` reconciles row ids when the number of parts changes from outside; a same-length replacement keeps ids, and the file input's key gives it a fresh input.

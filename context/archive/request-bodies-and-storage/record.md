---
change_id: request-bodies-and-storage
title: Send, replay and export request bodies, and store bodies over 16 MB in full
produced-by: lz-archive
archived: 2026-11-07
change-opened: 2026-11-06
ticket: null
verdict: merge-with-fixes
outcome: shipped
milestone: M1, first half of slice 3 (roadmap.md)
branch: merged to main at 15c97c9, directly with no pull request; draft PR #2 closed, branch deleted
raw: raw/
---

## 1. What was built

The form sends JSON, XML, text and form-urlencoded bodies. The bytes sent are the bytes recorded. Replay and curl export send the same bytes, and Edit loads a body back into the form. A body up to 1 MiB stays in its document. A larger one is a GridFS file in the `bodies` bucket, and every reader handles both shapes (`src/core/call-schema.ts`, `StoredBody`). A 17 MiB response and request read back with equal SHA-256. A stored body is shown a page at a time through `readBody`, the seventh preload function.

**Differs from the plan:**
- Curl uses `--data-raw`, not the `--data-binary` first planned. A spike changed this before any code existed.
- A cancel during a large body returns a new result kind, `cancelled`, with no call recorded, because no send document exists yet. A small request is still recorded as `cancelled`.
- After a failed `finish()`, the store deletes the chunks itself instead of calling the driver's `abort()`.
- The headers timeout is 30 s plus 1 s per whole MiB of request body, not a flat 30 s.
- Form content that a row cannot hold (a blank name, a line break) loads as Text.
- Six of these fixes came from a first `/code-review` and five from a second, after all six phases were done.
- Merged to `main` directly, which also brought in slices 1 and 2.

## 2. Why this approach

A reference to a file keeps call documents small, so history and opening a call never read body contents. The file is written before the document that refers to it, so a document never points at a partial file. This keeps the rule that a send document exists before dispatch (T1.2).

A response is held in memory up to 1 MiB and then streamed, so main's memory stays bounded at any size. The threshold equals the display page, so every inline body is shown whole and every stored body is paged.

Each call owns its bytes: a replay copies a stored request body to a new file. Slice 7 can then delete a call without counting references.

`HEAD` with a body is refused in `wire.ts`, so no record can exist that curl cannot export.

## 3. What was rejected

- **Buffering whole responses, then storing** — a response larger than available memory could crash main. Author chose streaming.
- **One `<pre>` with the whole body, or appending pages to one string** — slow over IPC at tens of MB, and V8's limit of 536,870,888 characters applies either way. Pages are a list with one text node each.
- **A raw text box for form-urlencoded** — author chose rows: no hand-encoding, and they match Query and Header.
- **`--data-binary`** — a body starting with `@` sends that local file to the server: a false export and a data leak.
- **A body on `HEAD`** — undici sends it, but `--head` exits 2 with a body. Dropping it silently would make the record false.
- **Saving a body to a file and exporting `@file`** — author chose refusing: a save dialog and a local path inside a copied command.
- **All bodies in GridFS** — a round trip and a file per small body, for no gain below the limit.
- **An inline threshold near 16 MB** — a document's other fields count toward the limit, and history reads would have to exclude large documents.
- **A replay referring to the original's file** — slice 7 would need reference counts.
- **Streaming a stored body to undici on replay** — request bodies reach main in memory through IPC anyway, so loading one is less code. Streaming also lost as the fix for the upload timeout: what undici writes for a stream has not been probed, and the standing rule requires it.
- **A separate `getSend` for replay** — stored responses are no longer read by `getCall`, so the saving is small. Raised again by the second code review and accepted.
- **`schemaVersion: 2`** — the change only adds allowed values, and old documents parse unchanged.
- **Turning off the headers timeout for large bodies** — a server that never answers would hang until cancelled, which T2.11 exists to prevent.
- **A height cap on the body area now** — the next change replaces the text area with the editor (author, 2026-11-06).
- **A scroll correction after Load more** — written and removed: the failure it answered was DevTools docking during a test, not the app.

## 4. Surprises

- **`--data-binary` reads a file.** The plan named the flag. Only the spike's test of a body starting with `@` showed it.
- **The command limit is about 1 MiB, not the predicted 100 MB.** `ARG_MAX` also counts the environment.
- **`pipeline` leaves chunks on failure, and the driver's `abort()` refuses a stream already ended.** The spike found the first. The first code review found the second.
- **A range read with its chunks removed returns short with no error.** `readRange` now compares what it received with the range.
- **undici's headers timer runs during the upload.** A 30 MiB body at 1 MiB per second failed with `UND_ERR_HEADERS_TIMEOUT` at 2.5 s against a 2 s limit, and finished in 30 s against 40 s. The second code review found it, and a probe confirmed it. The spike on bodies had not looked at timing.
- **A 17 MiB test failed at page 11 because of DevTools.** It was first blamed on text length. A width measurement (960 to 481) disproved that. `app.isPackaged` is false in e2e, so DevTools docks some time after launch.
- **The tests missed a paging defect.** Clicking the row of the call already open loaded another page, because an effect depended on an object's identity. All six e2e scenarios passed with it; the second code review found it.
- **Phase 3 lost its red step.** An unbounded loop in a test helper hung the first run, the rerun used `timeout` (absent on macOS), and the code was then written. Mutations stand in as evidence.
- **`toMatchObject({ length })` also matches bytes.** Two tests passed before the code existed.

## 5. What still stands

- **Not reviewed:** the fixes from the second `/code-review` (the headers timeout, `PagedBodyText`'s dependencies, `InlineBodyText`, `plainBody`). A later `/code-review` can run against `main`.
- **Slice 7 must find two kinds of orphan:** chunks with no file document after a crash, and finished files no call refers to, left when the document insert fails. It must also recheck `send.ts`'s error mapping: a file removed during a read can report the database as unavailable.
- **Curl export:** the 900 KiB limit was measured on one macOS machine. On Linux, one argument is capped at 128 KiB, so a command between 128 KiB and 900 KiB is offered and fails. Terminal pasting is untested.
- **Upload timeout:** assumes about 8 Mbit/s. A slower link records `timeout`. The unit test reads the value given to undici, and only the throwaway probe ran a slow upload. The probe ran on Node 22, not Electron's Node 24.
- **`durationMs`** includes time writing to GridFS above 1 MiB, so durations above and below that are not comparable.
- **Renderer memory** limits how far a very large body can be paged. 18 text nodes holding 17 MiB stayed usable; nothing larger was tried.
- **A 1 MiB body makes History a long scroll away**, about 131,000 px. Accepted until the editor arrives.
- **Edit:** a `Content-Type` typed last in lowercase looks generated, so its row is dropped, and changing the body type then changes the header. The record cannot tell typed from generated. A body in a file cannot be edited at all.
- **The `cancelled` message has not been seen on screen.** An IPC test proves the result. No e2e test presses Cancel during a large write.
- **The `busy` ref in `PagedBodyText`** is protected by no test. The disabled button stops a second read in production.
- **Tests not seen failing first** are listed in `raw/progress.md`.
- **Not done by this change:** `test-strategy.md` still marks T1.5 a gap and states a flat 30 s in T2.11; `roadmap.md` still names slice 3 as one slice.
- **If a stored body will not open or replay,** check `bodies.files` and `bodies.chunks` first. A missing file makes replay refuse with no record written, and Load more shows the error.

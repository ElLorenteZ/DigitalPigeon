---
change_id: multipart-with-file-copies
title: Send multipart requests with files, keeping a stored copy so replay survives file deletion
produced-by: lz-archive
archived: 2026-11-10
change-opened: 2026-11-08
ticket: null
verdict: merge-with-fixes
outcome: shipped
milestone: M1, slice 4 (roadmap.md)
branch: multipart-with-file-copies, fast-forwarded to main at 7ab1f65 on 2026-11-09 with no pull request (author's instruction), before closing
raw: raw/
---

## 1. What was built

A Multipart body type in the form: text fields and files picked with `<input type="file">`, read whole when picked.
`wire.ts` encodes the parts to one `multipart/form-data` body with a boundary, and from there the existing body path
does the rest: the body is recorded inline up to 1 MiB or in GridFS above it, replay resends the recorded bytes, and a
17 MiB upload replays with the same SHA-256 after the source file is deleted. The recorded body is the copy of each
file. curl exports a text-only multipart body and refuses one with a binary file part. The call panel lists a body's
parts (`src/core/multipart.ts` scans pages; `describeBody`, the eighth preload function, lists a stored body in main).
Edit loads a multipart call, a stored one included, and resends the same bytes, reusing the recorded boundary.

**Differs from the plan:**
- The IPC schema for multipart landed in phase 1, not 5, to keep the typecheck green.
- `formFromCall` takes the record plus an optional `storedBody`; a stored body's refusal needs to know it was stored.
- An inline multipart body that does not re-encode loads as Text only when it is valid UTF-8, otherwise Edit refuses.
  The plan had an unconditional Text fallback; code review found it resent different bytes (CR4).
- A carried boundary outside RFC 2046's characters is replaced by a chosen one rather than refused (CR6).
- Opening a call, changing the form or sending ends a pending Edit; the plan named only a later Edit (CR2).
- The overlap and failed-read scenarios are in a separate spec, `e2e/multipart-edit-failures.spec.ts`, because they
  replace main's read-body handler for the launch. The failed read is stubbed, not caused by removing chunks.
- The manual check of the native file dialog was not performed; the author closed without it (review F1).

## 2. Why this approach

The record stays exactly the bytes that went on the wire, so replay resends rather than rebuilds and T1.3 cannot drift
for multipart. Nothing about parts is stored beside the bytes: the parts list and Edit parse them back out on demand,
so a parser defect is fixable without touching an immutable record. The cost is reading a stored body to list or edit
it. Files enter through the renderer's File API, so main never opens a path the renderer names.

## 3. What was rejected

- **Each file as its own GridFS file, body rebuilt on replay** — replay would re-derive the boundary and framing,
  which is how a replay ends up different from the wire. Author chose the whole body as bytes.
- **A main-process file dialog returning a token** — an extra channel and token store, and main reading a file later
  than the user saw it. The spike showed bytes cross IPC intact at 256 MiB.
- **Part summaries recorded in the send document** — a parser defect would be written into immutable records, and a
  derived field could disagree with the bytes.
- **Building the parts list from pages as Load more fetches them** — a field after a 17 MiB file stays hidden until
  17 pages load, and the list reads as complete when it is not.
- **curl `-F name=@path`** — a local path in a copied command, read when run. Same reason `--data-binary` lost in 3a.
- **A new boundary on every edit-and-send** — an unchanged resend would send different bytes (T2.12).
- **Refusing Edit for multipart** — rebuilding a request by hand after the file is gone defeats the slice.
- **A size cap on Edit of a stored body** — offered at 256 MiB after code review; author accepted no cap (CR3).
- **Out of scope:** editing a part's content type or bytes, per-part headers, `filename*`, part previews, streaming
  request bodies to undici, `multipart/mixed`, deleting stored copies (slice 7).

## 4. Surprises

- **Main receives a plain `Uint8Array`, not a `Buffer`.** The spike predicted Buffer. Code in main must not call
  Buffer methods on file bytes.
- **`File.type` is Chromium's guess from the extension.** `.bin` gives `application/macbinary`, `.dat` gives `""`.
  The guess is recorded as sent.
- **A failing `toHaveBeenCalledWith` on a mock holding 17 MiB crashed the Vitest worker** ("Reached heap limit")
  instead of failing. The T2.11 test now reads the two timeout values.
- **A boundary check that reused `chooseBoundary` with a fixed draw looped forever** when the boundary occurred in a
  part; the unit run hung. Replaced by `boundaryOccursIn`.
- **Code review found three async state defects the e2e suite missed:** a file read and an Edit read each applied
  state captured before an `await` (CR1, CR2), and index-keyed rows left a file input showing a removed file (CR7).
- **`diff-vs-plan.sh` and `state.sh` read the first ledger section per phase**, not the last; both reported phases
  open that were done.

## 5. What still stands

- **Edit of a stored multipart body holds it whole in the renderer**, with no size limit. Near 1–2 GB it can fail or
  crash the renderer (CR3, accepted). Measured only to 3 MiB in e2e.
- **The parts list of a stored body reads the whole file in main on every open**, and the read runs on after the panel
  changes (CR8, accepted). One GridFS stream per 1 MiB page; one stream would do (CR9, carried in `roadmap.md`).
- **Not tested:** the native file dialog (F1); the "Could not read" row when a picked file cannot be read (F3).
- **A second `/code-review` pass on the fixes did not run.** CR4 and CR6 change what is recorded and sent.
- **If a multipart replay or Edit differs from the original**, check first: `encodedBody` and the `BOUNDARY` check in
  `src/core/wire.ts`, then `loadedMultipart` in `src/core/form-from-call.ts`, whose conditions (generated
  Content-Type in place, no blank names, no line breaks in values, exact re-encode) decide multipart versus Text.
- **If Edit loads the wrong call or reverts typing**, check `latestEdit` and `endPendingEdit` in `src/renderer/app.tsx`
  and the row ids in `PartsEditor`; `e2e/multipart-edit-failures.spec.ts` holds reads to test the order.
- **A field value or part name escape** (`%22`, `%0D`, `%0A`) is kept as written when parsed, so the parts list shows
  it escaped.
- Probe and spike: `raw/probe-undici-curl-multipart.md` (undici 8.12.3, curl 8.7.1, Node 22) and
  `raw/spike-file-input-ipc.md` (Electron 45.2.1, `.vite/build` with the production CSP).

---
change_id: editor-and-formatting
title: Show JSON and XML bodies pretty-printed in the editor, with stored bytes unchanged
produced-by: lz-archive
archived: 2026-11-08
change-opened: 2026-11-07
ticket: null
verdict: merge
outcome: shipped
milestone: M1, slice 3b (roadmap.md)
branch: editor-and-formatting, PR #3 open, not merged at archive time
raw: raw/
---

## 1. What was built

Every recorded request and response body shows in a read-only Monaco 0.57.0 editor with a fixed height that scrolls inside its own area, so
History is one scroll below even a 1 MiB body. JSON and XML bodies (chosen from the recorded `Content-Type`) show Pretty by default, with a
Raw switch and a label. Formatting is `src/core/body-format.ts`, a token scanner that carries state between pieces, so a stored body read a page
at a time is formatted as each page arrives and appended to the model as an edit. Only whitespace between tokens changes; nothing recorded,
sent, replayed or exported changes. Links are off and main denies every new window, so a body cannot run script or open a page (T1.8).

**Differs from the plan:**
- Workers are configured: `MonacoEnvironment.getWorker` loads the editor and JSON workers as bundled files from `file://`. Revisions 2–4
  planned no workers at all, on the spike's evidence.
- `monaco-editor/internal/common/workers.js` is imported eagerly at startup (revision 6).
- A leading byte order mark is not drawn by Monaco; the label says the recorded text starts with one.
- A trailing CR is held back to the next page, so a CRLF split across pages is one line break.
- JSON keeps tokens only: diagnostics, folding by syntax, hovers and formatting from the JSON worker are off (code review finding 4).
- Each body has its own error boundary keyed to that body, and a failed view switch shows "Could not show the body" (code review 1, 2).
- The phase 4 gate first ran as `npx playwright test` on `.vite/`; `npm run test:e2e` completed later, 26 passed.

## 2. Why this approach

`tech-stack.md` chose Monaco, and a `<pre>` cannot scroll a 17 MiB body in a fixed box without rendering all of it. The formatter is this
repository's own code because every library option needs the whole document and rewrites what it reads: a 17 MiB body arrives in 1 MiB pages,
and an integer above 2^53 must keep every digit (T2.6). One code path serves a 20-byte inline body and a 17 MiB stored one.

Pages are appended as model edits, never joined into one string, because V8's string limit would apply. The kind comes from the recorded
`Content-Type`, not from sniffing content, so a `text/plain` body that looks like JSON stays as written.

e2e reads whole bodies through `data-loaded-chars` (decoded characters loaded) and the keyboard (Cmd+Up / Cmd+Down), with no test-only path in
the renderer.

## 3. What was rejected

- **Keep the `<pre>`, add a formatter only** — cannot scroll a 17 MiB body in a fixed box; reverses `tech-stack.md`.
- **CodeMirror 6** — smaller and CSP-friendly, but reverses a stack decision; held as the fallback, never needed.
- **`@monaco-editor/react`** — loads Monaco from a CDN by default, which `script-src 'self'` blocks.
- **Monaco's Format Document** — needs the JSON worker, has no XML formatter, formats whole documents only.
- **`JSON.parse`/`stringify`, `DOMParser`** — lose digits above 2^53, rewrite escapes and entities, need the whole document; `DOMParser` also
  parses untrusted markup in the renderer.
- **Formatting only after every page loads, or only up to 1 MiB** — author chose formatting every size as pages arrive.
- **A label only, or Raw by default** — no way to see the recorded text, or works against "shown pretty-printed".
- **Raw and pretty models held at once** — doubles renderer memory for a stored body; the view switch reformats the raw pages instead.
- **No workers at all** — each worker-backed feature must be found and turned off one by one, and an upgrade can add another.
- **`editor.main.js`** — registers every language and worker (TypeScript, CSS, HTML), several MB more; kept as the fallback to the eager import.
- **A Monarch JSON grammar in this repository** — removes the JSON worker but adds a grammar to maintain.
- **`blob:` or `worker-src` in the CSP** — `AGENTS.md` fixes the CSP, and bundled files under `script-src 'self'` need neither.
- **A visible BOM marker inside Raw** — would show a character the record does not hold at that place.
- **A test hook exposing the model text** — a test-only path in production code.
- **`text/json` as JSON** — not in the planned type list (code review 8, accepted).
- **Out of scope:** the form's body box stays a text box; mixed or lone-CR line endings show as one kind; no Copy action; no freeing or
  windowing of loaded pages; multipart (slice 4), search (slice 6), deletion (slice 7).

## 4. Surprises

- **The spike's "no worker" result did not hold in this renderer.** In a bare Vite and Electron app no worker started; inside this app the
  editor worker started, fell back to `blob:`, and the CSP blocked it. The spike's Not tried list named this renderer, and the plan still marked
  the assumption verified through two plan reviews (review F2; third incident of the standing spike rule).
- **Monaco's lazily loaded JSON support threw five "depends on UNKNOWN service" errors.** About 60 contributions load with `jsonMode` after
  the first editor's services exist. They surfaced as uncaught page errors, which phase 2's console-only listener missed (review F3).
- **Monaco drops a leading BOM** from the model (`pieceTreeTextBufferBuilder.js:71`) and keeps one end-of-line type per model.
- **A CR and an LF appended as separate edits show as two line breaks.**
- **Drawn lines are not in DOM order after a scroll**; tests sort `.view-line` by `top`. Jumping with Cmd+Down redraws in order, so an
  order bug only showed after a wheel scroll was added to the test.
- **A code review test passed unfixed through the result view**, because that view unmounts during a send and resets the boundary; it had to
  move to the call panel to go red.
- **Links-on was caught every run, in a different content type each time**, because Monaco detects links asynchronously.

## 5. What still stands

- If the editor breaks after a Monaco upgrade, check first: the `?worker` entry paths in `src/renderer/app.tsx`, the eager
  `internal/common/workers.js` import, and `e2e/body-safety.spec.ts`'s console and page-error assertion.
- `body-safety.spec.ts` is the CSP and T1.8 guard; it records console errors and uncaught page errors. A new Monaco feature that needs a worker
  or a service will fail it.
- The packaged `.app`'s console is unreadable (`ELECTRON_ENABLE_LOGGING` writes nothing), so the CSP is checked on the `.vite/` build only.
- Switching Pretty/Raw on a fully loaded 17 MiB body holds the window about 1.2 s (accepted, F6 / CR3).
- `wordWrap` on a 17 MiB single line appends in about 91–297 ms per page; the wrap-off fallback was not needed.
- The 17 MiB e2e test checks length, start and end, not the middle; content correctness rests on the formatter's 54 unit tests (F4).
- A held-back CR is lost if the next page read fails (CR5, accepted).
- The inline Pretty/Raw choice resets when a call is opened again (CR7, accepted).
- Renderer memory still limits how far a very large body can be paged (T3.10, manual).

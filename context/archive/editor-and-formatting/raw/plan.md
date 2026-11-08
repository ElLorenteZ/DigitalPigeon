---
change_id: editor-and-formatting
status: draft
produced-by: lz-plan
created: 2026-11-07
updated: 2026-11-08
inputs: [change.md, author answer 2026-11-08 (Monaco load), author answers 2026-11-07, author answers 2026-11-08 (two rounds), progress.md phase 2 (blocked, three defect drifts), spike-monaco.md, lz-plan-review 2026-11-08, foundation/prd.md, foundation/tech-stack.md, foundation/test-strategy.md, foundation/roadmap.md, foundation/lessons.md, archive/request-bodies-and-storage/record.md, archive/preview-replay-export/record.md, e2e/bodies.spec.ts]
revision: 6 — answers phase 4's defect drift (progress.md, 2026-11-08): Monaco's JSON language lazy-loads editor contributions whose services register after the first editor exists, so five services throw as UNKNOWN. The renderer now imports those contributions at startup (author decision, 2026-11-08). Phases 1 to 3 stay done; phase 4 resumes. Revision 5 — answers phase 2's three defect drifts (progress.md, 2026-11-08): Monaco starts workers, a worker file is bundled, and a leading byte order mark is not drawn. Workers now load from file:// (author decision); a leading BOM is noted in the label (author decision). Phase numbers are unchanged; phase 1 stays done. Revision 4 answered the second plan review: the end check under the wrapping fallback, what `data-loaded-chars` counts, and how existing assertions read a body that opens Pretty. Revision 3 answered the first review: how e2e checks a whole body, the wrapping fallback, line endings, the editor's error path, and test-strategy updates. Revision 2 folded in spike-monaco.md.
---

# Plan: Show JSON and XML bodies pretty-printed in the editor, with stored bytes unchanged

## Approach

**A read-only Monaco editor replaces the `<pre>` for every recorded body, and formatting is this repository's own code, not Monaco's.** Request and response bodies in the call panel and the result view open in a fixed-height editor that scrolls inside its own area. The form's text box is unchanged (author decision). Nothing in this change touches what is recorded, sent, replayed or exported: formatting exists only between the decoded text and the editor.

**The formatter works on tokens and carries its state between pages (author decision).** `src/core/body-format.ts` is a pure module the renderer imports. It takes text in pieces and returns indented text, without parsing a whole document. JSON strings and numbers are copied as written, so an integer above 2^53 keeps every digit (T2.6). XML tags, attributes, comments, CDATA and processing instructions are copied as written. Only whitespace between tokens changes: whitespace-only text between XML elements is replaced by indentation, and any text that is not whitespace-only is left alone. Malformed input is indented as far as the tokens allow, and no character other than that whitespace is added or removed. One code path serves a 20-byte inline body and a 17 MiB body read a page at a time. The kind is chosen from the recorded `Content-Type`: `application/json`, `+json`, `application/xml`, `text/xml` and `+xml`, ignoring case and parameters. Anything else is shown as raw text.

**Each JSON or XML body has a Pretty and Raw switch, with a label saying which is shown (author decision).** Pretty is the default. Raw shows the decoded text as the record holds it. Monaco takes a leading byte order mark out of the text it draws (`pieceTreeTextBufferBuilder.js:71` in `monaco-editor` 0.57.0), so when the decoded text starts with U+FEFF the label says the recorded text starts with a byte order mark that is not drawn (author decision, 2026-11-08). `data-loaded-chars` still counts it. A stored body still loads page by page with Load more. Pages are appended to the editor's model as edits, never joined into one string, because V8's string limit would apply.

**Monaco's workers load as bundled files from `file://` (author decision, 2026-11-08), and nothing loads from the network.** The renderer imports `monaco-editor/editor/editor.api.js` and the JSON and XML language registrations only, bundled by Vite. The renderer also imports `monaco-editor/internal/common/workers.js` at startup, before any editor is created (author decision, 2026-11-08). The JSON language loads that module lazily, from `jsonMode`, through `languages/features/json/workerManager.js:1`; it imports about 60 editor contributions, which register their services as they load. Loaded lazily, they register after Monaco has created its services for the first editor, and five of them (`ICodeLensCache`, `IInlayHintsCache`, `ITreeViewsDnDService`, `ISuggestMemoryService`, `IActionWidgetService`) then throw "depends on UNKNOWN service" (progress.md, phase 4). Loaded first, they register in time. `MonacoEnvironment.getWorker` returns the editor worker or the JSON worker, each created from its bundled file URL, so no worker is created from a `blob:` URL. `script-src 'self'` already admits a worker from the app's own `file://` origin: phase 2's run started `json.worker-*.js` that way with no violation, while the editor worker, with no `getWorker`, fell back to `blob:` and was blocked three times (progress.md, phase 2). The CSP is unchanged. Links are off, and main denies new windows, so nothing in a body can open a page. `wordWrap` is on in both views, because Monaco stops drawing a long line at "Show more" and a minified body is one line. The production CSP, `sandbox: true` and `contextIsolation` stay as they are. `spike-monaco.md` ran Monaco from `file://` under the CSP and the sandbox, with 17 appended pages of 1 MiB at 8–17 ms each. Its "no worker" result did not hold in this repository's renderer (phase 2), so the plan no longer cites it for workers. It did not run the packaged `.app`, React, `StrictMode`, the preload, DevTools, or wrapping a 17 MiB line; those are checked in phases 2 and 3.

**e2e checks a whole body through one attribute and the keyboard (author decision, 2026-11-08).** Monaco draws only the lines on screen, so the page holds no whole body to read. The body area carries `data-loaded-chars`, the number of decoded characters loaded so far, beside the existing `data-remaining`. It counts the recorded text, not the model, so it is the same in Pretty and Raw and a dropped page shows in either view. A test reads the start and end of a body by clicking a visible point in the editor, pressing Cmd+Up or Cmd+Down, and reading the visible lines sorted by `top`. No test-only code path exists in the renderer.

**Wrapping is on until timing says otherwise (author decision, 2026-11-08).** If wrapping a 17 MiB single line is slow, `wordWrap` turns off for bodies above a size measured in phase 3. Such a body shows Monaco's "Show more" cut-off, and the label says that long lines are not wrapped. If the fallback is taken, the 17 MiB e2e body gains a line break every 64 KiB, so its end stays readable with Cmd+Down; the cut-off and the label on a single-line body above the size are checked by observation in phase 3.

**Line endings are Monaco's.** A model holds one end-of-line sequence, so a body mixing CRLF and LF, or holding a lone CR, shows with uniform line breaks, and text copied from the editor carries them. The recorded bytes, Replay, Edit and curl export are unaffected. This is accepted and listed under Out of scope.

**A failed editor stays inside its body area.** An error boundary around each body shows "Could not show the body" with the message, so the form, the panel and History stay usable if Monaco throws.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Keep the `<pre>` and add a formatter only | `tech-stack.md` chose Monaco, and `roadmap.md` names the editor. A `<pre>` cannot scroll a 17 MiB body in a fixed box without rendering all of it. Revisit if the spike fails. |
| CodeMirror 6 | Smaller and built for strict CSPs, but it reverses a `tech-stack.md` decision, which belongs to `lz-stack`. The fallback if the spike fails. |
| `@monaco-editor/react` | Loads Monaco from a CDN by default. `script-src 'self'` blocks that, and configuring it to load locally adds a loader for no gain. |
| Monaco's Format Document | Needs the JSON language worker, has no XML formatter, and formats a whole document only, so it cannot format pages as they arrive. |
| `JSON.parse` and `JSON.stringify` | Loses digits above 2^53 (T2.6), normalises escapes and duplicate keys, and needs the whole document. |
| `DOMParser` for XML | Whole document only, rewrites entities and attribute quoting, and parses untrusted markup in the renderer. |
| Formatting once every page is loaded | Author chose formatting as pages arrive. It would need every page first, and one string meets V8's limit. |
| Format only up to 1 MiB | Author chose formatting every size. A large JSON response would stay unformatted. |
| Label only, or Raw by default | Author chose a switch. A label gives no way to see the recorded text, and Raw by default works against "shown pretty-printed". |
| Choosing the kind by looking at the content | Would format a `text/plain` body that looks like JSON. The recorded `Content-Type` is what the server or the author declared. |
| Keeping a raw and a pretty model at once | Doubles renderer memory for a stored body. The raw pages already held are formatted again when the switch changes. |
| No `MonacoEnvironment`, relying on no worker being started | Chosen in revisions 2 to 4 on the spike's evidence; false in this renderer, where the editor worker fell back to `blob:` and the CSP blocked it (progress.md, phase 2). |
| No workers at all: every worker-backed feature turned off and `getWorker` refusing | Author chose workers from `file://`. Turning off each feature that wants a worker (JSON modes, Unicode highlighting, word highlighting) has to be found feature by feature, and a Monaco upgrade can add one. |
| `editor.main.js` as the entry | Registers every service up front, and also every language, including TypeScript, CSS and HTML with their workers: several MB more and more worker labels. The fallback if the eager import does not remove the errors. |
| Dropping Monaco's JSON language for a Monarch grammar in this repository | No worker manager and no JSON worker, but a grammar to maintain, and no folding or JSON diagnostics. Author chose the eager import. |
| Adding `worker-src` or `blob:` to the CSP | `AGENTS.md` fixes the CSP, and a bundled file under `script-src 'self'` needs neither. |
| A visible marker for a byte order mark inside the Raw text | The marker would be a character the record does not hold at that place. Author chose a note in the label. |
| Importing `monaco-editor` (`editor.main`) | Registers every language and contribution. The spike ran with `editor.api` plus JSON and XML only. |
| `wordWrap` off, or on in Raw only | A long line stops at "Show more (17.0 MB)" in the spike. A long JSON string in Pretty is also one line, so wrapping applies in both views. |
| A test hook exposing the model's text to e2e | A test-only path in renderer code (author decision, 2026-11-08). `data-loaded-chars` and the keyboard cover length, start and end. |
| Keys and visible lines only, no attribute | Loses the exact length check, which caught the page-append defect in the second code review of `request-bodies-and-storage` (`Expected "2097152" Received "1048576"`). |
| Making the e2e bodies many short lines instead of a wrapping fallback | Keeps the gate fast and leaves a real minified 17 MiB body slow in daily use. Author chose the size fallback. |
| Reading the end of an unwrapped single line under the fallback through a test hook or the clipboard | A test-only path, or a clipboard stub that tests the copy and not the view. A body with line breaks keeps the end visible through the same helper. |
| Asserting Pretty text in every existing body assertion | Couples each existing spec to the formatter's indentation. Those specs check the recorded text; Pretty output is checked once in phase 2 and by phase 1's unit tests. |
| Falling back to the `<pre>` when Monaco throws | Brings back the long scroll and a 17 MiB `<pre>` on the failure path. An error in the body area keeps the rest of the window usable. |

## Out of scope

- The request form's body box stays a text box (author decision). Typing in Monaco, and a Format action in the form, are not built.
- Configuring the JSON language beyond Monaco's defaults: no schemas. Whatever the default JSON worker shows on a malformed body, such as a squiggle, is accepted as display (T3.2).
- Highlighting beyond what Monaco tokenizes in the main thread. HTML, YAML and other kinds show as raw text.
- Search inside a body beyond what Monaco offers by default.
- Charsets other than UTF-8, as before.
- A formatter that reports a document as invalid. Malformed input is indented as far as its tokens allow.
- Freeing loaded pages, or windowing them.
- Showing mixed or lone-CR line endings as recorded. Monaco shows one kind of line break per model, and text copied from the editor carries it. The record and every action that sends or exports it are unaffected.
- A Copy body action. Copying is Monaco's selection, and copies what the view shows.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | `monaco-editor` 0.57.0 renders a read-only editor in the production build under the existing CSP, `sandbox: true` and `contextIsolation`, loaded from `file://`, with no CSP violation and no network request. | Phase 2 cannot proceed without changing the CSP, which `AGENTS.md` forbids. The fallback is the CodeMirror row above. | yes — **verified** by `spike-monaco.md` for a Vite build from `file://`; the packaged `.app` is A8 |
| A2 | With `MonacoEnvironment.getWorker` creating the editor and JSON workers from their bundled `file://` URLs, both start under the unchanged CSP with no console error, in the e2e build. | Workers stay blocked, or the CSP would need changing, which `AGENTS.md` forbids. Phase 2 stalls; the fallback is the "no workers at all" row, which the author ranked second. | yes — **partly verified**: phase 2's run started `json.worker-*.js` from `file://` with no violation. The editor worker from `file://` is unverified; phase 2's first step checks it before any other work |
| A3 | A model grown by appending 17 pages of 1 MiB through edits stays usable: scrolling, reaching the end, and appending the next page. | Phase 3 needs windowing, which is out of scope. | yes — **verified**: 8–17 ms per append, Cmd+Down reached line 188,815. Memory was not measured |
| A4 | Playwright can read the text Monaco shows, so e2e can assert what a reader sees. Whole-body length comes from `data-loaded-chars`, not from the page text. | Phase 2 cannot keep the existing body assertions. | yes — **verified** for visible text: a short body reads in order through the editor's text; a long one by sorting `.view-line` by `top`; keys need a click on a visible point first. `data-loaded-chars` is set by this change and checked against known bodies in phases 2 and 3, in both views |
| A5 | Monaco's main-thread tokenizers highlight JSON and XML. | Bodies show unhighlighted. The roadmap outcome still holds. | no |
| A6 | `links: false` plus a deny-all `setWindowOpenHandler` stops every path from a body to a new page. | A body could open a page or window. | no — phase 4's T1.8 test checks it |
| A7 | Token-level formatting keeps every character except whitespace between tokens, for any split into pages. | T2.6 fails. | no — phase 1 checks it |
| A8 | Monaco behaves the same in the packaged `.app` (asar, fuses), inside this repository's React tree under `StrictMode`, and with DevTools open as in e2e. Not tried by the spike. | The editor fails only in the shipped app, or `StrictMode` creates two editors. | no — phase 2 runs the e2e suite (React, `StrictMode`, DevTools) and opens one body in the packaged `.app` |
| A10 | Importing `monaco-editor/internal/common/workers.js` before the first editor is created registers the five services in time, so no "depends on UNKNOWN service" error is thrown, as a console message or an uncaught page error, in the sequence `body-safety.spec.ts` runs. | The safety spec's console assertion keeps failing. Phase 4 stalls; the fallback is `editor.main.js`. | yes — **unverified**. The mechanism is read from the source, not run: `jsonMode` is a lazy chunk (`languages/features/json/register.js:60`), and `registerSingleton` calls in the chunk come after the first editor. Phase 4's first step checks it with the failing safety spec |
| A9 | `wordWrap: 'on'` keeps a 17 MiB single-line body usable. The spike showed the end of such a line, and did not time it. The existing 17 MiB e2e body is one raw line, so every e2e run from phase 3 on depends on it. | The e2e gate turns slow or flaky, and a large minified body freezes the window. | yes — **unverified**; phase 3's first step times it, and the fallback is fixed: `wordWrap` off above a measured size (author decision, 2026-11-08) |

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | JSON and XML text, in any number of pieces, formats into indented text with every other character kept | new `src/core/body-format.ts`, its test | lz-tdd | `npm run test:unit` |
| 2 | A recorded body up to 1 MiB opens in a read-only editor with a Pretty and Raw switch, and History stays reachable | `package.json`, `src/renderer/app.tsx`, `src/index.css`, `src/main.ts`, e2e specs that read body text | lz-build | `npm run typecheck`, `npm run lint`, `npm run test:e2e`; scripted observation |
| 3 | A stored body loads page by page into the editor, formatted as pages arrive | `src/renderer/app.tsx`, `e2e/bodies.spec.ts`, `e2e/open-call-failures.spec.ts` | lz-build | `npm run typecheck`, `npm run lint`, `npm run test:e2e`; scripted observation |
| 4 | A body cannot run script or open a page, and the switch and Load more hold in the built app | `src/renderer/app.tsx` (one import), `e2e/bodies.spec.ts`, new `e2e/body-safety.spec.ts`, `context/foundation/test-strategy.md` | lz-e2e | `npm run test:e2e`, three clean runs |

### Phase 1 — JSON and XML text, in any number of pieces, formats into indented text with every other character kept

**Changes:**
- `src/core/body-format.ts`, pure, no DOM:
  - `bodyKind(headers)`: `json`, `xml` or `raw`, from the recorded `Content-Type`
  - a formatter per kind with `push(text) → string` and `end() → string`, carrying its state between calls
- Tests in `src/core/body-format.test.ts`:
  - T2.6: an integer above 2^53, a long decimal and an exponent keep their digits; strings with escaped quotes, backslashes, `\u` escapes and non-ASCII are copied as written
  - every non-whitespace character outside strings, and every character inside them, is kept; output with whitespace between tokens removed equals input with the same removed
  - the same input split at every position, into two pieces, gives the same output as the whole
  - XML: attributes holding `>`, comments, CDATA, processing instructions, a doctype and self-closing tags are copied as written; text that is not whitespace-only is unchanged
  - malformed JSON and XML, and an empty body, produce output under the same keep-every-character rule
  - a byte order mark at the start is kept
  - `bodyKind` for each listed type, with parameters, case, and an absent or unknown type

**Verification:**
```
$ npm run test:unit
expected: exit 0; body-format tests listed and passing
```

**Done when:** tests pass, and each of these fails a test: parsing numbers instead of copying them, dropping a character inside a string, treating `>` inside an attribute value as the tag's end, and resetting state between pieces.

**Executor:** lz-tdd — T2.6 is assigned to unit, and the formatter is a pure transformation.

### Phase 2 — A recorded body up to 1 MiB opens in a read-only editor with a Pretty and Raw switch, and History stays reachable

**Changes:**
- `package.json`: `monaco-editor` pinned to `0.57.0`, the version the spike ran.
- Resumes from the blocked attempt recorded in `progress.md`; that code stays and is changed as below.
- First step: set `MonacoEnvironment.getWorker` for the `editorWorkerService` and `json` labels, each worker created with `new Worker(new URL(…, import.meta.url), { type: 'module' })` from `monaco-editor`'s worker entry files. Run the built app and record the console and the workers started. Zero errors and both workers from `file://` settle A2; otherwise stop and record a defect.
- `src/renderer/app.tsx`: `InlineBodyText` renders a read-only editor in place of the `<pre>`. One editor per body, disposed when the body leaves the screen, including `StrictMode`'s second mount.
  - The Pretty and Raw switch appears for `json` and `xml`, with a label saying which is shown. The kind comes from the recorded request or response headers.
  - Imports: `monaco-editor/editor/editor.api.js`, `monaco-editor/language/json/monaco.contribution.js`, `monaco-editor/languages/definitions/xml/register.js`, and the worker setup above.
  - When the decoded text starts with U+FEFF, the label adds that the recorded text starts with a byte order mark that is not drawn, in both views.
  - Editor options: `readOnly`, `links: false`, `wordWrap: 'on'`, `automaticLayout`, minimap off.
  - The body area carries `data-loaded-chars`, the number of decoded characters loaded, the same in both views.
  - An error boundary around each body: if the editor throws, the body area shows "Could not show the body" and the message, and the rest of the window keeps working.
- `src/index.css`: a fixed-height editor area.
- `src/main.ts`: `setWindowOpenHandler` denies every new window. This adds a restriction, and no hardening setting changes.
- e2e specs that read body text (`bodies.spec.ts`, `replay.spec.ts`, `send-and-record.spec.ts`, `open-call-failures.spec.ts`) read what the editor shows. A short body is read through the editor's text, with Playwright's whitespace normalisation. Where a body is longer than the area, lines are read by sorting `.view-line` by `top`. A test that presses keys in a body clicks a visible point in the editor first. Length is read from `data-loaded-chars`. One shared helper in `e2e/` holds these.
- Existing assertions that check a body's recorded text (`e2e/bodies.spec.ts:102`, `:129`, `:133`, `:158`, and any other on a JSON or XML body) press Raw first, then read. A body with no JSON or XML type has no switch and is read as it is. One new assertion checks the Pretty text of `{"item":"é"}`.

**Verification:**
```
$ npm run typecheck && npm run lint && npm run test:e2e
expected: exit 0; every existing spec passes
$ scripted observation against the built app (throwaway, deleted afterwards), dp_test_ database:
observe: a JSON and an XML response open Pretty, indented, with the label; Raw shows the recorded text
observe: a JSON response starting with U+FEFF: the label notes the byte order mark in Pretty and in Raw; data-loaded-chars counts it
observe: a text/plain body that looks like JSON is shown raw, with no switch
observe: after a 1 MiB response, History's heading comes into view with one scroll of the page, not 131,000 px
observe: zero console errors and zero CSP violations while opening JSON, XML and text bodies; workers started only from file:// URLs of the bundle; no failed request
observe: Cmd+click on a URL inside a body opens nothing
observe: a JSON body on one line longer than the area wraps, and its last character is visible after a click on a drawn text line (a .view-line element, not the margin) and Cmd+Down
observe: opening ten calls in turn leaves one editor in the DOM (StrictMode, disposal)
observe: data-loaded-chars equals the decoded length of a known 1 MiB JSON body, in Pretty and in Raw
observe: with editor creation forced to throw (temporary edit, reverted), the body area shows the error and History and the form still work
$ npm run package, then open the packaged .app against a dp_test_ database (A8)
observe: one JSON response opens Pretty, highlighted; no CSP violation in the console
$ grep -c 'MongoClient' / 'undici' / 'GridFSBucket' in the preload and renderer bundles
expected: 0
$ ls .vite/renderer/main_window/assets for worker files
expected: the editor worker and the JSON worker files only
$ time npm run package and npm run test:e2e, before and after the dependency
expected: both times recorded in progress.md
```

**Done when:** the commands pass and every observation holds, recorded with output.

**Executor:** lz-build — wiring a component into the renderer and configuring the build.

### Phase 3 — A stored body loads page by page into the editor, formatted as pages arrive

**Changes:**
- First step, before the wiring: time a 17 MiB single-line raw body in the editor with `wordWrap: 'on'`, from the last append to its end being shown, recorded in `progress.md`. If it holds the window for more than about one second, set a size above which `wordWrap` is off and the label says long lines are not wrapped (author decision, 2026-11-08); the measured size and the time are recorded. Under the fallback, the 17 MiB e2e body gains a line break every 64 KiB, with START-MARKER first and FINAL-MARKER last.
- `src/renderer/app.tsx`: `PagedBodyText` appends each page to the editor's model as an edit. In Pretty, each page goes through the formatter, carrying its state between pages. Switching between Pretty and Raw rebuilds the model by appending the loaded pages again. The remaining count, Load more, one read at a time and ignored stale answers stay as they are. `data-loaded-chars` follows the model.
- `e2e/bodies.spec.ts`, the 17 MiB Load more test (`e2e/bodies.spec.ts:180-245`): `ends()` reads the length from `data-loaded-chars` and the first and last 12 characters from the visible lines after Cmd+Up and Cmd+Down. `lastPageTopInView` (a DOM range on the last page's text node) is replaced by the T2.9 check for a body that scrolls in its own area: after Load more, the body area and the remaining count are in the viewport. The reopen test (`e2e/bodies.spec.ts:248`) and the 2 MiB request body test keep their `data-remaining` checks.
- `e2e/open-call-failures.spec.ts:160-187`: the paged request body `[file-b@0][file-b@10]` is read through the shared helper.

**Verification:**
```
$ npm run typecheck && npm run lint && npm run test:e2e
expected: exit 0
$ scripted observation against the built app, dp_test_ database:
observe: a 17 MiB JSON response loads to its end with Load more; after a click inside the editor, Cmd+Down shows the final value; indentation continues correctly across a page boundary
observe: a 17 MiB minified JSON response, fully loaded, switched to Raw: time to show recorded (A9), and its end visible
observe: switching to Raw and back keeps every loaded page, in order
observe: a multi-byte character across a page boundary shows correctly in both views
observe: a body with CRLF split across a page boundary shows one line break there, not two
observe: a 17 MiB JSON response, fully loaded, switched from Raw back to Pretty: time to show recorded; data-loaded-chars unchanged by the switch
observe: if the fallback was taken, a single-line raw body above the size shows the cut-off and the label saying long lines are not wrapped
observe: opening another call while a page is being read shows only the new call's body
```

**Done when:** the commands pass and every observation holds, recorded with output; the 17 MiB test fails when a page is not appended (length short by 1 MiB), checked by a temporary edit and reverted.

**Executor:** lz-build — renderer wiring over the formatter phase 1 tested.

### Phase 4 — A body cannot run script or open a page, and the switch and Load more hold in the built app

**Changes:**
- Resumes from the blocked attempt in `progress.md`; `e2e/body-safety.spec.ts` exists and fails on the console assertion.
- First step: `src/renderer/app.tsx` imports `monaco-editor/internal/common/workers.js` before the editor API is used. Run `body-safety.spec.ts`: its `text/plain` test, red before the import, must pass, with the console and uncaught page errors empty. If not, stop and record a defect; `editor.main.js` is the fallback.
- Console checks record both console messages and uncaught page errors (`pageerror`). Phase 2's observation recorded console messages only, which is how these errors were missed.
- New `e2e/body-safety.spec.ts`, T1.8, on the production build, also records the window's console while bodies open and asserts no error and no CSP violation, so a blocked worker fails the suite rather than passing silently as it did in phase 2's first attempt.
- The T1.8 payloads: responses holding `<script>`, `<img onerror>`, an SVG with an event handler and a `javascript:` URL, as `text/html`, `application/xml`, `application/json` and `text/plain`. Opened in Pretty and in Raw. A page-level flag the payload would set stays unset. No new window opens, and the main window's URL does not change.
- `e2e/bodies.spec.ts`:
  - T2.9: the switch keeps the body in view, and History is reachable after a 1 MiB response
  - Load more on a stored JSON body, read to its final value
  - T2.10: a held page read for one call does not appear under the next
- `context/foundation/test-strategy.md`: Covered? for T1.8 and T2.6, and T2.9's Load more entry, point at the tests this change leaves; T3.10's long scroll is marked ended.

**Verification:**
```
$ npm run test:e2e
expected: all specs pass; the new and changed scenarios pass 3 times; no dp_test_ database remains
```

**Done when:** specs pass three times, and each fails under one of these: the body rendered through `innerHTML`, links left on with no window handler, a stale page applied to the next call, the switch moving the body out of view, Load more leaving the body area or the remaining count out of view, and the read helper returning lines in DOM order after a scroll.

**Executor:** lz-e2e — T1.8, T2.9 and T2.10 are e2e risks.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| Monaco cannot run under the CSP or the sandbox | possible: its worker was blocked once | Phases 2 to 4 stall | Workers from `file://` (A2), checked first in phase 2; "no workers at all" is the second fallback, CodeMirror the third; phase 2 opens the packaged `.app` (A8) |
| A blocked worker or CSP violation passes the suite unnoticed | happened once | Monaco runs degraded with errors no test reads | Phase 4's spec asserts a clean console |
| Monaco's bundle slows `npm run package` and every e2e run | possible | Slower gates | Spike build took 0.5 s at 4.8 MB; phase 2 records the gate times before and after |
| Wrapping a 17 MiB line freezes the window | possible | Raw view of a large minified body stops responding; the e2e gate turns slow | Phase 3 times it first (A9); the fallback, wrapping off above a measured size, is decided |
| Monaco throws while creating an editor | unlikely | The whole window unmounts | An error boundary per body (phase 2), checked by forcing a throw |
| Line endings shown differ from the record | certain for mixed endings | Copied text differs from the recorded bytes | Accepted, Out of scope; the record and every action on it are unaffected |
| The formatter misreads a token and drops a character | possible | T2.6: the view differs from the record in content | Phase 1's keep-every-character and split-anywhere tests; the Raw view always shows the record |
| Formatting and appending 17 MiB in the renderer freezes the window | possible | The app stops responding while a page loads | A3's spike measures it; a page is formatted as it arrives |
| e2e reads lines in DOM order and passes on the wrong text | possible | A body assertion stops catching a wrong body | The shared helper sorts by `top`; phase 4's done-when breaks a body and expects a failure |
| `StrictMode` creates two editors, or leaks one per opened call | possible | Memory grows with each opened call | Phase 2 disposes editors on unmount; phase 3's observation opens calls repeatedly |

## For the reviewer

- **Weakest link:** A10, the eager import. The cause is read from Monaco's source, not proven by a run; phase 4 runs the safety spec, which is red today, as the check, with `editor.main.js` as the fallback. No spike is routed, because the check is one import and one spec run.
- **Phase 2's "zero console errors" result** recorded console messages only. It does not cover uncaught page errors; phase 4's spec does.
- **Earlier weakest link, now settled:** A2, the editor worker from `file://`. Its JSON counterpart started that way in this app, which is the evidence; the editor worker itself is checked as phase 2's first step, with the author's second choice as the fallback. No spike is routed, because the check needs only the phase 2 code already in the working tree.
- **The spike's worker finding was wrong for this renderer.** Revisions 2 to 4 cited it; this revision does not. Which difference between the spike's app and this one starts the workers was not found and is not needed once workers are configured.
- **Phase 4's console assertion** traces to phase 2's first attempt, where three CSP violations passed all 19 specs.
- **Next weakest:** A9, wrapping a 17 MiB line. It is unverified and the e2e gate depends on it from phase 3, so phase 3 times it before any wiring, with the fallback already decided. No spike is routed: either result leaves phase 3 able to proceed. A8 (packaged `.app`, `StrictMode`, DevTools) is checked in phase 2.
- **`data-loaded-chars`** is an attribute in production DOM that tests read, in the same way as `data-remaining`. It carries a count, not body text.
- **"About one second"** as the point where wrapping counts as slow is a planning choice, not an author answer.
- **A line break every 64 KiB** in the 17 MiB e2e body, only if the fallback is taken, is a planning choice. It changes the test body, not the wrapping decision the author made.
- **Existing assertions press Raw** before reading a JSON or XML body. A reviewer should check each still fails on a wrong body.
- **`wordWrap: 'on'` in Pretty** is a planning choice, not an author answer. It follows from the spike's long-line cutoff: a long JSON string is one line in Pretty too.
- **The formatter is new code with a strict rule:** keep everything except whitespace between tokens. Its tests compare inputs and outputs with whitespace removed, so a formatter that changes whitespace inside a string, or inside an XML text node, must fail them.
- **Phase 2 changes every spec that reads a body.** The risk is weakening those tests while changing how they read. Each changed assertion should still fail when the body is wrong.
- **`setWindowOpenHandler` in `src/main.ts`** is outside `change.md`'s list of touched code. It traces to the boundary's T1.8 line, "a response body cannot run as script", and adds a restriction only.
- **No phase changes the record.** A reviewer should find no diff in `src/core/` outside `body-format.ts`.

## References

- `context/changes/editor-and-formatting/change.md` — boundary, and three questions answered by the author on 2026-11-07.
- `context/foundation/tech-stack.md:25` — Monaco chosen for the editor.
- `context/foundation/prd.md:27` — "JSON and XML request and response bodies are shown pretty-printed."
- `context/foundation/test-strategy.md` — T1.8 (e2e, production build), T2.6 (unit), T2.9, T2.10, T3.10.
- `context/foundation/lessons.md` — standing rule: list what a spike did not try.
- `context/changes/editor-and-formatting/spike-monaco.md` — verdict holds; imports, options, the e2e reading method, and the "Not tried" list.
- `vite.renderer.config.mts:7` — the production CSP: `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, no `worker-src`.
- `src/main.ts:20` — window options; no `setWindowOpenHandler` today.
- `context/archive/request-bodies-and-storage/record.md` §1, §5 — paged bodies, `ignoreBOM`, the long scroll accepted until the editor.

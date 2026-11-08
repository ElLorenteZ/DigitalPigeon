---
change_id: editor-and-formatting
produced-by: lz-e2e
plan: plan.md
updated: 2026-11-08
---

# Progress: Show JSON and XML bodies pretty-printed in the editor, with stored bytes unchanged

Work runs on branch `editor-and-formatting`, created from `main` at `0250bf6` with `roadmap.md`, `test-strategy.md` and this change folder
uncommitted. Phases 2 and 3 are assigned to `lz-build` and phase 4 to `lz-e2e` by the plan.

## Phase 1 — JSON and XML text, in any number of pieces, formats into indented text with every other character kept

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-08
- **Finished:** 2026-11-08

**Changed**
- `src/core/body-format.ts` — new, pure. `bodyKind(headers)` reads the first `Content-Type` in any case, drops parameters, and returns `json` for
  `application/json` and `+json`, `xml` for `application/xml`, `text/xml` and `+xml`, otherwise `raw`. `createFormatter(kind)` returns
  `{ push(text), end() }`:
  - JSON: a character-level scanner. Strings are copied whole with their escapes; whitespace outside strings is dropped and replaced by two-space
    indentation, a newline after `,`, and one space after `:`. Separators are written when the next token arrives, so `{}` and `[]` stay on one line.
    Whitespace between two values in malformed input stays as one space, so `1 2` does not read as `12`.
  - XML: text that is whitespace-only is held and replaced by indentation; any other text is written as it arrives, with its own whitespace. Markup is
    classified from at most its first nine characters (`<!--`, `<![CDATA[`, `<?`, `</`, `<!`, otherwise a start tag) and then copied as it streams.
    Start and end tags honour quoted attribute values; a declaration honours an internal subset in brackets. An end tag right after its start tag
    stays on the same line.
  - raw: text passes through.
- `src/core/body-format.test.ts` — new, 54 tests: `bodyKind` for each listed type, parameters, case, a type that only starts with `json`, and an absent
  type; JSON layout, T2.6 numbers and strings, a byte order mark, empty and scalar bodies, seven malformed inputs; XML layout, mixed content,
  attributes holding `>` and `/`, a doctype with an internal subset, comments and CDATA holding markup, a byte order mark, whitespace before text at the start, seven malformed inputs; the
  same output for every two-piece split and for one character per piece, for three JSON and three XML inputs.

**Cycles**
1. Tests first, against a stub returning `raw` and `''`: 40 failed on assertions (`expected 'raw' to be 'json'`, `expected '' to be '{\n  "a": 1,…'`).
   Passed against the stub, not seen red: the six split-anywhere tests, the raw `bodyKind` cases and the empty-body cases. The stub's constant `''`
   satisfies them; mutation 4 below is their evidence.
2. Implementation: 53 passed on the first run. Before that run, a reading of the draft showed it dropped whitespace before text at the start of a body,
   which the "text that is not whitespace-only is unchanged" rule forbids; held whitespace is now always written once text arrives. No failing run
   showed this. A test for it was then added (`whitespace before text at the start of a body belongs to the text`) and run against the draft
   behaviour restored: `Expected: "  just text " Received: "just text "`, 1 failed. Restored, 54 passed.
3. Done-when mutations, each applied to the file and restored (`cmp` confirmed):
   - numbers parsed through `Number` → 2 failed
   - a backslash dropped inside a string → 2 failed
   - quotes ignored in tags, so `>` in an attribute ends the tag → 2 failed
   - JSON state reset at each piece → 3 failed
   - XML state reset at each piece → 3 failed

   The first attempt at the backslash mutation and the JSON reset hit the wrong lines and left 53 passing; both were reapplied at the right lines
   before the results above.
4. `npm run lint` failed on formatting of the two new files; `oxfmt --write` fixed it, then the suite was re-run.

**Verification**

```
$ npm run test:unit
 Test Files  9 passed (9)
      Tests  240 passed (240)
$ npm run typecheck
typecheck 0
$ npm run lint
lint 0
```

PASS — the formatter keeps every character except whitespace between tokens, for any split into pieces; each done-when mutation fails a test.

**Drift:** none

## Phase 2 — A recorded body up to 1 MiB opens in a read-only editor with a Pretty and Raw switch, and History stays reachable

- **Executor:** lz-build
- **Status:** blocked
- **Started:** 2026-11-08
- **Finished:** —

**Changed**
- `package.json`, `package-lock.json` — `monaco-editor` `0.57.0`, exact, in `dependencies` beside React.
- `src/renderer/app.tsx`:
  - imports `monaco-editor/editor/editor.api.js`, `monaco-editor/language/json/monaco.contribution.js` and
    `monaco-editor/languages/definitions/xml/register.js`; no `MonacoEnvironment`
  - `BodyText` takes the recorded headers and wraps each body in `BodyBoundary`, an error boundary that shows "Could not show the body: …"
  - `InlineBodyText` decodes as before, picks the kind with `bodyKind(headers)`, formats with `createFormatter` in Pretty, and renders
    `ViewSwitch` (a label and Pretty and Raw buttons, `data-view`) for JSON and XML and `MonacoBody` for every kind. Pretty is the default for each
    body shown: a Raw choice does not carry to the next call's body.
  - `MonacoBody`: one editor per body, created on mount and disposed with its model on unmount; `readOnly`, `links: false`, `wordWrap: 'on'`,
    `automaticLayout`, minimap off, `scrollBeyondLastLine: false`. A new model replaces the old one when the text or language changes. The host
    carries the body's test id and `data-loaded-chars`, the decoded length.
  - The component is named `MonacoBody`, not `BodyEditor`: that name is the form's body box.
- `src/index.css` — `.body-editor` 20rem high with a border; the pressed view button is bold.
- `src/main.ts` — `setWindowOpenHandler` denies every new window.
- `e2e/support.ts` — `bodyLines` (`.view-line` sorted by `top`, no-break spaces read as spaces), `expectBodyText`, `showBodyView`.
- `e2e/send-and-record.spec.ts`, `e2e/replay.spec.ts`, `e2e/bodies.spec.ts` — every `toHaveText` on an inline body reads through `expectBodyText`;
  JSON bodies press Raw first. `bodies.spec.ts` adds the Pretty text of `{"item":"é"}`, its `data-view`, and that a body with no JSON or XML type
  has no switch. Paged bodies are unchanged until phase 3.

**Verification**

```
$ npm run typecheck && npm run lint
typecheck 0, lint 0
$ npm run package   (timed, before → after the dependency)
real 4.82 → real 4.86
$ npx playwright test   (timed, before → after; npm run test:e2e is package + this)
19 passed (25.5s), real 26.19 → 19 passed (23.3s), real 23.91
$ grep -c MongoClient / undici / GridFSBucket in .vite/build/preload.cjs and .vite/renderer/main_window/assets/*.js
0 in every file
$ ls .vite/renderer/main_window/assets
codicon-DF1abBS2.ttf  index-D_bgYPbr.css  index-Di9mGPZv.js  json.worker-CV9fqkUp.js  jsonMode-C4M0KAjs.js  jsonMode-Kp8g3qXg.css  xml-AxvFPOyT.js
expected: no Monaco worker file in the bundle — FAILS: json.worker-CV9fqkUp.js is emitted
```

Scripted observation, throwaway spec `e2e/zz-observe-phase2.spec.ts` against the built app and a `dp_test_` database, deleted after the run:

```
json pretty lines     ["{","  \"a\": [","    1,","    {","      \"b\": \"x y\"","    }","  ],","  \"n\": 12345678901234567890","}"]
json label            "Pretty-printed for reading; Raw shows the recorded text." / Raw: "Raw: the recorded text."
json raw lines        ["{\"a\":[1,{\"b\":\"x y\"}],\"n\":12345678901234567890}"]
json raw starts with BOM: false        (the response starts with U+FEFF)
distinct token classes in the JSON view: 7
xml pretty lines      ["<?xml version=\"1.0\"?>","<r a=\"1\">","  <c>t</c>","  <!-- x -->","</r>"]
text/plain JSON-looking body: switch count 0, shown as recorded
Cmd+click on a URL in a body: windows 2 → 2, URL unchanged
one 300 KB JSON line in Raw: 18 wrapped lines drawn, no "Show more"; after a click at the editor's top left, document.activeElement had no
  class and Cmd+Down did not move — the end was not reached, so this observation is not made
1 MiB JSON (1,048,551 characters): data-loaded-chars "1048551" in Pretty and in Raw
page after a 1 MiB response: scrollHeight 1214, innerHeight 768, History at 938 px
.monaco-editor count after each of ten opens: [2,2,2,2,2,2,2,2,2,2]
workers started: ["file:///…/.vite/renderer/main_window/assets/json.worker-CV9fqkUp.js"]
failed requests: []
console: 3 errors, all "Creating a worker from 'blob:…' violates the following Content Security Policy directive: \"script-src 'self'\"…
  The action has been blocked."
```

Not run: the forced-throw check of `BodyBoundary`, the packaged `.app` (A8), and reaching the end of a wrapped long line. Phase 2 stopped on the
drift below before them.

FAIL — the editor, switch, labels, formatting, `data-loaded-chars`, window denial and History position hold, and all 19 existing specs pass; A2 is
false in this repository's build, and two plan expectations do not hold.

**Drift:**
- defect — A2 assumed Monaco starts no language worker with no `MonacoEnvironment`. In this build it does: Playwright saw a worker start from
  `json.worker-CV9fqkUp.js`, and the console logged three CSP violations for workers created from `blob:` URLs. The spike's app (no React, no
  preload, value passed to `editor.create`) saw neither; which difference matters has not been found. The e2e suite passes because it does not
  read the console. This invalidates A2 and phase 2's "no CSP violation … no worker errors" observation, and touches the CSP, which `AGENTS.md`
  fixes.
- defect — the plan expected no Monaco worker file in the bundle. `json.worker-*.js` is emitted because the JSON language references it; the spike
  had recorded "0.7 MB are the two unused worker files", so the plan's check contradicted its own evidence.
- defect — the plan says Raw shows the recorded text "with the byte order mark kept". Monaco removes a leading U+FEFF from a model's text and keeps
  it as a separate field (`node_modules/monaco-editor/esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js:71`), so no
  view draws it.

Three defect drifts: the plan needs `/lz-plan revise` before this phase continues. The code above stays in the working tree.

## Phase 2 — A recorded body up to 1 MiB opens in a read-only editor with a Pretty and Raw switch, and History stays reachable

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-08
- **Finished:** 2026-11-08

Resumed after `/lz-plan revise` (revision 5) and `/lz-plan-review` (accept). The blocked attempt's code above stayed and was changed as below.

**Changed**
- `src/renderer/app.tsx`:
  - `self.MonacoEnvironment.getWorker` returns a `JsonWorker` for the `json` label and an `EditorWorker` for any other, both from Vite `?worker`
    imports of `monaco-editor/language/json/json.worker.js` and `monaco-editor/editor/editor.worker.js`. Once `getWorker` exists Monaco uses it for
    every label (bundled resolver `qV` in `jsonMode-*.js`), so the JSON worker is covered here too.
  - `BOM_NOTE`: when the decoded text starts with U+FEFF, the view label adds "The recorded text starts with a byte order mark (U+FEFF), which is not
    drawn." in Pretty and in Raw. A raw-kind body, which has no switch, shows the same note on its own line.
- `src/declarations.d.ts` — a module declaration for `*?worker` imports.

**Verification**

First step, A2, throwaway spec against the built app with JSON (non-ASCII and malformed), XML and text bodies opened:

```
workers started: json.worker-CV9fqkUp.js, editor.worker-CRz__AKW.js (×3 by then), all file:///…/.vite/renderer/main_window/assets/
console errors and CSP lines: []
```

A2 holds: both workers start from `file://` under the unchanged CSP with no console error.

```
$ npm run typecheck
typecheck 0
$ npm run lint
lint 0
$ npm run test:unit
      Tests  240 passed (240)
$ npm run package   (timed)
real 6.02   (4.82 before the dependency, 4.86 in the blocked attempt)
$ npx playwright test   (timed; npm run test:e2e is package + this)
19 passed (22.4s), real 23.03   (26.19 before the dependency)
$ grep -c MongoClient / undici / GridFSBucket in .vite/build/preload.cjs and .vite/renderer/main_window/assets/*.js
0 0 0 in every file
$ ls .vite/renderer/main_window/assets
codicon-DF1abBS2.ttf  editor.worker-CRz__AKW.js  index-BWdRosFK.js  index-D_bgYPbr.css  json.worker-CV9fqkUp.js  jsonMode-Csm1q78V.js
jsonMode-Kp8g3qXg.css  xml-r5GNzNq7.js
expected: the editor worker and the JSON worker files only — holds; .vite/renderer is 5.2 MB
```

Scripted observation, throwaway `e2e/zz-observe-phase2.spec.ts` against the built app and a `dp_test_` database, deleted after the run:

```
json call, Pretty      ["{","  \"a\": [","    1,","    {","      \"b\": \"x é y\"","    }","  ],","  \"n\": 12345678901234567890","}"], data-view "pretty"
json call, Raw         ["{\"a\":[1,{\"b\":\"x é y\"}],\"n\":12345678901234567890}"]
token classes          JSON 7, XML 6
xml call, Pretty       ["<?xml version=\"1.0\"?>","<r a=\"1\">","  <c>t</c>","  <!-- x -->","</r>"]
text/plain call        switch count 0, lines ["plain ü text"]
BOM, Pretty            "Pretty-printed for reading; Raw shows the recorded text. The recorded text starts with a byte order mark (U+FEFF), which is not drawn."
BOM, Raw               "Raw: the recorded text. The recorded text starts with a byte order mark (U+FEFF), which is not drawn."
BOM data-loaded-chars  "8" for "﻿{\"a\":1}"; no note on the same body without the mark
one 300 KB JSON line   Raw: click on the first .view-line focused the editor (activeElement "native-edit-context"); after Cmd+Down the last
                       visible line ends "\"END-OF-LINE\"]"; "Show more" count 0
Cmd+click on a URL     windows 2 → 2, URL unchanged (main_window/index.html)
1 MiB JSON             1,048,551 characters; data-loaded-chars "1048551" in Pretty and in Raw
page after 1 MiB       scrollHeight 2132 with the call panel open, innerHeight 768, History at 938 px
ten opens              .monaco-editor count [2,2,2,2,2,2,2,2,2,2]
worker starts          editor worker 6, JSON worker 1, over the whole session
console errors and CSP lines at the end: []; failed requests: []
```

An early read of the XML and text calls returned the previous call's lines; the script had not waited for the opened call. After waiting for
`call-request-line` to show the path, the reads above came back correct.

Forced throw: a temporary `throw` at the top of `MonacoBody`'s create effect, rebuilt, throwaway spec, reverted (`cmp` confirmed):

```
result body:  "Could not show the body: forced for observation"
second send:  recorded, History rows 2
panel opened: its body shows the same error; the URL field is editable
```

Packaged `.app` (A8): a `dp_test_` database seeded through the built app with one JSON response, then
`out/DigitalPigeon-darwin-arm64/DigitalPigeon.app` started on it with `ELECTRON_ENABLE_LOGGING=1 --enable-logging`, stderr to a file. The author
opened the call: "Pretty and highlighted". The log file had 0 lines, so the packaged app's console was not observable; "no CSP violation in the
console" for the packaged app is **not observed**. The same renderer bundle showed no violation under e2e above. The seeded database was dropped
afterwards.

PASS — recorded bodies up to 1 MiB open in a read-only editor with a Pretty and Raw switch, workers load from `file://` with a clean console,
History stays reachable, and all 19 existing specs pass. One sub-observation, the packaged app's console, could not be made.

**Drift:**
- decision — the plan's worker step named `new Worker(new URL(…, import.meta.url), { type: 'module' })` → Vite `?worker` imports, because a package
  path inside `new URL` is a bare specifier Vite does not resolve (the plan review's note).
- decision — `src/declarations.d.ts`, not named by the plan, gained the `*?worker` module declaration, because TypeScript has no type for those
  imports otherwise.
- decision — the plan put the byte order mark note in the label of JSON and XML bodies → a raw-kind body with the mark shows the note on its own
  line too, because Monaco drops the mark for every kind and a raw body has no label to carry it.

Notes for the next phases and the review:
- `oxfmt --write` in phase 1 turned the `﻿` escapes in `src/core/body-format.test.ts` into literal U+FEFF characters (4 occurrences). The
  tests behave the same; the characters are invisible in most editors.
- A `dp_test_` database from 2026-11-06 (`dp_test_1794008846160_9c432c0d`, 0 calls) predates this phase and was left in place.

## Phase 3 — A stored body loads page by page into the editor, formatted as pages arrive

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-08
- **Finished:** 2026-11-08

**Changed**
- `src/renderer/app.tsx`:
  - `useBodyEditor(host, onCreate)` — the editor creation and disposal from phase 2's `MonacoBody`, shared by both body components. `onCreate` runs
    for every editor created, including `StrictMode`'s second mount, so the caller gives it a model.
  - `setModel` and `appendToModel` — a new model replacing and disposing the old one; text appended at the model's end through `applyEdits`.
  - `BodyViewLabel` replaces phase 2's `ViewSwitch` and the raw-kind note, so both components share one label.
  - `PagedBodyText` takes the body's kind. Each decoded page is kept in a ref and appended to the model as an edit; in Pretty it goes through the
    formatter, which keeps its state between pages and is ended on the last page. Switching views builds a new model from the kept pages through a
    new formatter. A page whose shown text ends in CR holds that CR back until the next page. `data-loaded-chars` counts decoded characters; the
    byte order mark note comes from the first page. The append runs inside `readNext`'s `try`, so an edit that throws shows as "Could not read the
    body". The remaining count, Load more, one read at a time and stale answers are unchanged.
- `e2e/support.ts` — `bodyEdge(page, body, 'start' | 'end')`: clicks inside the text area, presses Cmd+Up or Cmd+Down, and returns the first or last
  line drawn.
- `e2e/bodies.spec.ts` — the 17 MiB test reads its length from `data-loaded-chars` after every page, and its start and end through `bodyEdge`;
  `lastPageTopInView` is replaced by `toBeInViewport` on the body area and the remaining count after each Load more.
- `e2e/open-call-failures.spec.ts` — the paged T2.10 test reads `[file-a@0]`, `[file-b@0]` and `[file-b@0][file-b@10]` through `expectBodyText`.

**Cycles**
1. A9 timing, throwaway `e2e/zz-observe-phase3.spec.ts` on the built app (deleted afterwards). 17 MiB raw single line, `wordWrap: 'on'`:

   ```
   Load more ms each   [158,137,138,128,128,131,142,124,127,123,121,121,122,132,123,121,91]
   Cmd+Down            last line drawn "aaaaaaaaFINAL-MARKER"; Cmd+Up "START-MARKERaaaaaaaa"
   data-loaded-chars   "17825816" for 17,825,816 bytes; next frame 1 ms after the last page
   ```

   No append held the window near one second, so the fallback was not taken and the e2e body keeps its single line.
2. The other observations, same spec:

   ```
   17 MiB minified JSON, Pretty   Load more ms each [297,164,112,140,221,129,374,141,171,222,138,172,154,136,148,168,80]
                                  last lines drawn ["  {","    \"i\": 564000,","    \"v\": \"value-564000\"","  }","]"]
                                  (last item {"i":564000,"v":"value-564000"}; indentation continues across all 17 boundaries)
   switch to Raw                  1101 ms; last line "…{\"i\":564000,\"v\":\"value-564000\"}]", first "[{\"i\":0,\"v\":\"value-0\"},…"
   switch back to Pretty          1322 ms; last lines ["    \"v\": \"value-564000\"","  }","]"]
   data-loaded-chars              "17825813" in Pretty, after both switches, for 17,825,813 bytes
   é split at byte 1,048,575      Pretty last lines ["aaaaaaaéEND\"","]"]; Raw last line "éEND\"]"
   CRLF split at the boundary     ["xxxxxxxxxx","","tail"] — two line breaks
   open another call mid-read     Load more on the 17 MiB call, then the CRLF call opened: data-loaded-chars "1048576", remaining "5", first
                                  line "xxxxxxxxxxxx" — only the new call's body
   console errors                 []
   ```
3. The CRLF result came from appending CR and LF as separate edits. `PagedBodyText` now holds a trailing CR back until the next page. Re-run:
   `crlf last 3 lines ["xxxxxxxxxx","xxxxxxxxxx","tail"]` (one wrapped line, then `tail`); JSON, multi-byte and console results unchanged.
4. Done-when mutation: the second page neither kept nor appended nor counted (`if (offset.current !== 2 * BODY_PAGE_BYTES)` around that block),
   rebuilt, 17 MiB test only:

   ```
   ✘ a 17 MiB response can be read to its end with Load more
   Expected: "2097152"
   Received: "1048576"
   ```

   Restored, `cmp` confirmed, rebuilt.

**Verification**

```
$ npm run typecheck && npm run lint
typecheck 0, lint 0
$ npm run test:e2e   (timed)
19 passed (16.9s), real 24.33
$ npx playwright test e2e/bodies.spec.ts e2e/open-call-failures.spec.ts   (three runs)
10 passed (8.2s) / 10 passed (7.8s) / 10 passed (7.8s)
$ npm run test:unit
      Tests  240 passed (240)
```

PASS — a stored body loads page by page into the editor, formatted as pages arrive, readable to its end in both views, with the existing paging
and T2.10 tests reading through the editor.

**Drift:**
- decision — the plan put the A9 timing before the wiring → it ran on the wiring, because timing without it needed a separate throwaway Vite and
  Electron build; the fallback was decided beforehand, so the order changed no decision.
- decision — `e2e/support.ts` gained `bodyEdge`, not named in phase 3's file list, so the 17 MiB test and later specs share one way to reach a
  body's start and end.
- decision — phase 2's `MonacoBody` and `ViewSwitch` were reshaped into `useBodyEditor`, `MonacoBody` and `BodyViewLabel`, so the inline and paged
  bodies share editor setup and label.

Notes for the review:
- The 17 MiB test checks the loaded length and the first and last 12 characters. Text counted but missing from the middle of the model would pass it.
- Switching views on a fully loaded 17 MiB body holds the window for about 1.1 to 1.3 s.

## Phase 4 — A body cannot run script or open a page, and the switch and Load more hold in the built app

- **Executor:** lz-build → routed to lz-e2e
- **Status:** in-progress

**Routed:** T1.8, T2.9 and T2.10 are e2e risks in `test-strategy.md` (render-only, on the production build), and the plan assigns this phase to
lz-e2e. Run `/lz-e2e editor-and-formatting` to execute it.

## Phase 4 — A body cannot run script or open a page, and the switch and Load more hold in the built app

- **Executor:** lz-e2e
- **Status:** blocked
- **Started:** 2026-11-08
- **Finished:** —

Gate: T1.8 and T2.9 are e2e risks in `test-strategy.md` and stay here. T2.10's "a page read for one body appears under the next call" is already
covered by `e2e/open-call-failures.spec.ts:150-191`, which reads through the editor since phase 3; the plan's second T2.10 test in
`bodies.spec.ts` would duplicate it, so it is not written, and the done-when mutation for a stale page runs against the existing test instead.

**Changed**
- `e2e/body-safety.spec.ts` — new, four tests (`text/html`, `application/xml`, `application/json`, `text/plain`). Each response holds `<script>`,
  `<img onerror>`, an SVG with `onload` and a `javascript:` link, each setting `window.__pwned`, plus a URL on its own line. Opened in the result
  view, in Pretty and Raw where the switch exists: the markup is drawn as text, Cmd+click on the URL opens nothing, the flag stays unset, the window
  count and the page URL are unchanged, and the console and uncaught page errors recorded during the test are empty.

**Verification**

```
$ npm run package && npx playwright test e2e/body-safety.spec.ts   (three runs)
1 failed, 3 passed (2.0s) / 1 failed, 3 passed (1.9s) / 1 failed, 3 passed (2.0s)

✘ a text/plain body holding markup shows as text, runs nothing and opens nothing
Expected: []
Received: 17 entries, each as an uncaught page error and as a console error:
  "[createInstance] fh depends on UNKNOWN service ICodeLensCache."
  "[createInstance] Mb depends on UNKNOWN service IInlayHintsCache."
  "[createInstance] Yx depends on UNKNOWN service treeViewsDndService."
  "[createInstance] yA depends on UNKNOWN service ISuggestMemories."
  "[createInstance] Vm depends on UNKNOWN service actionWidgetService."
```

The flag, window and URL assertions held in all four tests and all three runs; only the console assertion failed, in the `text/plain` test, which
runs after the JSON test. A throwaway probe on a single `text/plain` body (hover, click, Cmd+Down, holding Meta, Cmd+click, right click) recorded
no error, so the trigger is in the sequence, most likely the result view's editor changing from a JSON model to a plain-text model; it was not
narrowed further.

Source of the missing services, read in `node_modules/monaco-editor/esm/vs` (0.57.0):
- `languages/features/json/workerManager.js:1` imports `internal/common/workers.js`;
- `internal/common/workers.js` imports about 60 editor contributions, among them `editor/contrib/codelens/browser/codelensController.js` (line 10);
- the services those contributions need are registered by separate modules, such as `editor/contrib/codelens/browser/codeLensCache.js`, which
  `editor/editor.main.js` imports and the renderer's `editor.api.js` plus JSON and XML imports do not.

Earlier attempts in this phase: the `text/html` test first timed out clicking `example.com` on a wrapped line, and the shared error list then carried
17 entries into later tests. Payloads now put the URL on its own line and each test resets the list; the 17 entries above are from the `text/plain`
test alone.

FAIL — T1.8's script, window and navigation checks hold; the clean-console requirement does not, because Monaco throws on contributions whose
services are not registered.

**Drift:**
- defect — the plan (Approach, phase 2 observation, phase 4) assumes that `editor.api.js` with the JSON and XML registrations runs with no console
  error. The JSON language's worker manager imports Monaco's editor contributions without the services they depend on, and five of them throw when
  instantiated. Phase 2's observations listened to `console` messages only and did not record uncaught page errors, so this was not seen there. It
  invalidates phase 2's "zero console errors" result for this sequence and phase 4's console assertion. The choice between importing the five
  service modules, importing `editor.main.js` (every language), or another import shape changes the Approach and the bundle, so it belongs to
  `/lz-plan revise`.
- decision — the plan's new T2.10 test in `bodies.spec.ts` is not written; the existing `open-call-failures.spec.ts` test covers the same risk.

Not yet done in this phase: the T2.9 tests in `bodies.spec.ts` (the switch keeps the body in view; History reachable after a 1 MiB response), Load
more on a stored JSON body to its final value, the done-when mutations, the `test-strategy.md` update, and the three full runs.

## Phase 4 — A body cannot run script or open a page, and the switch and Load more hold in the built app

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-08
- **Finished:** 2026-11-08

Resumed after `/lz-plan revise` (revision 6) and `/lz-plan-review` (accept).

**Changed**
- `src/renderer/app.tsx` — imports `monaco-editor/internal/common/workers.js` before `editor.api.js`, so the editor contributions it loads register
  their services before the first editor exists (A10).
- `e2e/body-safety.spec.ts` — as in the blocked entry above, unchanged.
- `e2e/bodies.spec.ts`:
  - `T2.9 — switching a JSON response between Pretty and Raw keeps it in view, and History is one scroll below a 1 MiB response`: a JSON response
    just under 1 MiB in the result view; after Raw and after Pretty, `data-view` changes and at least 90% of the body area is in the viewport; after
    one `scrollBy(0, innerHeight)` the History heading is in the viewport.
  - `a stored JSON response loads page by page, formatted, to its final value`: 2.5 MiB of JSON objects, Pretty, every page loaded on the remaining
    count, `data-loaded-chars` equal to the body's length, the last five lines drawn after Cmd+Down exactly the last object indented and `]`, then
    a 90-pixel wheel scroll back and the `"i"` values drawn in ascending order.
  - The 17 MiB test's in-view checks after Load more require 90% of the body area and the whole remaining count, not any part of them.
- `context/foundation/test-strategy.md` — T1.8 and T2.6 covered, T2.9's Covered list, T3.10 narrowed to memory with the long scroll ended, the unit
  gate (240), the e2e gate's 2026-11-08 state, the two closed gaps removed, and a known-limits entry for T1.8 in the editor.

**Cycles**
1. A10: `body-safety.spec.ts` was red before the import (blocked entry above). After it, on a Vite build made after the edit (assets 11:27:38, source
   11:27:02): `4 passed` three times — `(1.8s)`, `(1.9s)`, `(1.9s)`. The two services the plan review had not traced, `IActionWidgetService` and
   `ITreeViewsDnDService`, are covered by the same import; no further import was needed.
2. The new `bodies.spec.ts` tests: the stored JSON test first timed out clicking a disabled Load more while the first page was still loading, and
   the element was then replaced; it now waits on the remaining count before each click, as the 17 MiB test does. Then three runs: `8 passed (9.4s)`,
   `8 passed (9.3s)`, `8 passed (9.3s)`.
3. Done-when mutations, each applied, rebuilt where it touched the app (Vite assets newer than the edit each time), run against its spec, restored
   (`cmp` confirmed):

   ```
   body also rendered through dangerouslySetInnerHTML      body-safety: 4 failed
   links: true and no setWindowOpenHandler                 body-safety: 1 failed / 1 failed / 2 failed in three runs (JSON or XML)
   PagedBodyText not keyed by file                         open-call-failures: "a page read for a body no longer shown is ignored" failed
   the switch scrolls the page to the top                  bodies T2.9 switch test: toBeInViewport failed
   Load more scrolls the page to the top                   bodies 17 MiB test: toBeInViewport failed
   bodyLines in DOM order                                  bodies stored JSON test: failed three times (the ascending check)
   ```

   First attempts that did not fail, and why:
   - the switch and Load more mutations first scrolled to the page's bottom: the page was 237 px taller than the window, so the body area
     (311–633 px) stayed in view, and the original `toBeInViewport()` with no ratio passed on any overlap. The checks now require 90%, and the
     mutations scroll to the top, which a remounted element taking focus would do; a scroll inside `setTimeout` passed before it ran.
   - `bodyLines` in DOM order passed the 17 MiB and stored JSON tests as first written: Cmd+Down and Cmd+Up redraw every line, in order. Lines come
     out of DOM order only after a small scroll, which the stored JSON test now does.
   - links on: the window check Cmd+clicks once per view; Monaco finds links through its worker after drawing, so a click can come first. The suite
     failed in every run, but not in the same content type.

**Verification**

```
$ npm run test:e2e   (three runs)
✖ Packaging application [FAILED: fetch failed] — Electron's zip download from github.com failed (earlier: Response code 504); curl to the same URL
returned no response. Vite had built .vite/ before that step (assets 11:49:13, source restored 11:42:55).
$ npx playwright test   (the specs npm run test:e2e runs, on that .vite/ build; three runs)
25 passed (22.1s) / 25 passed (21.2s) / 25 passed (20.6s)
$ npm run test:unit
      Tests  240 passed (240)
$ npm run typecheck && npm run lint
tc 0, lint 0
$ dp_test_ databases after the runs
[ 'dp_test_1794008846160_9c432c0d' ]   (from 2026-11-06, before this change, 0 calls)
```

PASS — a body cannot run script or open a page in any of four content types and both views, the console stays clean, and the switch and Load more
keep the body in view; each scenario passed three runs and each done-when mutation fails one. `npm run test:e2e` itself did not complete: its
packaging step needs github.com, which was unreachable. It should be run once more before merge.

**Drift:**
- decision — the plan's verification `npm run test:e2e` → `npx playwright test` on the `.vite/` build that its packaging step produced before
  failing, because the failure was a network download, not the build; the specs run against `.vite/`, not the packaged app.
- decision — the plan's T2.10 test in `bodies.spec.ts` was not written (recorded in the blocked entry above).
- decision — the T2.9 in-view checks require 90% of the body area, not any overlap, because the page is short enough that any-overlap cannot fail.
- decision — the stored JSON test adds a wheel scroll and an ordering check, not in the plan, because no existing test made `bodyLines` read lines
  in DOM order, which the done-when list requires to fail.

## Code review fixes — findings 1, 2, 4 and 6 (author: "fix 1, 2, 4, 6, accept the rest")

- **Executor:** lz-build, test-first where a test shows the defect
- **Status:** done
- **Started:** 2026-11-08
- **Finished:** 2026-11-08

`/code-review` ran on the working tree after `lz-review` and reported 8 findings. The author chose to fix 1, 2, 4 and 6 and accept 3, 5, 7 and 8.

**Changed**
- `src/renderer/app.tsx`:
  - Finding 1 — `BodyText` keys `BodyBoundary` by `bodyKey(body)`: `file:<fileId>` for a stored body, a counter kept in a `WeakMap` for inline bytes.
    A body that failed to show no longer leaves its error on the next call opened in the same place.
  - Finding 2 — `PagedBodyText.setView` catches a failed rebuild and shows "Could not show the body: …" in the body area; a click handler is not
    covered by an error boundary. The error state now holds the whole message, so a failed read reads "Could not read the body: …" as before.
  - Finding 4 — `jsonDefaults.setDiagnosticsOptions({ validate: false })` and `setModeConfiguration` with `tokens: true` and every other feature
    off. JSON keeps its highlighting; the JSON worker no longer validates or parses an unfinished paged document.
  - Finding 6 — `MonacoBody` sets its model only in its `[text, language]` effect; `useBodyEditor`'s `onCreate` is optional and unused there.
- `src/declarations.d.ts` — a declaration for `jsonDefaults` at `monaco-editor/language/json/monaco.contribution.js`, whose package types cover
  only the side-effect import.
- `e2e/bodies.spec.ts` — `a body that could not be shown does not leave its error on the next call opened (code review, finding 1)`: two JSON
  calls; `globalThis.ResizeObserver` replaced by one whose constructor throws (Monaco's `automaticLayout` constructs it,
  `elementSizeObserver.js:62`); the first call opened from History shows "forced for this test"; the observer restored; the second call opened
  shows its own body and no error.

**Cycles**
1. Finding 1, red. A first version sent two responses into the result view and passed against the unfixed build: the result view unmounts while a
   send is in flight, which resets the boundary. Moved to the call panel, which stays mounted between opens:

   ```
   ✘ a body that could not be shown does not leave its error on the next call opened (code review, finding 1)
   Expected: 0
   Received: 1
   ```

   After the fix, on a Vite build newer than the edit (assets 12:26:52, source 12:26:41): `1 passed (1.5s)`.
2. Finding 4, throwaway observation (`e2e/zz-observe-f4.spec.ts`, deleted): a 2.5 MiB stored JSON body, first page loaded, four seconds:

   ```
   with the JSON settings      squiggles 0, folding controls 7, workers started ["editor.worker-CRz__AKW.js"]
   without them (reverted)     squiggles 0, folding controls 6, workers started ["json.worker-CV9fqkUp.js","editor.worker-CRz__AKW.js"]
   ```

   The JSON worker no longer starts, so nothing re-parses the model after each page. Squiggles were 0 either way: the error in an unfinished
   document sits at the end of the loaded text, out of view. Restored (`cmp` confirmed) and rebuilt.
3. Findings 2 and 6 have no test: neither a failed rebuild inside a click handler nor a model built twice can be arranged from the page without a
   hook in production code. Both changes were read against the code review's description.

**Verification**

```
$ npx playwright test   (on the .vite/ build of the fixed source; three runs)
26 passed (20.9s) / 26 passed (20.4s) / 26 passed (20.6s)
$ npm run test:unit
      Tests  240 passed (240)
$ npm run typecheck && npm run lint
tc 0, lint 0
```

PASS — findings 1, 2, 4 and 6 fixed; finding 1 has a test seen red; finding 4 is evidenced by the JSON worker no longer starting.

**Drift:**
- decision — finding 4's fix turns off JSON folding, hovers, symbols, colours and formatting as well as diagnostics, because each is served by
  the JSON worker re-parsing the whole model; indentation-based folding still shows.

## Review finding F1 — the e2e gate command on the branch

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-08
- **Finished:** 2026-11-08

`npm run test:e2e` had not completed in phase 4 or after the code review fixes, because its packaging step could not download Electron 45.2.1
(`fetch failed`, earlier `Response code 504`). Run again on commit `1fe3beb`, with github.com reachable.

**Changed**
- Nothing. The packaged `.app` was rebuilt by the command (`out/`, 2026-11-08 15:47), the first packaged build to include the eager import of
  `internal/common/workers.js` and the code review fixes.

**Verification**

```
$ npm run test:e2e
✔ Packaging for arm64 on darwin
✔ Packaging application
✔ Running postPackage hook
Running 26 tests using 1 worker
  26 passed (23.2s)
```

PASS — the plan's e2e gate command completes on this branch.

**Drift:** none

---
produced-by: lz-spike
assumption: monaco-editor 0.57.0, bundled by Vite and loaded from file:// in Electron 45.2.1 under the production CSP with sandbox and contextIsolation, renders a read-only editor with no CSP violation, no network request and no language worker; a model grown by 17 one-MiB appends stays usable; Playwright can read the text it shows.
verdict: holds
timebox: 90 minutes / about 4 minutes by the clock (21:22 to 21:26)
versions: monaco-editor 0.57.0, Electron 45.2.1, Vite 8.3.5, Playwright (the repository's), macOS 27
updated: 2026-11-07
---

# Spike: Monaco under the production CSP

## Assumption
Plan A1 to A4. Negative result: a CSP violation or network request, an error with no worker, a model that freezes or cannot reach its end at 17 MiB, or text Playwright cannot read.

## Prediction (written before running)
"All four hold": "Monaco renders with no CSP violation, runs without language workers, stays usable at 17 MiB of appended pages, and Playwright reads the visible text." (author's choice, 2026-11-07)

## What happened
A throwaway Electron app in the session scratch directory loaded a Vite build of `monaco-editor/editor/editor.api.js`, the XML language and the JSON language, from `file://`, with the CSP string from `vite.renderer.config.mts` injected as a meta tag. `BrowserWindow` used `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, with no preload. Main logged console messages, any request that was not a plain file, any worker file, new windows and navigation. Playwright drove it, once with no `MonacoEnvironment` and once with one returning module workers.

```
console, both modes        only the app's own READY line; no CSP violation, no warning
requests                   none outside file://; no worker file requested in either mode
tokens                     JSON highlighted on the main thread; 12345678901234567890 shown as written
<img onerror> in a string  shown as text; the flag it would set stayed unset
Cmd+click on a URL         nothing opened, no navigation (links: false)
17 appends of 1 MiB        8-17 ms each, through model.applyEdits; IPC round trip after each 0-6 ms
model                      188,815 lines, 17,825,445 characters
Cmd+Down / Cmd+Up          line 188,815 shown with FINAL-MARKER / line 1 shown
one line of 17 MiB         appended in 125 ms; rendering stops with "Show more (17.0 MB)"
same line, wordWrap on     its end, END-OF-LINE, shown
build                      0.5 s; dist 4.8 MB, of which 0.7 MB are the two unused worker files
```

## Verdict: holds
All four hold for a read-only editor with links off, in a production-style build. Three conditions follow for the plan.

## Surprises
- **No worker was ever requested.** With no `MonacoEnvironment`, Monaco logged nothing and ran. With one, it did not start the JSON worker either. A read-only model with no diagnostics needs none. Configuring workers is unnecessary, and leaving them out also leaves their 0.7 MB out of the bundle.
- **A long line is cut off.** Monaco stops rendering a line at a limit and shows "Show more (17.0 MB)". A minified JSON body in Raw is one line, so its end is not visible unless `wordWrap` is on. With `wordWrap: 'on'` the end showed.
- **The text's DOM order is not its visual order.** Monaco reuses line elements, so `innerText` of `.view-lines` returned lines out of order after scrolling. Sorting `.view-line` elements by their `top` style gives the visible text in order. For a short body that fits, `innerText` is in order, and Playwright's whitespace normalisation treats the no-break spaces as spaces.
- **Clicking the line container does not focus the editor.** Playwright clicks the centre of `.view-lines`, which is as tall as the whole model, so it scrolled the editor and left focus on the page, and keys did nothing. Clicking a visible point inside the editor focused it, and then Cmd+Down and Cmd+Up worked.
- The prediction held. The surprises are in how a test must read and drive the editor, not in whether it runs.

## What this means for the plan
- A1, A2, A3 and A4 hold. Phase 2 needs no CSP change and no `MonacoEnvironment`.
- Phase 2 imports `editor.api` and the JSON and XML languages only, not `editor.main`, which registers every language.
- Raw view, and any body on one long line, needs `wordWrap: 'on'`, or its end cannot be seen.
- e2e reads a short body through the editor's text, and a long one by sorting `.view-line` by `top`. To move in a body, a test clicks a visible point in the editor first. Cmd+Down reaches the end on macOS.

## Not tried
- The packaged `.app` from `npm run package`, with this repository's fuses and asar. Only a Vite build loaded from `file://`.
- This repository's renderer: React, `StrictMode`, the preload and IPC.
- DevTools open, as it is in e2e.
- XML highlighting on real content. The language was registered and not used.
- Format Document or any other Monaco action.
- Memory: only time per append was measured.
- Switching models repeatedly, and disposing editors.
- `wordWrap` timing on a 17 MiB line; only that its end showed.
- Monaco's accessibility mode.

## Code
Deleted. It lived in the session scratch directory, `monaco-spike/`. The working pieces:
```
import * as monaco from 'monaco-editor/editor/editor.api.js';   // package exports map: './*' → './esm/vs/*.js'
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/language/json/monaco.contribution.js';
monaco.editor.create(el, { value, language: 'json', readOnly: true, links: false, automaticLayout: true, minimap: { enabled: false } });
model.applyEdits([{ range: new monaco.Range(l, c, l, c), text }]);   // l = last line, c = its max column
// visible text in order:
[...el.querySelectorAll('.view-line')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((e) => e.textContent)
```

---
change_id: local-web-app
produced-by: lz-research
questions: 5
updated: 2026-11-11
---

# Research: what ties the app to Electron

## Questions asked
1. Which Electron APIs does the code call, and where? — **answered**
2. What does the IPC boundary carry that JSON over HTTP does not? — **answered**
3. Which handler behaviours depend on per-process state that a server must keep? — **answered**
4. What in the e2e suite depends on Electron? — **answered**
5. What in the UI depends on being loaded from `file://` inside Electron: CSP, Monaco workers, clipboard, new windows,
   dev server? — **partially** (secure-context behaviour of `http://127.0.0.1` not run)

## Findings

### 1. Electron APIs in the code

**Answer:** Electron is imported in four production files and the Forge build config. Outside them, the only Electron
dependency in production code is the `userData` path that locates `config.json`. `src/core/` imports no Electron.

**Evidence**
- `src/main.ts:1` — `app`, `BrowserWindow`, `ipcMain`. Uses: window with `contextIsolation`/`sandbox`/`nodeIntegration`
  (`:21-32`), deny all new windows (`:36`), load dev-server URL or `file://` index (`:39-45`), DevTools when not
  packaged (`:48-50`), `app.getPath('userData')` for `config.json` (`:58`), database connect at ready (`:64-74`),
  close the client on `before-quit` (`:75-78`), `registerIpc` (`:80-98`), macOS window lifecycle (`:104-118`).
- `src/main.ts:4,15-17` — `electron-squirrel-startup` (Windows installer hook).
- `src/main/ipc.ts:4` — only `import type { IpcMain }`. Every handler is registered as
  `ipcMain.handle(channel, (_event, raw) => …)` (`:232-523`); no handler reads `_event`.
- `src/preload.ts:3-30` — `contextBridge.exposeInMainWorld('pigeon', api)`, 16 functions, each one
  `ipcRenderer.invoke(channel, input)`.
- `src/declarations.d.ts:1` — `/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />`, which declares
  `MAIN_WINDOW_VITE_DEV_SERVER_URL` / `MAIN_WINDOW_VITE_NAME` used at `src/main.ts:39,43`.
- `src/renderer/app.tsx:61-62` — `interface Window { pigeon: PigeonApi }`; the UI calls `window.pigeon.*` at 17 sites
  (`:186, 194, 217, 232, 353, 375, 400, 418, 474, 485, 493, 527, 530, 559, 1191, 1243, 1765`, text search).
- `src/core/db-config.ts:1-3` — comment: `config.json` lives in Electron's `userData` "because a Finder-launched
  packaged app has no shell environment"; the path itself is passed in (`configPath`), so the module has no Electron
  import. AGENTS.md states the macOS path: `~/Library/Application Support/DigitalPigeon/config.json`.
- `forge.config.mts:1-57` — makers (Squirrel, ZIP, RPM, Deb), Vite plugin building `src/main.ts` and `src/preload.ts`,
  fuses. `package.json` `main` is `.vite/build/main.cjs`; scripts `start`, `package`, `make`, `release` call
  `electron-forge`; `test:e2e` runs `npm run package` first.

**Verified by:** text search (`grep`) across `src/`, `e2e/`, configs; reading.
**Confidence:** high.

### 2. What the IPC boundary carries that JSON does not

**Answer:** The contract relies on structured clone. It carries `Uint8Array` in both directions and `Date` in every
call record. JSON turns a `Uint8Array` into an object of indexed keys and a `Date` into a string, and the shared `zod`
schemas reject both (`z.instanceof(Uint8Array)`, `z.date()`). Handlers never reject: every failure is a result value,
with one exception (`cancel`).

**Evidence**
- `src/shared/ipc-contract.ts:3` — "Bodies are Uint8Array: the sandboxed renderer has no Node Buffer."
- `src/shared/ipc-contract.ts:66` — multipart file part `bytes: z.instanceof(Uint8Array)` in `SendInput` (UI → main).
  The UI fills it from `new Uint8Array(await file.arrayBuffer())` (`src/renderer/app.tsx:760`): the whole file is in the
  send message. No size limit appears in the schema.
- `src/shared/ipc-contract.ts:121` — `readBody` returns `bytes: z.instanceof(Uint8Array)`, up to `BODY_PAGE_BYTES`
  (1 MiB, `:111`), "equal to the inline limit".
- `src/core/call-schema.ts:16` — `StoredBody` is `Uint8Array` or `{ fileId, length }`; it appears in `SendDocSchema`
  and `CompletionDocSchema`, which `SendResult` (`ipc-contract.ts:281-303`) and `GetCallResult` return. Inline bodies up
  to the inline limit travel inside these results.
- `src/core/call-schema.ts:30,62` — `sentAt: z.date()`, `completedAt: z.date()`; the UI calls
  `.toLocaleString()` on them (`src/renderer/app.tsx:1336, 1370, 1877`).
- `src/main/ipc.ts:79-101` — `plainBody`/`plainBytes`/`plainSend` copy `Buffer` to `Uint8Array` so the contract
  holds "in main as well as in the renderer".
- `src/main/ipc.ts:3` — "Handlers return results rather than rejecting". `src/main/ipc.ts:494-499` — `cancel` is the
  exception: it calls `CancelInputSchema.parse` and throws on bad input, and returns `void`.
- `src/main/ipc.ts:176-180, 295-298, 319, 352` — outputs are re-parsed with the result schemas before return; a parse
  failure inside `try` becomes `{ ok: false, message }`.

**Verified by:** reading; text search for `instanceof`, `z.date`, `Uint8Array`.
**Confidence:** high.

### 3. Per-process state in the handlers

**Answer:** `registerIpc` closes over three pieces of state that assume one long-lived process serving one UI:
in-flight `AbortController`s keyed by a client-chosen id, the set of in-flight send ids, and a per-`Db` store cache.
The database connection is started once at app ready and closed on quit.

**Evidence**
- `src/main/ipc.ts:135` — `controllers: Map<clientRequestId, AbortController>`; set at `:166`, deleted in `finally` at
  `:222`; `cancel` aborts by id at `:498`. The id comes from the UI (`ipc-contract.ts:89, 99, 103`). Cancel works only
  while the send's request is still being handled by the same process.
- `src/main/ipc.ts:136, 173, 223` — `inFlightSendIds`, passed to `getCall` (`:291-294`) and `listCalls` (`:507-510`) so
  a call recorded but not yet completed is shown as in flight.
- `src/main/ipc.ts:137-146` — `WeakMap<Db, CallStore>` so index creation runs once per database.
- `src/main.ts:64-78` — `createDbConnection(...).start()` at ready, `stop()` and `close()` on `before-quit`.
  `dbStatus` reports `connecting | up | down | not-configured` (`ipc-contract.ts:305-310`).
- `src/main/ipc.int.test.ts:33-41` — integration tests already drive `registerIpc` through a stand-in object whose only
  member is `handle(channel, handler)`, called as `handler(null, input)` (`:28-30`). The handlers run in plain Node with
  no Electron runtime.
- `src/renderer/app.tsx:148-149, 236, 259` — the UI polls `dbStatus` every 2 s and `listCalls` every 500 ms.

**Verified by:** reading.
**Confidence:** high.

### 4. Electron in the e2e suite

**Answer:** Every spec launches Electron through `launchWithTestDatabase()`. Six of the twelve specs also reach into
the main process with `app.evaluate`: 13 of those calls replace or wrap an `ipcMain` handler to hold, fail or reject an
answer (fault injection); others close DevTools, read window bounds, or count windows. Specs call `window.pigeon`
directly to force a round trip.

**Evidence**
- `e2e/support.ts:9, 76-93` — `_electron.launch({ args: ['.'], env: { ...process.env, ...db.env } })`; `db.env` sets
  `DP_MONGO_DB` to a `dp_test_*` database (`test-support/e2e-database.ts:16, 43`). `close` closes the app, then drops the
  database.
- `e2e/support.ts:95-109` — the window is found by URL ending `main_window/index.html` because DevTools opens a second
  window when unpacked.
- `e2e/support.ts:1-4` — runs `.vite/build`, not the packaged `.app`, because the fuses disable the inspector
  (`context/archive/test-harness/record.md` §3).
- `playwright.config.ts:3-5` — "E2e drives the Electron app, not a browser, so there are no browser projects and no
  `playwright install`."
- `app.evaluate` / `app.windows` per spec (text count): `environments` 8, `saved-requests` 7, `open-call-failures` 4,
  `bodies` 3, `multipart-edit-failures` 3, `body-safety` 2. Handler replacement through `ipcMain.removeHandler` /
  `ipcMain.handle` / the private `_invokeHandlers` map: 13 occurrences, e.g. `e2e/environments.spec.ts:160-185`,
  `e2e/open-call-failures.spec.ts:50-60`, `e2e/multipart-edit-failures.spec.ts:75-90`.
- `e2e/bodies.spec.ts:46-71` — `closeDocked` waits for DevTools, closes it through `BrowserWindow`, and compares
  `getContentBounds().width` with `innerWidth`.
- `e2e/body-safety.spec.ts:89, 115` — asserts no new window opened by comparing `app.windows().length` (backed by
  `setWindowOpenHandler` deny, `src/main.ts:36`).
- `e2e/body-safety.spec.ts:107-110`, `e2e/open-call-failures.spec.ts:127-133` — `window.pigeon.dbStatus()` from the page
  as a "round trip to main".
- `e2e/edit-and-export.spec.ts:17-20` — stubs `navigator.clipboard.writeText` (AGENTS.md rule).

**Verified by:** text search with counts; reading of the cited ranges.
**Confidence:** high for locations; the counts are text-verified, not shape-verified (`ast-grep` was available and not
used).

### 5. What the UI assumes about its host

**Answer:** The CSP is a `<meta>` tag injected into production builds only, written for `file://`. Monaco's workers
are bundled files loaded through `getWorker`, because the fallback `blob:` worker is blocked by that CSP. New windows are
denied by the main process, not by the page. The dev loop loads a Vite dev server URL into the Electron window.

**Evidence**
- `vite.renderer.config.mts:4-9` — "Packaged builds load the renderer from file://, so the CSP must be a <meta> tag";
  policy `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  connect-src 'self'; object-src 'none'; base-uri 'none'`. `:11-21` — `apply: 'build'` only.
- `src/renderer/app.tsx:6-12, 67-71` — eager `monaco-editor/internal/common/workers.js`; `getWorker` returns
  `new JsonWorker()` or `new EditorWorker()` from `?worker` imports. Comment: without it the worker "falls back to a
  blob: URL, which the CSP blocks". `context/archive/editor-and-formatting/record.md:24, 59, 68-69` — the same, with
  `blob:`/`worker-src` in the CSP rejected because AGENTS.md fixes the CSP.
- `src/main.ts:34-36` — `setWindowOpenHandler(() => ({ action: 'deny' }))`, the only guard against a body opening a
  window (T1.8).
- `src/renderer/app.tsx:130-141` — Copy as curl calls `navigator.clipboard.writeText`, falling back to a selectable
  command when it fails.
- `src/main.ts:39-40` — dev mode loads `MAIN_WINDOW_VITE_DEV_SERVER_URL`; the window and the IPC handlers share one
  process, so there is no second origin in dev.
- `index.html:1-11` — no CSP, no token, a single module script `/src/renderer.tsx`.

**Verified by:** reading.
**Confidence:** high for what the code does. Not run: whether `navigator.clipboard` and Monaco's module workers behave
the same on `http://127.0.0.1:<port>` in a desktop browser.

## What the code does not say

- **The contract's types assume structured clone.** Nothing in `ipc-contract.ts` names the transport, but
  `z.instanceof(Uint8Array)` and `z.date()` are true only for structured clone. The same schemas validating input on
  the server and output in the UI would reject JSON-decoded values unless something converts them first.
- **"Handlers return results, never reject" is the UI's error model.** The UI shows `ok: false` messages and has no
  path for a rejected call except where tests inject one (`open-call-failures.spec.ts:55` throws). A transport that
  turns failures (network error, 401, 403, 413) into rejections is a new failure mode for every call site.
- **`cancel` throws on bad input** (`ipc.ts:495`) while every other handler returns a result.
- **The whole multipart file travels in one send message**, and a send result can carry inline bodies up to 1 MiB on
  each side. IPC imposes no size limit; an HTTP server's default body limit would.
- **`dbStatus.configPath` is shown to the user** (`ipc.ts:88, 94`: "Create <configPath>"), so the config location is
  user-visible text, not only an internal path.
- **The 500 ms history poll** costs nothing over IPC. Over HTTP each poll is a request through the token and origin
  checks.
- **The window is the only UI.** One window per process is assumed by `controllers` and `inFlightSendIds`; nothing
  prevents two browser tabs from sharing one server, and nothing in the handlers assumes otherwise, except that cancel
  ids are client-chosen and could collide between tabs.

## Surprises

1. **The contract is not JSON-safe.** Bodies (`Uint8Array`, in `SendInput`, `SendResult`, `GetCallResult`,
   `ReadBodyResult`) and timestamps (`Date`) need an encoding across HTTP. "Validated by the same `zod` schemas"
   (change.md boundary) holds only with a codec on both sides, or with schemas changed at the boundary.
2. **e2e fault injection lives in the main process.** 13 handler replacements via `app.evaluate` have no equivalent in
   a browser-only Playwright run; those scenarios need another seam in the server or in the page's network layer.
3. **New-window denial is Electron's, not the page's.** `setWindowOpenHandler` (`main.ts:36`) and the
   `app.windows()` assertion (`body-safety.spec.ts:89,115`) both disappear; T1.8's "opens nothing" check loses its
   enforcement point and its test.
4. **The CSP is build-only and a `<meta>` tag.** The dev loop runs with no CSP today; in a browser, dev and the API
   server are separate unless the server serves the dev build.

## Prior art found

- `context/archive/editor-and-formatting/record.md` — Monaco workers as bundled files under `script-src 'self'`; `blob:`
  and `worker-src` rejected. Holds for any host that serves the bundle from `'self'`.
- `context/archive/multipart-with-file-copies/record.md:62, 91` — main receives a plain `Uint8Array`, not a `Buffer`
  (spike on Electron 45.2.1). Specific to structured clone; does not carry over to HTTP.
- `context/archive/test-harness/record.md` §3 — e2e uses `.vite/build` because fuses disable the inspector. Obsolete
  once Electron is gone.
- `context/foundation/decisions/0002-...md` — the token, `Host`/`Origin` checks and CSP header are decided there.

## Unanswered

- **Secure context on `http://127.0.0.1`.** Whether `navigator.clipboard.writeText` and module workers work in the
  author's browser over plain HTTP on loopback. Settled by running the built UI from a local server once (a spike or the
  first plan phase).
- **Which browser.** No document names the author's browser; Playwright's browser choice for e2e follows from it.
- **Where `config.json` lives without Electron.** The current path comes from `app.getPath('userData')`; no code
  computes it otherwise. A decision for the plan, since the path is user-visible.
- **Upload and response size over HTTP.** No measurement of how large a multipart file or inline body the UI sends or
  receives today; the largest tested multipart is in `e2e/multipart.spec.ts` and `large-bodies.int.test.ts` (not read
  for sizes).

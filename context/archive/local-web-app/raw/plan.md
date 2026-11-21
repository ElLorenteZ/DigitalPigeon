---
change_id: local-web-app
status: draft
produced-by: lz-plan
created: 2026-11-11
updated: 2026-11-11
inputs: [change.md, research.md, spike-browser-host.md, decisions/0002, roadmap.md, tech-stack.md, test-strategy.md, lessons.md]
revision: 3 — 2026-11-11, plan review: phases 3 and 4 merged into one commit (author's choice (a)), per-port cookie, refused token exchange, dev mode and browser-side 17 MiB upload in the walkthrough; 5 phases → 4. Revision 2 folded in spike-browser-host.md
---

# Plan: Replace the Electron shell with a local Node server and a browser UI

## Approach

Keep `registerIpc` (`src/main/ipc.ts:134-524`) as the API, unchanged in behaviour, and put a plain `node:http` server
in front of it. The handlers already run without Electron through a stand-in whose only member is
`handle(channel, handler)` (`src/main/ipc.int.test.ts:33-41`). The server implements that same `handle` seam: one
dispatcher maps `POST /api/<channel>` to the registered handler. The UI swaps `window.pigeon` for a `fetch` client
typed as the existing `PigeonApi` (`src/shared/ipc-contract.ts:314-333`), so the 17 call sites
(`src/renderer/app.tsx`, research §1) change only in where the object comes from.

The contract is not JSON-safe (research, surprise 1): bodies are `Uint8Array` and timestamps are `Date`, and the shared
`zod` schemas check for exactly those types (`ipc-contract.ts:66,121`, `call-schema.ts:16,30,62`). A small codec in
`src/shared/` encodes them as tagged JSON values (`{"$bytes": base64}`, `{"$date": iso}`) on the way out and restores
them on the way in, on both sides. The schemas and the handlers stay as they are; the codec makes structured clone's
two guarantees true over HTTP.

Security follows ADR 0002. The server binds `127.0.0.1` only. `npm start` builds, starts the server on a fixed
default port (overridable by `DP_PORT`), and opens Chrome at `/?token=<per-launch token>`. The server answers that one
URL by setting an `HttpOnly; SameSite=Strict` cookie named for its port (`dp_<port>`) holding the token and redirecting to `/`. Every request then must
carry a `Host` of `127.0.0.1:<port>` (stops DNS rebinding). Every API call is a `POST`, must carry the cookie, and must
carry an `Origin` equal to the server's own. Chrome 157 sent `Origin` on every `fetch` `POST` and omitted it on the
navigation, classic scripts and the worker script (`spike-browser-host.md`, surprise 3), so the `Origin` rule applies to
`/api/*` only. Anything else is refused before it reaches a handler. The CSP moves from the build-only `<meta>` tag (`vite.renderer.config.mts:4-21`) to a response
header on the built UI; the dev loop keeps running without it, as today (AGENTS.md). In dev, Vite runs in middleware
mode inside the same server, so dev and API share one origin (research, surprise 4).

e2e moves to Playwright driving the installed Chrome (`channel: 'chrome'`, author's answer). The 13 handler swaps done
through `app.evaluate` (research §4) become `page.route` interceptions of `/api/<channel>`: hold, fail and reject are
expressible at the network layer, and the server carries no test-only code. A console listener does not see CSP
violations (`spike-browser-host.md`, surprise 1), so e2e also records `securitypolicyviolation` events and fails on
any.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Fastify or Hono instead of `node:http` | The API is 16 `POST` operations through one dispatcher, plus static files. A framework adds a dependency, its own validation and error model alongside `zod` and the "results, never rejections" model (`ipc.ts:3`), and nothing the dispatcher needs. Revisit if the server grows routes that are not operations. |
| REST resources per operation (`GET /calls/:id`, `DELETE /environments/:id`, …) | Rewrites 16 handlers and the UI's call shape for no behaviour change. `GET` requests carry no `Origin` header in same-origin fetches, so the origin check would need a second rule. One `POST` per operation keeps the seam that exists. |
| CBOR or MessagePack (`cbor-x`) for the transport | Carries `Uint8Array` and `Date` natively and avoids base64's 33% overhead, but adds a dependency and makes every request unreadable in DevTools' network tab. The largest payloads are a 1 MiB page (`ipc-contract.ts:111`) and uploaded files; base64 is measured on 17 MiB in phases 1 and 2 before it is accepted. |
| Change the schemas to JSON types (`z.string()` dates, base64 strings) | Touches `call-schema.ts`, which `src/core/` and the store validate against; `src/core/` behaviour is outside the change boundary. The codec keeps the change at the transport. |
| Test-only hooks in the server for e2e fault injection | Puts code in the production server that only tests use, and needs its own guard. `page.route` reaches every case the 13 swaps cover without touching the server. |
| A `report-uri` endpoint in the server to catch CSP violations in e2e | Adds a production endpoint that exists for tests and needs the same checks as `/api/*`. A Playwright init script listening for `securitypolicyviolation` sees violations without server code. |
| Also require `Sec-Fetch-Site: same-origin` on `/api/*` | Present on every request in the spike, but redundant with the `Origin` check in Chrome, and every non-browser client in tests would have to fake it. |
| Token in a URL fragment held in `sessionStorage`, sent as a header | Script-readable: an XSS from a response body (T1.8) could read and exfiltrate it. An `HttpOnly` cookie is not readable from script. |
| Keep the UI switch and the e2e port as separate phases (plan revision 2) | The Electron e2e suite and the Forge build would be red on the commit between them, against the gates in `test-strategy.md:96-98`. Waiving the gates for one commit was the other option; the author chose one combined phase (plan review, option (a)). |
| Keep a separate Vite dev server and proxy `/api` | Two origins in dev, so the `Origin` check needs a dev exception. Middleware mode gives one origin in both modes. |

## Out of scope

- A "server not reachable" or "session expired" state in the UI. After a server restart an open tab's calls are
  refused (new token) and reject, as a thrown IPC handler rejects today; the UI shows what it shows for a rejection
  now. Reopening via `npm start` is the recovery. A real state for it is new UI, not part of moving what exists.
- Persistent tokens, bookmarkable URLs that survive a restart, or several concurrent launches. ADR 0002 fixes a
  per-launch token.
- Opening any browser other than Chrome from `npm start`, and running e2e in WebKit or Firefox.
- Running the server as a background service, at login, or after the terminal closes.
- Response compression, HTTP/2, TLS on loopback.
- Changes to `src/core/`, to `call-schema.ts`, or to what any handler returns.
- Fixing the unhandled rejection of the `dbStatus` poll (`app.tsx:232`, no `catch`), beyond keeping it no worse.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | Monaco's bundled module workers (`app.tsx:6-12, 67-71`) start when the built UI is served from `http://127.0.0.1:<port>` with the CSP as a header (`script-src 'self'`, no `worker-src`). Verified so far only on `file://` (`archive/editor-and-formatting/record.md:24`). | Editor falls back to `blob:` and the CSP blocks it; phase 3 stalls or the CSP needs `worker-src`, which AGENTS.md fixes. | yes — **verified** for Chrome 157 on macOS, editor worker only (`spike-browser-host.md`) |
| A2 | Chrome sends `Origin` on same-origin `fetch` `POST` to `http://127.0.0.1:<port>`, and keeps an `HttpOnly; SameSite=Strict` cookie set on the `/?token=` redirect for later `fetch` calls. | The checks refuse the app's own calls (phase 3), or the token must travel another way. | yes — **verified** for Chrome 157 on macOS, including the `open` flow (`spike-browser-host.md`) |
| A3 | `navigator.clipboard.writeText` works on `http://127.0.0.1` (a secure context in Chrome). | Copy as curl falls back to the selectable command (`app.tsx:130-143`); no phase stalls. | no — **verified** (`spike-browser-host.md`) |
| A4 | undici 8.12.3 and the `mongodb` driver run on the system Node (v22.22.2 here) with no change. | The server cannot send or store. | no — verified: integration tests already run both in plain Node under Vitest (`test-strategy.md`, Integration layer) |
| A5 | A 17 MiB multipart file as base64 in one JSON request is sent, recorded and replayed through the server within the existing 60 s e2e timeout (`playwright.config.ts:9`). | Large uploads need a streamed or binary transport; the codec decision is reopened. | partly — phases 1 and 2 measure it before phase 3 builds on it; phase 3 uploads it from the browser |
| A6 | `page.route` with `route.fetch()` reproduces each of the 13 handler swaps, including "wrap the real handler, hold the first call, signal when stored" (`e2e/environments.spec.ts:160-185`). | Some scenarios need another seam; phase 3 step B grows. | no — phase 3 step B only |
| A7 | Electron's `userData` for this app is `~/Library/Application Support/DigitalPigeon` on macOS (AGENTS.md), `~/.config/DigitalPigeon` on Linux and `%APPDATA%\DigitalPigeon` on Windows, so the server finds the same `config.json`. | The author's existing credentials are not found; the status line says "not configured" and names the path. Recoverable by moving the file. | no |
| A8 | A `securitypolicyviolation` listener added with `page.addInitScript` sees a violation that the console listener misses. | Phase 3's CSP check passes while a violation happens. | no — phase 3 proves the listener catches an injected inline script before relying on it |
| A9 | Answering `/favicon.ico` with `204` produces no console error in Chrome. | Phase 3's console check fails on every page load. | no — phase 3's console check observes it |

A1–A3 were settled by `spike-browser-host.md` (2026-11-11, verdict holds) for the cases its "Not tried" list excludes:
other OSes and browsers, the JSON worker, large bodies, dev mode, and the refusal side. Its surprises are folded into phases 2–3.

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | Every contract value survives the trip: each result and input type round-trips through the codec and still parses with its existing schema | `src/shared/wire-codec.ts` (new), its unit test | lz-tdd | `npx vitest run --project unit src/shared/wire-codec.test.ts` |
| 2 | A Node server answers all 16 operations over HTTP and refuses every request that lacks the cookie, the server's `Host` or its `Origin`, before anything is sent or recorded | `src/server/` (new), `src/main/ipc.ts` (seam type only) | lz-tdd | `npx vitest run --project integration src/server/http.int.test.ts` |
| 3 | `npm start` opens Chrome on the app, everything that works in Electron today works there, and the whole e2e suite proves it in Chrome | `src/renderer/`, `src/renderer.tsx`, Vite configs, `package.json` scripts, config path, `e2e/`, `playwright.config.ts` | lz-build, then lz-e2e | `npm run test:e2e` + author's walkthrough + `npm run typecheck && npm run lint` |
| 4 | Electron is gone and the repository's rules, gates and strategy describe the server | delete `src/main.ts`, `src/preload.ts`, `forge.config.mts`, `vite.main/preload.config.mts`; `package.json`; `AGENTS.md`; `test-strategy.md` | lz-build | all gates green; `grep` finds no `electron` outside `context/` |

**Commit rule (revision 3, author's choice (a)).** Each phase lands as one commit that passes the gates in
`test-strategy.md`. Phase 3 is one commit: the UI switch and the e2e port together, so `test:e2e` is never red on a
commit. In phase 3, `test:e2e` stops building through Electron Forge and builds with `npm run build` instead (the new
server and UI build); the `npm run package` Build gate is replaced by `npm run build` from that commit, and phase 4
records the replacement in `test-strategy.md`. No gate is waived.

### Phase 1 — every contract value survives the trip

**Changes:** `src/shared/wire-codec.ts`: `encode(value): string` and `decode(text): unknown`. `Uint8Array` (any
subclass, so a Node `Buffer` encodes as bytes) ↔ `{"$bytes": "<base64>"}`; `Date` ↔ `{"$date": "<ISO 8601>"}`. A plain
object that has a `$bytes` or `$date` key of its own is escaped so it decodes unchanged. Base64 is produced in chunks
so a multi-MiB array does not overflow the call stack in the browser. No dependency on Node's `Buffer` or the DOM, so
both sides import it. Tests build one value of each result schema with bytes and dates (`SendResultSchema`,
`GetCallResultSchema`, `ReadBodyResultSchema`, `SendInputSchema` with a multipart file part) and assert
`schema.parse(decode(encode(v)))` deep-equals `v`.

**Verification:**
```
$ npx vitest run --project unit src/shared/wire-codec.test.ts
expected: all pass; includes an empty Uint8Array, a 17 MiB array, a Buffer, an Invalid Date refused, and a literal {"$bytes": …} object surviving as an object
```

**Done when:** the four schemas parse their round-tripped samples, the 17 MiB array round-trips, and the escaping case
passes.

**Executor:** lz-tdd — a pure function whose behaviour can be specified completely before it is written (unit layer,
`test-strategy.md`).

### Phase 2 — the server answers and refuses

**Changes:**
- `src/main/ipc.ts:4,68-69`: replace `IpcMain` with a local interface `{ handle(channel, handler) }`, the shape the
  integration test already passes (`ipc.int.test.ts:33-41`). No handler changes.
- `src/server/http.ts` (new): `createServer({ db, dbStatus, token, port, staticDir? })` on `node:http`, bound to
  `127.0.0.1`. Registers the handlers through `registerIpc` with a `handle` that stores them by channel. Request order:
  `Host` check → `GET /?token=` exchange → for `/api/*`: method `POST`, cookie, `Origin` → decode body with the codec →
  call handler → encode result. A thrown handler (only `cancel`, `ipc.ts:494-499`) answers `400` with a message.
  Refusals answer `403` with no body detail and never call a handler.
  - The cookie is named per port, `dp_<port>`. Cookies on `127.0.0.1` are shared across ports, so a fixed name lets a
    second server (`npm run dev` beside `npm start`) overwrite the first tab's cookie (plan review, revision 3).
  - The exchange compares the token in constant time. A wrong or missing token answers `403` and sets no cookie.
  - Static files (when `staticDir` is set) are served with the CSP header from `vite.renderer.config.mts:7-9`; no
    `Access-Control-*` header anywhere. Static `GET`s require the `Host` check and the cookie, not `Origin`.
    `GET /favicon.ico` answers `204` until slice 6 brings the logo (`spike-browser-host.md`, surprise 2).
- `src/server/http.int.test.ts` (new): real server on an ephemeral port, `openTestDb()` database, capture server from
  `test-support/`. Cases:
  - each of the 16 operations answers through HTTP;
  - refused with `403`, the capture server receiving nothing and the database holding no send document: no cookie,
    wrong cookie, the cookie of another port's name, `Host` of `evil.test:<port>`, `Origin` of `http://evil.test`,
    missing `Origin`, `GET /api/send`, a static file or `/favicon.ico` with a foreign `Host`;
  - `GET /?token=<wrong>` and `GET /?token=` answer `403` with no `Set-Cookie`;
  - the right token sets `dp_<port>` with `HttpOnly` and `SameSite=Strict`;
  - a send with a 17 MiB multipart file part is recorded and its replay delivers the same bytes (T1.4/T1.5 through the
    transport);
  - `cancel` of an in-flight send through a second request ends it as `cancelled`.

**Verification:**
```
$ npx vitest run --project integration src/server/http.int.test.ts
expected: all pass; the 17 MiB case reports its duration
$ npm run test:integration
expected: exit 0, src/main/ipc.int.test.ts unchanged and passing
```

**Done when:** every refusal case leaves zero dispatches and zero documents, no refused exchange sets a cookie, and
the 17 MiB round trip passes. If it takes longer than the 60 s e2e timeout, stop and reopen the codec decision (A5)
before phase 3.

**Executor:** lz-tdd — each refusal is a falsifiable rule that can be written as a failing test first; this is the
new tier-1 risk the change introduces (ADR 0002, "Given up").

### Phase 3 — the app runs in Chrome, and e2e proves it

One commit (commit rule above). Built in two steps on the branch; only the end state is committed.

**Changes, step A — the app (lz-build):**
- `src/renderer/api.ts` (new): `PigeonApi` over `fetch('/api/<channel>', { method: 'POST', body: encode(input) })`,
  decoding with the codec; a non-`2xx` answer rejects, as a thrown handler rejected `ipcRenderer.invoke`.
- `src/renderer/app.tsx:61-62` and the 17 call sites: take the API from `api.ts` instead of `window.pigeon`.
- `src/renderer.tsx`: `z.config({ jitless: true })` before anything parses, so zod's `Function('')` probe no longer
  trips `script-src 'self'` on every load (`spike-browser-host.md`, surprise 1). Schemas and results unchanged.
- `src/server/main.ts` (new): reads `DP_PORT` (fixed default otherwise), `DP_OPEN_BROWSER` (default on), resolves
  `config.json` at the per-OS `userData` path (A7) through `resolveDbConfig` (`src/core/db-config.ts`), starts the
  database connection as `src/main.ts:57-78` does, generates the token (`crypto.randomBytes`), starts the server, prints
  the URL, and opens it in Chrome (`open -a "Google Chrome"` on macOS; `google-chrome`/`start chrome` elsewhere). Stops
  the connection on `SIGINT`/`SIGTERM`. In dev it mounts Vite in middleware mode (with its HMR websocket on the same
  server, behind the `Host` and cookie checks) instead of `staticDir`.
- `vite.renderer.config.mts`: drop the `<meta>` CSP plugin (the header replaces it); build to a fixed `dist/ui`. A Vite
  SSR build of `src/server/main.ts` to `dist/server`.
- `package.json`: `build` builds UI and server; `start` runs `build`, then `node dist/server/main.js`; `dev` runs the
  server with Vite middleware; `test:e2e` runs `npm run build && playwright test`. `index.html` unchanged.
- Electron stays installed but is no longer the entry point; `src/main.ts` and `src/preload.ts` are untouched and
  unused until phase 4.

**Changes, step B — e2e in Chrome (lz-e2e):**
- `playwright.config.ts`: one project, `use: { channel: 'chrome' }`; the comment at `:3-5` rewritten.
- `e2e/support.ts:76-109`: `launchWithTestDatabase()` starts `dist/server/main.js` as a child process with
  `DP_PORT=0`, `DP_OPEN_BROWSER=0` and the `dp_test_*` env from `test-support/e2e-database.ts`, reads the token URL from
  its stdout, launches Chrome, and goes to it. `TestApp` keeps `window` (a `Page`) and `close` (kills the server, then
  drops the database); `app` becomes the browser context. `appWindow` and the DevTools handling go (lessons 2026-11-07
  docking entry no longer applies).
- The 13 handler swaps (`environments` 8 `app.evaluate` calls, `saved-requests` 7, `open-call-failures` 4,
  `multipart-edit-failures` 3; research §4) become `page.route('**/api/<channel>', …)` with the same hold / fail /
  reject behaviour. Signals that ran in main (`releaseHeld`, `firstChoiceDone`) move into the test process.
- `e2e/bodies.spec.ts:46-71` `closeDocked`: removed with its callers' waits.
- `e2e/support.ts`: a `page.addInitScript` that records `securitypolicyviolation` events, and an
  `expectNoCspViolations` helper. One new test first shows the helper fails: `page.addScriptTag({ content: … })` (an
  inline script the CSP blocks) must produce one recorded violation. Then `body-safety.spec.ts`, which already checks
  the console, also checks for no violation (T1.8).
- `e2e/body-safety.spec.ts:89,115`: "opens nothing" asserts the browser context's page count is unchanged and the
  page URL is unchanged. The `window.pigeon.dbStatus()` round trips (`body-safety.spec.ts:107-110`,
  `open-call-failures.spec.ts:127-133`) become a `fetch` of `/api/db-status` from the page.

**Verification:**
```
$ npx playwright test --list > /tmp/titles-before.txt      # on the commit before phase 3, against Electron
$ npm run typecheck && npm run lint
expected: exit 0
$ npm run test:e2e
expected: exit 0; `npx playwright test --list` lists every title in titles-before.txt, plus the CSP-check test
$ npm start
expected: Chrome opens at http://127.0.0.1:<port>/ (token gone from the address bar); status line shows the database up
```
Author's walkthrough in that tab:
- send a GET and a JSON POST; both appear in History; open one, replay it, edit and send, copy as curl;
- a JSON response shows Pretty and Raw;
- send a multipart file of at least 17 MiB, delete the file from disk, replay it (the browser-side codec on a large
  file, which phase 2's Node client did not exercise);
- save a request, switch environment, send it;
- stop Docker and see the database-down state;
- DevTools console shows no CSP violation, no `404` and no worker error, and the Issues panel lists no CSP issue;
- from a second tab on another origin (any `https://` site's console),
  `fetch('http://127.0.0.1:<port>/api/list-calls', { method: 'POST' })` fails and the server logs a refusal;
- with `npm start` still running, `npm run dev` on another port opens a second tab and one send succeeds there; the
  first tab still sends (per-port cookie).

**Done when:** `test:e2e` passes with every earlier title plus the CSP-check test, the injected inline script is
caught, no spec references `_electron`, `app.evaluate` or `ipcMain`, and every walkthrough step behaves as in the
Electron app.

**Executor:** lz-build for step A (wiring and configuration), then lz-e2e for step B (browser-level risks T1.8, T2.7,
T2.9, T2.10). Neither step is committed alone.

### Phase 4 — Electron removed, rules and strategy updated

**Changes:**
- Delete `src/main.ts`, `src/preload.ts`, `forge.config.mts`, `vite.main.config.mts`, `vite.preload.config.mts`.
  Remove `electron`, `electron-squirrel-startup`, `@electron-forge/*`, `@electron/fuses`,
  `@types/electron-squirrel-startup` from `package.json`; drop the `package`, `make`, `release` scripts; point `main`
  away from `.vite/build/main.cjs`. `src/declarations.d.ts:1` loses the Forge reference.
- Move `src/main/ipc.ts` and `src/main/ipc.int.test.ts` into `src/server/`; names and channel names unchanged.
- `AGENTS.md`: remove the transition note and the Electron non-negotiable; rewrite the Checks table (`npm start`,
  `npm run dev`, `npm run build`, e2e needs Chrome) with each command run; replace the Electron-specific notes
  (CSP `<meta>`, Electron binary download, `.vite/build`, `electron-winstaller`); state where `config.json` lives.
- `context/foundation/test-strategy.md` (revision line): new tier-1 row for cross-origin and tokenless requests reaching
  a handler, owned by `src/server/http.int.test.ts`; T1.8 and T2.1 rewritten for the browser and the HTTP boundary; the
  E2E layer row rewritten for Chrome and `page.route`; the Build gate becomes `npm run build`.

**Verification:**
```
$ npm run typecheck && npm run lint && npm run test:unit && npm run test:integration && npm run test:e2e
expected: exit 0 for each
$ grep -rni electron src e2e test-support package.json *.mts *.ts AGENTS.md
expected: no output
```

**Done when:** all gates pass, the grep is empty, and `npm start` from a fresh `npm ci` opens the app.

**Executor:** lz-build — removal and documentation; covered by the gates the earlier phases made green.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| A page in the author's browser drives the API (CSRF, DNS rebinding) | medium if unchecked | High: requests sent in the author's name; history and tokens read | Phase 2 tests each refusal against the real server before the UI exists on it |
| Losing Electron's new-window denial (`src/main.ts:36`) lets a body open a window | low | Medium | Bodies are never live HTML and Monaco links are off (`body-safety.spec.ts`); phase 3 keeps the "opens nothing" assertion on the browser context. The enforcement point is gone; the test remains |
| Base64 upload too slow or too large in memory | low | Medium | Phase 1 round-trips 17 MiB in the codec; phase 2 measures it through the server and stops before phase 3 if slow (A5); phase 3's walkthrough uploads 17 MiB from the browser |
| Phase 3 is one large commit, so a defect is harder to bisect inside it | medium | Low | Steps A and B are separate on the branch; `progress.md` records both; only the commit is combined |
| A second local server overwrites the session cookie | high without a per-port name | Medium: the daily tab stops working during development | Per-port cookie name, tested in phase 2 and walked through in phase 3 |
| History poll every 500 ms (`app.tsx:149`) now costs an HTTP request with checks | low | Low | Measured in the walkthrough by eye; no change planned |
| A CSP violation goes unnoticed because only the console is checked | high without a listener (zod's probe was invisible to it in the spike) | Medium: T1.8 rests on the CSP | Phase 3 removes the known violation, adds a violation listener and proves it catches an injected one |
| A dropped `.catch` on the status poll (`app.tsx:232`) turns server restarts into console errors | high | Low | Out of scope; noted for the reviewer |

## For the reviewer

- **Phase 3 is the weakest link: the largest phase and commit.** It replaces the e2e harness and the UI transport
  together, so its first full check is `npm run test:e2e` at the end of step B. A defect in step A surfaces only then.
- **The Build gate changes inside phase 3** from `npm run package` to `npm run build`. This is a substitution, not a
  waiver; check that `npm run build` covers what `package` covered for the UI (the CSP now ships as a header, so the
  production build is checked by e2e against the server, not by the build output).
- **A1–A3 rest on one spike: Chrome 157 on macOS, against a stubbed API** (`spike-browser-host.md`, Not tried).
  Windows, Linux, the JSON worker and dev mode were not exercised by it; dev mode is now in phase 3's walkthrough.
- **`z.config({ jitless: true })` changes how zod runs in the UI.** Check whether any UI path depends on JIT-only
  behaviour (none is known).
- **The cookie is the token.** `SameSite=Strict` plus the `Origin` check carry the CSRF defence; the `Host` check
  carries rebinding. Check that no route, static files and the Vite dev middleware included, answers before the `Host`
  check.
- **"Server not reachable" is out of scope.** After a restart, an open tab's calls reject. Decide whether that is
  acceptable for daily use.

## References

- `src/main/ipc.int.test.ts:33-41` — handlers run with a `handle`-only stand-in; the seam the server uses.
- `src/main/ipc.ts:3, 135-146, 494-499` — results not rejections; per-process state; `cancel` throws.
- `src/shared/ipc-contract.ts:66, 111, 121, 314-333` and `src/core/call-schema.ts:16, 30, 62` — `Uint8Array` and `Date`
  in the contract; `PigeonApi`.
- `src/main.ts:36, 57-78` — new-window denial; config and connection startup to port.
- `vite.renderer.config.mts:4-21` — the CSP and its build-only `<meta>` injection.
- `e2e/support.ts:76-109`, research §4 — the Electron launch and the 13 handler swaps.
- `context/foundation/decisions/0002-the-app-is-a-local-web-app-served-from-127-0-0-1.md` — token, `Host`/`Origin`, CSP
  header, `127.0.0.1`.
- `context/archive/editor-and-formatting/record.md:24, 59, 68-69` — workers as bundled files; a spike result that did
  not hold inside the app (the reason A1 is spiked against this app's build, not a bare one).
- `context/changes/local-web-app/spike-browser-host.md` — A1–A3 hold on Chrome 157/macOS; favicon `404`, zod's CSP
  violation, `Origin` only on `fetch` `POST`.
- `context/foundation/lessons.md` — "List what a spike did not try" (the spike's Not tried list above); 2026-11-03
  re-fetch race (the 500 ms poll stays).

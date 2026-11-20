---
change_id: local-web-app
produced-by: lz-build
plan: plan.md
updated: 2026-11-11
---

# Progress: Replace the Electron shell with a local Node server and a browser UI

## Phase 1 — Every contract value survives the trip: each result and input type round-trips through the codec and still parses with its existing schema

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Changed**
- `src/shared/wire-codec.ts` — new. `encode` (a `JSON.stringify` replacer reading `this[key]`, so a `Date` or `Buffer`
  is seen before its `toJSON`) and `decode` (a `JSON.parse` reviver). `Uint8Array` ↔ `{"$bytes": base64}` built in
  32 KiB chunks with `btoa`/`atob`; `Date` ↔ `{"$date": ISO}`; a plain object with an own key `$bytes`, `$date` or
  `$object` ↔ `{"$object": [[key, value], …]}`.
- `src/shared/wire-codec.test.ts` — new, 13 tests.

**Cycles**
1. Red: 8 round-trip tests (send result, call detail with a stored-file body, 1 MiB page, multipart send input, empty
   array, `Buffer`, 17 MiB array, the tagged wire format) against a stub that throws. Seven failed with
   `not implemented`; the multipart test failed on its own sample (`query`/`headers` instead of `queryRows`/
   `headerRows`), was corrected, and then failed with `not implemented`. Green with the replacer and reviver.
2. Red: 5 tests for lookalike values. Three failed for the right reason (`{ headers: { $bytes: 'AQI=' } }` came back
   as `Uint8Array [1, 2]`; `[{ $date: … }]` came back as a `Date`; `{ $object: { $bytes: 'x' } }` threw
   `InvalidCharacterError`). Two passed on first run: "an escaped object keeps real bytes and dates inside it" and
   "an Invalid Date is refused". Green with the entries escape.
3. Mutation check for the two tests never seen red: encoding dates with `toJSON()` (an Invalid Date becomes `null`)
   failed the Invalid Date test; returning `$object`'s entries without `Object.fromEntries` failed the escaped-object
   test. Code restored.

**Verification**

```
$ npx vitest run --project unit src/shared/wire-codec.test.ts
      Tests  13 passed (13)
   Duration  1.85s (tests 97%, import 2%, transform 1%)
$ npm run typecheck
exit 0
$ npx oxfmt --check src/shared/wire-codec.ts src/shared/wire-codec.test.ts   (after oxfmt --write)
exit 0
```

PASS — the four contract schemas parse their round-tripped samples, a 17 MiB array round-trips byte for byte, and
lookalike objects survive unchanged.

**Drift:** decision — the plan said "escaped so it decodes unchanged" without a shape → escaped as an entries array
under `$object`, because `JSON.parse` revives bottom-up, so an escape that kept the lookalike object nested would still
be read as a tag. `$object` is a third reserved key. Also: no commit. The plan's commit rule (one commit per phase)
needs the author's go-ahead; the work is on `main`, uncommitted, alongside the uncommitted foundation documents.

## Phase 2 — A Node server answers all 16 operations over HTTP and refuses every request that lacks the cookie, the server's `Host` or its `Origin`, before anything is sent or recorded

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Changed**
- `src/main/ipc.ts` — `IpcMain` replaced by a local `Registrar` interface (`handle(channel, handler)`); header comment
  rewritten. No handler changed. Electron's `ipcMain` (`src/main.ts`) and the test stand-ins still satisfy it.
- `src/server/http.ts` — new. `createServer({ db, dbStatus, token, port, staticDir? })` on `node:http`, bound to
  `127.0.0.1`. Order: `Host` must be `127.0.0.1:<port>` → `GET /?token=` exchange (`timingSafeEqual`; `303` with
  `dp_<port>=<token>; HttpOnly; SameSite=Strict; Path=/`, or `403` with no cookie) → cookie `dp_<port>` →
  `/api/<channel>`: `POST` only and `Origin` must be `http://127.0.0.1:<port>`, body decoded with the codec, handler
  result encoded (`null` for `cancel`'s `void`); a thrown handler answers `400` with its message → static `GET`s from
  `staticDir` with the CSP header; `/favicon.ico` answers `204`; a path outside `staticDir` answers `404`. Refusals are
  `403` with an empty body. `CSP` is exported from here.
- `src/server/http.int.test.ts` — new, 27 tests against a real server on an ephemeral port, an `openTestDb()`
  database and the capture server.

**Cycles**
1. Red: all 27 tests against a stub that listened and answered `501` to everything. 26 failed on their expected status
   (`expected 501 to be 303 / 403 / 200 / 204 / 400`; the cancel test timed out because the send never reached the
   silent target). "No response carries a CORS header" passed, since the stub sends none.
2. Green: the `Registrar` seam, then `http.ts` as above. 27 passed.
3. Mutation check: adding `Access-Control-Allow-Origin: *` to operation replies failed the CORS test; removing the
   `Origin` check failed 3 tests (foreign, missing, other-port `Origin`); removing the `Host` check failed 5 (foreign
   and `localhost` `Host` on `/api/send`, the UI, the favicon, the token exchange). Code restored.

**Verification**

```
$ npx vitest run --project integration src/server/http.int.test.ts
      Tests  27 passed (27)
stdout | … a 17 MiB multipart file is recorded, and its replay delivers the same bytes
17 MiB send and replay over HTTP: 935 ms
$ npm run test:integration
 Test Files  13 passed (13)
      Tests  333 passed (333)
$ npm run test:unit
 Test Files  12 passed (12)
      Tests  370 passed (370)
$ npm run typecheck
exit 0
$ npm run lint
All matched files use the correct format.
```

PASS — every refusal case returns `403` with nothing sent to the capture server and no `sends` document; refused
token exchanges set no cookie; the 17 MiB round trip takes 935 ms against the 60 s bound (A5 holds for the server
path); `src/main/ipc.int.test.ts` passes unchanged.

**Drift:** decision — the plan listed refusal cases for the API and static files → also added `localhost` as `Host`
(refused: only `127.0.0.1:<port>` is the server's own), an `Origin` on another port, a path outside `staticDir`
(`404`), and a malformed body (`400`, untested). A path outside `staticDir` answers `404`, not `403`; the test accepts
either and checks the file is not served. Not committed (see phase 1).

## Phase 3 — `npm start` opens Chrome on the app, everything that works in Electron today works there, and the whole e2e suite proves it in Chrome

- **Executor:** lz-tdd → routed to lz-build (step A), then lz-e2e (step B)
- **Status:** in-progress

**Routed:** step A is wiring and configuration (the `fetch` client, `src/server/main.ts`, Vite builds, npm scripts),
where a test-first loop would assert Vite's and Node's behaviour; the plan names lz-build. Step B is browser-level risk
(T1.8, T2.7, T2.9, T2.10), which `test-strategy.md` assigns to e2e; the plan names lz-e2e. Before starting, capture
`npx playwright test --list > titles-before.txt` against the Electron build (plan, phase 3 verification). Run
`/lz-build local-web-app`.

## Phase 4 — Electron is gone and the repository's rules, gates and strategy describe the server

- **Executor:** lz-tdd → routed to lz-build
- **Status:** in-progress

**Routed:** removal of Electron files and dependencies, and rewriting `AGENTS.md` and `test-strategy.md`, is removal and
documentation; the existing gates are its net. Run after phase 3 with `/lz-build local-web-app`.

## Phase 3 — `npm start` opens Chrome on the app, everything that works in Electron today works there, and the whole e2e suite proves it in Chrome

- **Executor:** lz-build (step A); step B routed to lz-e2e
- **Status:** in-progress
- **Started:** 2026-11-11
- **Finished:** —

**Before:** `npx playwright test --list` against the Electron build, saved as
`context/changes/local-web-app/titles-before.txt`: `Total: 50 tests in 12 files`.

**Changed (step A)**
- `src/renderer/api.ts` — new. `PigeonApi` over `fetch('/api/<channel>', { method: 'POST' })`, encoded and decoded
  with the codec; a non-`2xx` answer rejects with the channel, status and body text.
- `src/renderer/app.tsx` — the 17 `window.pigeon` call sites use `pigeon` from `./api`; the `Window` declaration and the
  `PigeonApi` import removed; the Monaco worker comment names the server's origin instead of `file://`.
- `src/renderer/zod-jitless.ts` — new, `z.config({ jitless: true })`; imported first by `src/renderer.tsx`, whose header
  comment now describes the browser and the server.
- `src/server/main.ts` — new. Config path at Electron's former `userData` per OS, the same `resolveDbConfig` and
  `createDbConnection` as `src/main.ts:57-78`, a 32-byte hex token, `createServer` on `DP_PORT` (default 4380), one
  stdout line `DigitalPigeon listening: <token URL>`, Chrome opened unless `DP_OPEN_BROWSER=0`, `SIGINT`/`SIGTERM` close
  the server and the client. `DP_DEV=1` serves the UI through Vite in middleware mode.
- `src/server/http.ts` — new `devMiddleware` option, called after the `Host` and cookie checks for non-API `GET`s.
- `vite.renderer.config.mts` — the `<meta>` CSP plugin removed; output to `dist/ui`.
- `vite.server.config.mts` — new. SSR build of `src/server/main.ts` to `dist/server/main.mjs`.
- `package.json` — `build` (UI then server), `start` (`build`, then `node dist/server/main.mjs`), `dev` (server build,
  then `DP_DEV=1 node dist/server/main.mjs`), `test:e2e` now `npm run build && playwright test`.

**Verification (step A)**

```
$ npm run build
dist/ui/assets/index-CAPy4Pj2.js          4,284.03 kB │ gzip: 1,113.39 kB
✓ built in 523ms
dist/server/main.mjs  64.51 kB │ gzip: 17.44 kB
✓ built in 13ms
$ node <scratchpad>/stepA/check.mjs     # built server, dp_test_* database, installed Chrome via Playwright
server url http://127.0.0.1:50741/?token=…
address bar after exchange: http://127.0.0.1:50741/
status: Database: up (dp_test_1794404498663_stepa)
history rows: 1
response body (Pretty): ["{","  \"ok\": true,","  \"items\": [","    1,","    2","  ]","}"]
workers: /assets/editor.worker-CRz__AKW.js
csp violations: []
console errors: []
cross-origin fetch: rejected: Failed to fetch
sends recorded in dp_test_1794404498663_stepa: 1
$ node <scratchpad>/stepA/check-dev.mjs  # the same with DP_DEV=1
status: Database: up (dp_test_1794404513834_stepadev)
history rows: 1
workers: /node_modules/monaco-editor/esm/vs/editor/editor.worker.js
csp violations: []
console errors: ["WebSocket connection to 'ws://127.0.0.1:24678/?token=…' failed: … ERR_CONNECTION_REFUSED", "[vite] failed to connect to websocket …", "pageerror: WebSocket closed without opened."]
cross-origin fetch: rejected: Failed to fetch
$ npm run typecheck
exit 0
$ npm run lint
All matched files use the correct format.
$ npm run test:unit
      Tests  370 passed (370)
$ npx vitest run --project integration src/server/http.int.test.ts
      Tests  27 passed (27)
```

Step A PASS — the built server serves the app in Chrome with the database up, records a send, renders the response in
Monaco with the editor worker, raises no CSP violation (zod's probe is gone) and no console error (the favicon `204`
holds, A9), and another origin's `fetch` fails. Phase 3 is not verified: `npm run test:e2e` (step B) and the author's
walkthrough have not run. Both test databases were dropped by the check scripts.

**Drift:**
- decision — the plan named `dist/server/main.js` → the build writes `dist/server/main.mjs`, because `package.json` has no
  `"type": "module"` and Node would read a `.js` ES module as CommonJS.
- decision — the plan put Vite's HMR websocket "on the same server, behind the `Host` and cookie checks" → HMR is off
  (`hmr: false, ws: false`), because a websocket arrives through Node's `upgrade` event, which `http.ts`'s request
  checks do not see. Consequence, observed: in `npm run dev` the Vite client still tries `ws://127.0.0.1:24678` and logs
  connection errors and one `pageerror`; pages reload by hand. Production (`npm start`, e2e) is unaffected. Vite's own
  websocket checks a token and the host; enabling HMR through them is a choice for the author.
- decision — `npm run dev` sets `DP_DEV=1` with POSIX syntax, so it runs on macOS and Linux shells, not `cmd.exe`.
- decision — the default port is 4380 (the plan said "a fixed default port").

**Routed (step B):** the e2e port is browser-level risk (T1.8, T2.7, T2.9, T2.10; `test-strategy.md`), which the plan
assigns to lz-e2e. Step B must also decide `smoke.spec.ts`'s title "the production build carries a
Content-Security-Policy meta tag": the meta tag is gone by design (ADR 0002, plan phase 3), so the title cannot stay
true. Run `/lz-e2e local-web-app`. Phase 3 is one commit with step B (plan, commit rule).

## Phase 3 — `npm start` opens Chrome on the app, everything that works in Electron today works there, and the whole e2e suite proves it in Chrome

- **Executor:** lz-e2e (step B)
- **Status:** blocked
- **Started:** 2026-11-11
- **Finished:** —

**Blocked on:** the author's walkthrough in plan phase 3 (`npm start` in the author's own Chrome; send, replay, edit,
curl, Pretty/Raw, a ≥17 MiB multipart upload deleted and replayed, saved request and environment switch, Docker
stopped, DevTools console and Issues panel clean, a cross-origin `fetch` refused, `npm run dev` beside `npm start` with
both tabs sending). Every other part of the phase's done-when is met below. Phase 3 and step A land in one commit
(plan, commit rule), not yet made.

**Gate.** No new browser-level risk was added beyond what `test-strategy.md` already assigns to e2e (T1.8, T2.7,
T2.9, T2.10); the existing scenarios were ported. One scenario is new: the CSP-violation recorder, because the console
does not report violations (`spike-browser-host.md`, surprise 1) and no lower layer runs the page.

**Changed (step B)**
- `playwright.config.ts` — `use: { channel: 'chrome' }`; comment rewritten for the server and Chrome.
- `e2e/support.ts` — `launchWithTestDatabase()` spawns `node dist/server/main.mjs` with `DP_PORT=0`,
  `DP_OPEN_BROWSER=0` and the `dp_test_*` env, reads the token URL from stdout, launches Chrome at 1100×800 (the
  Electron window size), and goes to it; `close` closes the browser, stops the server with `SIGTERM`, drops the
  database. `TestApp.app` is the `BrowserContext`; new `origin`. New helpers: `stubOperation` (`page.route` on
  `/api/<channel>`, input decoded, `real()` through `route.fetch()`, a thrown error answers `500` so the call rejects),
  `gate`, `callOperation` (a same-origin `fetch` from the page, decoded in Node), `settle` (waits for released stubbed
  answers, one `db-status` round trip, one frame), `recordCspViolations` (init script on `securitypolicyviolation`),
  `cspViolations`, `expectNoCspViolations`. `appWindow` and the DevTools handling removed.
- `e2e/open-call-failures.spec.ts`, `e2e/environments.spec.ts`, `e2e/saved-requests.spec.ts`,
  `e2e/multipart-edit-failures.spec.ts` — the 13 `ipcMain` handler swaps are `stubOperation` calls with the same hold /
  fail / reject behaviour; held answers wait on `gate()`; the wrapped-handler cases call `real()`; `window.pigeon` round
  trips are `callOperation` or `settle`. Comments that named main or the handler now name the server or the answer.
- `e2e/bodies.spec.ts` — `closeDocked` and its call removed; the `pigeon` round trips are `callOperation`.
- `e2e/body-safety.spec.ts` — "opens nothing" counts `app.pages()`; the round trip is `settle`; each scenario also
  asserts no CSP violation.
- `e2e/smoke.spec.ts` — the meta-tag test replaced by "the built UI is served with a Content-Security-Policy header"
  (header present, no `<meta>`); new "the CSP blocks an inline script, and the violation is recorded".

**Verification**

```
$ npm run test:e2e        # run 1, includes npm run build
Running 51 tests using 1 worker
  51 passed (41.6s)
$ npx playwright test     # run 2
  51 passed (39.8s)
$ npx playwright test     # run 3
  51 passed (40.9s)
$ npx playwright test --list   compared with titles-before.txt (50 tests in 12 files)
--- only before:
the production build carries a Content-Security-Policy meta tag
--- only after:
the built UI is served with a Content-Security-Policy header
the CSP blocks an inline script, and the violation is recorded
Total: 51 tests in 12 files
$ # break-it: src/renderer.tsx without `import './renderer/zod-jitless'`, rebuilt
$ npx playwright test e2e/body-safety.spec.ts
  ✘ 1–4 … holding markup shows as text, runs nothing and opens nothing
    +   "script-src blocked eval",
$ # restored, rebuilt
$ npx playwright test e2e/body-safety.spec.ts
  4 passed (2.3s)
$ grep -rn "_electron\|app\.evaluate\|ipcMain\|window\.pigeon" e2e/
(no output)
$ npm run typecheck
exit 0
$ npm run lint      # after removing a spread oxlint flagged in settle()
All matched files use the correct format.
$ npx playwright test e2e/open-call-failures.spec.ts e2e/saved-requests.spec.ts e2e/multipart-edit-failures.spec.ts
  16 passed (11.3s)       # the specs using settle(), after the lint fix
```

PASS for step B — the suite passes in Chrome three times, the injected inline script is caught, a real violation
(zod's probe) fails T1.8's scenarios, and no spec references Electron. That stubs intercept and holds work is shown by
scenarios that only pass when they do: "the database query fails" needs the stubbed failure, and "a change to the form
while Edit reads a stored body keeps the change" needs the held read to show `Loading the call into the form…`.

**Drift:**
- decision — the plan required every earlier title to remain → "the production build carries a Content-Security-Policy
  meta tag" is gone and replaced by a header test, because the meta tag is removed by design (ADR 0002, plan phase 3);
  51 titles against 50, one replaced, one added.
- decision — the stubbed rejection answers `500` with the message as the body; the UI receives a rejection carrying
  `pigeon:get-call: 500 server went away`, where IPC carried the message alone. The scenario asserts the error is shown,
  not its wording. The rejection text in "the call to main rejects" changed from `main went away` to `server went
  away`; the title is unchanged.
- decision — the browser context is 1100×800, the Electron window's outer size, so content is 1100×800 where Electron's
  content area was smaller by its title bar. No viewport assertion failed.

## Phase 3 — `npm start` opens Chrome on the app, everything that works in Electron today works there, and the whole e2e suite proves it in Chrome

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Changed:** nothing since the step B entry; committed as `5f9c1bd` on branch `local-web-app`.

**Verification**

```
Author's walkthrough (plan phase 3), reported by the author on 2026-11-11: "walkthrough done, all good"
```

PASS — the last open condition of phase 3's done-when. The walkthrough's individual steps were not recorded one by
one; the author reported the whole list as passing. The e2e evidence is in the step B entry above.

**Drift:** none

## Phase 4 — Electron is gone and the repository's rules, gates and strategy describe the server

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-11
- **Finished:** 2026-11-11

**Changed**
- Deleted `src/main.ts`, `src/preload.ts`, `forge.config.mts`, `vite.main.config.mts`, `vite.preload.config.mts`.
- Moved `src/main/ipc.ts` → `src/server/ipc.ts` and `src/main/ipc.int.test.ts` → `src/server/ipc.int.test.ts`
  (`git mv`); `src/server/http.ts` imports `./ipc`; the test passes its stand-in `as Registrar` instead of
  `as unknown as IpcMain` and no longer imports `electron`.
- `package.json` — removed `main`, the `package`, `make` and `release` scripts, `electron`, `electron-squirrel-startup`,
  the eight `@electron-forge/*` packages, `@electron/fuses`, `@types/electron-squirrel-startup`; added
  `@types/node@^22.20.5`. `package-lock.json` regenerated (`npm install`, `npm prune`).
- `src/declarations.d.ts` — the Forge type reference removed.
- Comments that named Electron now name the desktop build, the server or the browser: `src/core/db-config.ts`,
  `src/core/send.ts`, `src/server/ipc.ts`, `src/server/main.ts`, `src/renderer/api.ts`, `vitest.config.mts`,
  `e2e/support.ts`.
- `AGENTS.md` — the transition note and the Electron non-negotiable removed; the HTTP/storage rule names
  `src/server/`, `src/core/`, `src/renderer/api.ts`; the server rule names the checks in `src/server/http.ts` and adds
  "never add a route or a websocket that skips these checks"; the Checks table rewritten (`build`, `start`, `dev`, e2e in
  Chrome) and re-verified; notes on the CSP header, CSP violations and `jitless`, the config path, `stubOperation` and
  `settle`, `fsevents`, and `DP_DEV` under `cmd.exe`.
- `context/foundation/test-strategy.md` — revision line; tiers 9/12/10; new T1.9 (another origin or no token reaching an
  operation, integration, `src/server/http.int.test.ts`); T1.8, T2.1, T2.7, T2.10, T3.3, T3.10 rewritten for the browser,
  the HTTP boundary and `npm start`; the layer contract, the design-consequence paragraph and the type-system list
  rewritten; the Build gate is `npm run build`; the E2E gate names Chrome; the known gap on Electron's private
  `_invokeHandlers` replaced by the `stubOperation` note.

**Verification**

```
$ npm run typecheck
exit 0
$ npm run lint
All matched files use the correct format.
$ npm run test:unit
 Test Files  12 passed (12)
      Tests  370 passed (370)
$ npm run test:integration
 Test Files  13 passed (13)
      Tests  333 passed (333)
$ npm run test:e2e
  51 passed (41.2s)
$ grep -rni electron src e2e test-support package.json *.mts *.ts AGENTS.md
(no output)
$ npm ci
added 72 packages, and audited 73 packages in 2s
$ ls node_modules | grep -ci electron
0
$ DP_OPEN_BROWSER=0 npm start      # after npm ci
DigitalPigeon listening: http://127.0.0.1:4380/?token=…
$ curl -H 'Host: 127.0.0.1:4380' http://127.0.0.1:4380/
GET / without cookie: 403
$ npm run typecheck                # after npm ci
exit 0
$ DP_OPEN_BROWSER=0 npm run dev    # before the AGENTS.md rewrite, to verify its Checks table
DigitalPigeon listening: http://127.0.0.1:4380/?token=…
GET / without cookie: 403
```

PASS — all gates pass with Electron removed, the grep is empty, and a fresh `npm ci` builds and serves the app. The
server was started with `DP_OPEN_BROWSER=0`, so the Chrome launch itself was last exercised in the author's phase 3
walkthrough, not after `npm ci`.

**Drift:**
- decision — `@types/node` added as a direct dev dependency at `^22`: it had arrived only through Electron's tree
  (26.6.6), and removing Electron left `Buffer` and `node:*` untyped (`e2e/bodies.spec.ts` TS2591 errors). Major 22
  matches the runtime (v22.22.2), so types cannot promise APIs Node 22 lacks; the typecheck passes on it.
- decision — empty `node_modules/@electron*` scope folders left by `npm prune` were removed by hand.
- decision — `test-strategy.md` changes go beyond the plan's list (T1.9, T1.8, T2.1, E2E layer, Build gate): T2.7,
  T2.10, T3.3, T3.10 and the known gaps also named Electron, the renderer or `npm run package`, and were rewritten.
- Not committed. The author authorised commits for phases 1–3; phase 4 waits for the same.

## Review fixes — review.md F1, F2, F3 (fix now)

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-13
- **Finished:** 2026-11-13

Not a plan phase: the fix-now findings of `review.md` (2026-11-13). F4 and F5 are `accept` there and were not changed.

**Changed**
- F1 — `src/server/http.ts`: right after the `Host` check, a request carrying an `Origin` other than
  `http://127.0.0.1:<port>` is refused with `403` on every route (UI, scripts, favicon, token exchange, operations); an
  absent `Origin` stays allowed outside `/api/*`. Header comment updated. `src/server/http.int.test.ts`: 4 cases (UI,
  script, favicon with a valid cookie; the token exchange without one) with `Origin: http://evil.test` → `403` and no
  `Set-Cookie`; 1 case: a script with the server's own `Origin` is served. `AGENTS.md` server rule and
  `test-strategy.md` T1.9 (why and covered) state the rule for every route.
- F2 — `context/foundation/tech-stack.md`: the Shell row names Node.js 22 and `node:http` (frameworks rejected in this
  change's plan); the Build row names both Vite builds and `npm run build`; the "server must be running" row names
  `npm start`, `127.0.0.1:4380`, `DP_PORT`. `context/foundation/infrastructure.md`: the chosen distribution row names
  the built bundle, `npm start`, the port and `npm run dev`.
- F3 — this note: commit `0efb1be` ("phase 2") also contains the `devMiddleware` option of `src/server/http.ts`, written
  during phase 3 step A; `http.ts` was committed as it stood rather than split by hunk. The gates ran on the working
  tree at the end of each phase and on `c514005`; the commits `b9ada70` and `0efb1be` were not checked out and
  gate-checked on their own.

**Verification**

```
$ npx vitest run --project integration src/server/http.int.test.ts     # before the http.ts change
     × the UI with a foreign Origin → 403
     × a script with a foreign Origin → 403
     × the favicon with a foreign Origin → 403
     × the token exchange with a foreign Origin → 403
AssertionError: expected 200 to be 403 / expected 204 to be 403 / expected 303 to be 403
      Tests  4 failed | 28 passed (32)
$ npx vitest run --project integration src/server/http.int.test.ts     # after
      Tests  32 passed (32)
$ npm run typecheck
exit 0
$ npm run lint
All matched files use the correct format.
$ npm run test:unit
      Tests  370 passed (370)
$ npm run test:integration
 Test Files  13 passed (13)
      Tests  338 passed (338)
$ npm run test:e2e
  51 passed (42.0s)
$ grep -n "slice 5b's plan" context/foundation/*.md
(no output)
```

PASS — every route refuses a foreign `Origin` (the four cases failed first, for the reason the review gave), the app
still runs in Chrome under the rule (51 e2e), and no foundation document defers to the plan.

**Drift:** none — the fixes are the ones `review.md` names, with its stated shape for F1.

## Code-review fixes — /code-review findings 3, 5, 8, 9, 10 (fix now)

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-20
- **Finished:** 2026-11-20

Not a plan phase. `/code-review main...local-web-app` (2026-11-20) reported 10 findings without verifying them. Five are
fixed here. Findings 1, 2, 4, 6 and 7 are open for the author and recorded in `review.md`, under Host code review.

**Changed**
- Finding 3: in `src/server/http.ts`, `createServer` rejects when `listen` fails, instead of the error escaping as an
  unhandled `'error'` event. In `src/server/main.ts`, `EADDRINUSE` prints
  `Port <n> is in use. Is DigitalPigeon already running? Set DP_PORT to use another port.` and exits 1.
- Finding 5: in `src/server/http.ts`, the cookie check accepts the request when any cookie named `dp_<port>` holds the
  token. A cookie of that name planted by another 127.0.0.1 port, which Chrome sends first, no longer locks the UI out.
- Finding 8: in `src/shared/wire-codec.ts`, the replacer returns the value after `toJSON` for anything that is not
  bytes, a date or an escaped object. A `URL` or a driver id travels as its JSON form.
- Finding 9: `src/server/http.ts` uses the `message` helper that `src/server/ipc.ts` now exports.
- Finding 10: the `/api/*` Origin check is written as `origin === undefined`, since a foreign Origin has already been
  refused above it.
- Tests, each seen failing first:
  - `wire-codec.test.ts`: an object with its own `toJSON`;
  - `http.int.test.ts`: a planted cookie before the real one gets 200, and a port in use rejects `createServer`.

**Verification**

```
$ npx vitest run --project unit src/shared/wire-codec.test.ts           # before
     × an object with its own toJSON travels as that JSON form
      Tests  1 failed | 13 passed (14)
$ npx vitest run --project integration src/server/http.int.test.ts      # before
     × a cookie planted under the same name before the real one does not lock the UI out
AssertionError: expected 403 to be 200
     × a port already in use rejects createServer instead of crashing the process
Error: Test timed out in 5000ms.   Unhandled: listen EADDRINUSE: address already in use
      Tests  2 failed | 32 passed (34)
$ (after) wire-codec.test.ts  Tests  14 passed (14)
$ (after) http.int.test.ts    Tests  34 passed (34)
$ npm run typecheck
exit 0
$ npm run lint
All matched files use the correct format.
$ npm run test:unit
      Tests  371 passed (371)
$ npm run test:integration
 Test Files  1 failed | 12 passed (13)
      Tests  1 failed | 339 passed (340)
  × src/core/curl.int.test.ts > a command at the limit sends — Test timed out in 5000ms
$ git stash; npx vitest run --project integration src/core/curl.int.test.ts -t "at the limit"   # without these changes, twice
      Tests  1 failed | 74 skipped (75)
$ npm run test:e2e
  51 passed (1.2m)
$ DP_PORT=4399 node dist/server/main.mjs     # with 4399 held by another listener
exit 1
Port 4399 is in use. Is DigitalPigeon already running? Set DP_PORT to use another port.
```

PASS, with one exception. `src/core/curl.int.test.ts` "a command at the limit sends" times out at 5 s with or without
these changes. It passed on 2026-11-13 (338 of 338). The test runs a real shell `curl` with a maximum-length command, and
this machine's load average was 3.9–6.5. No `src/core/` file changed in this entry, and the timeout is not diagnosed
here.

**Drift:** none. These are not plan phases; each fix is the one its finding names.

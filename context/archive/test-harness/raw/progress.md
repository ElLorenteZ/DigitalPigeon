---
change_id: test-harness
produced-by: lz-build
plan: plan.md
updated: 2026-11-02
---

# Progress: Install the unit, integration and e2e test harness from the test strategy

## Phase 1 — `npm run test:unit` runs unit tests and proves the test-database name guard

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-02
- **Finished:** 2026-11-02

**Changed**
- `package.json` / `package-lock.json` — `vitest` 5.0.5 added as a devDependency; script
  `test:unit` = `vitest run --project unit`.
- `vitest.config.mts` — new. Project `unit`, Node environment, includes `src/**/*.test.ts` and
  `test-support/**/*.test.ts`, excludes `**/*.int.test.ts`.
- `tsconfig.json` — `include` gains `test-support/**/*` and `e2e/**/*`.
- `test-support/test-db-name.ts` — new. `TEST_DB_PREFIX`, `testDbName()` (`dp_test_<epoch-ms>_<8
  hex>`), `assertTestDbName()` (throws unless the name starts with `dp_test_` and has characters
  after it).
- `test-support/test-db-name.test.ts` — new. 14 tests: prefix and shape of generated names,
  uniqueness over 100 calls, generated names pass the guard, the guard refuses ten names
  (`digital_pigeon`, `digital-pigeon`, `admin`, `local`, `config`, empty, `xdp_test_1`,
  `DP_TEST_1`, `dp_test`, `dp_test_`) and accepts a prefixed name.

**Cycles**
1. Test written first. The first run failed on the missing module (`./test-db-name`), which is not
   the behaviour, so a stub exporting no-op functions was added. Re-run: 11 failed on assertions
   (`expected '' to match /^dp_test_\d+_[a-z0-9]+$/`, `expected [Function] to throw an error`),
   2 passed (the two "accepts" cases, which a no-op guard satisfies). Minimal implementation: 13
   passed.
2. The bare-prefix branch (`name.length === TEST_DB_PREFIX.length`) had been written without a test
   asking for it. Branch removed and case `dp_test_` added: 1 failed (`refuses "dp_test_"`). Branch
   restored: 14 passed.
3. Refactor: the random suffix moved from `Math.random().toString(36).slice(2, 10)` (variable
   length, can be empty) to `randomBytes(4).toString('hex')`. No test edited; 14 passed.

**Verification**

```
$ npm run test:unit
 Test Files  1 passed (1)
      Tests  14 passed (14)
test:unit exit 0
$ npm run typecheck && npm run lint
typecheck exit 0
All matched files use the correct format.
lint exit 0
$ npx vitest list --project unit   (files only)
[unit] test-support/test-db-name.test.ts
```

PASS — the unit command runs only `*.test.ts` files, and the guard demonstrably fails the suite
when its prefix check is weakened (cycles 1 and 2).

**Drift:** decision — the plan lists installing Vitest as part of phase 1 but the TDD loop needs a
runnable command before the first red; the install, config and script were done as setup before
cycle 1, with no test of their own. `npm install` reported the same blocked install scripts as the
scaffold (`fsevents`, `electron-winstaller`); no effect on the unit run.

## Phase 2 — `npm run test:integration` runs against a throwaway database on the Compose MongoDB and leaves nothing behind

- **Executor:** lz-tdd → routed to lz-build
- **Status:** in-progress

**Routed:** wiring to an external process (global setup, `.env` loading, driver connection, URI
hand-off). The plan assigns it to lz-build; a test-first loop here would assert the driver's
behaviour. Run `/lz-build test-harness` to execute it. Phase 3 (lz-tdd) runs inside the integration
project this phase creates, so it resumes with `/lz-tdd test-harness` after phase 2 is done.

## Phase 2 — `npm run test:integration` runs against a throwaway database on the Compose MongoDB and leaves nothing behind

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-02
- **Finished:** 2026-11-02

**Changed**
- `package.json` / `package-lock.json` — `mongodb` 7.8.0 added to `dependencies`; script
  `test:integration` = `vitest run --project integration`.
- `vitest.config.mts` — project `integration`, Node environment, includes `src/**/*.int.test.ts`
  and `test-support/**/*.int.test.ts`, `globalSetup: ['test-support/mongo-global-setup.ts']`.
- `test-support/mongo-global-setup.ts` — new. Loads `.env` (`process.loadEnvFile`), builds the URI
  for `127.0.0.1:27017` with `authSource=admin`, pings with `serverSelectionTimeoutMS: 10_000`,
  fails the run with an instruction when `.env` or MongoDB is missing, drops every `dp_test_*`
  database through `assertTestDbName`, and passes the URI with `project.provide('mongoUri', uri)`.
  `ProvidedContext` is augmented so `inject('mongoUri')` is typed.
- `test-support/test-db.ts` — new. `openTestDb()` reads `inject('mongoUri')`, opens a client and a
  database named by `testDbName()`, and returns `drop()`, which asserts the prefix, drops the
  database and closes the client.
- `test-support/test-db.int.test.ts` — new. The database name carries the prefix; a document
  inserted reads back unchanged.

**Verification**

```
$ docker compose up -d && npm run test:integration
 Container digitalpigeon-mongo-1  Running
 Test Files  1 passed (1)
      Tests  2 passed (2)
exit 0
$ docker compose exec -T mongo sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" \
    -p "$MONGO_INITDB_ROOT_PASSWORD" --eval "…filter(n=>n.startsWith(\"dp_test_\"))"'
[]
$ docker compose stop mongo && npm run test:integration; docker compose start mongo
 Container digitalpigeon-mongo-1  Stopped
exit 1
[integration setup] MongoDB is not reachable on 127.0.0.1:27017. Start it with `docker compose up -d` and check the credentials in .env. (MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017)
 Container digitalpigeon-mongo-1  Started
$ npx vitest list --project unit   (files only)
[unit] test-support/test-db-name.test.ts
```

Additional check (sweep): seeded `dp_test_0_leftover` and `dp_keep_me`, ran
`npm run test:integration` (exit 0). Databases before: `admin, config, dp_keep_me,
dp_test_0_leftover, local`; after: `admin, config, dp_keep_me, local`. `dp_keep_me` was then
dropped by hand.

PASS — integration runs against a throwaway database, leaves no `dp_test_*` database behind, drops
only prefixed leftovers, and fails with the instruction when MongoDB is down. `npm run typecheck`
and `npm run lint` exit 0.

**Drift:** decision — the plan said global setup "throws a message naming `docker compose up -d`".
With Vitest 5.0.5 and Vite 8.3.5, any error thrown from a global setup file is reported as
`TypeError: code.charCodeAt is not a function` (from Vite's `extractInlineSourceMap`), and the
message is never shown. Reproduced with a bare `throw new Error('PROBE-MESSAGE')` in a throwaway
project inside the repo (`.gs-probe/`, deleted afterwards). Workaround: a `fail()` helper writes
the message to stderr prefixed `[integration setup]`, then throws. The driver error is folded into
the message text rather than attached as `{ cause }`. Revisit when Vitest or Vite is upgraded.

## Phase 3 — A capture server records method, URL, raw header order and case, and body bytes of a request

- **Executor:** lz-build → routed to lz-tdd
- **Status:** in-progress

**Routed:** the capture server's behaviour (header order and case, exact body bytes, configured
response) is specifiable as cases before the helper exists, which is lz-tdd's discipline; the plan
assigns it there. Run `/lz-tdd test-harness` to execute it.

## Phase 4 — `npm run test:e2e` builds the app and drives its window through Playwright

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-02
- **Finished:** 2026-11-02

**Changed**
- `package.json` / `package-lock.json` — `@playwright/test` 1.64.1 added as a devDependency;
  script `test:e2e` = `npm run package && playwright test`. No `playwright install`.
- `playwright.config.ts` — new. `testDir: 'e2e'`, `workers: 1`, `timeout: 60_000`, no browser
  projects.
- `e2e/smoke.spec.ts` — new. `_electron.launch({ args: ['.'] })`; selects the window whose URL ends
  with `main_window/index.html`; asserts `#root h1` reads `DigitalPigeon` and that exactly one
  `Content-Security-Policy` meta tag exists with `script-src 'self'`.
- `.gitignore` — `test-results/` and `playwright-report/` added.

**Verification**

```
$ rm -rf .vite && npm run test:e2e
✔ Packaging application
  ✓  1 e2e/smoke.spec.ts:32:5 › the app window renders the React root (322ms)
  ✓  2 e2e/smoke.spec.ts:37:5 › the production build carries a Content-Security-Policy meta tag (8ms)
  2 passed (1.0s)
exit 0
$ # CSP plugin removed from vite.renderer.config.mts (plugins: [react()]), then:
$ npm run test:e2e
  ✓  1 e2e/smoke.spec.ts:32:5 › the app window renders the React root (355ms)
  ✘  2 e2e/smoke.spec.ts:37:5 › the production build carries a Content-Security-Policy meta tag (5.0s)
    Error: expect(locator).toHaveCount(expected) failed
  1 failed
exit 1
$ # config restored (plugins: [react(), cspOnBuild()]), then:
$ npm run test:e2e
  2 passed (1.3s)
exit 0
$ npm run typecheck && npm run lint
typecheck exit 0
lint exit 0
```

PASS — e2e builds the production output, launches it through Playwright, and detects a missing
CSP. A2 (Playwright `_electron` launching Electron 45.2.1 from `node_modules` with `args: ['.']`)
is now verified. `test:unit` and `test:integration` still exit 0 after this phase.

**Drift:** decision — the plan's verification expected "1 test passes"; the smoke spec has two tests
(window renders; CSP meta tag present) so a CSP failure is reported separately from a launch
failure. Phase 4 was executed before phase 3 because it does not depend on it and phase 3 is routed
to lz-tdd; phase numbering is unchanged.

## Phase 3 — A capture server records method, URL, raw header order and case, and body bytes of a request

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-02
- **Finished:** 2026-11-02

**Changed**
- `test-support/capture-server.ts` — new. `startCaptureServer()` listens on `127.0.0.1`, port 0;
  returns `url`, `requests` (each `{ method, url, rawHeaders, body: Buffer }`, with `rawHeaders`
  copied from `req.rawHeaders`), `respondWith({ status, headers?, body? })` (default 200, empty
  body) and `close()`.
- `test-support/capture-server.int.test.ts` — new. 7 tests, sending with `node:http.request` and
  `setHeader` so order and case are controlled: loopback address with an assigned port; method and
  path with query (`PATCH /orders/12?expand=items&x=%20y`); header names `X-Zeta`, `a-Alpha`,
  `Content-Type` in that order and case; body bytes `00 ff fe 80 7f c3 28 0a` equal; two requests
  recorded in order; configured response (201, `X-Served-By`, JSON body) received; connection
  refused after `close()`.

**Cycles**
1. Tests written first, against a stub that listened and answered 200 but recorded nothing.
   5 failed on assertions (`expected [] to have a length of 1 but got +0`, `expected [] to deeply
   equal [ 'X-Zeta', 'a-Alpha', 'Content-Type' ]`, `expected undefined to be true`, `expected [] to
   deeply equal [ '/first', '/second' ]`, `expected 200 to be 201`). 2 passed against the stub —
   the loopback/port test and the close test — because the stub's listen and close scaffolding
   already satisfied them; these two were not seen red.
2. Minimal implementation: 7 passed. `close()` had also been given `server.closeAllConnections()`
   without a test requiring it; removed, 7 still passed (Node 22 `server.close()` closes idle
   keep-alive sockets), so it stays out.
3. Done-when checks (mutations, each reverted): recording `req.headers` instead of `req.rawHeaders`
   → 1 failed, `expected [ 'x-zeta', 'a-alpha', 'content-type' ] to deeply equal [ 'X-Zeta',
   'a-Alpha', 'Content-Type' ]`; reversing the header pairs → 1 failed, `expected [ 'Content-Type',
   'a-Alpha', 'X-Zeta' ] to deeply equal [ 'X-Zeta', 'a-Alpha', 'Content-Type' ]`.

**Verification**

```
$ npm run test:integration
 Test Files  2 passed (2)
      Tests  9 passed (9)
exit 0
$ npm run typecheck && npm run lint && npm run test:unit
typecheck exit 0
lint exit 0
test:unit exit 0
```

PASS — the capture server preserves method, path and query, header order and case, and exact body
bytes, serves a configured response, and the header test detects both a case and an order loss.

**Drift:** none

## Phase 3 — A capture server records method, URL, raw header order and case, and body bytes of a request

- **Executor:** lz-tdd (aborted request), lz-build (listen error)
- **Status:** done
- **Started:** 2026-11-02
- **Finished:** 2026-11-02

Follow-up to host code review findings #5 and #7 (`review.md`, Host code review). The earlier
Phase 3 section stands; this section records the additions.

**Changed**
- `test-support/capture-server.ts` — `CapturedRequest.complete` added; a request whose connection
  closes before `end` is recorded with the bytes received and `complete: false`; `req` errors are
  handled; `bytesReceived()` added (total body bytes received), so a test can wait for bytes to
  arrive before aborting; the listen promise rejects on a server `error`.
- `test-support/capture-server.int.test.ts` — 2 tests: an aborted mid-body request is recorded,
  incomplete, with exactly the bytes sent; a full request is marked complete.

**Cycles**
1. First run failed on `TypeError: server.received is not a function` (missing API, not the
   behaviour). Stub added (`bytesReceived: () => 0`, `complete: true`). Re-run: `expected 0 to be
   greater than or equal to 11` for the aborted test; the completeness test had failed in the first
   run with `expected undefined to be true`. A hook timeout followed, because the failing test never
   destroyed its request.
2. Implementation: 9 passed. The aborted test ran 10 times in a row: 10 passed.
3. Listen error (no test seam; host is fixed): host temporarily set to `256.0.0.1`. Before the fix:
   `Error: Hook timed out in 10000ms` plus an unhandled `getaddrinfo ENOTFOUND 256.0.0.1`. After the
   fix: the test fails in 208 ms with `Error: getaddrinfo ENOTFOUND 256.0.0.1` and no unhandled
   error. Host restored to `127.0.0.1`.

**Verification**

```
$ npm run test:integration
      Tests  11 passed (11)
$ npm run typecheck && npm run lint && npm run test:unit
typecheck 0
lint 0
      Tests  14 passed (14)
```

PASS — aborted requests are recorded with what reached the wire, and a listen failure rejects
instead of hanging.

**Drift:** decision — `bytesReceived()` is new public surface on the helper, not in the plan; it is
the only way a test can know bytes reached the server before aborting without a sleep.

## Phase 4 — `npm run test:e2e` builds the app and drives its window through Playwright

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-02
- **Finished:** 2026-11-02

Follow-up to host code review finding #4. The earlier Phase 4 section stands.

**Changed**
- `e2e/smoke.spec.ts` — `appWindow()` polls `app.windows()` (`expect.poll`, 30 s) for a window whose
  URL ends with `main_window/index.html`, instead of a one-shot `waitForEvent('window')` predicate
  that a window created at `about:blank` would fail.

**Verification**

```
$ npm run test:e2e
  ✓  1 e2e/smoke.spec.ts:39:5 › the app window renders the React root (458ms)
  ✓  2 e2e/smoke.spec.ts:44:5 › the production build carries a Content-Security-Policy meta tag (5ms)
  2 passed (1.7s)
$ npx playwright test   (x5, same build)
.....
$ # predicate pointed at main_window/missing.html, then restored:
$ npx playwright test
  ✘  1 … renders the React root (29.9s)
    Error: an Electron window showing main_window/index.html
```

PASS — the window is found by polling, and a missing window fails with a named message instead of
hanging to the test timeout.

**Drift:** none

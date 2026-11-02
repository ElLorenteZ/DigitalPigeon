---
change_id: test-harness
status: draft
produced-by: lz-plan
created: 2026-11-02
updated: 2026-11-02
inputs: [change.md, foundation/test-strategy.md, foundation/tech-stack.md, scaffold-verification.md]
---

# Plan: Install the unit, integration and e2e test harness from the test strategy

## Approach

One Vitest configuration with two projects selected by file suffix, and Playwright for e2e. Unit
tests are `*.test.ts` and integration tests `*.int.test.ts`, colocated with the code they test in
`src/`. Harness helpers live in `test-support/` and are tested by the same two projects. E2e specs
live in `e2e/` at the repo root, because they exercise the whole app rather than one module (author
decision, this session). Each layer is proven by a smoke test of its own helper, so the smoke tests
check something real instead of `1 + 1`.

The integration project's global setup loads `.env`, connects to the Compose MongoDB with a short
server-selection timeout, and fails the run with an instruction (`docker compose up -d`) when the
database is unreachable. Integration tests block tier 1, so a skipped suite would read as a pass.
Each test file gets its own database named `dp_test_<time>_<random>`, dropped afterwards. The drop
path refuses any name without the `dp_test_` prefix, which is the guard that keeps the history
database out of reach. Global setup also drops leftover `dp_test_*` databases from crashed runs.
Global setup hands the connection URI to test files through Vitest's `provide`, and they read it
with `inject`. Nothing relies on worker processes inheriting the environment that global setup
loaded.

E2e launches the Electron binary from `node_modules` with the repo root as the app directory
(`args: ['.']`). `package.json` `main` points at `.vite/build/main.cjs`, the production Vite output
that `npm run package` writes. Launching the root rather than the file keeps the app name and
`userData` location those of DigitalPigeon rather than "Electron". The e2e target is this build
output, not the packaged `.app`. This departs from
`test-strategy.md` ("against the packaged build"). The strategy's reason (the CSP exists only in
production builds) still holds, because that build output is what the `.app` contains. Only the
fuses and asar packaging differ. The packaged app disables `EnableNodeCliInspectArguments`
(`forge.config.mts:52`), which is expected to block Playwright from attaching (author decision, this
session). `npm run test:e2e` runs `npm run package` first, so it never tests a stale build (author
decision, this session).

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Top-level `tests/{unit,integration,e2e}` mirroring `src/` | Author chose colocation. Separating by directory puts tests far from their code and duplicates the `src/` tree. |
| `mongodb-memory-server` for integration | Author chose the Compose container (test strategy). The in-process binary can drift from the pinned `mongo:8.0.34` image. |
| Skipping integration tests when Docker is down | Integration tests gate tier 1. A skipped run looks green and hides the risk the gate exists for. |
| Raw `net` socket capture server (exact wire bytes, including chunk framing) | It would need a hand-written HTTP parser. `node:http` with `req.rawHeaders` keeps header order and case, and the body as bytes. That is what T1.2–T1.4 compare. Chunk framing is visible as the `transfer-encoding` header. |
| E2e against the packaged `.app` with a test-only fuse configuration | It is a second Forge config to maintain, and the shipped fuses still go untested. Rejected by the author this session. |
| `test:e2e` reusing the existing build | Can silently test out-of-date code. Rejected by the author this session. |

## Out of scope

- A combined `npm test` script. The test strategy names three separate gates and none combines them.
- CSP, hardening or XSS assertions in the e2e smoke test beyond "the CSP meta tag is present". T1.8
  belongs to the first change that renders a response body.
- GridFS, large-body or HTTP-client (`undici`) code. The smoke tests use only the driver and
  `node:http`.
- Changing `src/main.ts`, for example to suppress DevTools during e2e. The smoke test selects the app
  window by URL instead.
- Parallel-run isolation across separate `vitest` invocations. Single developer. See Risks.
- Pointing the app at a test database during e2e. The app has no database code yet, so the smoke
  test writes nothing. **Constraint for the first feature change that adds database access:** the
  app reads its database name from the environment, and e2e sets a `dp_test_` name. Without this,
  T2.7 (send → history → replay) would write into the real history database.
- Updating the "against the packaged build" wording in `test-strategy.md`. Its producer,
  `/lz-test-strategy`, updates it after this change verifies the build-output target.
- Fixing the backup command comment in `docker-compose.yml`. It reads credentials from the host
  shell, which has no `.env` loaded, so it fails authentication in the same way as the original
  phase 2 check. It is a separate fix.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | A Vitest release supports Vite 8 and TypeScript 6. | Phases 1–3 cannot install. **Verified 2026-11-02:** `vitest@5.0.5` peer `vite ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0`. | yes — verified |
| A2 | Playwright `_electron.launch` (`@playwright/test` 1.64.x) can start Electron 45.2.1 from `node_modules` with `args: ['.']` (resolving to `.vite/build/main.cjs`) and return the app window. | Phase 4 needs a different launch method. Phases 1–3 are unaffected. | yes — **unverified** |
| A3 | `npm run package` leaves the production build in `.vite/build/main.cjs` and `.vite/renderer/main_window/index.html`, with the CSP meta tag. | Phase 4 launches the wrong output. Verified in `context/scaffold-verification.md` (Checks, Build). | yes — verified |
| A4 | The `.env` root user can create and drop databases. | Phase 2 fails. Verified indirectly in the scaffold log: authenticated `listDatabases` returns `ok=1` as root. | yes — verified |
| A5 | Node 22 `process.loadEnvFile` reads `.env`, so no `dotenv` dependency is needed. | Add `dotenv` in phase 2. Node v22.22.2 was confirmed in this session. | no |
| A6 | The fuses block Playwright from attaching to the packaged `.app`. | E2e could target the `.app` after all. The approach still works either way. Unverified, from model recall. | no |
| A7 | DevTools opening when `app.isPackaged` is false (`src/main.ts:35`) does not prevent selecting the app window. | The smoke test needs a different window selector. | no |

A2 is the only unverified load-bearing assumption. A spike is not proposed: phase 4 is the last
phase, touches no file the other phases use, and is itself the smallest test of A2. If A2 fails, only
phase 4 is replanned.

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | `npm run test:unit` runs unit tests and proves the test-database name guard | `package.json`, `vitest.config.mts`, `tsconfig.json`, `test-support/test-db-name.ts`, `test-support/test-db-name.test.ts` | lz-tdd | `npm run test:unit` passes; `npm run typecheck` and `npm run lint` pass |
| 2 | `npm run test:integration` runs against a throwaway database on the Compose MongoDB and leaves nothing behind | `package.json` (`mongodb` dependency, script), `vitest.config.mts`, `test-support/mongo-global-setup.ts`, `test-support/test-db.ts`, `test-support/test-db.int.test.ts` | lz-build | Integration passes with Docker up; no `dp_test_*` database remains afterwards; with Mongo stopped it fails with the instruction |
| 3 | A capture server records method, URL, raw header order and case, and body bytes of a request | `test-support/capture-server.ts`, `test-support/capture-server.int.test.ts` | lz-tdd | `npm run test:integration` passes, including the capture tests |
| 4 | `npm run test:e2e` builds the app and drives its window through Playwright | `package.json` (`@playwright/test`, script), `playwright.config.ts`, `e2e/smoke.spec.ts`, `tsconfig.json`, `.gitignore` | lz-build | `npm run test:e2e` passes; the spec sees the app window and the CSP meta tag |

### Phase 1 — `npm run test:unit` runs unit tests and proves the test-database name guard

**Changes:**
- `package.json`: add `vitest` (5.x) as a devDependency. Add script
  `"test:unit": "vitest run --project unit"`.
- `vitest.config.mts`: new. Project `unit`, Node environment, includes `src/**/*.test.ts` and
  `test-support/**/*.test.ts`, excludes `**/*.int.test.ts`. No globals: tests import from `vitest`.
- `tsconfig.json`: add `test-support/**/*` and `e2e/**/*` to `include` (currently `src/**/*`,
  `*.ts`, `*.mts`, `tsconfig.json:15`), so `npm run typecheck` covers the harness.
- `test-support/test-db-name.ts`: pure functions. One generates `dp_test_<epoch-ms>_<random>`.
  One asserts a name carries the `dp_test_` prefix and throws otherwise.
- `test-support/test-db-name.test.ts`: generated names carry the prefix and are unique across calls;
  the assertion throws for names without the prefix (for example `digital_pigeon`, `admin`, empty,
  `xdp_test_1`).

**Verification:**
```
$ npm run test:unit
expected: 1 file, all tests pass, exit 0
$ npm run typecheck && npm run lint
expected: exit 0
```

**Done when:** `npm run test:unit` exits 0 and runs no `*.int.test.ts` file. Breaking the prefix
check (for example accepting any name) makes it exit non-zero.

**Executor:** lz-tdd — pure logic with clear cases, specifiable before the code.

### Phase 2 — `npm run test:integration` runs against a throwaway database and leaves nothing behind

**Changes:**
- `package.json`: add `mongodb` (current major, 7.x) as a **dependency**, because the main process
  will use it (`tech-stack.md`, Storage). Add script
  `"test:integration": "vitest run --project integration"`.
- `vitest.config.mts`: project `integration`, Node environment, includes `src/**/*.int.test.ts`
  and `test-support/**/*.int.test.ts`, `globalSetup: test-support/mongo-global-setup.ts`.
- `test-support/mongo-global-setup.ts`: load `.env` with `process.loadEnvFile`. Build the URI for
  `127.0.0.1:27017` from `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD`. Ping with a server-selection
  timeout of about 10 s, which covers the first-start `mongod` restart. On failure, throw a message
  naming `docker compose up -d` and `.env`. Drop every existing `dp_test_*` database. Pass the URI
  to test files with `provide('mongoUri', uri)`, declaring the key's type through Vitest's
  `ProvidedContext` so `inject` is typed.
- `test-support/test-db.ts`: for a test file, read the URI with `inject('mongoUri')`, then create a
  client and a database with a generated name
  (phase 1), and expose a teardown that drops it through the phase 1 prefix assertion.
- `test-support/test-db.int.test.ts`: insert a document, read it back, and assert the database name
  carries the prefix.

**Verification:**
```
$ docker compose up -d && npm run test:integration
expected: exit 0
$ docker compose exec -T mongo sh -c 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" \
    -p "$MONGO_INITDB_ROOT_PASSWORD" --eval "db.adminCommand({listDatabases:1}).databases.map(d=>d.name).filter(n=>n.startsWith(\"dp_test_\"))"'
expected: []
$ docker compose stop mongo && npm run test:integration; docker compose start mongo
expected: non-zero exit; output names `docker compose up -d`
```

The second command reads credentials from the container's environment. The host shell has no `.env`
loaded, so `-u "$MONGO_ROOT_USER"` on the host fails with "Command listDatabases requires
authentication" (observed in plan review, 2026-11-02).

**Done when:** all three observations hold, and `npm run test:unit` still runs no integration file.

**Executor:** lz-build — wiring to an external process; a test-first loop adds no safety over the
smoke test itself.

### Phase 3 — A capture server records the request as received

**Changes:**
- `test-support/capture-server.ts`: starts a `node:http` server on `127.0.0.1` with port 0, and
  exposes its base URL. For each request, records method, URL (path and query), `req.rawHeaders`
  (order and case preserved) and the body as a `Buffer`. Responds with a configurable status,
  headers and body, so later tests can serve fixed responses. Closes on teardown.
- `test-support/capture-server.int.test.ts`: a request sent with `node:http.request`, carrying
  mixed-case headers in a set order and a binary body (including non-UTF-8 bytes), is captured with
  the same order, case and exact bytes. The configured response is what the client receives.

**Verification:**
```
$ npm run test:integration
expected: exit 0; capture-server tests listed and passing
```

**Done when:** the capture test passes, and fails when header order is not preserved (for example
when the server records `req.headers` instead of `req.rawHeaders`).

**Executor:** lz-tdd — the behaviour is specifiable as cases before the helper exists.

### Phase 4 — `npm run test:e2e` builds the app and drives its window

**Changes:**
- `package.json`: add `@playwright/test` (1.64.x) as a devDependency. Add script
  `"test:e2e": "npm run package && playwright test"`. No `playwright install`: Electron does not need
  Playwright's browsers.
- `playwright.config.ts`: `testDir: 'e2e'`, one worker, no browser projects.
- `e2e/smoke.spec.ts`: `_electron.launch` with the Electron binary from `node_modules` and
  `args: ['.']`, so `package.json` `main` (`.vite/build/main.cjs`) is the entry point. Select the window whose URL ends with `main_window/index.html` (A7).
  Assert the React root renders and a `Content-Security-Policy` meta tag is present. Close the app.
- `.gitignore`: add `test-results/` and `playwright-report/`.

**Verification:**
```
$ npm run test:e2e
expected: package step succeeds; 1 test passes; exit 0
$ npm run typecheck && npm run lint
expected: exit 0
```

**Done when:** `npm run test:e2e` exits 0 from a clean `.vite/` (`rm -rf .vite` first), and removing
the CSP plugin from `vite.renderer.config.mts` makes the spec fail.

**Executor:** lz-build — launch wiring and configuration. lz-e2e owns risk scenarios such as T1.8
and T2.7, which this change does not write.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| Playwright cannot attach to Electron 45 launched from `node_modules` (A2) | low | Phase 4 replanned | Phase 4 is last and isolated |
| Global setup's sweep drops a database belonging to a concurrent `vitest` run | low (single developer) | That run fails | Accepted; recorded in Out of scope |
| A bug in the test database helper drops the history database | low | Irreversible history loss | Every drop goes through the prefix assertion, which is unit-tested in phase 1 |
| `npm run package` makes `test:e2e` slow (about 20–30 s plus packaging) | high | Slower feedback | Accepted by the author in exchange for never testing a stale build |
| oxfmt or oxlint rejects new config file formats | medium | Lint fails | Each phase verifies `npm run lint` |

## For the reviewer

- **Weakest link:** phase 4's launch path (A2), and the decision to depart from the test strategy's
  "packaged build" wording (updated by `/lz-test-strategy` afterwards; see Out of scope). Check that testing `.vite/build` output still serves T1.8's need for the
  production CSP.
- Phase 2's sweep drops `dp_test_*` databases unconditionally at global setup. Check whether "older
  than the current run" should be the rule instead.
- `mongodb` is added as a runtime dependency by a test-harness change. `tech-stack.md` deferred it to
  "the change that first uses it", and this is that change. Check that the placement is acceptable.

## References

- Plan review, 2026-11-02 (verdict REVISE): host-shell mongosh credentials, URI hand-off, launch
  `args`, e2e database isolation, strategy wording owner. All five addressed in this revision.

- `forge.config.mts:52` — `EnableNodeCliInspectArguments: false` on the packaged app
- `src/main.ts:35` — DevTools opens when `app.isPackaged` is false
- `tsconfig.json:15` — `include` covers `src/**/*`, `*.ts`, `*.mts` only
- `vite.renderer.config.mts:11` — CSP plugin applies to `build` only
- `context/scaffold-verification.md` — the build output location and CSP presence; Mongo root
  authentication
- `context/foundation/test-strategy.md` — Layer contract, Quality gates, Known gaps

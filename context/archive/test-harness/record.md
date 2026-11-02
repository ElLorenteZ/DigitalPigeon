---
change_id: test-harness
title: Install the unit, integration and e2e test harness from the test strategy
produced-by: lz-archive
outcome: shipped
closed: 2026-11-02
archived: 2026-11-02
commits: [f8e94d9, c7d19e5, bcf7f10, b3be480]
branch: test-harness (not merged at archive time)
---

# Record: test harness

## 1. What was built

Three test gates where none existed: `npm run test:unit` (Vitest, `*.test.ts`),
`npm run test:integration` (Vitest, `*.int.test.ts`, real MongoDB from Compose) and
`npm run test:e2e` (Playwright driving Electron). Helpers in `test-support/`:
`openTestDb()` gives each integration test file a throwaway `dp_test_*` database;
`assertTestDbName()` is the only path to dropping a database; `startCaptureServer()` records
requests as received on the wire (method, path and query, raw header order and case, exact body
bytes, and aborted requests marked `complete: false`). Each layer is proven by tests of its own
helper only. No product risk (T1/T2 in `test-strategy.md`) is covered yet, because no feature
exists.

**Differs from the plan:**
- Global setup cannot report failures by throwing. Vitest 5.0.5 with Vite 8.3.5 hides them (see §4),
  so setup prints `[integration setup] …` to stderr and then throws.
- The e2e smoke spec has two tests (the window renders, and the CSP is present), not one.
- After host code review, the capture server gained `complete` and `bytesReceived()`, and its
  `listen` rejects on error. The e2e spec polls for the app window instead of matching the
  `window` event once.

## 2. Why this approach

Layers are selected by file suffix, so a test sits next to the code it covers and its layer is
visible in the filename. Integration runs against the same `mongo:8.0.34` container the app uses,
so GridFS, text indexes and the 16 MB limit behave as they will in production. A missing database
fails the run rather than skipping it, because these tests gate tier 1 and a skipped run reads as
a pass. E2e launches Electron on the production Vite output (`.vite/build`, `args: ['.']`) because
the CSP exists only in production builds. It always rebuilds first, so it never tests stale code.

## 3. What was rejected

- **E2e against the packaged `.app`.** Its fuses disable `EnableNodeCliInspectArguments`
  (`forge.config.mts`), which Playwright needs to attach. A test-only fuse config was also
  rejected: a second Forge config to maintain, and the shipped fuses would still go untested.
- **`mongodb-memory-server`.** Its downloaded `mongod` can drift from the pinned image.
- **Skipping integration tests when Docker is down.** A green skipped run hides tier-1 risk.
- **A raw `net` socket capture server.** It would need a hand-written HTTP parser.
  `node:http` with `req.rawHeaders` preserves order, case and bytes, which is all T1.2–T1.4 compare.
- **Top-level `tests/{unit,integration,e2e}`.** The author chose colocation.
- **`test:e2e` reusing an existing build.** It can silently test old code. The cost is a full
  `electron-forge package` on every run.
- **Hosted CI.** The author chose local gates only (single developer, $0).
- **Not done here:** making the app read its database name from the environment, and the T1/T2
  risk tests themselves. Both belong to feature changes.

## 4. Surprises

- **Vitest 5.0.5 with Vite 8.3.5 cannot print an error thrown from a global-setup file.** Every
  such error appears as `TypeError: code.charCodeAt is not a function` from Vite's
  `extractInlineSourceMap`. Reproduced with a bare `throw`. The workaround is in
  `test-support/mongo-global-setup.ts` (`fail()`).
- **The host shell does not load `.env`.** The plan's first database-check command used
  `-u "$MONGO_ROOT_USER"` on the host and failed authentication; plan review caught it. The
  backup comment in `docker-compose.yml` has the same defect and is still unfixed.
- **Playwright `_electron` launched Electron 45 from `node_modules`.** This was the one unverified
  load-bearing assumption, and it held.
- **Vitest skips a project's global setup when that project has no matching files.** So
  `npx vitest run <unit file>` works with MongoDB down. Code review claimed otherwise.

## 5. What still stands

- **The prefix guard is the only barrier to deleting history.** It is `assertTestDbName` in
  `test-support/test-db-name.ts`, and `AGENTS.md` makes it non-negotiable. Any new drop path must
  go through it.
- **Concurrent integration runs break each other.** Global setup drops every `dp_test_*` database
  at the start, including a concurrent run's live ones. Accepted for a single developer. The fix,
  if needed, is an age cutoff using the timestamp in the name.
- **E2e cannot send or record yet.** It first needs the app to take its database name from the
  environment. Until then, an e2e test that records a call writes into the real history.
- **T1.6 waits on the PRD.** The PRD has not decided what happens when the database is down.
- **If integration fails with `code.charCodeAt`,** read the `[integration setup]` line above it.
  The `TypeError` is not the cause.
- **If e2e hangs on the window,** check that `main_window/index.html` is still the renderer
  entry. `appWindow()` polls for that URL for 30 s.
- **Capture server `close()` does not call `closeAllConnections()`.** Node 22 closes idle
  keep-alive sockets on its own. Revisit if `undici` clients hang teardown.
- **Accepted:** `test:e2e` is slow (it packages the app), a missing `.env` is fatal even when the
  variables are exported, and a database named exactly `dp_test_` would abort setup.

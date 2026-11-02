---
change_id: test-harness
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-02
updated: 2026-11-02
reviewed: working tree against 66cc5b8 (origin/main merge-base), 4 phases, plan.md as revised after plan review
delegated-to: host /code-review (8-angle pass over main...HEAD, 2026-11-02; findings unverified by the tool, triaged below)
---

# Review: Install the unit, integration and e2e test harness from the test strategy

## Verdict

**merge-with-fixes** — the plan was followed with every divergence recorded and every phase
evidenced. The fixes concern the git history the change lands in (F1) and two foundation documents
it made stale (F2), not the harness itself.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification
completeness**. It does **not** cover general code correctness — logic errors, edge cases,
efficiency, idiom.

General correctness was reviewed separately by the host `/code-review` (findings and dispositions
under Host code review).

This review ran in the same session that planned and executed the change (lz-plan, lz-tdd,
lz-build). The reviewer wrote the code under review; weigh the verdict accordingly.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | Every file in the four phases' Touches columns exists as planned. All five Out of scope items held: no `test` script in `package.json`; `src/main.ts` unchanged (hardening flags at lines 19–21); no GridFS or `undici` code; no `src/` restructuring; `docker-compose.yml` comment untouched. Three divergences, all recorded as `decision` in `progress.md`. |
| Convention compliance | 4/5 | `AGENTS.md` non-negotiables hold: `mongodb` is imported only from `test-support/` (`grep -rl mongodb src/` finds nothing), renderer CSP plugin intact (`vite.renderer.config.mts:25`). The test-strategy layer contract holds: unit tests touch no database or network, the capture server sits in the integration project, e2e uses the production build. Minus one because `AGENTS.md` now misstates the repo (F2). |
| Lessons compliance | — | `lessons.md` does not exist; no standing rules to apply. No ADRs. |
| Verification completeness | 5/5 | 4 of 4 phases marked `done` carry the plan's verification command with real output. Phases 1 and 3 record red-step failure messages. Each phase's Done-when check was run as a mutation (prefix check weakened, Mongo stopped, CSP plugin removed, header case and order broken) with the failing output recorded. Two tests were not seen red, and the ledger says so (F3). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| Phase 1 installs Vitest as part of the phase | Install, config and script done as setup before the first red, untested | yes (Phase 1 drift) | decision |
| Global setup throws a message naming `docker compose up -d` | `fail()` writes the message to stderr, then throws; driver error folded into the text. Vitest 5.0.5 / Vite 8.3.5 replace any global-setup error with `code.charCodeAt is not a function` (reproduced with a bare throw) | yes (Phase 2 drift) | decision |
| E2e smoke: "1 test passes" | Two tests: window renders; CSP meta tag present | yes (Phase 4 drift) | decision |
| Phases in order 1–4 | Phase 4 executed before phase 3 | yes (Phase 4 drift) | decision |
| `playwright.config.ts`: `testDir`, one worker, no browser projects | Also `timeout: 60_000` | yes (Phase 4, Changed) | decision (not listed on the drift line; trivial) |
| `close()` of the capture server | `closeAllConnections()` added, then removed when no test required it | yes (Phase 3 cycle 2) | none — shipped as planned |

Files flagged by `diff-vs-plan.sh` as changed but not planned (`AGENTS.md`, `CLAUDE.md`,
`.oxfmtrc.json`, `.oxlintrc.json`, `.gitignore`, `package-lock.json`) come from the scaffold and
onboarding sessions, not this change. `.gitignore` gained `test-results/` and `playwright-report/`
(planned, phase 4); `package-lock.json` changed with the planned installs. The script also reported
phases 2 and 3 as `in-progress` because it reads the first ledger section per phase (the routing
note); the last section, which is authoritative, is `done` for both.

## Findings

### F1 — The change is not separable in git from the scaffold and onboarding work

- **Severity:** minor
- **Where:** working tree; last commit `66cc5b8`
- **Category:** verification
- **Finding:** Nothing since `66cc5b8` is committed. The scaffold, the `context/` substrate,
  `AGENTS.md`/`CLAUDE.md` and this harness are all untracked together (30 files outside
  `context/`). The harness diff cannot be reviewed, reverted or attributed on its own, and the
  host code reviewer would see all of it as one change.
- **Disposition:** fix now
- **Because:** author chose two commits on a branch before close: first the scaffold, `context/`
  substrate and agent rules; then the test harness, so its diff is exactly this change.

### F2 — `AGENTS.md` and `test-strategy.md` now misstate the test harness

- **Severity:** minor
- **Where:** `AGENTS.md:29`; `context/foundation/test-strategy.md:27`, `:58` and the Quality gates
  table
- **Category:** convention
- **Finding:** `AGENTS.md` says "No test runner exists. There is no `npm test`." Three verified test
  commands now exist. `test-strategy.md` says e2e runs "against the packaged build" (this change
  uses the production build output, per the plan's recorded reason) and lists `test:unit`,
  `test:integration` and `test:e2e` as "not runnable". An agent reading `AGENTS.md` on every turn
  would not run the tests. The plan assigned both updates to their producers (Out of scope).
- **Disposition:** fix now
- **Because:** author chose to run `/lz-onboard` and `/lz-test-strategy` before `/lz-change close`.
  This is a close-gate condition.

### F3 — Two capture-server tests were never seen failing

- **Severity:** minor
- **Where:** `test-support/capture-server.int.test.ts` ("listens on 127.0.0.1 with an ephemeral
  port", "stops accepting connections after close")
- **Category:** verification
- **Finding:** Both passed against the red-step stub because the stub contained the listen and close
  code. The ledger records this (Phase 3, cycle 1).
- **Disposition:** accept
- **Because:** both assert behaviour of `node:http` listen/close rather than capture logic, the
  ledger is explicit about it, and the capture behaviour the phase exists for (header order and
  case, body bytes) was shown red by two mutations.

## Host code review

Ten findings from `/code-review` over `main...HEAD` (both commits), triaged 2026-11-02.

| # | Where | Finding | Verified? | Disposition |
|---|---|---|---|---|
| 4 | `e2e/smoke.spec.ts` | One-shot `window` predicate can miss a window that navigates after creation | plausible (4/4 runs passed) | **fixed** — polls `app.windows()`; ledger Phase 4 follow-up |
| 5 | `test-support/capture-server.ts` | Aborted request never recorded; no `req` error handler | yes (red test) | **fixed** — recorded with `complete: false`; ledger Phase 3 follow-up |
| 7 | `test-support/capture-server.ts` | Listen error never settles the promise | yes (mutation: 10 s hang + unhandled error) | **fixed** — rejects on `error` |
| 1 | `docker-compose.yml:7` | Backup comment reads credentials from the host shell | yes (same class as plan review) | accept for this change — out of scope per plan; separate fix (author chose not to include it) |
| 2 | `test-support/mongo-global-setup.ts` | Sweep drops a concurrent run's live `dp_test_*` databases | yes, by reading | accept — single developer; recorded in plan Risks |
| 3 | `test-support/mongo-global-setup.ts` | Missing `.env` fatal even with variables exported | yes, by reading | accept — no CI; `.env` is the documented setup |
| 6 | `test-support/capture-server.ts` | `close()` may hang on keep-alive clients | not reproduced; Node 22 `server.close()` closes idle sockets | dispute — revisit when `undici` is introduced |
| 8 | `vitest.config.mts` | Plain `vitest run <unit file>` needs MongoDB | **false** — with Mongo stopped, `npx vitest run test-support/test-db-name.test.ts` passed 14/14 | dispute |
| 9 | `test-support/mongo-global-setup.ts` | A database named exactly `dp_test_` aborts setup | yes, by reading | accept — nothing creates that name |
| 10 | `package.json` | `test:e2e` packages the app only to get `.vite/` | yes | accept — author chose a full build over a stale one; a build-only command is unverified |

## Lessons candidates

- **Commands run on the host that need `.env` values.** The plan's original phase 2 check and the
  backup command in `docker-compose.yml` both read `$MONGO_ROOT_USER` from a shell that never
  loads `.env`, and both fail authentication. Two instances in one day, same class. The
  in-container form (`sh -c '… $MONGO_INITDB_ROOT_USERNAME …'`) works.
- **Vitest global-setup errors are masked** by `code.charCodeAt is not a function` on Vitest 5.0.5
  with Vite 8.3.5. One incident; generalises to any future global setup until an upgrade fixes it.
- **oxfmt checks Markdown outside `context/`** — already a line in `AGENTS.md`; no new incident in
  this change.

## For the archive record

- E2e targets `.vite/build` output launched with `args: ['.']`, not the packaged `.app`: the fuses
  disable the inspector. Assumption A2 (Playwright `_electron` with Electron 45 from
  `node_modules`) held.
- Vitest 5.0.5 / Vite 8.3.5 cannot print global-setup errors; `test-support/mongo-global-setup.ts`
  works around it with a stderr-first `fail()`. Revisit on upgrade.
- Constraint carried forward: the first feature with database access must take its database name
  from the environment so e2e can point the app at a `dp_test_` database.

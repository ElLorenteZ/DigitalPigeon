---
change_id: send-and-record
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-03
updated: 2026-11-04
reviewed: working tree on branch send-and-record against main (be422db), 5 phases, plan.md as revised after plan review and spike
delegated-to: host /code-review (main...working tree, 2026-11-04; findings unverified by the tool, triaged below)
---

# Review: Send a REST request from the app and record every send as its own call record

## Verdict

**merge-with-fixes** — every phase was built as planned or with recorded drift, and every phase is
evidenced. Three fixes remain before close:
- the e2e database helper sits outside the paths `AGENTS.md` allows for `mongodb` (F1)
- the smoke spec reads real history (F2)
- two foundation documents no longer describe the repo (F3)

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification
completeness**. It does **not** cover general code correctness — logic errors, edge cases,
efficiency, idiom.

General correctness was reviewed separately by the host `/code-review` (findings and dispositions
under Host code review).

This review ran in the same session that planned and executed the change (lz-plan, lz-spike,
lz-tdd, lz-build, lz-e2e). The reviewer wrote the code under review; weigh the verdict accordingly.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | All five phases match their goals and file lists. Drift: 6 decisions and 1 defect, all recorded in `progress.md`, plus one unlisted change (window size, F6). One edit outside a phase's paths: `src/core/send.ts` gained `onSent` during phase 4, recorded with a test. Out of scope held: no request bodies, no GridFS, no single-call view, no redirects, no proxy. Minus one because the plan's wire contract no longer matches the code: the `HEAD` rule exists only in the ledger (F5). |
| Convention compliance | 4/5 | Hardening flags unchanged (`git diff main -- src/main.ts`), and no HTML-rendering API anywhere in `src/`. Bodies are rendered through `TextDecoder` into `<pre>`. The preload exposes 4 named functions, and the preload and renderer bundles contain neither `MongoClient` nor `undici`. Every `dropDatabase` goes through `assertTestDbName`. Minus one because `e2e/support.ts` imports `mongodb`, outside the paths `AGENTS.md` allows (F1). |
| Lessons compliance | — | `lessons.md` has 0 standing rules; its observation log does not bind. |
| Verification completeness | 5/5 | 5 of 5 phases marked done carry their plan verification command and real output. Mutation checks: phase 1 (upsert), phase 2 (three mutations), phase 3 (dispatch before insert), phase 5 (no re-fetch). Phase 4 has scripted observation output plus the author's packaged-app report, quoted. The e2e scenario ran 4× clean. Tests not seen red are named in each phase (F4). One plan observation (dev mode) was not made, and the ledger says so (F7). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| "Every document read is parsed with its schema" (failure unspecified) | A failing document lists as an `unreadable` row with the schema error | yes (phase 1) | decision (author) |
| Wire contract: `connection` is `keep-alive` or the typed value | `HEAD` always `connection: close`; a typed `Connection` on `HEAD` is ignored | yes (phase 2) | defect — the plan's contract was wrong for `HEAD` (undici 8.12.3) |
| Typed `Content-Length` unspecified | Replaced by the computed value | yes (phase 2) | decision |
| "Bounded attempts" (after the bound unspecified) | `down` after the bound, retries continue | yes (phase 3) | decision (author) |
| History re-fetched after each send completes or fails | Also re-fetched every 500 ms while a send is in flight | yes (phase 4) | decision — fixes a race found by observation |
| `src/core/send.ts` untouched in phase 4 | `onSent` option added, with an integration test | yes (phase 4) | decision |
| `npm start` observations | Scripted against the built output; packaged app observed by the author; dev mode not run | yes (phase 4) | decision (F7) |
| Window size not in the plan | 1100×800 | listed under Changed, not as drift | unrecorded, trivial (F6) |

`diff-vs-plan.sh` also flagged `package-lock.json`, `src/index.css` and `src/renderer/app.tsx` as
unnamed. The lockfile follows the planned installs; the other two are the plan's "renderer
components" and are listed under phase 4's Changed. The script reported phases 4 and 5 as
`in-progress`, because it reads the first ledger section per phase (the routing note). The
authoritative last sections are `done`.

## Findings

### F1 — `e2e/support.ts` imports `mongodb` outside the paths `AGENTS.md` allows

- **Severity:** minor
- **Where:** `e2e/support.ts:11`, `:65`; `AGENTS.md` Non-negotiable, first rule
- **Category:** convention
- **Finding:** The rule names main-process code and `test-support/` as the only importers of the
  `mongodb` driver. The e2e launch helper creates a client and drops its test database itself.
- **Disposition:** fix now
- **Because:** author chose to move the database part into `test-support/` (credentials from
  `.env`, test database name, drop through the guard), leaving only the app launch in `e2e/`. The
  rule stays unchanged.

### F2 — The smoke spec connects the app to the real history database

- **Severity:** minor
- **Where:** `e2e/smoke.spec.ts` (`electron.launch({ args: ['.'] })`)
- **Category:** convention
- **Finding:** Since phase 4 the app connects at startup with `config.json`. The smoke spec sets
  no `DP_MONGO_DB`, so every `npm run test:e2e` connects to `digital_pigeon` and lists its history.
  It never sends.
- **Disposition:** fix now
- **Because:** author chose to switch it to the test-database launch helper, so no e2e run touches
  real history.

### F3 — `test-strategy.md` and `AGENTS.md` no longer describe the repo

- **Severity:** minor
- **Where:** `context/foundation/test-strategy.md`, Covered column of T1.1, T1.2, T1.3, T1.6,
  T2.1, T2.2, T2.7 and T2.8 (all `**gap**`); `AGENTS.md`
- **Category:** convention
- **Finding:**
  - The eight risks are now covered at their assigned layers, but the strategy says `gap`.
  - `AGENTS.md` does not say that the app reads credentials from the environment or from
    `~/Library/Application Support/DigitalPigeon/config.json`, that `DP_MONGO_DB` overrides the
    database, or that e2e sets it.
  - Both updates were assigned to their producers in plan Out of scope.
- **Disposition:** fix now
- **Because:** author chose to run `/lz-test-strategy` and `/lz-onboard` before `/lz-change close`.
  This is a close-gate condition.

### F4 — Some tests were never seen failing

- **Severity:** minor
- **Where:** `progress.md` phases 1–3 cycles
- **Category:** verification
- **Finding:** 11 tests passed against their stubs: 3 schema-validity cases, the store-shape test,
  6 wire cases, and the refused → `network` case. The ledger names each.
- **Disposition:** accept
- **Because:** each asserts a pass-through of the stub's own shape, and every phase's core
  behaviour was shown failing, by a red step or a done-when mutation.

### F5 — `plan.md`'s wire contract omits the `HEAD` rule

- **Severity:** minor
- **Where:** `plan.md` Approach, "Wire contract"
- **Category:** drift
- **Finding:** The code and `wire.test.ts` force `connection: close` for `HEAD`; the plan still
  states the rule without that exception. The defect is recorded in `progress.md` phase 2.
- **Disposition:** accept
- **Because:** the plan is the reviewed record of intent, and the ledger and the archive record carry
  the correction. Rewriting the plan after execution would hide the defect.

### F6 — Window size changed without a drift entry

- **Severity:** nit
- **Where:** `src/main.ts` (`width: 1100, height: 800`)
- **Category:** drift
- **Finding:** Listed under phase 4's Changed, not as drift.
- **Disposition:** accept
- **Because:** cosmetic; it does not touch anything the plan constrained.

### F7 — Dev mode (`npm start`) was not observed

- **Severity:** minor
- **Where:** `progress.md` phase 4, drift
- **Category:** verification
- **Finding:** The plan's observations ran by script against `.vite/build`, and the packaged app
  was checked by the author. `npm start` itself never ran in this change.
- **Disposition:** accept
- **Because:** the author judged that dev mode differs only in the Vite dev server and the absent
  CSP, while the same main and renderer code ran in both checked builds.

## Host code review

Ten findings from `/code-review`, triaged by the author on 2026-11-04: fix all but #4. The fixes and
their red-then-green evidence are in `progress.md` (follow-up sections dated 2026-11-04).

| # | Where | Finding | Verified? | Disposition |
|---|---|---|---|---|
| 1 | `src/core/wire.ts` | Query rows after a `#fragment` were recorded but never sent | **yes** — `…/items#top?page=2` recorded, `/items` sent | **fixed** — URL-based; T1.3 now asserts the full recorded URL |
| 2 | `src/renderer/app.tsx` | A rejected `send` invoke was unhandled and invisible | yes, by reading | **fixed** — shown as `unexpected`; failure branch not exercised |
| 3 | `src/main/ipc.ts` | `listCalls` rejected when the database dropped between heartbeats | yes, by reading | **fixed** — returns `{ ok: false, message }`, shown above history; failure branch not exercised |
| 5 | `src/core/send.ts` | A schema error was reported as "Database unavailable" | yes (red test) | **fixed** — only `MongoError` is wrapped |
| 6 | `src/core/db-connection.ts` | A client connecting after `stop()` was kept open | yes (red test) | **fixed** — closed and not kept |
| 7 | `src/core/send.ts` | Connect timeout classified as `network` | yes (red test) | **fixed** — `timeout` |
| 8 | `src/main/ipc.ts`, `call-store.ts` | Store rebuilt per call; a failed index creation would be cached | yes (red test for the cache) | **fixed** — one store per `Db`; rejection not cached |
| 9 | `src/core/call-store.ts` | History reads and ships full response bodies every 500 ms while in flight | yes (red test) | **fixed** — bodies projected out of history rows |
| 10 | `test-support/e2e-database.ts` | Hand-written `.env` parser mishandles quotes and CRLF | yes | **fixed** — `node:util` `parseEnv` |
| 4 | `src/core/send.ts` | Bodies near or over 16 MB can never be recorded | yes, by reading | accept — plan Out of scope; GridFS and T1.5 are roadmap slice 3 |

## Lessons candidates

- **undici changes the wire request in ways the plan did not predict.** Two incidents in this change,
  with different mechanisms:
  - the plan review probe: lowercase `host`, added `connection`, `content-length` on `POST`
  - phase 2: forced `connection: close` on `HEAD`

  Both were caught only by running undici against the capture server. A candidate rule: "any
  claim about what reaches the wire is checked against the capture server before it is planned".
  Both incidents fall within one change, so whether they count as distinct is for `/lz-lessons`.
- **A URL edge case the wire tests did not cover (fragment).** T1.3 compared only path and query,
  so the recorded URL could claim a query that was never sent. Same class as the undici findings:
  the record and the wire compared on less than the whole request. One more incident of the class
  "the T1.3 comparison is narrower than the record".
- **UI re-fetch racing a write in main.** The in-flight row was missing because history was
  re-fetched before main had inserted the send document. One incident.

## For the archive record

- A call is two insert-only documents (send before dispatch, completion after). The send document
  records the exact header list undici 8.12.3 writes. That is the wire contract in
  `src/core/wire.ts`, including the `HEAD` exception found in phase 2.
- The spike showed the default Forge Vite build bundles `mongodb` and `undici` into the packaged app.
  The driver's optional features (Kerberos, compression, encryption, AWS/GCP auth, SOCKS) are
  unavailable there.
- The app needs `~/Library/Application Support/DigitalPigeon/config.json` (or env credentials). It
  was created during phase 4 with mode 600. One real `GET https://example.com` call is in
  `digital_pigeon`.

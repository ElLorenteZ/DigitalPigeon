---
change_id: local-web-app
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-13
updated: 2026-11-13
reviewed: branch local-web-app against main (merge base ea911b3), commits aff8907..c514005, 4 phases, plan revision 3
delegated-to: nothing yet — general correctness is UNREVIEWED; /code-review is required before merge (test-strategy.md, Quality gates)
---

# Review: Replace the Electron shell with a local Node server and a browser UI

## Verdict

**merge-with-fixes** — the change matches its plan and every phase is evidenced, but the static routes do not
refuse a foreign `Origin`, which ADR 0002 requires of every endpoint (F1).

**This review was run in the same session that planned and built the change.** The reviewer wrote the code under
review and the ledger it reads as evidence. Weigh the scores with that in mind; the host code review below is the
independent check.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification completeness**. It does
**not** cover general code correctness — logic errors, edge cases, efficiency, idiom.

General correctness has NOT been reviewed. Run `/code-review` before merging (author decision 2026-11-07,
`test-strategy.md`, Quality gates).

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | All 34 changed files trace to a phase. 11 divergences, 10 recorded as decisions in `progress.md`; one nit unrecorded (F5). No scope creep: `src/core/` changes are comments only, inside `change.md`'s boundary. |
| Convention compliance | 3/5 | ADR 0002's "every endpoint refuses … a `Host` or `Origin` that is not the server's own" holds for `/api/*` only (F1). `tech-stack.md` and `infrastructure.md` still defer to "slice 5b's plan" for choices this change made (F2). AGENTS.md non-negotiables otherwise met: `undici`/`mongodb` only in `src/server/`, `src/core/`, `test-support/`; tests on `dp_test_*`; no CORS headers. |
| Lessons compliance | 5/5 | Standing rule "List what a spike did not try": `spike-browser-host.md` has a Not tried list, and plan A1–A3 cite it for Chrome 157/macOS only. Standing rule "Probe what undici does": no new request shape was introduced. |
| Verification completeness | 4/5 | 4 of 4 done phases carry command output in their last ledger section. Phase 3's walkthrough is the author's summary attestation, not a step-by-step record (F4). The intermediate commits `b9ada70` and `0efb1be` were not gate-checked on their own, and `0efb1be` holds phase 3 code; the ledger does not say so (F3). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| Codec escape "decodes unchanged", no shape | Entries array under a third reserved key `$object` | yes (phase 1) | decision |
| Refusal cases listed in phase 2 | Also `localhost` `Host`, other-port `Origin`, path outside `staticDir` (`404`), malformed body (`400`) | yes (phase 2) | decision |
| `dist/server/main.js` | `dist/server/main.mjs` | yes (phase 3 A) | decision |
| Vite HMR websocket behind the server's checks | HMR off; `npm run dev` logs websocket errors and reloads by hand | yes (phase 3 A) | decision |
| `npm run dev` portable | POSIX `DP_DEV=1` syntax, not `cmd.exe` | yes (phase 3 A) | decision |
| "A fixed default port" | 4380 | yes (phase 3 A) | decision |
| Every earlier e2e title remains | Meta-tag title replaced by a header test; 51 titles against 50 | yes (phase 3 B) | decision |
| Stubbed rejection carries the message | `pigeon:<channel>: 500 <message>` | yes (phase 3 B) | decision |
| — | Browser context 1100×800 | yes (phase 3 B) | decision |
| `test-strategy.md`: T1.9, T1.8, T2.1, E2E, Build | Also T2.7, T2.10, T3.3, T3.10 and known gaps | yes (phase 4) | decision |
| — | `@types/node@^22` added as a direct dev dependency | yes (phase 4) | decision |
| `z.config({ jitless: true })` in `src/renderer.tsx` | In `src/renderer/zod-jitless.ts`, imported first by `src/renderer.tsx` | **NO** | decision (F5, nit) |

`diff-vs-plan.sh` reported phases 3 and 4 as `in-progress` with no output: it reads the first ledger section of a phase
(the routing entry), while the schema makes the last one authoritative. The last sections were read by hand.

## Findings

### F1 — Static routes serve a request that carries a foreign `Origin`

- **Severity:** major
- **Where:** `src/server/http.ts:154-185` (the `Origin` check at `:175` sits inside the `/api/` branch)
- **Category:** convention (ADR 0002)
- **Finding:** ADR 0002 (Decision): "Every endpoint refuses a request without the per-launch token, or with a `Host` or
  `Origin` that is not the server's own." The server checks `Origin` only on `POST /api/*`. A `GET /` or
  `GET /assets/*` that carries `Origin: http://evil.test` and a valid cookie is served. A browser does not attach the
  `SameSite=Strict` cookie to a cross-site request, so this is not open today; it is still the ADR's rule, and plan
  revision 2 narrowed it ("the `Origin` rule applies to `/api/*` only") from the spike's observation that same-origin
  navigations and worker scripts carry *no* `Origin` — which does not require accepting a *foreign* one. The phase 2
  tests cover a missing `Origin` on static routes, not a foreign one.
- **Disposition:** fix now
- **Because:** an accepted ADR is binding. The fix keeps the spike's finding: refuse a present `Origin` that is not
  the server's own on every route; allow an absent one outside `/api/*`. Add the case to
  `src/server/http.int.test.ts` (UI, script and favicon with `Origin: http://evil.test` and a valid cookie → `403`)
  and align the AGENTS.md server rule.

### F2 — Foundation documents still defer decisions this change made

- **Severity:** minor
- **Where:** `context/foundation/tech-stack.md:26, 34, 57`; `context/foundation/infrastructure.md:37`
- **Category:** convention
- **Finding:** They say the Node.js version, the HTTP server library, the server build and the start command and port
  "are set in slice 5b's plan". They are now set: `node:http`, Node 22 (`@types/node@^22`), `vite.server.config.mts` to
  `dist/server/main.mjs`, `npm start` on `127.0.0.1:4380` (`DP_PORT`), daily use runs the built bundle.
- **Disposition:** fix now
- **Because:** four short edits; left as is, the next reader of `foundation/` is sent to a plan that is about to be
  archived.

### F3 — The ledger does not say commit `0efb1be` holds phase 3 code, or that intermediate commits went unchecked

- **Severity:** minor
- **Where:** `context/changes/local-web-app/progress.md` (phase 2 entry); commits `b9ada70`, `0efb1be`
- **Category:** verification
- **Finding:** The phase 2 commit contains the `devMiddleware` option added during phase 3 step A. The gates ran on the
  final state of each commit's phase in the working tree, not on the checked-out commits `b9ada70` and `0efb1be`.
  Both facts were reported in the conversation, not in the ledger.
- **Disposition:** fix now
- **Because:** one ledger note; a bisect over this branch otherwise meets a phase 2 commit with an unexplained option.

### F4 — The phase 3 walkthrough is recorded as one attestation

- **Severity:** minor
- **Where:** `context/changes/local-web-app/progress.md` (last phase 3 section)
- **Category:** verification
- **Finding:** The ledger quotes "walkthrough done, all good" for the plan's eight-step walkthrough; individual steps
  (the ≥17 MiB browser upload, `npm run dev` beside `npm start`) are not recorded one by one.
- **Disposition:** accept
- **Because:** only the author can perform the walkthrough, and the author attested to the whole list. The e2e suite
  covers the journeys (51 tests, three runs); the step A check script covered the cross-origin `fetch` and dev mode.

### F5 — `jitless` lives in its own module, unrecorded

- **Severity:** nit
- **Where:** `src/renderer/zod-jitless.ts`, `src/renderer.tsx:5`
- **Category:** drift
- **Finding:** The plan put `z.config({ jitless: true })` in `src/renderer.tsx`; it is a separate module imported first,
  so it runs before any other import evaluates. Listed under Changed, not as drift.
- **Disposition:** accept
- **Because:** same effect, inside the file the plan named; the break-it check (body-safety red without the import)
  covers it.

## Lessons candidates

- **`diff-vs-plan.sh` reads a phase's first ledger section.** With routing entries, it reports done phases as
  in-progress with no evidence. Tooling, not this project; one incident.
- **An ADR's rule narrowed by a plan without saying so** (F1). The plan cited a spike for the narrowing, and two plan
  reviews did not compare it with the ADR's wording. No prior incident known.

## For the archive record

- Electron removed in one slice: `src/core/` unchanged in behaviour; the operations run behind `node:http` through a
  handle-only seam; a tagged-JSON codec carries bytes and dates.
- Security moved from Electron's sandbox to the server's checks (`Host`, per-port `HttpOnly; SameSite=Strict` cookie,
  `Origin`), tested as T1.9. Surprises: zod 4's JIT probe trips the CSP silently; the console does not report CSP
  violations; Chrome requests `/favicon.ico`.
- Still open: dev-mode HMR is off (a choice left to the author); "server not reachable" after a restart is out of
  scope; Windows `npm run dev`.

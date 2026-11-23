---
change_id: history-grouping
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-23
updated: 2026-11-23
reviewed: land-slices-7-12 @ 2a44ef1 → history-grouping working tree (commit a43ff5f + uncommitted Phases 3 and 5); 5 phases
delegated-to: nothing — general correctness is UNREVIEWED
---

# Review: Group history by request path, optionally split by the authorization sent

## Verdict

**merge-with-fixes** — every done phase carries real command output, but both new e2e specs omit the "no CSP
violation" check the plan lists for Phases 3 and 5, and Phase 5's done-when still needs the author's T3.2 look.

This review ran in the same session that executed Phases 1–5 (lz-tdd, lz-e2e). The reviewer wrote the code under
review.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification completeness**. It does
**not** cover general code correctness: logic errors, edge cases, efficiency, idiom.

General correctness has NOT been reviewed. Run the host code reviewer (`/code-review`) before merging.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | Every planned file and behaviour shipped. Five divergences: three recorded as decisions, two unrecorded (CSP check missing, Split-by-auth scenario on `/accounts` instead of `/orders`). |
| Convention compliance | 5/5 | AGENTS.md non-negotiables. HTTP and storage stay in the server: `listRequestGroups` is in `call-store.ts`, and the renderer reaches it through `api.ts`. The new operation passes the Host/Origin/cookie checks: it sits in the `answers` map of `http.int.test.ts`. No body rendered as HTML. Tests use throwaway databases. ADR 0001 is untouched. ADR 0002 holds: preferences live in the page's `localStorage` on 127.0.0.1. |
| Lessons compliance | 5/5 | Two standing rules (probe undici; spike "Not tried"). Neither applies: no new request shape and no spike. |
| Verification completeness | 4/5 | Phases 1–4: 4 of 4 marked done, each with red and green output. Phase 5 is honestly `in-progress` until the manual T3.2 look. One integration case (ipc failure paths) was never seen red; the ledger records this. CSP absence is not asserted (F1). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| Phase 1: results table names the header | Shows `—` for an empty value, so it agrees with the facet | yes | decision |
| Phase 2: load summaries, filter in Node | Projects url/headers/sentAt for the method, filters, then lists ≤500 by id | yes | decision |
| Phase 3: call record "follows the same setting" | Toggle in the strip only; the record follows it and names the auth | yes | decision |
| Phase 4: `-t groups` | `-t listRequestGroups` (plan's filter matched one test); bulk insert with a 60 s limit | yes | defect (plan's command) |
| Phase 5, A4: seed, then run the whole suite before any UI | Seed first; whole suite run once the UI existed (95 passed) | yes | decision |
| Phase 5, T2.9 scenario | Clicks at the bottom edge with `dispatchEvent` | yes | decision |
| Phases 3 and 5: "no CSP violation" in the expected output | Neither `responses.spec.ts` nor `history-grouping.spec.ts` calls `expectNoCspViolations` | **NO** | unrecorded |
| Phase 5: "/orders splits into two groups" by Authorization | `/accounts` splits into two; `/orders` is asserted as the "no auth" group | **NO** | unrecorded |
| Files not named: `src/server/http.int.test.ts`, `src/server/ipc.int.test.ts` | Operation and auth over HTTP; handler failure paths | yes (ledger, Phases 2 and 4) | decision; `ipc.int.test.ts` is in Phase 4's verification command |
| `AGENTS.md` named, not changed | Cited only as the source of the design-precedence rule | n/a | not drift |

## Findings

### F1 — The new e2e scenarios do not check for CSP violations, which the plan expected

- **Severity:** major
- **Where:** `e2e/history-grouping.spec.ts` (whole file); `e2e/responses.spec.ts` (Split by auth scenario)
- **Category:** drift / verification
- **Finding:** The plan's expected output for Phases 3 and 5 includes "no CSP violation". `launchWithTestDatabase` records violations (`e2e/support.ts:106`), but only `smoke.spec.ts` and `body-safety.spec.ts` assert on them (`expectNoCspViolations`). A suite that is green under the production CSP does not show that nothing was blocked. The ledger does not record the omission.
- **Disposition:** fix now
- **Because:** Two lines: call `expectNoCspViolations(testApp.window)` in `afterAll` (or at the end of the scenarios) in both specs, and run them once.

### F2 — Phase 5's done-when needs the author's look at request mode (T3.2)

- **Severity:** major
- **Where:** `context/changes/history-grouping/progress.md` (Phase 5 status)
- **Category:** verification
- **Finding:** Every automated criterion passes. The manual comparison against screen 01's sidebar has not happened. The ledger states this, and the phase is not marked done.
- **Disposition:** fix now (the author's act)
- **Because:** The plan makes it part of done. Screenshots: `/private/tmp/claude-501/-Users-lorentez-Developer-DigitalPigeon/4732e474-11c5-41c5-a080-962fe00a65a7/scratchpad/request-mode.png`, `/private/tmp/claude-501/-Users-lorentez-Developer-DigitalPigeon/4732e474-11c5-41c5-a080-962fe00a65a7/scratchpad/request-mode-split.png`. Two points to check there: the expand chevron is small, and the × sits close to the status code in expanded rows.

### F3 — Phases 3 and 5 are uncommitted

- **Severity:** minor
- **Where:** working tree: `app.tsx`, `index.css`, `e2e/support.ts`, `e2e/responses.spec.ts`, `e2e/history-grouping.spec.ts`, `progress.md`
- **Category:** verification
- **Finding:** PR #12's base branch plus `a43ff5f` hold Phases 1, 2 and 4 only. The verified Phase 3 and 5 work exists only in the working tree.
- **Disposition:** fix now
- **Because:** Commit after F1, so the commit carries the CSP check.

### F4 — The Split-by-auth group scenario uses `/accounts`, not `/orders` as planned

- **Severity:** nit
- **Where:** `e2e/history-grouping.spec.ts:136-163`
- **Category:** drift
- **Finding:** The plan names `/orders` splitting into two Authorization groups. The spec sends Bearer alpha/beta to `/accounts` and asserts `/orders` as the "no auth" group. This covers the same behaviour and adds the no-auth case. Not recorded.
- **Disposition:** accept
- **Because:** Equivalent coverage, plus one case. Recorded here so the ledger and the plan reconcile.

### F5 — Lifecycle fields lag the work

- **Severity:** nit
- **Where:** `context/changes/history-grouping/change.md:4` (`status: planned`); `plan.md` frontmatter (`status: draft`)
- **Category:** convention
- **Finding:** Both frontmatter statuses predate execution.
- **Disposition:** accept
- **Because:** `lz-change` derives status from the artifacts on disk and corrects drift on resume or close.

## Lessons candidates

- **A plan's "no CSP violation" expectation was not asserted (F1).** Related observation: 2026-11-08, "A 'clean console' observation listened to console messages only". Both are CSP checks claimed by a green run rather than asserted. A second distinct incident may meet the promotion bar. `/lz-lessons history-grouping` decides.
- **An e2e scenario could not fail because Playwright's click scrolls the target into view** (Phase 5, T2.9). Related observation: 2026-11-06, "A test named for a behaviour passed with that behaviour broken". The deliberate-break step caught it.

## For the archive record

- One auth rule (`authOf`: Authorization, otherwise Cookie) and one request key (`requestKeyOf`) in `src/core/`. Store and renderer share them, and `listResponses` no longer uses a `$regex`.
- `listRequestGroups` loads all summaries in Node: 59 ms at 5 000 calls (A1). The remedy for later growth remains the roadmap's "Search performance" item.
- e2e specs are pinned to day mode by the `launchWithTestDatabase` seed. Request mode, the default, is covered by `history-grouping.spec.ts` only.

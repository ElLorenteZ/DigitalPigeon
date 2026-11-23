---
change_id: environment-aware-history
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-23
updated: 2026-11-23
reviewed: a43ff5f → environment-aware-history working tree (uncommitted; shares the tree with history-grouping's uncommitted Phases 3 and 5); plan.md revision 2, 5 phases; progress.md
delegated-to: nothing — general correctness is UNREVIEWED
---

# Review: Detect a call's environment from its URL, and show History for the selected environment

## Verdict

**merge-with-fixes** — every phase marked done carries red and green output and every divergence is recorded, but Phase
5 still needs the author's T3.2 look, and the change is uncommitted and shares `app.tsx` with history-grouping's
uncommitted work.

This review ran in the same session that executed Phases 1–5 (lz-tdd, lz-e2e). The reviewer wrote the code under
review.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification completeness**. It does
**not** cover general code correctness: logic errors, edge cases, efficiency, idiom.

General correctness has NOT been reviewed. Run the host code reviewer (`/code-review`) before merging.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | All five phases shipped as planned, and every divergence is recorded in `progress.md`. Two changed what the plan prescribed: scenario (h) sends through Edit on a result, because the planned step cannot be performed; A2 needed more resets than the plan foresaw. |
| Convention compliance | 5/5 | AGENTS.md non-negotiables. Storage stays in the server: detection is in `resolveEnvironment`, which reads environments from the store, never a `baseUrl` from the renderer (B1 kept). Each changed operation validates its input with zod: the `listCalls` handler now validates the optional input, covered by `ipc.int.test.ts`. Every operation passes the HTTP checks (`http.int.test.ts`). Tests use throwaway databases. ADR 0002: the followed choice is stored in main through `setActiveEnvironment`. ADR 0001: untouched. |
| Lessons compliance | 5/5 | Two standing rules (probe undici; spike "Not tried"). Neither applies: no new request shape and no spike. |
| Verification completeness | 4/5 | Phases 1, 2, 4 (lz-tdd) and 3 (lz-e2e) are marked done. Each has red output, green output and, for e2e, deliberate breaks plus three clean runs. Phase 5 is honestly `in-progress` pending the manual T3.2 look. Each routed phase has an earlier routing entry with status `in-progress`, and the ledger script reads that entry as the phase's status (F3). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| Phase 1 case: `http://h/api` base → no match for `http://h/api/` | `pathFor` matches it; the test states that, and `http://h/api` (no slash) does not match | yes | defect (plan) |
| Phase 2: one `form-from-call.test.ts` case for Edit of a detected call | Not added: the existing case covers it, and a new one would pass on first run | yes | decision |
| Phase 4: `src/renderer/api.ts` signatures | Unchanged: `call()` is generic over the contract | yes | decision |
| Phase 5 (h): a send "appears in the results without any other action" | Sent through Edit on a result, then "Show results": while search is open the request form is hidden | yes | decision |
| Phase 5: strip label for a call outside the selection | The strip is also shown when that call is the only response, so the note has somewhere to appear | yes | decision |
| A2: specs that choose an environment need a reset | 3 resets, plus 2 races counting rows while History refetches, seen only in the full suite | yes | defect (plan's A2 was narrower than what happened) |
| Files not named: `e2e/saved-requests.spec.ts` | A2 resets | yes (Phase 5) | decision |
| Files in the diff not part of this change: `e2e/history-grouping.spec.ts`, `e2e/responses.spec.ts`, `e2e/support.ts`, `src/index.css` | history-grouping's uncommitted Phases 3 and 5, in the same working tree | yes (ledger header) | not drift; see F1 |
| `AGENTS.md` named, not changed | Cited only for the design-precedence rule | n/a | not drift |

## Findings

### F1 — The change is uncommitted and entangled with history-grouping's uncommitted work

- **Severity:** minor
- **Where:** working tree on branch `environment-aware-history` (created from `a43ff5f`)
- **Category:** verification
- **Finding:** Both changes edit `src/renderer/app.tsx`. history-grouping's Phase 3 and 5 hunks and this change's hunks sit in one file, so this change cannot be committed by file selection alone. history-grouping also has open review fixes (its `review.md` F1–F3).
- **Disposition:** fix now — done: history-grouping committed as `af7a187`, this change as `254447c` on top; merged into `main` as `6cc8c9f`.
- **Because:** Commit order decides whether either change's history reads correctly: history-grouping's fixes and commit first (on `history-grouping`), then this change on top.

### F2 — Phase 5's done-when needs the author's look at History with an environment selected (T3.2)

- **Severity:** major
- **Where:** `context/changes/environment-aware-history/progress.md` (Phase 5 status)
- **Category:** verification
- **Finding:** Every automated criterion passes. The manual look the plan makes part of done has not happened. The ledger states this, and the phase is not marked done.
- **Disposition:** fix now (the author's act) — done 2026-11-23: "I looked, it's fine".
- **Because:** The plan makes it part of done. Screenshots: `/private/tmp/claude-501/-Users-lorentez-Developer-DigitalPigeon/4732e474-11c5-41c5-a080-962fe00a65a7/scratchpad/env-selected.png`, `/private/tmp/claude-501/-Users-lorentez-Developer-DigitalPigeon/4732e474-11c5-41c5-a080-962fe00a65a7/scratchpad/env-all.png`.

### F3 — A phase's routing entry reads as its status

- **Severity:** nit
- **Where:** `progress.md`, the Phase 3 and Phase 5 routing entries written by lz-tdd
- **Category:** verification
- **Finding:** Phase 3 has a routing entry (`in-progress`) and, below it, the lz-e2e entry (`done`). The `diff-vs-plan.sh` and `phases.sh` scripts read the first entry and report Phase 3 as `in-progress` with no command output. A reader of the whole file sees `done`. The same shape occurred in history-grouping.
- **Disposition:** accept
- **Because:** The ledger is append-only by schema and the later entry is explicit. The mismatch is in how the toolkit scripts read it, outside this change. Nominated below.

### F4 — Lifecycle fields lag the work

- **Severity:** nit
- **Where:** `change.md:4` (`status: new`); `plan.md` frontmatter (`status: draft`)
- **Category:** convention
- **Finding:** Both statuses predate execution.
- **Disposition:** accept
- **Because:** `lz-change` derives status from the artifacts and corrects it on resume or close.

## Lessons candidates

- **A plan's e2e verification not asserting CSP.** This plan did not list "no CSP violation", so its absence from `environment-history.spec.ts` is not drift here. It is the same gap history-grouping's review F1 found. Two changes in a row have new e2e specs with no `expectNoCspViolations`, which may meet `lz-lessons`' second-incident bar for a rule such as "a new e2e spec asserts no CSP violations".
- **Counting History rows while it refetches.** After this change, every selector change refetches History. Reading `history.count()` straight after a selector change races the refetch (two scenarios, seen only in the full suite). The 2026-11-06 observation "Presence checks passed for an element the user could not see" is related but not the same.
- **Routing entries read as a phase's status** (F3). Seen in history-grouping and here; a toolkit matter (`phases.sh`, `diff-vs-plan.sh`), not a project rule.

## For the archive record

- Full URLs now record the environment whose `baseUrl` they start with (`environmentForUrl`, longest prefix; ties go to the selected environment). This supersedes slice 5's review R1. Edit of such a call loads the path.
- "All" replaces "None". History, request groups, the strip, Other responses and search follow the select by the recorded snapshot only. Older full-URL calls appear under "All" only. Search's environment is a default kept out of `filters`, because `filters` turn search on.
- `dataVersion` is bumped after every send, because a filtered `historyMark` no longer changes for sends outside the selection.

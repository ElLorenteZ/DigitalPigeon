---
change_id: history-status-filter
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-24
updated: 2026-11-24
reviewed: origin/main (merge-base 3d7157ec) + working tree; plan.md revision 2; progress.md, 4 phases
delegated-to: /code-review (Claude Code host reviewer), 2026-11-24; its findings are triaged below
---

# Review: Filter History by HTTP status code with a multi-select combo box

## Verdict

**merge-with-fixes**: every phase is evidenced and every drift but one is recorded. One minor verification gap is
fixed now: the status options' failure path has no scenario (F1).

Fixes applied 2026-11-24: F1, and the host review's #2–#6, #9 and #10. See `progress.md`, "Review fixes". Every
finding left open is `accept` with a reason, below.

This review ran in the same session that planned and built the change. The reviewer wrote the code under review.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification
completeness**. It does **not** cover general code correctness — logic errors, edge cases,
efficiency, idiom.

General correctness was reviewed separately by `/code-review`, the Claude Code host reviewer (10 findings, triaged
under "Host code review").

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | All four phases shipped as planned. Six divergences, five recorded in `progress.md` (four decisions, one plan defect). One unrecorded: `e2e/support.ts`, named in Phase 3, was not changed (F3). No scope creep: `listResponses`, persistence, status classes and the search chips stayed out, as the plan's Out of scope says. |
| Convention compliance | 4/5 | AGENTS.md non-negotiables hold: one new named operation in `ipc-contract.ts`, validated with zod in `ipc.ts`, reached through `api.ts`, and served under `/api/*` behind the `http.ts` checks (ADR 0002). The coverage guard in `http.int.test.ts` includes it. Tests use `openTestDb` and `launchWithTestDatabase`, and no dependency was added (tech-stack). `test-strategy.md` T2.3 still reads "gap" (F4). |
| Lessons compliance | 5/5 | Neither standing rule applies: no new request shape reaches undici, and no spike was cited. Two 2026-11-23 observations were followed without being binding: rows are counted only through retrying assertions, and `expectNoCspViolations` is called. |
| Verification completeness | 4/5 | 4/4 done phases carry their commands and real output. Phase 3 and 4 mechanisms were each broken on purpose and shown red: the selection guard, the server mark, and passing `statuses` to search. The spec ran 3× clean, and the full suites are green. Gaps: the options' failure path and the count-0 option have no scenario (F1, F2). One unexplained failing run is recorded, not resolved (F5). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| Phase 1 test: `historyMark` "the same with and without a status selection" | Test that the mark moves when a 200 call is added while the 404-filtered list does not change | yes (Phase 1) | decision |
| `historyMark` in-flight part over the environment's calls | Process-wide in-flight count | yes (Phase 1) | decision |
| `statuses` added to the contract's `SearchQuerySchema` | Also added to the store's own `SearchQuery` interface | yes (Phase 2) | decision |
| Status facet in search (order unstated) | Sorted: codes ascending, No response last | yes (Phase 2) | decision |
| Phase 3 scenario: the responses strip lists a 200 sent while 404 is selected | Option counts asserted during a held send; strip asserted after completion | yes (Phase 3) | decision |
| Canonical selection by `join(',')` (plan review, revision 2) | `statusKeyOf` = JSON: `['']` and `[]` joined to the same key | yes (Phase 3) | defect, plan |
| A4: `history-grouping` closed before Phase 3 | Proceeded with `history-grouping` open; its remaining items (F1 CSP, F2 visual check) touch no code changed here | yes (Phase 3) | decision |
| Empty state: a code with no calls in the selected environment | The selected status's only call is deleted | yes (Phase 3) | decision |
| `src/index.css` ("styles", Phase 3) | `.status-filter` rules | yes (Phase 3) | as planned |
| `src/server/http.int.test.ts` (not named) | The coverage guard lists the new channel; asserts on `mark` and on a 200 option | yes (Phase 1) | decision |
| `e2e/support.ts` (Phase 3 Touches) | Unchanged; no new helper was needed | **NO** | unrecorded (F3) |

## Findings

### F1 — The status options' failure path has no scenario

- **Severity:** minor
- **Where:** `src/renderer/app.tsx` (`StatusFilter`, the `status-filter-error` paragraph); `e2e/status-filter.spec.ts`
- **Category:** verification
- **Finding:** The second plan review asked that a failed `listStatusCodes` leave the selected chips and × usable and
  show the failure. The code does this, but no test observes it. `stubOperation` can fail the operation in one
  scenario.
- **Disposition:** fix now
- **Because:** The scenario takes minutes with the existing helper. Without it, a later change can make the filter
  impossible to clear when the options fail, and nothing would report it.

### F2 — A selected code missing from the options, listed with count 0, has no scenario (covered since)

- **Severity:** minor
- **Where:** `src/renderer/app.tsx` (`StatusFilter`, the merge of `options` and `selected`)
- **Category:** verification
- **Finding:** Phase 3 promises that a selected code with no calls stays listed with count 0. In the empty-state
  scenario the deleted call is still held for Undo, so the server still counts it, and the count-0 branch never runs.
- **Disposition:** accept
- **Because:** It is a pure merge of two lists, with no server or timing involved. The chip, the scenario's visible
  check, stays covered. Covering the branch needs an environment switch or a finished delete, which costs more than
  the branch risks. Covered since: the F1 scenario asserts "404 · 0 calls" while the options fail.

### F3 — `e2e/support.ts` was named in the plan and not changed; the ledger does not say so

- **Severity:** nit
- **Where:** `plan.md`, Phase 3 Touches
- **Category:** drift
- **Finding:** The plan listed `e2e/support.ts`. The spec needed no new helper, and the ledger does not record that.
- **Disposition:** accept
- **Because:** The plan named the file as a possible location, not as a requirement. Nothing reviewed depended on it.

### F4 — `test-strategy.md` T2.3 still reads "gap"

- **Severity:** minor
- **Where:** `context/foundation/test-strategy.md`, T2.3
- **Category:** convention
- **Finding:** This change adds integration coverage for a history filter: `call-store.int.test.ts` "status
  filter" and `search.int.test.ts` "searchCalls by status". The T2.3 row still says "gap". Earlier changes recorded
  their coverage in the file's `revised:` lines.
- **Disposition:** accept
- **Because:** The row has been stale since `history-search` and `environment-aware-history`, which also added T2.3
  coverage. The file belongs to `lz-test-strategy`. A single update that names all three changes is worth more than
  one patch per change. Listed under Lessons candidates.

### F5 — One full run failed in `saved-requests.spec.ts` and one integration test, and did not reproduce

- **Severity:** minor
- **Where:** `progress.md`, Phase 4
- **Category:** verification
- **Finding:** One run of the gates took 10.9 minutes for e2e instead of 1.6. It failed `saved-requests.spec.ts:245`
  and `:387`, and one integration test the output did not name. Every rerun passed: the spec alone (9), the spec 3×
  (27), the full e2e suite (111) and integration (402).
- **Disposition:** accept
- **Because:** Neither spec touches the status filter, the failures coincide with a run six times slower, and the
  ledger records them as unexplained, not as fixed. If `saved-requests.spec.ts:245` fails again, it goes to
  `lz-debug`.

## Host code review

`/code-review` on the uncommitted change, 2026-11-24. Ten findings.

| # | Finding | Disposition | Because |
|---|---|---|---|
| 1 | `statusCondition` puts every matching send id in one `$in`/`$nin`. `distinct` and the query document are capped at 16 MB of BSON, and the ids are not scoped by environment. | accept | The limit is near 350k calls. The plan rated this risk low (Risks, A2), and `searchCalls` already reads every summary per query. The fix is a server-side aggregation over completions, which is a redesign. It belongs with the roadmap's "Search performance" item, where the History query cost is already recorded. |
| 2 | With No response selected, unreadable sends are listed but not counted | fixed | `listCalls` and `listResponses` drop unreadable records under a selection. Integration test. |
| 3 | An expanded group filtered on the client from the newest 500 calls can show none of the calls its count counts | fixed | `listResponses` takes `statuses` before its limit. Integration test with 501 calls. This was the plan's "For the reviewer" item. |
| 4 | Space toggles the active option, so a space cannot be typed | fixed | Space toggles only while the field is empty. e2e: "no r" narrows the list to No response. |
| 5 | In search, a failed search leaves the list showing "Loading…" with no error | fixed | The search's message is shown. e2e. |
| 6 | `listStatusCodes` reads every call on each refresh, even during a search, when its options are not shown | fixed (partly) | It no longer runs during a search. The full read outside search stays, with the same cost as `listRequestGroups`. It goes with #1 to the same roadmap item. |
| 7 | `historyMark` counts in-flight calls in every environment and adds two queries per poll | accept | This was a recorded decision (`progress.md`, Phase 1). The 500 ms poll runs only while a send is in flight (`app.tsx`, the `inFlightId` effect), not on every refresh. A send in another environment causes at most one extra refetch and never a missed one. |
| 8 | An environment switch refetches the views keyed on `historyMark` twice | dispute | It is not new. The previous key, built from the History list, also changed twice on a switch: once when the list became empty for the new environment, and once when the new list arrived. |
| 9 | Doc comments of `RequestGroup` and `HistoryList` were left above the new code | fixed | Moved back. |
| 10 | The status order and the no-response rule existed twice, in the store and in the renderer | fixed | `src/core/status.ts`, imported by both. |

## Lessons candidates

- **An empty string as an enum value collides with an empty list under `join`.** `['']` and `[]` give the same key.
  The convention "`''` means none" comes from `history-search` and is reused here. No prior incident is known. A second
  incident with the same convention would justify a rule on how keys are built.
- **A planned scenario that cannot observe its defect.** The plan's strip scenario passed with the fix missing,
  because a completed send already refreshes the views. The plan review caught it before code existed. This is a
  second mechanism for the 2026-11-06 entry "A test named for a behaviour passed with that behaviour broken".
  `lz-lessons` decides whether that entry is now a class.
- **`test-strategy.md` rows not updated when coverage is added** (F4). Three changes in a row added T2.3 coverage and
  left the row at "gap".

## For the archive record

- The server returns an unfiltered `mark` with History's list. Every view keyed on `historyMark` refreshes on it, so
  a filter on the list can never stop them refreshing.
- The status lives on the completion. `statusCondition` resolves a selection to send ids before `limit`; `''` (No
  response) uses `$nin` over the completions that have a response.
- The selection key is JSON, not `join`: `['']` and `[]` joined to the same key, and the Clear scenario caught it.

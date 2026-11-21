---
change_id: openapi-import
produced-by: lz-review
verdict: merge
created: 2026-11-21
updated: 2026-11-21
reviewed: branch openapi-import against history-search, 3 phases, plan revision 1
delegated-to: /code-review (2026-11-21), results under Host code review
---

# Review: OpenAPI import

## Verdict

**merge.** This review ran in the session that built the change.

## Scope of this review

Covers plan drift, conventions, lessons and verification. Does **not** cover general correctness. That is delegated to
`/code-review`.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | The planned files and phases, and two recorded decisions. |
| Convention compliance | 5/5 | The contract pattern is followed. The server parses the spec again. `src/core/openapi.ts` has no Node imports, so the UI can use it. No new dependency. |
| Lessons compliance | 5/5 | No new request shape. A template sends through the existing path. |
| Verification completeness | 3/5 | The phase 2 store tests were not watched failing. The ledger says so. |

## Findings

### F1: phase 2 store tests not seen red
- **Severity:** minor · **Disposition:** accept. The contract test was red first, and the store tests check behaviour
  the plan names.

## For the archive record
- One parser serves both preview and import.
- Templates open unlinked, by the roadmap decision.

## Host code review

`/code-review history-search...openapi-import` ran on 2026-11-21 and reported 9 findings: 8 fixed, 1 accepted in part.

| # | Finding | Disposition |
|---|---|---|
| 1 | A TRACE template listed but could not open | fixed, unit test |
| 2 | A server URL with variables made unopenable templates | fixed, integration test |
| 3 | `openTemplate` had no latest-open guard | fixed |
| 4 | A failed import left an orphan source | fixed |
| 5 | Object examples became "[object Object]"; path parameters stay `{id}` | fixed (examples); path parameters accepted |
| 6 | A file-pick race | fixed |
| 7 | Quadratic grouping in `list` | fixed |
| 8 | Quadratic grouping in the parser and the tree | fixed |
| 9 | Template id validated with the call-id schema | fixed |

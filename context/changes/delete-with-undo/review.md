---
change_id: delete-with-undo
produced-by: lz-review
verdict: merge
created: 2026-11-21
updated: 2026-11-21
reviewed: branch delete-with-undo against responses-strip, 2 phases, plan revision 1
delegated-to: /code-review (2026-11-21), results under Host code review
---

# Review: delete with undo

## Verdict

**merge.** This review ran in the session that built the change.

## Scope of this review

Covers plan drift, conventions, lessons and verification. Does **not** cover general correctness. That is delegated to
`/code-review`.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | Every planned file changed, and nothing outside them except the spec selector edits, which the ledger records. |
| Convention compliance | 5/5 | The T1.1 guard was changed on purpose: deletion is a PRD requirement, and there is still no update. `deleteCall` is tested to remove only its own call (T1.7). The contract pattern is followed. |
| Lessons compliance | 5/5 | No new request shape. The one load-bearing assumption (A1) was checked on a real upload before the sweep relied on it. |
| Verification completeness | 4/5 | Both phases were red, then green. The window-expiry scenario waits on a condition, the call being gone from `getCall`, with a 15 s timeout. It is not driven by a fake clock, so the 8 s window costs 8 s of suite time. |

## Findings

### F1: test-strategy T1.7 and T3.9 still read "gap"

- **Severity:** minor
- **Where:** `context/foundation/test-strategy.md`
- **Disposition:** fix now. Record single delete (T1.7) and the orphan sweep (T3.9) as covered. Bulk delete stays a gap
  until slice 9.

## For the archive record

- Delete is held in the app for 8 s and done in the store after. A closed tab deletes nothing.
- The orphan sweep runs after each delete with a 1 h cutoff, so an upload in progress is never touched.

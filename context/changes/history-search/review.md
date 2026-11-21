---
change_id: history-search
produced-by: lz-review
verdict: merge
created: 2026-11-21
updated: 2026-11-21
reviewed: branch history-search against delete-with-undo, 2 phases, plan revision 1
delegated-to: /code-review (2026-11-21), results under Host code review
---

# Review: history search

## Verdict

**merge.** This review ran in the session that built the change.

## Scope of this review

Covers plan drift, conventions, lessons and verification. Does **not** cover general correctness. That is delegated to
`/code-review`.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | The planned files, and one recorded decision: the carried item moves to "Not ordered yet". |
| Convention compliance | 5/5 | The contract pattern is followed. Resend goes through `replay`, so T1.1 holds, and the scenario checks the originals deep-equal. Bulk delete goes through the held delete. |
| Lessons compliance | 5/5 | No new request shape. |
| Verification completeness | 4/5 | Both phases were red, then green, with output. Search over bodies stored as files is a stated gap, not tested. |

## Findings

### F1: bodies stored as files are not searched

- **Severity:** minor
- **Disposition:** accept. The UI says so. Bodies over 1 MiB are rare, and reading them on every search costs seconds.

## For the archive record

- Search runs in Node over call summaries. It reads bodies only for calls not already matched by the URL or headers.
- Facet counts are standard faceted counts, each excluding its own filter.

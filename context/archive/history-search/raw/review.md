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

## Host code review

`/code-review delete-with-undo...history-search` ran on 2026-11-21 and reported 10 findings.

| # | Finding | Disposition |
|---|---|---|
| 1 | A deleted call came back in the results past 200 calls | fixed |
| 2 | Deleting the opened call left the results | fixed, e2e |
| 3 | Opening a call from a call lost the way back | fixed |
| 4 | Bulk actions included calls in flight | fixed |
| 5 | Resend failures were silent, and a double click resent twice | fixed, e2e |
| 6 | Search loads every summary on each query | fix later: roadmap "Not ordered yet", search performance |
| 7 | An unrepresentable date left the search stuck | fixed |
| 8 | Long Authorization values failed the query schema | fixed |
| 9 | The summary omitted most filters | fixed |
| 10 | The Authorization lookup was written three times | fixed (`src/core/headers.ts`) |

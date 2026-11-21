---
change_id: responses-strip
produced-by: lz-review
verdict: merge
created: 2026-11-21
updated: 2026-11-21
reviewed: branch responses-strip against workspace-shell, 2 phases, plan revision 1
delegated-to: /code-review (2026-11-21), results under Host code review
---

# Review: responses strip

## Verdict

**merge.** Both phases are evidenced, the drift is recorded, and no ADR or lesson is crossed. This review ran in the
session that built the change.

## Scope of this review

Covers plan drift, conventions, lessons and verification completeness. Does **not** cover general code correctness. That
is delegated to `/code-review`.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | Every file named in the plan was changed, and nothing else. Two decisions are recorded. |
| Convention compliance | 5/5 | The new operation follows the contract pattern: a channel, a zod input, a handler that returns results and never rejects, and the client. `src/core/` does not import the UI. No CORS, no CSP change. |
| Lessons compliance | 5/5 | No new request shape is sent, so the undici probe rule does not apply. |
| Verification completeness | 5/5 | Both phases were red first and are green, with output. The e2e scenarios ran 3×. |

## Findings

### F1: the path query scans `sends`

- **Severity:** minor
- **Where:** `src/core/call-store.ts` `listResponses`
- **Category:** performance (in the plan's Out of scope)
- **Disposition:** fix later. Ticket: roadmap slice 9 ("search, filter"), which needs indexes for its facets anyway.
- **Because:** at the volume of one person's personal history, a scan is cheap.

## For the archive record

- "The same request" is the method plus the URL pathname, with the query, fragment and host left out. Screen 01 is the
  evidence for this decision.
- One query serves both strips. It covers every call up to 500, not only History's newest 200.

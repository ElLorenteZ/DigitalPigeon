---
change_id: wsdl-import
produced-by: lz-review
verdict: merge
created: 2026-11-21
updated: 2026-11-21
reviewed: branch wsdl-import against reimport-and-errors, 3 phases, plan revision 1
delegated-to: /code-review (2026-11-21), results under Host code review
---

# Review: WSDL import

## Verdict

**merge.** This review ran in the session that built the change.

## Scope of this review

Covers plan drift, conventions, lessons and verification. Does **not** cover general correctness. That is delegated to
`/code-review`.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | As planned. |
| Convention compliance | 5/5 | The new dependency is recorded in `tech-stack.md`, and the contract pattern is followed. |
| Lessons compliance | 5/5 | "Probe what undici does": both SOAP header shapes are probed on the wire (`wsdl.int.test.ts`). "List what a spike did not try": the spike record has a Not tried list, and the plan cites it only for what it tried. |
| Verification completeness | 4/5 | The wire probe was not run red first. It confirms a prediction rather than specifying behaviour. |

## For the archive record

- WSDL names are resolved by namespace URI, never by stripping prefixes.

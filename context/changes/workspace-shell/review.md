---
change_id: workspace-shell
produced-by: lz-review
verdict: merge
created: 2026-11-21
updated: 2026-11-21
reviewed: branch workspace-shell against main (38082a2), commits 35abf12..c0282bc, 3 phases, plan revision 1
delegated-to: /code-review (2026-11-21), results under Host code review
---

# Review: workspace shell

## Verdict

**merge.** Every phase is evidenced, every drift is recorded as a decision, and no ADR or standing lesson is crossed.

**This review ran in the same session that planned and built the change.** The host code review is the independent
check.

## Scope of this review

Covers plan drift, conventions, lessons and verification completeness. Does **not** cover general code correctness. That
is delegated to `/code-review`; its results are recorded below.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | All 22 files trace to a phase: `src/renderer/app.tsx`, `src/index.css`, `e2e/*` and the change folder. 4 divergences, all recorded as decisions: Back to the call; `aria-label` panels; `scrollbar-gutter`; phases 2 and 3 in one commit. Nothing outside `src/renderer/`, `src/index.css` and `e2e/`. |
| Convention compliance | 5/5 | The CSP is unchanged. The UI calls only `pigeon` operations. No web fonts and no new dependency. Bodies are still shown as text or in a read-only Monaco (T1.8): `body-safety.spec.ts` passes, with no CSP violations recorded. |
| Lessons compliance | 5/5 | No new request shape, so the undici probe rule does not apply. No spike was run or cited. |
| Verification completeness | 4/5 | Every phase carries command output. Phase 1's scenarios were seen failing first. Phases 2 and 3 share one verification; the ledger says so. Visual fidelity is judged by eye against two screenshots, and the differences are listed. |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| Back to the request only | Also "Back to the call" in the workspace | yes (phase 1) | decision |
| Tab panels labelled by their tab | `aria-label` | yes (phase 1) | decision |
| — | `scrollbar-gutter: stable` on `.main` | yes (phase 1) | decision |
| Phases 2 and 3 as two commits | One commit | yes (phase 3) | decision |
| `← Request` back button | "Back to the request" (the arrow is `aria-hidden`) | yes (phase 1 Changed) | decision |

## Findings

### F1: e2e step edits were applied by script

- **Severity:** minor
- **Where:** `e2e/*.spec.ts`
- **Category:** verification
- **Finding:** The tab, view and accessible-name edits were inserted by two transform scripts, then corrected by hand.
  Each edited journey passes, and its title is unchanged. A navigation step inserted where none was needed is a no-op,
  because each helper checks the state first. It is still noise in the specs.
- **Disposition:** accept
- **Because:** the helpers are idempotent, and 60 of 60 pass in 51 s.

### F2: the request body is not the design's numbered editor

- **Severity:** minor
- **Where:** `BodyEditor`
- **Category:** drift from the design (recorded in phase 3)
- **Finding:** Screen 01 shows the request body in a numbered code editor. The app keeps a textarea.
- **Disposition:** fix later. Ticket: roadmap "Not ordered yet", "Editable request body in the code editor".
- **Because:** an editable Monaco changes how the form's text state is held. That is behaviour, not shell.

## Lessons candidates

- **Machine load changes e2e timing by 10–20×.** A journey failed at 3.1 minutes under a load average of 9–26 and passed
  in 1.6 s alone. One incident.

## For the archive record

- The shell is a structural change to `App`: two views (workspace and call), sidebar tabs and request tabs, all with
  mounted, `hidden` panels.
- The e2e helpers (`showRequestTab`, `showSidebarTab`, `showRequest`, `showCall`, `openEnvironments`,
  `chooseBodyType`, `rowName`, `containing`) are how journeys move around the shell. New journeys should use them.
- Monaco's automatic layout and a pane scrollbar can resize each other in a loop. `scrollbar-gutter: stable` stops it.

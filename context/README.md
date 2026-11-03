---
stage: 2
produced-by: lz-context
updated: 2026-11-02
---

# Project context

This directory is the **artifact ledger** for agent-assisted work on this repo.
It holds what the code cannot tell you: intent, rejected alternatives, and
lessons learned. It is committed and reviewed in pull requests like code.

If you are new here, read `foundation/prd.md` first, then the most recent
record under `archive/`.

## Layout

| Path | Holds | Written by |
|---|---|---|
| `changes/<id>/` | One folder per unit of work, from intent to merge | `lz-change` opens it; each skill adds its own file |
| `archive/<id>/record.md` | Distilled record of a finished change — what was built, what was rejected | `lz-archive` |
| `foundation/` | Long-lived, project-wide truths. One of each. | see below |
| `foundation/decisions/` | ADRs — one file per decision, immutable once accepted | `lz-adr` |
| `scaffold-verification.md` | How the repo was bootstrapped, and the checks run afterwards | `lz-scaffold` |

| `foundation/` file | Holds | Written by |
|---|---|---|
| `shape-notes.md` | Discovery record: appetite, scope, explicit exclusions | `lz-shape` |
| `prd.md` | What is being built and why | `lz-spec` |
| `tech-stack.md` | Stack choice or assessment, with rationale | `lz-stack` |
| `infrastructure.md` | Where it runs, and what was rejected | `lz-infra` |
| `roadmap.md` | Milestones and vertical slices | `lz-roadmap` |
| `test-strategy.md` | Risk tiers and quality gates | `lz-test-strategy` |
| `lessons.md` | Durable rules learned the hard way | `lz-lessons` |
| `map.md` | Module ownership, boundaries, hotspots | `lz-map` |
| `health.md` | Dependency, security and CI readiness | `lz-health` |

Files listed here but absent from disk have not been produced yet.

## Rules

- **One producer per file.** If you are unsure who writes something, nobody
  should overwrite it by hand — run the skill that owns it.
- **Everything carries `updated:` and `produced-by:`.** A reader can then judge
  for themselves whether it is still true. Stale beats absent, but only if dated.
- **Nothing here is regenerated from the code.** If an agent could reconstruct a
  file from the repository in five minutes, it does not belong here.
- **Nothing here is personal notes.** Project memory only.

## Current stage: 2 — Foundation

Single module, single contributor. `foundation/` holds the project-wide
decisions; `changes/` and `archive/` hold per-change work.
Escalate to stage 3 when a module's conventions contradict the root rules.

Run `/lz-context` to re-survey the repo and escalate when a signal appears.

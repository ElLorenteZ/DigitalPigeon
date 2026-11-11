---
change_id: saved-requests-and-environments
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-11
updated: 2026-11-11
reviewed: working tree on branch saved-requests-and-environments against main at 11d828e (21 files outside context/); plan.md revision 2, 5 phases; progress.md
delegated-to: /code-review, two passes (2026-11-11; 10 findings each, triaged below). The second pass's fixes have not had a third
---

# Review: Save and edit requests, and send them to the active environment's baseUrl

## Verdict

**merge-with-fixes** — the change matches its plan, every divergence is recorded with a reason, and every phase is
evidenced; F1 and the fixes from two `/code-review` passes are done. The second pass found that one first-pass fix
(CR7's rename) had been recorded as done without running; it is now done and the record corrected.

**This review was written in the same session that planned and built the change.** The reviewer wrote the code and the
ledger. Weigh the plan-adherence and verification scores with that in mind; the red evidence and mutation results in
`progress.md` are the independent part.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification completeness**. It does
**not** cover general code correctness — logic errors, edge cases, efficiency, idiom.

General correctness was reviewed separately by `/code-review`, twice (2026-11-11). Findings and dispositions are
below; the second pass's fixes were not reviewed by a third.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | All five phases built as planned; nine divergences, each recorded in `progress.md` as a decision or a defect with its reason; nothing outside `change.md`'s boundary. |
| Convention compliance | 4/5 | `AGENTS.md`: mongodb stays in main (`environment-store.ts`, `saved-request-store.ts` in `src/core/`, no `electron` import); each new preload function is named and validated with `zod` in main; CSP and `webPreferences` untouched; tests use `openTestDb()` and `launchWithTestDatabase()`. The preload surface grew from eight to sixteen functions, one per operation, as the plan's reviewer section flagged. |
| Lessons compliance | 5/5 | Standing rule "Probe what undici does": no new method, body type or header rule; T1.3 runs with a composed URL (A1). Standing rule "List what a spike did not try": A4 cites the multipart spike's host and Not tried item, and phase 4 checks main → renderer at 17 MiB. ADR 0001: one flat list by name. |
| Verification completeness | 5/5 | Every phase `done` with the plan's command and its output (in each phase's last section), red evidence or a mutation per test, e2e repeats of 3 or more, and all gates (unit 344, integration 305, e2e 44, typecheck, lint). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| Deleted-environment refusal on the send path | In `resolveEnvironment`, called by the send handler before `sendAndRecord` | yes (phase 1) | decision |
| Review R1 left open | A full URL records no environment and is never refused for one | yes (phase 1) | decision |
| Round trip compared as wire requests | Compared as forms; multipart boundaries are random per build | yes (phase 3) | decision |
| Blank saved-request name not specified | Refused, as for environments | yes (phase 3) | decision |
| Labels "Environment base URL" | "Environment base address": `getByLabel('URL')` matched any label with "URL" | yes (phase 2) | decision |
| — | "Add environment" cleared fields typed during a save; fixed | yes (phase 2) | defect (found by e2e) |
| R2 left open | A deleted saved request is not linked; the UI also unlinks on delete; main tested in `ipc.int.test.ts` | yes (phase 4) | decision |
| — | Save as new disabled while unlinked | yes (phase 4) | decision |
| Edit → Save as new in the outcome scenario | Save, since the edited form is unlinked | yes (phase 5) | decision |

Not named in the plan and not drift: `src/core/form-from-call.test.ts` (tests for `form-from-call.ts`, which phase 1
names) and `src/main/ipc.int.test.ts` (where phase 4 records R2 is tested). `saved-request-store.ts`'s `exists(id)` is
listed under phase 4's Changed; it serves R2.

Inventory note: `diff-vs-plan.sh` reported phases 2, 4 and 5 as `in-progress` with no output. It read each phase's
first section, the routing entry from lz-tdd; the last section, which the ledger schema makes authoritative, is
`done` with output. The same misread occurred in `multipart-with-file-copies`.

## Findings

### F1 — Copy as curl refusing a path with no environment had no test

- **Severity:** minor
- **Where:** `e2e/environments.spec.ts`, scenario (2)
- **Category:** verification
- **Finding:** Plan phase 2: "Copy as curl from the form composes with the active environment, or refuses a path with
  none active." The refusal was implemented (`composeUrl` throws inside `exportCurl`) and no test reached it.
- **Disposition:** fix now — done
- **Because:** author, 2026-11-11. Scenario (2) now presses Copy as curl after the refused send; a mutation that stops
  composing failed it ("Invalid URL" instead of the reason). 3 repeats clean. Ledger: "Review follow-up — F1".

## Code review findings

From `/code-review`, first pass (2026-11-11). Unverified by the reviewer; each was checked against the code before
triage. Dispositions by the author ("go ahead", 2026-11-11). Fixes and evidence: `progress.md`, "Code review follow-up".

| # | Finding | Disposition |
|---|---|---|
| CR1 | A Save finishing after New or another open linked the replaced form to what it saved; the next Save overwrote it | fix now — done |
| CR2 | A slow open of a saved request replaced what was typed, sent or loaded by Edit meanwhile | fix now — done |
| CR3 | Replay copies the original's saved-request link even after that saved request was deleted; Send drops it (R2) | accept — the plan has Replay keep the original's link (Approach), so slice 6's filter by saved request finds replays; the panel says "deleted" |
| CR4 | The panel called a call's saved request deleted whenever the list had not loaded or failed | fix now — done |
| CR5 | Quick environment choices could store an older one for startup | fix now — done |
| CR6 | The 1 MiB inline budget ignores rows and field values; a field over 16 MB fails the save and leaves files | accept — needs a field over 16 MB; the failure is shown; known limit in `test-strategy.md` |
| CR7 | The saved-request IPC wrapper duplicated the environment one and reused environment-named schemas | fix now — done; the rename was first recorded as done when it had not run (macOS `sed` without `\b`), found by the second pass and corrected (`progress.md`, "Correction") |
| CR8 | The store redefines its row schema and its own inline rule | accept — its body schema holds file references by design, and its inline rule counts across parts |
| CR9 | The send handler and the environment list made sequential database round trips | fix now — done |
| CR10 | `Form` derived from `SendInput`, which now carries the environment and saved-request ids | fix now — done |

### Second pass

| # | Finding | Disposition |
|---|---|---|
| R1 | Two Save presses before the first reply created two saved requests | fix now — done |
| R2 | A path with `.` or `..` segments left the environment's base path while recording the environment | fix now — done |
| R3 | A driver failure in the lookups before recording reported `unexpected`, not `database-unavailable` | fix now — done |
| R4 | Replay keeps a deleted saved request's link | accept — same as CR3 |
| R5 | One rejected save of the environment choice stopped every later choice from being stored | fix now — done |
| R6 | Inline budget ignores rows and field values | accept — same as CR6 |
| R7 | Saving over a request leaves its old files in GridFS | accept — out of scope by plan; slice 7 finds them (author: "Keep the file bytes") |
| R8 | Saved-request handlers still used environment-named schemas | fix now — done; this was CR7's rename, recorded as done when it had not run |
| R9 | `EnvironmentSchema` duplicated `EnvironmentSnapshotSchema` | fix now — done |
| R10 | A list error stayed on screen after a later successful load | fix now — done; untested (needs a database reconnect) |

## Lessons candidates

- **State captured before an await, applied after it** — six instances across two changes (CR1 and CR2 here added
  two after this list was first written): CR1 and CR2 in
  `multipart-with-file-copies`, and "Add environment" clearing fields after its save here (phase 2 defect). The
  2026-11-03 observation (a renderer re-fetch racing a write in main) is related. A specific shared check exists: any
  `await` in a renderer handler followed by a state write must compare against the state at resolution, or be guarded
  by a latest-wins counter. Candidate for a standing rule.
- **A fix recorded as done that had not run** — CR7's rename: `sed -E` with `\b` on macOS matched nothing, and the
  gates stayed green because nothing changed. A refactor's evidence was "gates green", which an unapplied change also
  produces. One incident. A check for a rename: `grep` for the old name returns nothing.
- **A test crashed its worker instead of failing** — second incident (phase 3's 17 MiB `toEqual`, after slice 4's
  `toHaveBeenCalledWith`), in a file written after the first was recorded in an archive record. The check is
  specific: a large value is compared by length and digest. Candidate for a standing rule.
- **A scenario that cannot detect the regression it is named for** — B1's first scenario passed under the mutation 5
  of 5, because timing hid the race; a held handler made it deterministic. One incident; same family as "A test named
  for a behaviour passed with that behaviour broken" (2026-11-06, observation).

## For the archive record

- A path is joined to the environment the send names by id, loaded in main; a full URL uses none. Calls hold an
  environment snapshot and a saved-request id; Replay copies both; Edit restores the path.
- Saved requests keep their bytes (inline to 1 MiB, then GridFS); saving over or deleting leaves files for slice 7.
- Fragile: `e2e/saved-requests.spec.ts`'s overlap scenario uses Electron's private `ipcMain._invokeHandlers`; the B1
  scenario holds `setActiveEnvironment` and must stay last in its file.

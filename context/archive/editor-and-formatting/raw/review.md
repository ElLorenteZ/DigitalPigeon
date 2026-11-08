---
change_id: editor-and-formatting
produced-by: lz-review
verdict: merge
created: 2026-11-08
updated: 2026-11-08
reviewed: main (merge-base 0250bf69) + working tree on branch editor-and-formatting; plan revision 6; 4 phases
delegated-to: /code-review, one pass on the working tree (2026-11-08), 8 findings; 1, 2, 4, 6 fixed, the rest accepted by the author
---

# Review: Show JSON and XML bodies pretty-printed in the editor, with stored bytes unchanged

## Verdict

**merge** — every phase is evidenced, every divergence recorded, and the code review's chosen findings are fixed. F1 is resolved: `npm run test:e2e`
completed on commit `1fe3beb`, 26 passed (progress.md, "Review finding F1").

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification completeness**. It does **not** cover general code
correctness — logic errors, edge cases, efficiency, idiom.

General correctness was reviewed separately by `/code-review`, one pass on the working tree, 2026-11-08 (see "Code review" below). No second
pass has run on the fixes.

This review ran in the same session that planned and built the change. The reviewer wrote the code under review.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | Shipped matches revision 6. Four plan defects surfaced in execution (phase 2: workers started, a worker file bundled, BOM not drawn; phase 4: Monaco services registered late); each stopped the phase and went through `lz-plan revise` and `lz-plan-review`. Ten execution decisions, all recorded with reasons. No unrecorded drift found. |
| Convention compliance | 5/5 | `AGENTS.md`: no `dangerouslySetInnerHTML` in the shipped code (used only in a reverted mutation); `contextIsolation`, `sandbox`, `nodeIntegration` and the CSP unchanged, `setWindowOpenHandler` adds a restriction; `src/core/body-format.ts` imports nothing from Electron or the renderer; renderer and preload bundles hold no `MongoClient`, `undici` or `GridFSBucket`; e2e uses `launchWithTestDatabase()` and only one pre-existing `dp_test_` database remains. `tech-stack.md` chose Monaco; `monaco-editor` is pinned exactly at 0.57.0. |
| Lessons compliance | 3/5 | Standing rule "List what a spike did not try, and cite it only for what it tried": `spike-monaco.md` has a Not tried list, but plan revisions 2 to 4 marked A2 "verified" for this renderer, which that list names as not tried (F2). Standing rule "Probe what undici does": not applicable, no send or wire change. |
| Verification completeness | 4/5 | 4 of 4 phases and the code review fixes done with command output; the suite at 26 tests passed three times after the fixes. Phase 4's gate ran as `npx playwright test` on the `.vite/` build, 25 passed three times; `npm run test:e2e` did not complete (F1). The packaged `.app` was checked by the author's eye; its console is unreadable (F5). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| No `MonacoEnvironment`; no worker (revisions 2–4) | Editor and JSON workers from `file://` via `getWorker` | yes — phase 2 blocked entry, revision 5 | defect, resolved by revision |
| No worker file in the bundle | `editor.worker` and `json.worker` files | yes — phase 2 | defect, resolved by revision 5 |
| Raw keeps a leading BOM | Label notes the BOM; Monaco does not draw it | yes — phase 2 | defect, resolved by revision 5 |
| `editor.api.js` plus JSON and XML runs with a clean console | Eager import of `internal/common/workers.js` | yes — phase 4 blocked entry, revision 6 | defect, resolved by revision |
| Worker via `new Worker(new URL(…))` | Vite `?worker` imports | yes — phase 2 | decision |
| Files listed for phase 2 | `src/declarations.d.ts` added (`*?worker` types) | yes — phase 2 | decision |
| BOM note in the JSON/XML label | Also a standalone note for raw-kind bodies | yes — phase 2 | decision |
| A9 timing before the wiring | Timed on the wiring | yes — phase 3 | decision |
| Phase 3 files | `e2e/support.ts` `bodyEdge`; components reshaped into `useBodyEditor`, `BodyViewLabel` | yes — phase 3 | decision |
| Phase 3 behaviour | Trailing CR held back across pages (fix for an observed double line break) | yes — phase 3 cycle 3 | within the phase's own observation |
| New T2.10 test in `bodies.spec.ts` | Not written; `open-call-failures.spec.ts` covers it | yes — phase 4 | decision |
| `toBeInViewport()` checks | 90% of the body area, 100% of the remaining count | yes — phase 4 | decision |
| Stored JSON test | Adds a wheel scroll and an ordering check | yes — phase 4 | decision |
| `npm run test:e2e` | `npx playwright test` on the `.vite/` build | yes — phase 4 | decision (network), see F1 |

`package-lock.json` changed with `package.json` (the pinned dependency). `AGENTS.md` is named by the plan as a constraint, not a file to change.

## Findings

### F1 — The e2e gate command has not completed on this branch

- **Severity:** minor
- **Where:** `context/changes/editor-and-formatting/progress.md`, phase 4 Verification
- **Category:** verification
- **Finding:** `npm run test:e2e` failed in its packaging step (`fetch failed`, earlier `Response code 504`) downloading Electron 45.2.1 from
  github.com. The specs it runs passed 25 of 25 three times on the `.vite/` build that step produced first. The packaged `.app` was last built in
  phase 2, before the eager import of `internal/common/workers.js`.
- **Disposition:** fix now — **resolved** 2026-11-08: `npm run test:e2e` on `1fe3beb`, packaging done, 26 passed (progress.md)
- **Because:** the gate in `test-strategy.md` is the full command, and the packaged build includes the asar and fuses the Vite build does not.
  Run `npm run test:e2e` once github.com is reachable, and record the result in the ledger.

### F2 — Plan revisions 2 to 4 cited the spike for a renderer it did not run

- **Severity:** major
- **Where:** `context/changes/editor-and-formatting/plan.md`, Assumptions A2 (revisions 2–4); `spike-monaco.md` "Not tried"
- **Category:** lesson
- **Finding:** A2 was marked "verified: no `MonacoEnvironment`, no worker requested" from `spike-monaco.md`, whose Not tried list includes "This
  repository's renderer: React, `StrictMode`, the preload and IPC". In this renderer the editor worker started and fell back to `blob:`, blocked by
  the CSP. The standing rule's Check — "each plan assumption citing a spike uses wording the spike's output supports" — was not met. Two plan
  reviews accepted the wording.
- **Disposition:** accept
- **Because:** found by phase 2's own observation before merge, recorded as a defect drift, and corrected in revision 5; the shipped code does not
  depend on the spike's worker result.

### F3 — Phase 2's clean-console observation listened to console messages only

- **Severity:** minor
- **Where:** `progress.md`, phase 2 Verification ("console errors and CSP lines at the end: []")
- **Category:** verification
- **Finding:** Phase 2 recorded no console errors, but its listener did not record uncaught page errors. Five Monaco service errors were thrown
  in that build and surfaced in phase 4.
- **Disposition:** accept
- **Because:** recorded in the phase 4 entry and in revision 6; `e2e/body-safety.spec.ts` now records both channels, so the suite fails on them.

### F4 — Two e2e checks are weaker than they read

- **Severity:** minor
- **Where:** `e2e/bodies.spec.ts` (17 MiB test), `e2e/body-safety.spec.ts` (Cmd+click)
- **Category:** verification
- **Finding:** The 17 MiB test checks the loaded length and the first and last 12 characters, so text counted but missing from the middle of the
  model passes. The links-on mutation failed one or two content types per run, not the same ones, because Monaco detects links asynchronously.
- **Disposition:** accept
- **Because:** author decision, 2026-11-08. Both are recorded in `test-strategy.md` and the ledger; content is covered by the formatter's unit tests
  (T2.6), and the links-on mutation failed the suite in every run.

### F5 — T1.8's CSP check ran on the Vite build only

- **Severity:** minor
- **Where:** `progress.md`, phase 2 packaged `.app` observation
- **Category:** verification
- **Finding:** The packaged app writes nothing to its log with `ELECTRON_ENABLE_LOGGING`, so its console was not observed. The author confirmed
  a JSON body shows Pretty and highlighted there.
- **Disposition:** accept
- **Because:** the renderer bundle in the asar is the `.vite/` output the e2e specs run against, and `test-strategy.md` already states the packaged
  `.app` is outside e2e (its fuses disable the inspector). Recorded under T1.8's known limits.

### F6 — Switching views on a loaded 17 MiB body holds the window for about 1.1 to 1.3 s

- **Severity:** minor
- **Where:** `src/renderer/app.tsx`, `PagedBodyText` `rebuild`
- **Category:** drift
- **Finding:** The plan asked for the time to be recorded and set no limit. Switch to Raw took 1101 ms, back to Pretty 1322 ms.
- **Disposition:** accept
- **Because:** author decision, 2026-11-08; it occurs only after loading all pages of a 17 MiB body, in daily manual use (T3.10, T3.2).

### F7 — Phase 1's test file holds four literal U+FEFF characters

- **Severity:** nit
- **Where:** `src/core/body-format.test.ts`
- **Category:** convention
- **Finding:** `oxfmt --write` turned the `﻿` escapes into literal invisible characters. The tests behave the same.
- **Disposition:** accept
- **Because:** `oxfmt --write` rewrites the escapes whenever the file is formatted (seen in phase 1; whether `npm run lint` would reject the escapes
  was not checked); an editor that strips the character would make a test fail, not pass.

## Code review

`/code-review` reported 8 findings. The author's triage, 2026-11-08: "fix 1, 2, 4, 6, accept the rest". Fixes are recorded in `progress.md`,
"Code review fixes".

| # | Finding | Disposition | Evidence or reason |
|---|---|---|---|
| CR1 | `BodyBoundary` never resets, so a body that failed to show leaves its error on the next call opened | fixed | keyed per body; new e2e test seen red (`Expected: 0 Received: 1`), then green |
| CR2 | `PagedBodyText.setView` rebuilds in a click handler, outside any error boundary | fixed | try/catch shows "Could not show the body"; no test, a failed rebuild cannot be arranged from the page |
| CR3 | Switching views on a large paged body re-formats every page at once and holds the text twice | accept | the same cost as F6 (about 1.2 s at 17 MiB); memory is T3.10, manual |
| CR4 | Paged JSON uses the `json` language: the worker validates the unfinished document and re-parses it after every page | fixed | JSON diagnostics and worker features off, tokens kept; observed: the JSON worker no longer starts |
| CR5 | A held-back CR is lost if a later page read fails | accept | one trailing line break, in a body whose loading already failed |
| CR6 | `MonacoBody` builds its model twice on every mount | fixed | the model is set only by its effect; no test, model creation is not observable from the page |
| CR7 | Pretty/Raw state is kept two different ways; the inline choice resets when the bytes are fetched anew | accept | maintenance only; the reset happens only when the call is opened again |
| CR8 | `bodyKind` does not recognise `text/json` | accept | the type list came from the plan; NDJSON is not one JSON document |

## Lessons candidates

- **F2: a third incident of "cite a spike only for what it tried".** The Not tried list existed and named the gap; the plan still marked the
  assumption "verified", and two plan reviews accepted it. A narrower check may be worth considering: an assumption marked verified from a spike
  names the spike's host (here, a bare Vite and Electron app) and lists which Not tried items it depends on. Prior incidents:
  `preview-replay-export`, `request-bodies-and-storage`.
- **F3: an observation that a console is clean must record uncaught page errors too.** First known incident; no prior.
- **Monaco's lazily loaded language features register services after the first editor.** Library behaviour, specific to Monaco 0.57.0 imported
  through `editor.api.js`. First known incident; likely an observation, not a rule.

## For the archive record

- Monaco ran under the unchanged CSP only after three corrections the spike did not predict: workers configured from `file://`, a leading BOM
  noted in the label because Monaco does not draw it, and an eager import of `internal/common/workers.js` so lazily loaded contributions register
  their services before the first editor.
- What still stands: `wordWrap` on a 17 MiB single line appends in about 120 ms per page; switching views on 17 MiB takes about 1.2 s; a CRLF split
  across pages is held back by one CR; the packaged app's console is unreadable, so its CSP is checked on the Vite build only.
- If the editor breaks after a Monaco upgrade, check first: the `?worker` entry paths, the `internal/common/workers.js` import, and
  `body-safety.spec.ts`'s console assertion.

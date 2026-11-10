---
change_id: multipart-with-file-copies
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-09
updated: 2026-11-09
reviewed: working tree on branch multipart-with-file-copies against main at 00dc9d3 (17 files outside context/, 1164 insertions, 65 deletions); plan.md revision 3, 6 phases; progress.md
delegated-to: /code-review (first pass, 2026-11-09; 10 findings, triaged below). The fixes have not had a second pass
---

# Review: Send multipart requests with files, keeping a stored copy so replay survives file deletion

## Verdict

**merge-with-fixes** — the change matches its plan and every recorded divergence has a reason, but phase 5 is not
verified until the manual native-dialog check is done.

Fixes before merge: F1 (the manual check, by the author). A second `/code-review` pass on the fixes is suggested:
#4 and #6 change what is recorded and sent (`test-strategy.md`, code review step).

**This review was written in the same session that planned and built the change.** The reviewer wrote the code and the
ledger. Weigh the plan-adherence and verification scores with that in mind; the ledger's red evidence and mutation
results are the independent part.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification completeness**. It does
**not** cover general code correctness — logic errors, edge cases, efficiency, idiom.

General correctness was reviewed separately by `/code-review` (one pass, 2026-11-09). Its findings and their
dispositions are below; the fixes were not reviewed by a second pass.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 4/5 | All six phases built as planned. Five divergences, each recorded in `progress.md` with a reason; one of them (the separate failures spec) was recorded only at this review (F2). No scope beyond `change.md`'s boundary. |
| Convention compliance | 5/5 | `AGENTS.md`: undici and mongodb stay in main (`multipart.ts` imports neither, so the renderer can load it); one new preload function, named and validated with `zod` in main; CSP and `webPreferences` untouched; every integration test uses `openTestDb()` and every e2e spec `launchWithTestDatabase()`. |
| Lessons compliance | 5/5 | Standing rule "Probe what undici does": `probe-undici-curl-multipart.md`, plus T1.3 cases on 6 methods and a GridFS-stored body. Standing rule "List what a spike did not try": `spike-file-input-ipc.md` has a Not tried list naming its host; plan A1–A4 cite it with "partly verified" and the phase that checks the rest. |
| Verification completeness | 4/5 | Phases 1, 2, 3, 4 and 6 are `done`, each with the plan's command and its output, red evidence or a mutation for each test, and the full gates (unit 290, integration 270, e2e 32, typecheck, lint). Phase 5 is honestly `in-progress`: its scenarios pass 4×, but its done-when includes a manual check not yet run (F1). |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| IPC schema for multipart in phase 5 | Added in phase 1 with a type guard in `form-from-call.ts` and an unreachable `bodyOfType` branch, to keep the typecheck green | yes (phase 1) | decision |
| `formFromCall` takes the body's bytes | Takes the record plus an optional `{ storedBody }`, so a stored body's refusal knows it was stored | yes (phase 4) | decision |
| R3: a slice 3a-shaped record "loads as before" | A typed multipart Content-Type in the generated form and place, over a body that parses, loads as multipart; resend is identical either way. Test uses a non-parsing body | yes (phase 4) | decision |
| Only a later Edit discards an earlier read | Opening another call also ends a pending Edit | yes (phase 6) | decision |
| Failed-read scenario removes stored chunks | Read-body handler replaced to return the missing-chunks message; the real path is covered by integration tests | yes (phase 6) | decision |
| Latest-Edit and failed-read scenarios in `e2e/multipart.spec.ts` | In a new `e2e/multipart-edit-failures.spec.ts`, because the replaced handler persists for the app launch | yes — added at review | decision (F2) |

Paths the plan named and the diff does not touch — `.vite/build`, `e2e/body-safety.spec.ts`,
`e2e/open-call-failures.spec.ts` — are named as references and patterns, not as files to change. Not drift.

Inventory note: `diff-vs-plan.sh` reported phase 6 as `in-progress` with no output. It read phase 6's first section,
the routing entry from lz-tdd. The last section, which the ledger schema makes authoritative, is `done` with output
(`progress.md`, the second "Phase 6" heading).

## Findings

### F1 — Phase 5's manual native-dialog check has not been run

- **Severity:** minor
- **Where:** `context/changes/multipart-with-file-copies/progress.md`, phase 5 (lz-e2e entry), "Outstanding"
- **Category:** verification
- **Finding:** The plan's done-when for phase 5 includes picking a file through the native file dialog on the built
  app (A4's Not tried item). Playwright's `setInputFiles` does not open the dialog. The phase is correctly
  `in-progress`; nothing claims it done.
- **Disposition:** fix now
- **Because:** the close gate requires every phase verified or dropped. Performed by the author; the result is
  recorded in phase 5's entry.

### F2 — A new e2e spec file shipped without a drift line

- **Severity:** minor
- **Where:** `e2e/multipart-edit-failures.spec.ts`
- **Category:** drift
- **Finding:** The plan placed the latest-Edit and failed-read scenarios in `e2e/multipart.spec.ts`. They are in a
  separate file. The ledger listed the file under Changed but did not record the divergence as drift.
- **Disposition:** accept
- **Because:** the scenarios replace main's read-body handler for the rest of the app launch, which would break the
  other multipart scenarios; `e2e/open-call-failures.spec.ts` is separate for the same reason. Drift line added to
  `progress.md` phase 6 at this review (author, 2026-11-09).

### F3 — The file-read error path in the parts editor has no test

- **Severity:** minor
- **Where:** `src/renderer/app.tsx`, `PartsEditor` → `pick`
- **Category:** verification
- **Finding:** Revision 2 of the plan answered plan-review W5 with "a rejected read shows the error in its row and
  the part holds no file". It is implemented and untested: no scenario makes `File.arrayBuffer()` reject.
- **Disposition:** accept
- **Because:** the failure is shown to the one user at once, loses no data, and sends no file part; a test would have
  to patch a browser API in the page. Recorded in `test-strategy.md`, known limits (author, 2026-11-09).

## Code review findings

From `/code-review`, first pass (2026-11-09). Unverified by the reviewer; each was checked against the code before
triage. Dispositions by the author (2026-11-09). Fixes and their evidence: `progress.md`, "Code review follow-up".

| # | Finding | Disposition |
|---|---|---|
| CR1 | `PartsEditor.pick` applied a finished read to the parts and form captured when the input changed: edits made meanwhile were reverted, and after a removal the file landed in the wrong row | fix now — done |
| CR2 | Edit on a stored multipart body showed nothing while reading, and a slow read replaced what was typed or sent meanwhile | fix now — done |
| CR3 | `readWholeBody` allocates a stored body of any size in the renderer; 1–2 GB fails or crashes the renderer | accept — known limit in `test-strategy.md` (author: "accept as known limit") |
| CR4 | An inline multipart body that could not load as parts fell back to Text even when not UTF-8, so a resend sent different bytes (T2.12) | fix now — done |
| CR5 | A typed `Content-Type` was refused with an empty multipart body, which sends no body | fix now — done |
| CR6 | A carried boundary and a file part's content type reached headers and part heads unchecked, so a value undici rejects could be recorded first (`AGENTS.md`) | fix now — done |
| CR7 | Part rows keyed by index left an uncontrolled file input showing the removed row's file | fix now — done |
| CR8 | `describeBody` reads the whole stored file on every open, and the read is not cancelled when the panel changes | accept — the plan chose reading on demand over recording summaries (Alternatives rejected); cost grows with upload size and is visible at once |
| CR9 | `describeBody` does one metadata query and one stream per 1 MiB page | fix later — tracked in `roadmap.md`, "Carried into later slices" (no tracker; the roadmap entry is the ticket) |
| CR10 | curl's own multipart regex and a duplicated search loop in `multipart.ts` | fix now — done |

## Lessons candidates

- **A failing assertion crashed the test worker instead of failing.** Phase 2's first T2.11 test used
  `toHaveBeenCalledWith` on a mock that received a 17 MiB body; under a mutation, Vitest's diff exhausted the heap
  ("Reached heap limit"). Same family as "A test named for a behaviour passed with that behaviour broken" (2026-11-06,
  observation): the test's failure mode was never seen. First incident of this mechanism. The older 5 MiB text-body
  T2.11 test still asserts the same way.
- **Async UI state captured before an await was applied after it.** CR1 (the file read) and CR2 (the Edit read) are the
  same mechanism in one change, and the 2026-11-03 observation "A renderer re-fetch raced a write in the main process"
  is a related one. The T2.10 tests guard opens and page reads, not form writes.
- **A spike's verdict held where its prediction did not.** `spike-file-input-ipc.md` predicted a `Buffer` in main and got
  a plain `Uint8Array`; the plan's wording was corrected before code depended on it. Supports the existing standing
  rule rather than suggesting a new one.

## For the archive record

- The record is the bytes on the wire; parts are parsed back out on demand (scanner in `src/core/multipart.ts`,
  `describeBody` for stored bodies). Edit reads a stored multipart body whole into the renderer.
- A file part's content type is the browser's guess from the extension (`.bin` → `application/macbinary`), recorded as
  sent and not editable.
- Not tested: the native file dialog (manual, F1), the file-read error row (F3). `PartsEditor.pick` updates the part
  list captured when the input changed, so an edit to another row during a slow read is overwritten (ledger phase 5,
  Notes) — a correctness question for `/code-review`.

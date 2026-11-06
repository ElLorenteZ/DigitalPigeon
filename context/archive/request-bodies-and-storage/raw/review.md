---
change_id: request-bodies-and-storage
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-06
updated: 2026-11-07
reviewed: main at 15c97c9 against 1846ce8, 6 phases and two code review follow-ups
delegated-to: /code-review, two passes run by the author; the fixes after the second pass were not reviewed; see Code review findings
---

# Review: Send, replay and export request bodies, and store bodies over 16 MB in full

## Verdict

**merge-with-fixes** — every fix this verdict named has been applied and none is outstanding. It is not `merge` because accepted minor findings remain: the largest are that the last fixes had no code review (F10) and that a cancel during a large body has no test on screen (F9).

The change is already on `main`, as `15c97c9`. The author merged it directly, with no pull request, before this revision of the review. This verdict records the state and does not gate that merge.

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification
completeness**. It does **not** cover general code correctness — logic errors, edge cases,
efficiency, idiom.

General correctness was reviewed separately by `/code-review`, in two passes run by the author. The second pass covered the fixes from the first. **The fixes from the second pass have not had a code review:** the headers timeout, `PagedBodyText`'s dependencies, `InlineBodyText` and `plainBody` changed afterwards.

**This review ran in the same session that executed all six phases and both rounds of fixes.** The reviewer wrote the code and the ledger, so its judgement of both is not independent. Both `/code-review` passes ran in separate agents.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | All 6 phases shipped and no planned path was left untouched. 15 divergences, all recorded with reasons. Out of scope was respected, and both follow-ups stayed inside `change.md`'s boundary. |
| Convention compliance | 5/5 | `AGENTS.md`: `MongoClient`, `undici` and `GridFSBucket` count 0 in the preload and renderer bundles, rechecked on `main` 2026-11-07. No live HTML rendering. `contextIsolation`, `sandbox`, `nodeIntegration` and the CSP are unchanged. Tests use `openTestDb()` and `launchWithTestDatabase()`. |
| Lessons compliance | 5/5 | The one standing rule applies. A1, A2 and A3 cite probes; T1.3 runs 24 method and type combinations, and a 17 MiB request body is compared at the capture server. The timeout change was probed against undici 8.12.3 before the fix, as the rule requires. No follow-up adds a new request shape. |
| Verification completeness | 4/5 | 6 of 6 done phases and both follow-ups carry commands and output, and `diff-vs-plan.sh` reads all six phases. Deducted for tests not seen failing first (F5), one surviving mutant (F3) and the `cancelled` result not observed in the app (F9). All are stated in the ledger. |

Gates rerun for this review on `main` at `15c97c9`, 2026-11-07: typecheck 0, lint 0, unit 186 passed, integration 250 passed, e2e 19 passed.

## Drift from the plan

| # | Planned | Shipped | Recorded? | Classification |
|---|---|---|---|---|
| D1 | `body` on `SendInput` in phase 5 | Phase 2 | yes | decision |
| D2 | Phase 3's four mutations | Eight, because the red step was missing | yes | decision |
| D3 | Phase 4: `formFromCall` "reports" a stored body | Throws `BodyNotLoadableError` | yes | decision |
| D4 | Phase 4: body store on its own | `createCallStore` returns `bodies`; the store-keys test gained it | yes | decision |
| D5 | Phase 5: first page timing unstated | Read when the body is shown | yes | decision |
| D6 | Phase 5: Form rows and type changes unstated | Nameless rows dropped; None and Form discard typed text | yes | decision |
| D7 | Phase 5: Edit "says why" | Its own `call-edit-error` message | yes | decision |
| D8 | Phase 6: two spec files | Same files, with a DevTools step and stubbed T2.10 answers | yes | decision |
| D9 | Phase 1 touches `src/main/ipc.ts` ("`toView` follows") | Not changed until phase 4 | yes, after the first review | decision |
| D10 | Phase 4: storage failure "through a store that fails" | A real MongoDB refusal, through a collection validator | yes, after the first review | decision |
| D11 | Approach: threshold and display page are "one number" | Two constants: `INLINE_BODY_LIMIT` and `BODY_PAGE_BYTES` | yes, after the first review | decision |
| D12 | A3: range reads behave as the spike measured | Spike gap: a read with chunks removed returns short with no error, fixed in `readRange` | yes | defect, fixed |
| D13 | No `cancelled` result kind | `SendResult` gained one: a cancel during a large body happens before a send document exists | yes | decision |
| D14 | `abort()` removes an upload through the driver | After a failed `finish()` the store deletes the chunks itself: the driver refuses to abort an ended stream | yes | decision |
| D15 | T2.11 and the plan: a 30 s headers timeout | 30 s plus 1 s per whole MiB of request body: the timer runs during the upload, as probed | yes | decision |

Candidates from `diff-vs-plan.sh` against `1846ce8`: 10 changed test files the plan does not name by path. Each falls under a phase's "tests beside them", and the follow-up's `Changed` list names `src/main/ipc.int.test.ts`. `AGENTS.md` is named and not changed, because the plan's Out of scope leaves it to its producer.

## Code review findings

### First pass

From `/code-review`, in its numbering. The author replied "go ahead with 1, 2, 4, 5, 8, 9, accept the rest".

| # | Where | Finding | Disposition |
|---|---|---|---|
| 1 | `src/core/body-store.ts` | `abort()` left the chunks after a failed `finish()` | fixed |
| 2 | `src/core/form-from-call.ts` | A blank form name loaded as a row and was dropped on Send | fixed |
| 3 | `src/core/send.ts` | A finished file stays when the insert of its document fails | accept: the plan's Out of scope excludes this cleanup. Slice 7's sweep must look for these files as well as for orphan chunks |
| 4 | `src/core/send.ts` | Cancel could not stop a large write or a replay's read | fixed |
| 5 | `src/core/form-from-call.ts` | A line break in a form value was lost in an `<input>` | fixed |
| 6 | `src/core/curl.ts` | 900 KiB fits macOS; Linux caps one argument at 128 KiB | accept: the work machine's OS is undecided. Revisit when it is |
| 7 | `src/core/send.ts` | `durationMs` includes time writing to GridFS | accept: storage slows the read loop, so separate timing would still read as more exact than it is |
| 8 | `src/main/ipc.ts` | The request body skipped the plain-bytes copy | fixed |
| 9 | `src/core/call-schema.ts` | Two copies of the error-code list | fixed |
| 10 | `src/core/curl.ts` and others | `'fileId' in body` repeated in five files | accept: duplication only |

### Second pass

From `/code-review` on the code after the first pass's fixes, in its numbering. At `/lz-pr`, the author chose the option "Fix first, then draft", which fixes 1, 2, 4, 5 and 7 and accepts the rest.

| # | Where | Finding | Disposition |
|---|---|---|---|
| 1 | `src/renderer/app.tsx` | Opening the call already shown loaded another page | fixed |
| 2 | `src/core/send.ts` | The headers timeout runs during the upload, so a large body on a slow link fails as `timeout` | fixed: 30 s plus 1 s per MiB. A link slower than about 8 Mbit/s can still time out |
| 3 | `src/core/form-from-call.ts` | A `Content-Type` typed last in lowercase looks generated, so Edit drops its row | accept: the plan chose this rule, and the record cannot tell typed from generated |
| 4 | `e2e/bodies.spec.ts` | A Copy press with no clipboard stub, against `AGENTS.md` | fixed |
| 5 | `src/renderer/app.tsx` | An inline body was decoded on every re-render | fixed |
| 6 | `src/core/call-store.ts` | `includeBodies` has no production caller | accept: predates this change; belongs in its own cleanup |
| 7 | `src/main/ipc.ts` | `plainSend` and `plainBytes` repeated their copy logic | fixed |
| 8 | `src/core/send.ts` | The error mapping is written twice; a file removed mid-read reports the database as unavailable | accept: nothing can remove a file until slice 7, which must recheck this path |
| 9 | `src/core/send.ts` | Replay loads the whole call | accept: the plan's Alternatives rejected a separate `getSend` |
| 10 | `src/core/curl.ts` and others | The MiB message and decoder setup are repeated | accept: the Monaco change reworks these readers |

## Findings

### F1 — The ledger departed from its schema, so tools misread it

- **Severity:** minor
- **Where:** `context/changes/request-bodies-and-storage/progress.md`
- **Category:** verification
- **Finding:** Phase 3 had two sections, and phases 4 to 6 listed drift in a shape `diff-vs-plan.sh` could not read.
- **Disposition:** fix now
- **Because:** the fields are read by `lz-change close` and `lz-archive`. **Resolved 2026-11-07:** the script reports all six phases as done, with output and drift. The stale phase 3 section was removed; the final entry states its missing red step.

### F2 — Three small divergences were not in the ledger's drift lines

- **Severity:** minor
- **Where:** `progress.md`, phases 1 and 4
- **Category:** drift
- **Finding:** D9, D10 and D11 happened without a drift entry.
- **Disposition:** fix now
- **Because:** the record costs one line each. **Resolved 2026-11-07:** each is recorded and marked as recorded after review.

### F3 — The one-read-at-a-time ref is not protected by any test

- **Severity:** minor
- **Where:** `src/renderer/app.tsx:652`
- **Category:** verification
- **Finding:** Removing the `busy` check leaves all 9 scenarios passing. In the production build, the disabled button also stops a second read.
- **Disposition:** accept
- **Because:** the behaviour the plan requires was observed in phase 5 and the button enforces it. The ledger records the survivor. The ref still covers `StrictMode`'s double effect in development.

### F4 — A large body makes History a very long scroll away

- **Severity:** minor
- **Where:** `src/renderer/app.tsx`, `CompletionView` in the result view
- **Category:** drift
- **Finding:** 1 MiB of text renders about 131,000 px tall, above History. The plan is silent on this, so it is absent rather than excluded. Nothing is lost, and scrolling reaches History.
- **Disposition:** accept
- **Because:** author's decision, 2026-11-06: accepted until the next change replaces the plain text area with the editor. A height cap now would be redone there.

### F5 — Not every test was seen failing before its code

- **Severity:** minor
- **Where:** `progress.md`, phases 1 to 4 and the follow-up
- **Category:** verification
- **Finding:** Phase 3's new tests were never seen red. Neither were 3 tests in phase 1, 1 in phase 2, 6 in phase 4, 2 in the first follow-up and 1 in the second. Phase 2's `T1.1` test also passes under its mutation.
- **Disposition:** accept
- **Because:** the ledger states each case. Phase 3's tests and the six in phase 4 each fail under a recorded mutation. The rest guard behaviour that already held.

### F6 — Foundation documents still describe the state before this change

- **Severity:** minor
- **Where:** `context/foundation/test-strategy.md:28`, `context/foundation/roadmap.md`
- **Category:** convention
- **Finding:** T1.5 is still marked **gap**, the gate counts are out of date, and T2.11 still states a flat 30 s (D15). Slice 3 still needs splitting in the roadmap. The plan's Out of scope assigns these to their producers afterwards.
- **Disposition:** accept
- **Because:** planned. They need `/lz-test-strategy` and `/lz-roadmap` once this change closes, and the close step should not assume them done.

### F7 — The plan's status is still `draft`, and its last revision had no re-review

- **Severity:** nit
- **Where:** `context/changes/request-bodies-and-storage/plan.md:3`
- **Category:** drift
- **Finding:** Execution began after the third `/lz-plan revise` with no further `/lz-plan-review`. `status: draft` was not updated.
- **Disposition:** accept
- **Because:** the author chose to proceed, and earlier reviews covered the plan through two revisions.

### F8 — The change reached `main` with no pull request

- **Severity:** nit
- **Where:** `main`, `be422db..15c97c9`
- **Category:** convention
- **Finding:** The fast-forward also brought in slices 1 and 2, the roadmap commit and the slice 2 wrap-up. Draft PR #2 was closed unmerged, and the three branches were deleted.
- **Disposition:** accept
- **Because:** the author's instruction, 2026-11-07: "merge that directly to master without pr". This repository's default branch is `main`. Each slice had its own `lz-review`.

### F9 — The `cancelled` result is not observed in the app

- **Severity:** minor
- **Where:** `src/main/ipc.int.test.ts`, `src/renderer/app.tsx`, `ResultView`
- **Category:** verification
- **Finding:** T2.7 assigns the assembled wiring to e2e, and T2.9 names Cancel. The IPC test proves `kind: 'cancelled'` is returned, but no e2e test or observation shows the message on screen.
- **Disposition:** accept
- **Because:** the renderer has no branch of its own for this kind: `ResultView` shows "Not sent" for every kind other than `not-recorded`, a path e2e already covers through the `HEAD` refusal. A timed e2e test would race the database. The ledger states the gap.

### F10 — The fixes from the second code review have not had a code review

- **Severity:** minor
- **Where:** `src/core/send.ts`, `src/renderer/app.tsx`, `src/main/ipc.ts`
- **Category:** verification
- **Finding:** The second pass produced 5 more fixes, and those were merged without another pass. Findings 1 and 2 have tests seen failing first; 5 and 7 rest on existing tests; 4 is a test stub.
- **Disposition:** accept
- **Because:** the author merged after being told of this. A later `/code-review` can still run against `main`.

## Lessons candidates

- **A spike covers less of a failure path than its result suggests.** `abort()` was probed only before the stream ended, and range reads only with chunks present. Two gaps, both in this change and the same spike, so the distinct-incident bar is not met.
- **Attributing a rendered failure before measuring it.** A position failure was blamed on text length, and a fix was added before a width measurement showed DevTools docking. One incident; no prior known.
- **DevTools docks some time after launch in e2e.** It halves the width under any position check on long text (`src/main.ts:45`). `e2e/bodies.spec.ts` handles it locally, and other specs do not. One incident.
- **A review of a fix finds more than a review of the code it fixes suggests.** Each `/code-review` pass found defects `lz-review` could not see, and the second found a paging defect phase 6's scenarios missed. One change; slice 2 also needed its code review to find defects.
- **A test helper with an unbounded loop hangs the red step.** Phase 3 lost its red step this way. One incident.
- **A partial matcher can match the wrong shape.** `toMatchObject({ length })` also matched bytes, so two phase 4 tests passed before the code existed. One incident.

## For the archive record

- GridFS needs an explicit cleanup on every failure: `pipeline` leaves chunks, and the driver's `abort()` refuses a stream already ended. A read with chunks removed returns short with no error. The spike covered none of the last two.
- `--data-raw` replaced the planned `--data-binary`, because a body starting with `@` would have sent a local file.
- Still standing: renderer memory limits how far a very large body can be paged. Slice 7 must find both orphan chunks and finished files no call refers to. The 900 KiB curl limit was measured on one machine, fails on Linux above 128 KiB, and terminal pasting is untested. `durationMs` includes storage time above 1 MiB. The headers timeout assumes about 8 Mbit/s upload.

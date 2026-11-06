---
change_id: preview-replay-export
produced-by: lz-review
verdict: merge-with-fixes
created: 2026-11-06
updated: 2026-11-06
reviewed: working tree on branch send-and-record against d8d3c1d, 6 phases, plan.md as revised after two spikes and the plan review
delegated-to: /code-review, run by the author on the code before its fixes; see Code review findings
---

# Review: Open a past call, replay it exactly or edit and resend it, and export a request as curl

## Verdict

**merge-with-fixes** — all six phases match the plan, or diverge with a record, and each is evidenced.
Four fixes remain before close:
- two foundation documents are stale (F1)
- Edit and Copy as curl have no durable test in the app (F2)
- three paths were never exercised in the real app (F3)
- the work is uncommitted on top of an unmerged slice (F4)

## Scope of this review

This review covers **plan drift, project conventions, accepted lessons, and verification
completeness**. It does **not** cover general code correctness — logic errors, edge cases,
efficiency, idiom.

General correctness was reviewed separately by `/code-review` (see Code review findings). The fixes that
review led to have not been through a second one.

This review ran in the same session that planned and executed the change (lz-plan, lz-spike, lz-tdd,
lz-build, lz-e2e). The reviewer wrote the code under review; weigh the verdict accordingly.

## Scorecard

| Criterion | Score | Basis |
|---|---|---|
| Plan adherence | 5/5 | Every file in the six phases' Touches columns exists as planned. Out of scope held: no request bodies, no non-POSIX shells, no migration of old records, no replay-to-source link. All divergences are recorded in `progress.md`. |
| Convention compliance | 4/5 | `AGENTS.md` non-negotiables hold. `src/main.ts` is unchanged. No HTML-rendering API in `src/`. `undici` and `mongodb` are imported only under `src/core/`, `src/main`, `src/main/` and `test-support/`; the renderer imports only `wire`, `curl`, `form-from-call` and types, and its bundle holds neither driver. Every `dropDatabase` goes through `assertTestDbName`. e2e launches only through `launchWithTestDatabase()`. Minus one for stale documents (F1). |
| Lessons compliance | — | `lessons.md` has 0 standing rules; its observation log does not bind. |
| Verification completeness | 4/5 | 6 of 6 phases carry their plan verification with real output. Mutations: phase 1 (4), phase 2 (2), phase 3 (1), phase 4 (4), phase 6 (2). The e2e scenario ran 5× clean. Minus one for three paths never exercised in the real app (F3) and failure branches left unexercised since slice 1. |

## Drift from the plan

| Planned | Shipped | Recorded? | Classification |
|---|---|---|---|
| "Trimmed of leading and trailing whitespace" | Only space and tab are trimmed; `String.prototype.trim` would hide a line feed | yes (phase 1) | decision |
| Refusal of everything undici rejects, and trimming, as plan-review additions | Built as planned; author proceeded without objecting, not by direct choice | yes (phase 1, `change.md`) | decision |
| Replay rejects an "unknown or unreadable call" | A readable request with an unreadable completion also cannot be replayed | yes (phase 2) | decision |
| `toCurl` refuses non-ASCII values | Refuses anything `buildWireRequest` would refuse, including a line feed | yes (phase 4) | decision |
| One Copy as curl on the panel | Labelled **Copy call as curl**, distinct from the form's | yes (phase 5) | decision |
| Scripted observations only | Also wrote a curl command with a test token to the author's clipboard | yes (phase 5) | decision (side effect) |
| Scenario asserts "details unchanged" | Also changes the server's response and opens the replay first | yes (phase 6) | decision |

`diff-vs-plan.sh` flagged `src/index.css` (listed under phase 5's Changed) and `AGENTS.md` (assigned to
`/lz-onboard` by plan Out of scope, F1). It reported phases 5 and 6 as `in-progress` because it reads
the first ledger section per phase, the routing note. The authoritative last sections are `done`.

## Findings

### F1 — `test-strategy.md` and `AGENTS.md` no longer describe the repo

- **Severity:** minor
- **Where:** `context/foundation/test-strategy.md` (T2.4 at unit layer as `gap`; T1.1, T1.3 and T2.7
  without the replay and edit halves; Known gaps; gates); `AGENTS.md`
- **Category:** convention
- **Finding:** T2.4 moved to integration and is covered. Coverage of T1.1, T1.3 and T2.7 grew. An agent
  reading `AGENTS.md` would not know that header values must be printable ASCII, or that the curl
  export's flags and the undici wire rules are test-guarded. Both updates were assigned by plan Out of
  scope.
- **Disposition:** fix now
- **Because:** author chose to run `/lz-test-strategy` and `/lz-onboard` before `/lz-change close`.
  Close-gate condition.

### F2 — Edit and Copy as curl have no durable test in the app

- **Severity:** minor
- **Where:** `src/renderer/app.tsx` (`CallPanel`, `RequestForm`); `e2e/replay.spec.ts` covers Replay only
- **Category:** verification
- **Finding:** Their logic is tested in `form-from-call.test.ts` and `curl.int.test.ts`, and the wiring
  was seen once by phase 5's throwaway script. A wiring break would not fail any gate.
- **Disposition:** fix now
- **Because:** author chose one more e2e scenario: open a call, Edit, change a header, Send → a new row
  with the change; Copy call as curl shows a command; a refused header shows the message.

### F3 — Three paths were never exercised in the real app

- **Severity:** minor
- **Where:** `progress.md` phase 5, Not observed
- **Category:** verification
- **Finding:**
  - Cancelling a replay in flight. Cancel was observed for a send; replay shares the `recorded` path.
  - Opening an interrupted call.
  - All of this slice in the packaged `.app`. Automation cannot drive it.
- **Disposition:** fix now
- **Because:** author chose a throwaway script for the first two, and a manual check of Open, Replay and
  Copy as curl in the packaged `.app` by the author.

### F4 — The change is uncommitted on top of an unmerged slice

- **Severity:** minor
- **Where:** branch `send-and-record` (slice 1 at `d8d3c1d`, not pushed); this change in the working tree
- **Category:** verification
- **Finding:** Nothing from this change is committed, and the roadmap edit is mixed in. Slice 1 and slice
  2 cannot be reviewed apart until they are separated.
- **Disposition:** fix now
- **Because:** author chose a new `preview-replay-export` branch from `send-and-record`, with slice 1
  going up as its own pull request first.

### F5 — Some tests were never seen failing, and one red step was weak

- **Severity:** minor
- **Where:** `progress.md` phases 1–3
- **Category:** verification
- **Finding:** Accepted-value guards, `is null for an unknown id`, the store-keys test and 10 form cases
  passed against their stubs. Replay's red step failed on `replayCall is a stub`, showing only that
  replay did not exist.
- **Disposition:** accept
- **Because:** the ledger names each. Replay's real evidence is its mutations, and the form cases are
  covered by the round-trip test and its mutation.

### F6 — `plan.md` does not record undici's reordering of `connection`

- **Severity:** nit
- **Where:** `plan.md` Assumptions, A1
- **Category:** drift
- **Finding:** Phase 2 found that undici moves `connection` to second place whatever position it is
  given. The ledger records it. A1 holds for every list `wire.ts` produces.
- **Disposition:** accept
- **Because:** the plan is the reviewed record of intent, and rewriting it after execution would hide
  the finding. The archive record carries it.

### F7 — An opened call rendered off-screen (added after this review)

- **Severity:** minor
- **Where:** `src/renderer/app.tsx`; `e2e/replay.spec.ts`
- **Category:** drift
- **Finding:** The author's packaged-app check for F3 led to it. The panel renders below the history list,
  so a long history left it past the fold and a row click appeared to do nothing. The plan placed the
  panel there, and locator-based checks find an element wherever it is, so neither this review nor the
  tests could see it.
- **Disposition:** fix now
- **Because:** author replied "ok, continue" to the proposed fix. Fixed in phase 5: the panel scrolls into
  view on open, covered by a scenario that goes red with the scroll removed.

## Code review findings

From `/code-review`, run by the author. Dispositions by the author: "go ahead with 1–8, accept 9 and 10".
Evidence for R1–R8 is in `progress.md`, Follow-up.

| # | Finding | Where | Disposition |
|---|---|---|---|
| R1 | Replay skipped the 30 s timeouts | `src/core/send.ts` | fix now — done |
| R2 | `Transfer-Encoding`, `Keep-Alive`, `Upgrade`, `Expect` and an empty `Connection` were recorded, then refused by undici | `src/core/wire.ts` | fix now — done |
| R3 | `UND_ERR_NOT_SUPPORTED` was recorded as `network` | `src/core/send.ts` | fix now — done |
| R4 | A typed `Connection` was recorded but not sent | `src/core/wire.ts` | fix now — done |
| R5 | Replay and Edit acted out of view | `src/renderer/app.tsx` | fix now — done |
| R6 | Curl export turned a URL's user and password into an `Authorization` header undici never sent | `src/core/curl.ts` | fix now — done |
| R7 | A failed open left the previous call's actions live | `src/renderer/app.tsx` | fix now — done |
| R8 | Overlapping opens could show the wrong call | `src/renderer/app.tsx` | fix now — done |
| R9 | A call opened while in flight stays "In flight" in the panel | `src/renderer/app.tsx` | accept — clicking the row again refreshes it |
| R10 | Replay loads the stored response to read the request | `src/core/send.ts` | accept — only a cost on large bodies; refusing a corrupt completion is a recorded decision; slice 3 can revisit it |

R2 and R4 contradict phase 1 and `wire.ts`'s stated contract. Phase 1's probes covered characters in
values and name syntax, and did not try specific header names.

## Lessons candidates

- **undici refuses and rewrites by header name (R2, R3, R4).** A third mechanism in the same class as the
  first candidate below, found only after phase 1 claimed to cover everything undici rejects.

- **undici does not send what it is given, a distinct incident in a different change.** `lessons.md`
  (2026-11-03) holds a ready rule, waiting for a distinct incident. This change adds two, through a
  different mechanism (header values, not names): non-ASCII values rejected or re-encoded as latin1
  (`spike-non-ascii-headers.md`), and `connection` reordered (phase 2). Whether this clears the bar
  is for `/lz-lessons`.
- **A spike's "verified" was narrower than the request shapes.** A2 passed for one URL; the plan
  review's probe then found curl's globbing and empty-value behaviour. Same family as the 2026-11-04
  entry (a comparison narrower than the record), through a different mechanism.
- **A test that did not prove its name.** A mutation showed `a replay sends the recorded list…` passing
  with replay rebuilt. One incident.

- **Presence checks passed for an element the user could not see.** Scripted observations and e2e
  locators found the panel below the fold. A first viewport test with 8 rows also passed with no fix. One
  incident.

## For the archive record

- Replay sends the recorded list, not one rebuilt through `wire.ts`. `formFromCall` hides managed
  headers equal to what `wire.ts` generates. `toCurl` needs `--globoff`, `-H 'Name;'` for an empty
  value, and `-H 'User-Agent:' -H 'Accept:'`.
- Every new record now means one set of bytes: anything undici would refuse is refused before recording.
  Old records may still hold non-ASCII values; replay sends them as recorded, curl refuses them.
- The T2.4 layer moved from unit to integration because only running curl exposed the failures.

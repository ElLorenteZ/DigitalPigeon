---
change_id: editor-and-formatting
title: Show JSON and XML bodies pretty-printed in the editor, with stored bytes unchanged
status: new
ticket: null
created: 2026-11-07
updated: 2026-11-07
closed: null
produced-by: lz-change
---

## Intent

"/lz-change editor-and-formatting" — opening slice 3b of M1 as cut in `context/foundation/roadmap.md`:

> | 3b | Editor and formatting | JSON and XML request and response bodies shown pretty-printed in the
> editor, with what is stored and sent unchanged; a response body cannot run as script | next | — |

The author chose this cut at slice 3: "Two, bodies first".

## Boundary

**This change covers:**
- The Monaco editor, showing recorded request and response bodies.
- JSON and XML bodies shown pretty-printed, with the stored and sent bytes unchanged.
- A body held in a GridFS file, shown in the editor. It is read a page at a time.
- A body scrolling inside its own area, which ends the long scroll to History accepted in
  `archive/request-bodies-and-storage` (T3.10).
- Tests for the risks this change introduces or completes, at the layers `test-strategy.md` assigns:
  - T2.6, pretty-printing changing the content
  - T1.8, a response body running as script
  - T2.9 and T2.10, for what the editor changes
- The exit criterion this change can meet, from `roadmap.md`: JSON and XML request and response bodies
  are shown pretty-printed.

**Explicitly not in this change:**
- Multipart bodies and file copies, T1.4: slice 4.
- Saved requests and environments: slice 5.
- Filtering or searching history, including search inside bodies: slice 6.
- Deleting calls, and removing orphaned GridFS data: slice 7.
- Any change to what is recorded, sent or replayed. Formatting is display only.
- Relaxing `contextIsolation`, `sandbox`, `nodeIntegration` or the production CSP: `AGENTS.md` fixes them.
- Curl export limits, including Linux: recorded in `roadmap.md` for when the work machine's OS is decided.
- The cleanup findings accepted in `archive/request-bodies-and-storage`, such as `includeBodies`.

## Notes

- Unsettled, for `/lz-plan`:
  - whether the request form's body box also becomes the editor, or only recorded bodies do
  - how a body read a page at a time is formatted, since a partial JSON document cannot be parsed
  - how a reader sees that a formatted view differs from the recorded bytes
- Monaco is not a dependency yet (`package.json`). `tech-stack.md` chose it. It has not been run in this repository under
  the production CSP and `sandbox: true`, so the plan should treat that as load-bearing and unverified.
- Standing rule (`lessons.md`): list what a spike did not try, and cite it only for what it tried.
- Observation log (2026-11-07): DevTools docks during e2e and halves the width. A position check on long text must wait
  for it, as `e2e/bodies.spec.ts` does.
- T1.8 must be tested on the production build, because the CSP is injected only there (`test-strategy.md`).
- `roadmap.md` and `test-strategy.md` are uncommitted on `main`. This change has no branch yet.

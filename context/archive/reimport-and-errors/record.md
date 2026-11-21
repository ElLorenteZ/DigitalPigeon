---
change_id: reimport-and-errors
title: Re-import a spec in place, and say where an invalid file failed
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-21
ticket: null
verdict: merge
outcome: shipped
milestone: M2, slice 11 (roadmap.md)
branch: reimport-and-errors, PR #10 (stacked on #9; archived on the branch before merge)
raw: raw/
---

## 1. What was built

- **Re-import in place.** Importing a spec whose kind and title match an existing source updates that source. Each
  template is matched by the spec's own `METHOD path`, keeps its id when it still exists, new operations are added,
  and gone ones are removed. History is never touched.
- **Errors.** An invalid file imports nothing. The dialog shows where it failed: the JSON line and column, or the path
  or operation that is not an object.
- **The dialog** says when it will re-import, and the button reads "Update N templates".

**Differs from the plan:** code review added:
- untitled specs never merge;
- the stored key;
- one `bulkWrite`;
- `x-*` keys skipped;
- duplicate sources from slice 10 folded into the oldest;
- a stable tree order;
- a `mode` that stops the server overwriting a source the dialog did not warn about.

## 2. Why this approach

A spec's title is the identity it carries; file names change between downloads. Keeping template ids across
re-imports means a template stays the same object for the user. Matching on the spec's own path, not on the URL it
became, keeps that true whatever the base URL option was.

## 3. What was rejected

- **Identity by file name.** The same spec is downloaded under many names.
- **Replacing all of a source's templates.** Ids would change on every re-import.

## 4. Surprises

- Three ways to lose templates were found by code review, none by the plan:
  - a fallback title shared by every untitled spec;
  - a match key derived from a URL that depends on an option;
  - a dialog deciding re-import from a list that might be stale.

## 5. What still stands

- Two different specs with the same title are treated as one. The dialog warns before it updates.
- If a re-import fails part-way, writes already applied stay; it is one `bulkWrite`, not a transaction.

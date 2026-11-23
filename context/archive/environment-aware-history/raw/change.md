---
change_id: environment-aware-history
title: Detect a call's environment from its URL, and show History for the selected environment
status: closed
ticket: null
created: 2026-11-23
updated: 2026-11-23
closed: 2026-11-23
produced-by: lz-change
---

## Intent

environments should be updated automatically on requests. history should be shown for selected environment with "all" chosen by default

Author's clarification (2026-11-23), choosing from the options offered:
- "updated automatically on requests" means **"Request URL → env detected"**: when a sent URL's host matches an
  environment's `baseUrl`, the call is recorded under that environment, and the selector follows. This holds for
  ad-hoc requests too.
- Both parts are **one change**.

## Boundary

**This change covers:**
- Detecting the environment of a send from its URL against the defined environments' `baseUrl`s, for saved and
  ad-hoc requests alike. The call is recorded under the matched environment.
- The active-environment selector following the detected environment.
- History shown for the selected environment, with an "All" choice, and "All" as the default.

**Explicitly not in this change:**
- Rewriting the open request's URL when the active environment is switched. Offered as an option; not chosen.
- Writing values from responses (tokens and the like) into environments. Offered and not chosen. The PRD also lists
  variables other than `baseUrl` as not wanted.
- Environment variables beyond `baseUrl`, and auth per environment (PRD).
- Changes to History search's environment facet beyond what the History filter needs (slice 9 already filters by
  environment).
- Backfilling the environment on calls already recorded. Records are insert-only; whether old calls are matched at
  read time is for `lz-plan` to decide, not a rewrite of stored records.

## Notes

- Related, done: slice 5 `saved-requests-and-environments` (environment = name + `baseUrl`; switching changes a saved
  request's target), slice 9 `history-search` (environment facet), slice 6 (environment selector in the title bar).
- Open for research/plan:
  - What "matches" means: host only, scheme + host + port, or a `baseUrl` prefix including a path.
  - What happens when two environments match, or none does.
  - Whether "History for the selected environment" is the History sidebar list, the responses strip, or both.
  - How it interacts with `history-grouping`'s request mode (branch `history-grouping`, PR not yet opened).
- Closed 2026-11-23: all 5 phases verified (Phase 5 T3.2 look by the author); review merge-with-fixes, both fixes done;
  merged into `main` as `6cc8c9f` (with history-grouping and slices 7–12), directly at the author's request.
  General correctness not reviewed (`/code-review` not run).

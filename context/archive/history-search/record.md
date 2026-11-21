---
change_id: history-search
title: Search and filter History, and resend or delete a selection
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-21
ticket: null
verdict: merge
outcome: shipped
milestone: M1, slice 9 (roadmap.md)
branch: history-search, PR #8 (stacked on #7; archived on the branch before merge)
raw: raw/
---

## 1. What was built

- `pigeon:search-calls` searches every call by text and by method, environment, Authorization value, saved request and
  sent-date range. It returns the matches newest first, up to 500, with a count for each facet option. Text means the
  URL, request header values and inline request or response bodies.
- Screen 04:
  - the History tab has a search box and a Filters button;
  - while a search is active, the tab shows active-filter chips, Clear all, and the facets with their counts;
  - the main area shows a results table with per-row Resend, Edit and ×, and Resend N and Delete N for a selection;
  - an empty result offers Clear filters.

**Differs from the plan:**
- The carried "stored, indexed `request.path`" moved to "Not ordered yet", because the search runs in memory.
- Code review added: refetching when a delete or resend lands; a single-flight resend that reports failures; and one
  shared `authorizationOf` rule.

## 2. Why this approach

Bodies are stored as binary, so a body search has to decode them in Node. Doing the whole search in one place, over
call summaries, keeps one definition of each filter. Facet counts leave out their own facet's filter, so ticking an
option never hides its siblings' counts.

## 3. What was rejected

- **MongoDB `$facet` aggregation.** The body step runs in Node anyway, and two engines would have to agree on one
  filter definition.
- **A text index.** It needs a text field per document: a schema change and a migration.
- **Filtering the History list in the UI.** History holds only 200 calls.
- **Searching bodies stored as files.** Seconds per search for bodies over 1 MiB, which are rare. The UI states this.

## 4. Surprises

- Once History holds 200 calls, deleting an older call does not change History's newest rows. Lists keyed on History
  alone then never refetch. `dataVersion` now marks every delete and resend.
- Deleting the opened call from the results threw the user back to the request.

## 5. What still stands

- `searchCalls` loads every summary on each query (roadmap "Search performance"). Look there first if search slows
  down.
- Each facet value is an exact stored value, for example a full Authorization token. Values can be up to 64 KiB.
- Resend is `replay`: each resend creates a new record, and the originals are never touched (T1.1).

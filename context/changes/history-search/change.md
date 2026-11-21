---
change_id: history-search
title: Search and filter History, and resend or delete a selection
status: new
ticket: null
created: 2026-11-21
updated: 2026-11-21
closed: null
produced-by: lz-change
---

## Intent

Roadmap M1 slice 9, "Search, filter, resend": "Screen 04: search text plus method, environment, `Authorization` header
and date facets with counts, results table, resend one or a selection, delete a selection; an empty result says so and
offers to clear filters".

PRD success criteria this slice closes:
- History can be narrowed by environment, by saved request, by date range, and by a search term in URL or body.
- History can be narrowed by HTTP method (one or several) and by the `Authorization` header value sent. Filters
  combine, and each option shows its count.
- A call can be resent from History, one at a time or as a selection; each resend creates a new record.
- A call record disappears only after the user deletes it, one at a time or in bulk.

## Boundary

**This change covers:**
- A server search over all of History:
  - text in the URL, the request header values, and the inline request and response bodies;
  - the method, environment, `Authorization` value, saved request and date-range filters;
  - the count of each facet option.
- Screen 04: the search box and facets in the History tab, and the results table in the main area. Each row has
  Resend, Edit and Delete. Rows can be selected, and the selection can be resent or deleted with Undo. An empty
  result offers Clear filters.

**Explicitly not in this change:**
- Searching bodies stored as files (over 1 MiB). The search reads inline bodies only.
- Saved searches.
- Retention rules.

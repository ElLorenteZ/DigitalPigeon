---
change_id: history-status-filter
title: Filter History by HTTP status code with a multi-select combo box
status: closed
ticket: null
created: 2026-11-24
updated: 2026-11-24
closed: 2026-11-24
produced-by: lz-change
---

## Intent

add filtration in history by http codes. It should be a combi multiselect field that will display only request and responses with specified http code. No selection = all

## Boundary

**This change covers:**
- A multi-select combo box in the History tab listing HTTP status codes.
- History showing only calls whose response status is one of the selected codes.
- An empty selection showing every call, unfiltered.

**Explicitly not in this change:**
- Status filtering in the responses strip or any view other than History — not requested.
- Status-class shortcuts (2xx, 4xx, 5xx) or free-text status ranges — not requested; a separate change if wanted.
- Changes to the existing text search and facets from `history-search` beyond what composing with the new filter requires.
- Persisting the selection across app restarts — not requested.

## Notes

- `context/archive/history-search/record.md` already defines a server-side search with facets (method, environment,
  Authorization, saved request, date range) in `pigeon:search-calls`. Whether status code joins that facet set or
  filters the History list directly is a planning decision; that change rejected UI-side filtering of History because
  History holds only 200 calls.
- Open for planning: how calls with no response (network error, timeout) appear in the code list, and whether the
  list holds codes present in the data or a fixed set.
- Closed 2026-11-24: shipped. The History status filter covers the day list, request groups, an expanded group and
  search, with server-side filtering before every limit. Review verdict merge-with-fixes, fixes applied; host code
  review 7 fixed, 2 accepted, 1 disputed. PR #13 (https://github.com/ElLorenteZ/DigitalPigeon/pull/13) was open,
  unmerged, at close.

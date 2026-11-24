---
change_id: history-status-filter
title: Filter History by HTTP status code with a multi-select combo box
produced-by: lz-archive
archived: 2026-11-24
change-opened: 2026-11-24
ticket: null
verdict: merge-with-fixes
outcome: shipped
milestone: none (author request; builds on history-search, history-grouping, environment-aware-history)
branch: history-status-filter @ d24eb71, PR #13 (open, unmerged, at archive time)
raw: raw/
---

## 1. What was built

The History tab has a status filter between the search box and the list. It is a multi-select combo box listing the
codes present, with a count for each, plus "No response". No selection keeps every call. The filter applies to the day
list, the request groups and their counts, an expanded group, and search. The responses strips stay unfiltered.

- Store: `statusCondition` turns a selection into a condition on `sends._id`. It reads the matching ids from
  `completions`, where the status is stored, and runs before every limit: History's 200, `listResponses`' 500, and
  grouping. `''` means No response: an error completion, a call in flight, or an interrupted call. A selection never
  lists an unreadable record. New operation `pigeon:list-status-codes`; search has a `status` facet.
- `listCalls` returns a `mark` (count, newest id, in-flight count) computed **without** the filter. The renderer's
  `historyMark` is `dataVersion` + `mark`, so the views keyed on it refresh whatever is selected.
- Shared rules in `src/core/status.ts` (`statusOf`, `byStatus`), imported by the store and the renderer.

**Differs from the plan:**
- An expanded group was planned to filter on the client. It asks the server instead, because the 500-call window
  could hide every call the group's count counted (host code review #3).
- The selection key was planned as a sorted `join(',')`. It is JSON (see §4).
- The planned e2e "responses strip lists a 200 sent while 404 is selected" was replaced: the strip is not on screen
  during a send. The scenario holds a send and checks that the option counts move.
- Typed text is cleared when the list closes, and Space toggles an option only while the field is empty. Neither was
  in the plan; both came from review and testing.

## 2. Why this approach

History already filters on the server over every call (environment-aware-history, history-search). Status is one more
condition there, so the list, the groups, an expanded group and search share one definition of "matches", and every
limit applies after the filter. The cost is that filtering the History list stops being a safe input to the refresh
key. The server returns an unfiltered `mark` so that refreshes stay independent of what the user is looking at.

## 3. What was rejected

- **Filtering the rows the UI already holds.** The day list holds the newest 200 calls, so older matches would never
  show. `history-search` rejected this for the same reason, and the reason still holds.
- **A Status checkbox facet in the search Filters panel only.** The author wanted one control that works outside
  search too.
- **A fixed list of common codes.** The author chose the codes present, with counts. A fixed list offers codes with
  no calls and misses unusual ones (418, 599).
- **A `$lookup` aggregation joining sends to completions.** It would give the store a second read path beside
  `list()`. It is still the fix for the id-list size limit (§5), if that limit is ever reached.
- **A combo box library (Downshift, React Aria).** A new dependency for one control. The UI has no component library.
- **Refresh key: bumping `dataVersion` when a send starts.** The send document does not exist yet at that moment, and
  nothing bumps again when its row appears.
- **Refresh key: a second, unfiltered `listCalls` per poll.** Twice the History read, to get three numbers the server
  can return with the first.
- **Out of scope:**
  - status classes (2xx) and ranges;
  - typing a code that is not present;
  - persisting the selection;
  - adding the selection to search's chips or resetting it on Clear all;
  - an index on `completions.response.status`.

## 4. Surprises

- **`['']` joined to the same key as `[]`.** "No response only" and "nothing selected" looked identical, so Clearing
  refetched nothing and kept the No-response list as current. The plan review had suggested `join` as the canonical
  form. The e2e Clear scenario caught it, and `statusKeyOf` is JSON. The convention "`''` means none" comes from
  `history-search`; any key built from such a list has the same trap.
- **The planned refresh test could not fail.** A completed send already bumps `dataVersion`, so the strip refreshes
  with or without the fix. The real gap was only the in-flight period, and it shows only in the status option counts.
  The plan review caught this before code existed.
- **Typed text outlived the list.** "no r" left in the field narrowed the next opening to one option. The keyboard
  scenario found it through a failure in the next test.
- **One slow run (10.9 min for e2e instead of 1.6) failed two `saved-requests.spec.ts` tests and one integration
  test.** None of them reproduced in three reruns. Unexplained.

## 5. What still stands

- **Load-bearing:** `historyMark` (`app.tsx`) = `dataVersion` + the server's `mark`. If the strips, groups or search
  stop refreshing, check that `listCalls` still returns `mark` and that nothing rebuilds the key from the filtered
  list. The in-flight scenario in `e2e/status-filter.spec.ts` turns red if it does.
- **Accepted, code review #1:** `statusCondition` puts every matching send id in one `$in`/`$nin`. Past about 350k
  calls, the 16 MB BSON limit fails every filtered History query. The fix is an aggregation over completions. It
  belongs to the roadmap's "Search performance" item, together with `listStatusCodes`' full read on each refresh
  outside search.
- **Accepted, code review #7:** the mark's in-flight part counts sends in every environment, so a send elsewhere can
  cause one extra refetch, but never a missed one. The History poll runs only while a send is in flight.
- **Disputed, code review #8:** an environment switch refetches twice. The previous key behaved the same way.
- **Accepted, F4:** `test-strategy.md` T2.3 still reads "gap". This change, `history-search` and
  `environment-aware-history` all added T2.3 integration coverage.
- After a failed `listStatusCodes`, the options recover only on the next refetch, as every History list does. The
  selected chips and × stay usable meanwhile.
- `'' = No response` covers error completions, in-flight calls and interrupted calls alike. Unreadable records match
  no selection.

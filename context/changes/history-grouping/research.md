---
change_id: history-grouping
produced-by: lz-research
questions: 5
updated: 2026-11-22
base: land-slices-7-12 @ 2a44ef1 (PR #12, open) — main @ 6c8bd79 lacks slices 7–12
---

# Research: grouping history by path, optionally by authorization (Cookie and Authorization)

## Problem as stated (author, verbatim)

> When I'm using http request app like insomnia I often edit requests on the tab on the left when I resend them.
> However I realized that It's often for me that I need a response from such request back in time - for instance to
> see how the data was changed, how the request/response has changed and like the undocumented api changes. It's why I
> need history. However grouping history by path (default) and authorization (optional additional) (Cookie and
> Authorization headers) would be useful.

## Questions asked
1. What already groups calls by path, and what is the key? — **answered**
2. How is the History list itself grouped? — **answered**
3. What exists for telling calls apart by Authorization, and by Cookie? — **answered**
4. What exists for seeing how a request or response changed between two calls of one group? — **answered**
5. What limits apply to a per-path group (size, speed, key stability)? — **answered**; query cost **unmeasured**

## Findings

### 1. Grouping by path that already exists

**Answer:** Slice 7 (on `land-slices-7-12`, not on `main`) groups calls by **method + URL pathname**. Host, environment,
query string, fragment and headers are not part of the key. The group is shown in two places: "Responses to this
request" under the workspace response, and "Other responses to METHOD path" on a call record.

**Evidence**
- `src/core/call-store.ts:90-107` (branch) — `listResponses(method, path)`: `request.method` equality plus `$regex` on `request.url`; "The query string, fragment and host are not part of the key".
- `src/core/call-store.ts:402-407` (branch) — `pathPattern`: any scheme and host, exact path, then `?`, `#` or end; `/` also matches an empty path.
- `src/renderer/app.tsx:2274-2286` (branch) — `requestKeyOf`: `new URL(url).pathname`; the renderer's copy of the same rule.
- `src/renderer/app.tsx:622`, `:632`, `:2130` (branch) — key taken from the last result (workspace) and from the opened call (record).
- `context/archive/responses-strip/record.md` §2 (branch) — key decided by the author; screen 01 puts `/api/orders?dryRun=false` with `/api/orders`.
- Pencil screen 01 (`pyg23`) "Responses Strip": "Responses to this request · 3 kept"; screen 02 (`aJeTB`): "Other responses to GET /api/orders/1287".

**Verified by:** reading branch files via `git show`; Pencil text read.
**Confidence:** high.

### 2. How the History list is grouped

**Answer:** By **day** ("Today", "Yesterday", date), newest first, over the newest 200 calls. Calls with the same path
appear as separate rows wherever their send times put them. Screens 01 and 02 draw the same day groups ("TODAY",
"YESTERDAY") with two adjacent `POST /api/orders` rows.

**Evidence**
- `src/renderer/app.tsx:3009-3019` (branch) — `HistoryList` builds one group per `dayLabel`.
- `src/renderer/app.tsx:3097-3100` (branch) — `dayLabel`: Today / Yesterday / date.
- `src/server/ipc.ts:78` (branch) — `HISTORY_LIMIT = 200`.
- Pencil `pyg23` / `aJeTB` — `List > Group Today`, `Group Yesterday`.

**Verified by:** reading; Pencil text read.
**Confidence:** high.

### 3. Telling calls apart by Authorization and Cookie

**Answer:** Authorization has one shared rule, `authorizationOf`: the **first** `Authorization` header value, name
matched case-insensitively, compared as an exact full string. It feeds the History search facet and the call record
chip, not the path grouping. **Cookie has no rule anywhere**: a `Cookie` header is only a header value, reachable through
the search box's text match over request header values.

**Evidence**
- `src/core/headers.ts:1-7` (branch) — `authorizationOf`, first match, exact value.
- `src/core/call-store.ts:378-392` (branch) — `factsOf` stores `auth: authorizationOf(...) ?? ''`; `''` means "no header".
- `src/core/call-store.ts:164-175` (branch) — `auths` filter is exact-value membership.
- `src/core/call-store.ts:126-135` (branch) — text search covers `headerValues`, so a cookie substring finds calls.
- `src/core/call-store.ts:90-107` (branch) — `listResponses` takes no header input.
- `context/archive/history-search/record.md` §5 (branch) — "Each facet value is an exact stored value, for example a full Authorization token. Values can be up to 64 KiB."
- `src/core/wire.ts:161`, `:197` — request header names stored as typed (case kept); `cookie` is neither managed nor refused (`wire.ts:65-82`).
- `context/foundation/roadmap.md:242` (branch) — "OAuth2 token flows, cookie jar" under "Not ordered yet".

**Verified by:** reading + `grep -i cookie` over branch `src/core`, `src/shared`, `src/renderer/app.tsx` (only the
server's own session-cookie comment at `app.tsx:138` matches).
**Confidence:** high.

### 4. Seeing what changed between two calls of one group

**Answer:** One call at a time. Picking a chip in the workspace strip shows that call's **response** only; picking a
chip on a call record opens the whole record (request as sent + response). No view shows two calls together or marks
differences.

**Evidence**
- `context/archive/responses-strip/record.md` §1 (branch) — "Picking a chip loads that call and shows its response"; on the record, "Picking a chip opens that call".
- `src/renderer/app.tsx:2288-2304` (branch) — `Picked` holds one `completion`.
- `context/foundation/roadmap.md:240` (branch) — "Side-by-side diff of two calls" is "Not ordered yet"; `prd.md:92` lists it as later.
- Pencil screen 01 strip footer text: "Postman would keep only the last one" — the design's stated purpose of the strip.

**Verified by:** reading; Pencil text read.
**Confidence:** high.

### 5. Limits on a per-path group

**Answer:** A group shows at most 500 calls, newest first. It is computed by a `$regex` scan over all sends on every
History change. The path is not stored; it is re-derived from `request.url` by two rules that must agree (store regex,
renderer `URL.pathname`). Path parameters are part of the key: `/api/orders/1287` and `/api/orders/1288` are different
groups. Sends record no link to the OpenAPI template they came from, so a templated path (`/orders/{id}`) is not
available as a key.

**Evidence**
- `src/core/call-store.ts:334` (branch) — `RESPONSES_LIMIT = 500`.
- `context/archive/responses-strip/record.md` §5 (branch) — "`pathPattern` … and `requestKeyOf` … must agree"; "`listResponses` scans `sends` and runs on every History change, twice when a call is open".
- `context/foundation/roadmap.md:245-248` (branch) — "a stored, indexed `request.path`" is deferred under "Search performance".
- `src/core/call-schema.ts:32-34` (branch) — send links are `environment` and `savedRequestId` only; `grep template src/core/send.ts` (branch) — no match.
- `src/core/template-store.ts:29-31` (branch) — the template keeps `METHOD path` "as the spec states it", but nothing copies it onto a send.

**Verified by:** reading + text search.
**Confidence:** high for shape; query cost at real volume **unmeasured**.

## What the code does not say

- **The key ignores host and environment by design.** `GET /v1/health` on local and on staging is one group
  (`call-store.ts:92`, author decision `roadmap.md:107-108` on main). Grouping "by path" therefore already mixes
  environments; separating them would be a second dimension, like auth.
- **"Authorization" means the first header only, exact bytes.** A token refreshed every hour produces a new value each
  hour, so an exact-value split separates calls made by the same user (`headers.ts:6`). The design's labels
  ("staging · service token", "local · dev user", screen 04) imply an identity the store does not hold.
- **A Cookie header holds several cookies in one string.** Two calls with the same session cookie but a different
  tracking cookie, or the same cookies in another order, have different `Cookie` values. No code parses the string
  (finding 3).
- **The two path rules can disagree.** The store matches the raw URL text; the renderer uses the parsed, normalised
  pathname. An encoded character or a URL the parser rewrites can leave a call out of its own group
  (`responses-strip/record.md` §5 names this).
- **Edit-then-resend keeps the group only if method and path stay the same.** Editing a path parameter or the method
  moves the new call to another group; editing the query, headers or body does not.

## Surprises

1. **`main` is not the code base.** Slices 7–12 (responses strip, delete with undo, history search, OpenAPI and WSDL
   import) are on `land-slices-7-12`, PR #12, open since 2026-11-21. `main`'s roadmap still says "slice 7 next". Any
   plan has to start from that branch, or after the PR merges.
2. **Path grouping already exists as the "responses to this request" view** (slice 7), but not as a way of organising
   the History list, which stays grouped by day (findings 1-2).
3. **"How the request changed" is not visible from the workspace strip**: it swaps the response only. The request as
   sent for an earlier call is reachable only by opening that call (finding 4).
4. **Cookie is new ground**: neither the PRD nor the design names it; it appears only under "cookie jar", not ordered
   (`roadmap.md:242`).

## Prior art found

- `context/archive/responses-strip/record.md` (branch) — method + pathname key; rejected: computing the group in the
  renderer (fails past 200), storing `request.path` now (schema change + migration), the query as part of the key.
  Still holds.
- `context/archive/history-search/record.md` (branch) — exact-value Authorization facet; in-memory search; rejected
  `$facet` aggregation and a text index. Still holds.
- `context/foundation/roadmap.md:245-248` (branch) — stored, indexed `request.path` deferred.
- `context/foundation/prd.md:57` — "Redacting secrets in history" is a non-goal: tokens and cookies are stored as sent,
  so their full values are available for any grouping.

## Author decisions (2026-11-22)

Answers to the questions this research raised, verbatim, with what each one settles.

1. Where path grouping appears — "both toggled". Settles: path grouping is wanted in the History list **and** in the
   responses views (workspace strip, "Other responses" on a call record), each one switched on or off. Reading of
   "toggled" to confirm in planning: a toggle per place, or one shared toggle.
2. What counts as the same authorization — "exact cookie header and authorization". Settles: whole header values
   compared as exact strings; no parsing of individual cookies, no labels. A refreshed token or a changed cookie string
   starts a new group (accepted by this choice).
3. How Cookie and Authorization combine — "if authorization is provided its authorization, if not - cookie, else no
   authorization". Settles: one auth key per call, chosen in that order: the `Authorization` value; otherwise the
   `Cookie` value; otherwise "none".
4. Side-by-side diff — "4 is for my manual verification, I don't see the point of automating this part". Settles:
   comparing two calls stays manual; no diff view in this change.

### Consequences in the code as it stands

- The History search's Authorization facet (`call-store.ts:388`, branch) uses `authorizationOf` alone, with no Cookie
  fallback. Decision 3 defines a different "auth" for grouping. Whether the facet changes to match is not decided.
- `authorizationOf` takes the **first** `Authorization` header (`headers.ts:6`, branch). Decision 3 does not say which
  `Cookie` header counts when a request carries more than one; the form allows several rows with one name
  (`wire.ts:197` passes all typed rows through).
- Header names are stored as typed, so matching `Cookie` needs the same case-insensitive name rule as `authorizationOf`.
- `listResponses` (`call-store.ts:94-107`, branch) takes only method and path; an auth dimension is new input to that
  operation and to `pigeon:list-responses` (`ipc-contract.ts:17`, `:453`, branch).

## Unanswered

- **One toggle or one per place** (decision 1) — confirm in planning.
- **Which `Cookie` header when there are several** (decision 3) — first, as `authorizationOf` does, is the existing
  precedent; not decided.
- **Does the search facet adopt the Cookie fallback?** Not decided.
- **Cost of the `$regex` scan at real history size** — not measured; needs a timing run against a `dp_test_*` database
  filled to a realistic size.

---
change_id: history-grouping
produced-by: lz-tdd
plan: plan.md
updated: 2026-11-22
---

# Progress: Group history by request path, optionally split by the authorization sent

Branch `history-grouping`, cut from `land-slices-7-12` @ `2a44ef1`.

## Phase 1 — A call authenticated by `Cookie` only shows that cookie in History search's Auth facet, its results column and the call record chip

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-22
- **Finished:** 2026-11-22

**Changed**
- `src/core/headers.ts` — `authorizationOf` replaced by `authOf(headers)` → `{ header: 'Authorization' | 'Cookie', value } | undefined`; first header of a name, name matched ignoring case; the author's rule quoted in the comment.
- `src/core/headers.test.ts` (new) — 7 cases: Authorization only, Cookie only, both (Authorization wins whatever the order), neither, several of one name (first), name case, empty Authorization value ahead of a Cookie.
- `src/core/call-store.ts` — `CallFacts.authHeader`; `factsOf` uses `authOf`; the auth facet option's `detail` is the header name.
- `src/core/search.int.test.ts` — new `describe` with its own database: a Cookie-only call is an option labelled `Cookie`, a call with both headers is filed under Authorization, `auths: [cookie]` and `auths: ['']` return the right calls.
- `src/renderer/app.tsx` — call record chip `<header>: <value>`; results table cell `<header>: <value>`; facet option text prefixed with the header from `detail`; filter summary takes the header from the matching facet option (fallback `auth`), "no Authorization" → "no auth header".
- `e2e/search.spec.ts` — scenario: a Cookie-only call reads `Cookie: session=abc123` in the facet option, its results row and the summary; `showRequestTab` imported.

**Cycles**
1. `headers.test.ts` red: `TypeError: authOf is not a function` (7 failed) → green after `authOf`.
2. `search.int.test.ts` red: `expected undefined to be 1`, `expected [] to deeply equal [ 'k1' ]` (2 failed, 7 passed) → green after `factsOf`/facet `detail`.
3. `search.spec.ts` red: facet option `/^Cookie: session=abc123\b/` not found (1 failed, 6 passed) → green after the four renderer sites.

**Verification**

```
$ npx vitest run --project unit src/core/headers.test.ts
      Tests  7 passed (7)
$ npx vitest run --project integration src/core/search.int.test.ts
      Tests  9 passed (9)
$ npm run build && npx playwright test e2e/search.spec.ts
  7 passed (15.0s)
$ npm run typecheck
(no errors)
$ grep -rn "authorizationOf\|Authorization: \${" src
(no output)
$ npm run test:unit
 Test Files  15 passed (15)
      Tests  402 passed (402)
$ npx playwright test e2e/replay.spec.ts e2e/responses.spec.ts e2e/delete.spec.ts
  12 passed (15.9s)
```

PASS — the Auth facet, the results table, the summary and the call chip all follow Authorization → Cookie → none and name the header.

**Drift:** decision — the results table shows `—` for an empty Authorization value (as before this change) rather than `Authorization: `, so the table agrees with the facet, which files an empty value under "No auth header". Not specified by the plan.

## Phase 2 — `listResponses` uses the shared request key and can be narrowed to one auth key

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-22
- **Finished:** 2026-11-22

**Changed**
- `src/core/request-key.ts` (new) — `requestKeyOf(method, url)` moved from `app.tsx`, behaviour unchanged; generic over the method type.
- `src/core/request-key.test.ts` (new) — 7 cases: query and fragment ignored, host ignored, no path / root / root with query → `/`, path as the URL parser writes it (`a b` → `a%20b`), trailing slash distinct, unparseable text falls back, method kept.
- `src/renderer/app.tsx` — imports `requestKeyOf`; local copy deleted; two call sites cast the stored method to `Method`.
- `src/core/call-store.ts` — `listResponses(method, path, inFlight, auth?)`: reads `request.url`, `request.headers`, `sentAt` of every send with the method, newest first; keeps those whose `requestKeyOf` path equals `path` and, with `auth`, whose `authOf` value (`''` for none) equals it; stops at `RESPONSES_LIMIT`; then lists those ids. `pathPattern` and `escapeRegExp` deleted.
- `src/core/call-store.int.test.ts` — two cases: a raw `a b` URL and an `a%20b` URL are both responses to `/rs5/a%20b`; `auth` narrows to Authorization A (including a call that also has a Cookie), to a Cookie-only value, and `''` to no auth.
- `src/shared/ipc-contract.ts` — `ListResponsesInputSchema.auth`: `z.string().max(65536).optional()`.
- `src/server/ipc.ts` — the handler passes `auth` to the store.
- `src/server/http.int.test.ts` — over HTTP, `auth: ''` lists the replay (no auth header) and `auth: 'Bearer nobody'` lists nothing.

**Cycles**
1. `request-key.test.ts` red: `Cannot find module './request-key'` (a move; no new behaviour) → green after the move.
2. `call-store.int.test.ts` red: `expected [ 'rs-f2' ] to deeply equal [ 'rs-f2', 'rs-f1' ]` (the `$regex` missed the raw space) and `expected [ 'rs-g5', … ] to deeply equal [ 'rs-g3', 'rs-g1' ]` (auth ignored) → green after the rewrite; the 5 existing `listResponses` cases pass unchanged.
3. `http.int.test.ts` red: `Cannot read properties of undefined (reading 'map')` — the strict input schema refused `auth` → green after the contract and handler change. The first green attempt failed on the test's own assertion (the original send is deleted earlier in that test); the assertion now names the replay.

**Verification**

```
$ npx vitest run --project unit src/core/request-key.test.ts
      Tests  7 passed (7)
$ npx vitest run --project integration src/core/call-store.int.test.ts
      Tests  28 passed (28)
$ npm run test:integration
 Test Files  16 passed (16)
      Tests  378 passed (378)
$ npm run test:unit
      Tests  409 passed (409)
$ npm run build && npx playwright test e2e/responses.spec.ts e2e/delete.spec.ts
  10 passed (13.4s)
$ npm run typecheck && npm run lint
(no errors) · All matched files use the correct format.
```

PASS — the store finds responses with the same function the renderer names them with, and narrows them by auth over HTTP; the workspace strip is unchanged.

**Drift:** decision — `listResponses` reads the url and headers of every send with the method, then lists at most 500 of the matches, instead of loading full summaries and filtering (plan: "keep summaries where …"). Same result; loads completions for the matches only. An unreadable send whose `request.url` is a string still appears as an unreadable response when its path matches, as with the `$regex`.

## Phase 3 — "Split by auth" in the workspace strip and on the call record, remembered on reload

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the plan assigns this phase to lz-e2e; its risk (a list swapped under a key, a setting surviving a reload)
is observable only in the browser (T2.9, T2.10). Phase 4 does not depend on it and runs first under lz-tdd. Run
`/lz-e2e history-grouping` for Phases 3 and 5.

## Phase 4 — The server returns request groups over all of history, optionally split by auth

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-22
- **Finished:** 2026-11-22

**Changed**
- `src/core/call-store.ts` — `listRequestGroups(inFlight, { splitByAuth })`: lists every summary (`list({}, 0, …)`, as `searchCalls`), skips unreadable calls, keys on method + `requestKeyOf` path (+ `authOf` value when split); each group has `method`, `path`, `auth` (`Auth | null`), `count`, `latest` (first call seen, i.e. newest); groups in order of their newest call. Exported `RequestGroup` type.
- `src/core/call-store.int.test.ts` — `describe('listRequestGroups')` with its own database: 250 calls + 6 more (counts 150 / 100 / 5 / 1, total 256 beyond HISTORY_LIMIT; two hosts and a query in one group; GET and POST apart; newest call and its completion state; no bodies); split by auth on `/me` (Bearer A ×2, Bearer B, Cookie, none) with a call that has both headers filed under Authorization; an unreadable send in no group; an empty database; a 5 000-call timing case seeded in bulk (60 s limit). The store-keys test lists `listRequestGroups`.
- `src/shared/ipc-contract.ts` — channel `pigeon:list-request-groups`; `ListRequestGroupsInputSchema` (`{ splitByAuth: boolean }`), `RequestGroupSchema`, `ListRequestGroupsResultSchema`; `PigeonApi.listRequestGroups`.
- `src/server/ipc.ts` — handler: input refused with a message; `{ ok: true, groups: [] }` while the database is not up; `{ ok: false, message }` on a failed query; `latest` passed through `toView`.
- `src/renderer/api.ts` — `listRequestGroups`.
- `src/shared/wire-codec.test.ts` — a groups result (one with a Cookie auth, one with `auth: null`) round-trips with `Date` timestamps.
- `src/server/http.int.test.ts` — the operation answers over HTTP; the test's send is the one call of the `POST /` group, `auth: null`.
- `src/server/ipc.int.test.ts` — database down → empty; a query that throws → message; `{ splitByAuth: 'yes' }` refused.

**Cycles**
1. `call-store.int.test.ts` red: `store.listRequestGroups is not a function` (3) and the store-keys list one key short → green after `listRequestGroups`; existing 27 cases unchanged.
2. `wire-codec.test.ts` red: `Cannot read properties of undefined (reading 'safeParse')`; `http.int.test.ts` red: `Cannot read properties of undefined (reading 'replace')` (no channel) → green after the contract, handler and client.
3. `ipc.int.test.ts` failure-path case: written after the handler and green on its first run — not seen red. It covers the plan's "database-down returns an empty list".

**Verification**

```
$ npx vitest run --project integration src/core/call-store.int.test.ts -t listRequestGroups --reporter=verbose
 ✓ … one group per method and path over every call, newest group first, with its newest call 9ms
 ✓ … split by auth, a path has one group per Authorization, otherwise Cookie, value, and one with none 5ms
[A1] listRequestGroups over 5000 calls: 59 ms
 ✓ … 5 000 calls group, and the time it takes is printed 230ms
 ✓ … an empty history has no groups 6ms
$ npx vitest run --project unit src/shared/wire-codec.test.ts
      Tests  15 passed (15)
$ npx vitest run --project integration src/server/ipc.int.test.ts
      Tests  8 passed (8)
$ npm run test:unit
      Tests  410 passed (410)
$ npm run test:integration
 Test Files  16 passed (16)
      Tests  383 passed (383)
$ npm run typecheck && npm run lint
(no errors) · All matched files use the correct format.
```

PASS — groups cover every call (256 > 200), split by the author's auth rule, and the operation answers over HTTP. A1 holds: 59 ms for 5 000 calls with 512-byte bodies excluded by projection.

**Drift:** decision — the plan's `-t groups` matches one test name only; the verification ran `-t listRequestGroups` (the describe), which runs all four. Applied the second plan review's note: the 5 000-call case inserts in bulk into the throwaway database with its own 60 s limit.

## Phase 5 — History opens grouped by request; By day / By request and Split by auth toggle it and are remembered

- **Executor:** lz-tdd → routed to lz-e2e
- **Status:** in-progress

**Routed:** the plan assigns this phase to lz-e2e; its risks (the default after a fresh launch, a setting kept across a
reload, one group's rows under another, expanded rows out of view) are observable only in the browser (T2.9, T2.10).
Its server half, `listRequestGroups`, is Phase 4 (done). Run `/lz-e2e history-grouping` after Phase 3.

---
change_id: responses-strip
produced-by: lz-tdd
updated: 2026-11-21
---

# Progress: responses strip

## Phase 1: the store and the operation answer "every response to this method and path"

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/call-store.ts`:
  - `listResponses(method, path, inFlight)`: sends filtered by `request.method` and by a `request.url` regex. The regex
    is anchored on scheme and host, then the escaped path, then `?`, `#` or the end. `/` also matches a URL with no
    path. Newest first, without bodies, capped at 500.
  - `listCalls` and `listResponses` share one private `list(filter, …)`.
- `src/shared/ipc-contract.ts`: channel `pigeon:list-responses`, `ListResponsesInputSchema` (method in `METHODS`, path
  starting with `/`, at most 8 KiB) and `PigeonApi.listResponses`.
- `src/server/ipc.ts`: the handler. Invalid input returns `{ ok: false }`. A database that is not up returns an empty
  list.
- `src/renderer/api.ts`: the client method.
- Tests:
  - `call-store.int.test.ts`: 5 cases.
    - query, fragment and host are ignored, and the order is newest first;
    - another method, a longer path, a shared prefix or a trailing slash does not match;
    - regex characters in the path match literally;
    - the root path matches a URL with no path;
    - 230 calls are all returned.
  - The store-surface test now lists `listResponses`. It is a read; the test guards that there is no update or delete.
  - `http.int.test.ts`: the all-operations test covers the new channel.

**Verification**

```
$ npx vitest run --project integration src/core/call-store.int.test.ts      # before
     × (5 cases) TypeError: store.listResponses is not a function
$ npx vitest run --project integration src/server/http.int.test.ts -t "every operation"   # before the contract
     × every operation in the contract answers through HTTP — TypeError: Cannot read properties of undefined
$ npx vitest run --project integration src/core/call-store.int.test.ts → Tests 20 passed (20)
$ npx vitest run --project integration src/server/                       → Tests 41 passed (41)
$ npm run test:integration → Tests 345 passed (345)
```

PASS.

**Drift:** none.

## Phase 2: the strip and the call record's other responses

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/renderer/app.tsx`:
  - `App` lists the responses to the result's request (`requestKeyOf`: method, plus the URL's pathname) and to the
    opened call's request. Each list refreshes when History changes. Each list is tagged with its key, so a list for the
    previous request is never shown.
  - `pickResponse` loads a picked call with `getCall` and shows its completion. Picking the latest goes back to the
    result.
  - `ResultView` takes `picked` and `strip`. `CompletionView` puts the strip under its header.
  - `ResponsesStrip`: "Responses to this request · N kept", then chips. A chip (`ResponseChip`) is an `aria-pressed`
    button with a status dot, the code, the time and the duration.
  - `CallPanel` shows "Other responses to METHOD path" (`other-responses`). Picking one opens that call.
  - The result scrolls into view again when the strip first appears for a request.
- `src/index.css`: strip and chip styles.
- `e2e/responses.spec.ts` (new): 3 scenarios.

**Verification**

```
$ npx playwright test e2e/responses.spec.ts                 # before the UI
  3 failed (toContainText / toHaveCount)
$ npx playwright test e2e/responses.spec.ts --repeat-each=3
  9 passed (5.9s)
$ npx playwright test
  ✘ bodies.spec.ts › T2.9 … (toBeInViewport: the strip loads after the scroll and pushes the body down)
  66 passed
$ (re-scroll when the strip appears) npx playwright test
  67 passed (52.0s)
$ npm run typecheck → 0 · npm run lint → clean · npm run test:unit → 371 passed
$ screenshot: context/changes/responses-strip/shot-strip.png, compared with pyg23 "Responses Strip"
```

PASS.

**Drift:**
- decision: the strip is placed under the response header, inside `CompletionView`. The design puts it in the same
  place.
- decision: the "delete any you don't need" hint and the × on chips are left out. Delete is slice 8.

## Code-review fixes: /code-review findings 1–4, 7, 8 and 9

- **Executor:** lz-e2e (findings 2 and 7); lz-build (the rest)
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed** (`src/renderer/app.tsx`, `src/index.css`)
- 1 and 4: a pick is tagged with the result it was made under (`Picked.resultId`). A pick from an earlier result is
  never shown, including on the first render of a new one. The reset effect is removed.
- 2 and 7: `useResponses(key, refresh)` serves both lists, tagged with the request key. A list for another request is
  never returned. A failure returns its message, which the strip area shows as `responses-error`.
- 3: a picked call without a completion shows "Loading the response…", "In flight: no response yet", "The response
  could not be loaded: …" or "No response was recorded for this call".
- 8: unreadable calls are filtered out before "Other responses" decides to render.
- 9: the strips scroll sideways (`nowrap`, `overflow-x: auto`), so many chips do not push the body down.
- `requestKeyOf` always returns a path starting with `/`.
- `e2e/responses.spec.ts`: 2 new scenarios, for findings 2 and 7.

**Verification**

```
$ npx playwright test e2e/responses.spec.ts       # before the fixes
  ✘ while a call's other responses load, the previous call's are not shown under its name (toHaveCount)
  ✘ responses that cannot be listed say so (Expected substring: "listing failed")
$ npx playwright test e2e/responses.spec.ts --repeat-each=3 → 15 passed (5.9s)
$ npx playwright test → 69 passed (53.0s)
$ npm run typecheck → 0 · npm run lint → clean · npm run test:unit → 371 passed
```

**Drift:** none.

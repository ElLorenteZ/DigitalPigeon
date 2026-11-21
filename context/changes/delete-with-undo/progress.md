---
change_id: delete-with-undo
produced-by: lz-tdd
updated: 2026-11-21
---

# Progress: delete with undo

## Phase 1: the store deletes exactly one call and its files, and sweeps orphans

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/call-store.ts`:
  - `deleteCall(sendId)`: the completions for the id, the send, and every `StoredFile` the two documents reference.
    Returns `{ deleted }`.
  - `sweepOrphanBodies(cutoff)`: removes `bodies.files` uploaded before the cutoff that nothing references, and
    `bodies.chunks` older than the cutoff (by ObjectId time) whose file document is missing.
- `src/core/body-store.ts`: `remove(fileId)`. It falls back to deleting the chunks when no file document exists.
- `src/shared/ipc-contract.ts`, `src/server/ipc.ts`, `src/renderer/api.ts`: `pigeon:delete-call`. It refuses a call
  in flight, answers `Call not found` for an unknown id, and sweeps orphans older than 1 h after each delete.
- Tests:
  - `call-store.int.test.ts`:
    - T1.7, 3 cases: only the target's send, completion and files go, a neighbour stays deep-equal; an inline call with
      no completion; an unknown id deletes nothing.
    - T3.9, 2 cases: old orphans go while referenced and recent files stay, and A1 is checked on a real upload; recent
      unreferenced files stay.
  - The T1.1 surface guards now name `deleteCall`, `sweepOrphanBodies` and `remove`. There is still no update. The
    guard test titles changed to say this.
  - `http.int.test.ts`: the all-operations test deletes the call last and checks that `getCall` returns null.

**Verification**

```
$ npx vitest run --project integration src/core/call-store.int.test.ts     # before
     × (6) the surface guard; removes the send…; inline…; unknown id…; removes old unreferenced…; keeps…
$ npx vitest run --project integration src/server/http.int.test.ts -t "every operation"   # before the contract
     × TypeError: Cannot read properties of undefined (reading 'replace')
$ npx vitest run --project integration src/server/ src/core/call-store.int.test.ts src/core/body-store.int.test.ts
      Tests  88 passed (88)
$ npm run test:integration → Tests 350 passed (350)
```

A1 holds: the chunk ObjectId's time was within 60 s of the upload.

**Drift:** none.

## Phase 2: delete from the strip, History and the call record, with Undo

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/renderer/app.tsx`:
  - `held` holds the ids deleted but inside their window, and `holdTimers` holds one timer per id.
  - `deleteLater` hides the call from History, both strips and the call view, and returns to the workspace if that call
    was open. After `UNDO_WINDOW_MS` (8000) it calls `deleteCall`. On failure, the call reappears and the toast shows
    the reason.
  - `undoDelete` clears the timer and shows the call again.
  - A toast (`role="status"`, named "Deleted") says "Call deleted" and offers Undo.
  - The controls:
    - each History row has a × button named "Delete METHOD URL";
    - strip chips are a group of the pick button and a × named "Delete response CODE TIME";
    - the call record has a red "Delete", disabled while the call is in flight.
  - A tab closed inside the window deletes nothing.
- `src/index.css`: toast, row ×, chip group and danger button styles.
- `e2e/delete.spec.ts` (new): 3 scenarios.
- Spec selectors: a History row's `li` now holds two buttons, so 33 row-button lookups take `.first()`, the row itself.
  `rowName` does too. `responses.spec.ts` `chips()` excludes buttons named "Delete …".

**Verification**

```
$ npx playwright test e2e/delete.spec.ts                       # before the UI
  3 failed (toHaveCount: no Delete buttons)
$ npx playwright test e2e/delete.spec.ts --repeat-each=3        → 9 passed (32.4s)
$ npx playwright test                                           → 71 passed, 1 failed (bodies: a row lookup without .first())
$ npx playwright test e2e/bodies.spec.ts                        → 9 passed (after .first())
$ npm run typecheck → 0 · npm run lint → clean · npm run test:unit → 371 passed
```

**Drift:** none. The ledger records the spec selector edits.

## Code-review fixes: /code-review findings 1–10

- **Executor:** lz-tdd (finding 1); lz-e2e (findings 2 and 4); lz-build (the rest)
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- 1: `sweepOrphanBodies` also counts saved requests' files, `request.body.text.fileId` and
  `request.body.parts.bytes.fileId`, as in use. The new integration test failed first with "The stored body … is
  missing".
- 2: a response on screen that is held for deletion shows "This response was deleted. Undo keeps it." A picked
  response that is deleted clears the pick.
- 3: the History-row and strip × buttons are disabled for a call in flight, and `deleteLater` ignores one.
- 4: one toast per pending delete, naming the call (`METHOD /path`), and one per failure.
- 5: the Undo toast closes as soon as the window ends, before the store is called.
- 6 and 7: `deleteCall` deletes the send first, then the completions. A file that cannot be removed is left for the
  sweep, and the call still counts as deleted.
- 8 and 9: the sweep runs at most once an hour, for data older than 24 h.
- 10: the `call-store.ts` header now describes deletion and names the sweep's references.

**Verification**

```
$ npx vitest run --project integration src/core/call-store.int.test.ts -t "saved request's stored"   # before
     × keeps a saved request's stored text body and file part — Error: The stored body … is missing
$ npx playwright test e2e/delete.spec.ts                                                        # before
  ✘ deleting the response on screen says so… · ✘ two deletes in a row can each be undone
$ npx playwright test e2e/delete.spec.ts --repeat-each=3 → 15 passed (34.2s)
$ npx playwright test → 74 passed (1.1m)
$ npm run test:integration → 351 passed · npm run test:unit → 371 passed · typecheck 0 · lint clean
```

**Drift:** none.

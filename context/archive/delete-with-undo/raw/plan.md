---
change_id: delete-with-undo
title: Delete one call from anywhere it shows, with Undo for eight seconds
produced-by: lz-plan
revision: 1
created: 2026-11-21
updated: 2026-11-21
inputs: change.md, roadmap decisions (2026-11-11), test-strategy T1.1/T1.7/T3.9, src/core/call-store.ts, src/core/body-store.ts, the Pencil design (03 row 3 "delete with undo", 02 Delete button)
---

# Plan: delete with undo

## Approach

- **Store.** `callStore.deleteCall(sendId)` reads the send and its completion. It then deletes the completion
  documents for that `sendId`, deletes the send document, and removes every body file the two documents reference:
  the request body and the response body, each a `StoredFile`. It returns `{ deleted: boolean }`. Nothing else is
  touched. T1.7 seeds neighbours: the same URL, a replay of the call, and another call with files. All must stay
  deep-equal.
- **T3.9.** `callStore.sweepOrphanBodies(cutoff)` removes:
  - `bodies.files` entries uploaded before `cutoff` that no send or completion references;
  - `bodies.chunks` older than `cutoff`, by their ObjectId time, whose file document is missing.

  The cutoff (now minus 1 h) keeps the sweep away from an upload in progress, whose chunks exist before its file
  document. The sweep runs after each permanent delete.
- **T1.1 guard.** The store-surface tests change on purpose. The call store gains `deleteCall` and
  `sweepOrphanBodies`, and still has no update. The body store gains `remove(fileId)`. Each new function is tested to
  remove only what it names.
- **Contract.** `pigeon:delete-call` takes the send id and returns `MutationResult`. A call in flight in this process
  is refused ("A call in flight cannot be deleted"). An unknown id returns `{ ok: false, message: 'Call not found' }`.
- **UI.**
  - A delete hides the call at once from History, both strips and the call view. If the call view showed it, the app
    returns to the workspace.
  - A toast (`role="status"`) says "Call deleted" and offers Undo. Undo within 8 s cancels the timer and shows the call
    again. After 8 s, `deleteCall` runs. On failure, the call reappears and the toast shows the reason.
  - Several deletes can be pending at once, each with its own timer. The toast shows the latest one.
  - **Quitting inside the window: the delete is not carried out, and the call stays.** Holding the call in the app
    means nothing reached the store, and a closed tab cannot be trusted to finish a request. Losing a delete is safe;
    losing a call is not.
  - Buttons:
    - a `×` on each strip chip, beside the pick button. A button cannot hold another, so the chip becomes a group.
    - a `×` on each history row, named "Delete METHOD URL";
    - a red "Delete" on the call record (screen 02).

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Soft delete (a `deletedAt` flag) with Undo in the store | The author decided "held in the app" (2026-11-11). It would also change every query and leave records that are "deleted" but stored. |
| Send pending deletes on `pagehide` (`sendBeacon`) | The server requires `POST` with the server's own `Origin`. A beacon cannot be confirmed, and a half-done delete is worse than none. |
| Sweep orphans on startup | Startup is when an interrupted upload's chunks are freshest. After a permanent delete is an existing, user-driven moment. |

## Out of scope

- Bulk delete (slice 9).
- Retention rules.
- Undo after the window.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | GridFS chunk `_id`s are ObjectIds created by the driver at upload, so their time is the upload time. | The chunk sweep cannot tell old orphans from an upload in progress. | yes. Phase 1 checks it on a real upload. |

## Phases

### Phase 1: the store deletes exactly one call and its files, and sweeps orphans

- **Executor:** lz-tdd (test-strategy T1.7, T3.9: integration).
- **Files:** `src/core/call-store.ts`, `src/core/body-store.ts` and their `*.int.test.ts`; `src/shared/ipc-contract.ts`;
  `src/server/ipc.ts`; `src/renderer/api.ts`; `src/server/http.int.test.ts`.
- **Verification:** `npx vitest run --project integration src/core/call-store.int.test.ts src/core/body-store.int.test.ts src/server/`
  red, then green.

### Phase 2: delete from the strip, History and the call record, with Undo

- **Executor:** lz-e2e.
- **Files:** `src/renderer/app.tsx`, `src/index.css`, `e2e/delete.spec.ts` (new).
- **Scenarios:**
  1. Delete from History; the row disappears; Undo brings it back; nothing reaches the store meanwhile.
  2. Delete from a strip chip; after the window, the call is gone from History and from `getCall`.
  3. Delete from the call record; the view returns to the request; Undo restores the row.
- **Verification:** `npx playwright test e2e/delete.spec.ts` red, then green 3×. The full suite green.

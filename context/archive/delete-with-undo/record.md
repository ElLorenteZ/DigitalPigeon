---
change_id: delete-with-undo
title: Delete one call from anywhere it shows, with Undo for eight seconds
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-21
ticket: null
verdict: merge
outcome: shipped
milestone: M1, slice 8 (roadmap.md)
branch: delete-with-undo, PR #7 (stacked on #6; archived on the branch before merge)
raw: raw/
---

## 1. What was built

- A call can be deleted from three places: a History row (×), a response chip (×), or the call record ("Delete").
- It disappears at once, and a toast names it and offers Undo for 8 s. After that, `pigeon:delete-call` removes its
  send, its completions and its body files.
- An orphan sweep (T3.9) removes body files and chunks that nothing refers to. It runs at most once an hour, for data
  older than a day.
- Test-strategy T1.7 is covered for single delete. Bulk delete is slice 9.

**Differs from the plan:**
- The sweep runs at most hourly, with a 24 h cutoff. The plan had it after every delete, with 1 h.
- There is one toast per pending delete.
- Both came from code review.

## 2. Why this approach

The author decided the call is held in the app during the window, so Undo never touches the store and nothing in the
store is ever "half deleted". Deleting the send first makes the call gone as soon as that one write succeeds. Files are
removed afterwards, and anything left over is swept later.

## 3. What was rejected

- **A soft delete (a `deletedAt` flag).** It contradicts the author's decision. Every query would need it, and deleted
  data would stay stored.
- **Sending pending deletes on `pagehide` (`sendBeacon`).** A beacon cannot carry the required `Origin` with a
  confirmed result. Losing a delete is safe; losing a call is not.
- **Sweeping on startup.** That is when an interrupted upload's chunks are freshest.

## 4. Surprises

- **Saved requests keep large bodies in the same `bodies` bucket.** The first sweep would have deleted them, which
  would have been data loss. Code review caught it, and an integration test now guards it. Any new holder of a body
  file must be added to the sweep's references (header of `call-store.ts`).
- A GridFS chunk's ObjectId carries its upload time (A1, checked on a real upload). That is what lets the sweep skip
  uploads in progress.
- A History row holding two buttons made 33 spec lookups ambiguous. They now take `.first()`.

## 5. What still stands

- If a stored body goes missing, check `sweepOrphanBodies` first. Every collection that refers to a file must be in its
  reference list.
- A tab closed within 8 s of a delete keeps the call. This is by design.
- Undo is per call, and the toasts stack.

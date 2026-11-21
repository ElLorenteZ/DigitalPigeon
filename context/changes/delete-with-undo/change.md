---
change_id: delete-with-undo
title: Delete one call from anywhere it shows, with Undo for eight seconds
status: new
ticket: null
created: 2026-11-21
updated: 2026-11-21
closed: null
produced-by: lz-change
---

## Intent

Roadmap M1 slice 8, "Delete with undo": "Delete one response from the strip, the history list or the call record; it
disappears, an Undo toast restores it for a few seconds, then it is gone permanently along with its stored bodies and
file copies".

Author, 2026-11-11: during the Undo window the call is "held in the app". The store is not touched until the timer
ends, and the window is 8 s, as in the design. Left to `lz-plan`: what happens to a pending delete when the app quits
inside the window.

## Boundary

**This change covers:**
- Deleting one call permanently: its send document, its completion, and its stored request and response body files.
  The deletion is tested at the store to close test-strategy T1.7 for a single delete.
- T3.9: removing body files and chunks that no call refers to, as the roadmap carried into this slice.
- Delete buttons on a strip chip, on a history row and on the call record. The call disappears at once. An Undo toast
  restores it within 8 s, and after that the call is deleted.

**Explicitly not in this change:**
- Bulk delete of a selection (slice 9, with the results table).
- Retention rules (not in M1).
- Deleting saved requests or environments; that already exists.

---
change_id: multipart-with-file-copies
title: Send multipart requests with files, keeping a stored copy so replay survives file deletion
status: new
ticket: null
created: 2026-11-08
updated: 2026-11-08
closed: null
produced-by: lz-change
---

## Intent

"close 3b, merge to master then open slice 4"

Slice 4 in `context/foundation/roadmap.md`: "Send a multipart request with a file; delete the file from disk; replay the call and the server receives the same bytes".

## Boundary

**This change covers:**
- Building and sending a `multipart/form-data` request with text fields and one or more file parts chosen from disk.
- Recording the multipart request as sent, including a stored copy of each uploaded file's bytes (PRD success criteria lines 28–29).
- Exact replay of a recorded multipart call from the stored copy, after the original file is deleted or moved (T1.4, T1.3 for multipart).
- curl export of a recorded multipart call, or a stated refusal where curl cannot reproduce the same bytes (T2.4 for multipart).
- Showing a recorded multipart request body in the call panel.
- Risks carried from `archive/request-bodies-and-storage`: undici's headers timer with file bodies, and T1.5 (over 16 MB) for uploaded files.

**Explicitly not in this change:**
- Saved requests and environments — slice 5.
- Filtering or searching history, including by file name or part content — slice 6.
- Deleting calls and the stored file copies they hold, and orphaned chunks (T3.9) — slice 7.
- Multipart types other than `form-data` (`multipart/mixed`, `related`) — not in the PRD.
- Pretty-printing JSON or XML inside individual parts — not in the slice 4 outcome.
- Size caps or deduplication of stored file copies — PRD non-goal ("Size caps or truncation of stored response bodies"; A3 relies on retention instead).
- curl export on Linux above 128 KiB — waits on the work machine's OS decision (roadmap).

## Notes

- Branch `multipart-with-file-copies`, cut from `main` at `00dc9d3` (slice 3b merged through PR #3).
- Test-strategy gaps this slice closes: T1.4; T1.2, T1.3, T2.4 for multipart; T1.5 for uploaded files (`test-strategy.md` lines 112, 116).
- Calibration: every slice so far took two days; this one returns to undici, curl and GridFS (`roadmap.md`).

---
change_id: saved-requests-and-environments
title: Save and edit requests, and send them to the active environment's baseUrl
status: closed
ticket: null
created: 2026-11-10
updated: 2026-11-11
closed: 2026-11-11
produced-by: lz-change
---

## Intent

"/lz-change saved-requests-and-environments", opening slice 5 of `context/foundation/roadmap.md`: "Save a request and
edit it later; define environments (name + `baseUrl`), switch the active one, and the same saved request goes to the
other `baseUrl`; calls link back to their saved request".

Boundary question answered by the author: "One change, both (Recommended)".

## Boundary

**This change covers:**
- Saving the request in the form as a named saved request, listing saved requests, opening one into the form, editing it and saving it again (PRD: "Save a request and edit it later. Saved requests and calls are separate.").
- Saved requests as one flat list, found by name (ADR 0001).
- Environments, each a name plus a `baseUrl`: create, edit, choose the active one (PRD success criterion: "Switching the active environment changes the `baseUrl` that a saved request is sent to.").
- A saved request sent from the form goes to the active environment's `baseUrl`, and the call records the environment used and a link to the saved request it came from (PRD: call record holds "the environment used, a link to the source saved request").
- Starting a send from a saved request or from a historical call (PRD).
- T2.5: URL composition from `baseUrl` and path.

**Explicitly not in this change:**
- Filtering history by environment or by saved request — slice 6 (this change records the fields slice 6 filters on).
- Directories or tags for saved requests — ADR 0001; tags later.
- Environment variables other than `baseUrl` — PRD non-goal.
- Auth per environment — later milestone ("Auth per environment").
- Deleting saved requests, environments or calls — slice 7 decides deletion; whether a saved request or environment can be deleted in this change is a planning question, not assumed.
- Request templates and OpenAPI import — later milestone.
- Import of Postman collections and environments — PRD non-goal.

## Notes

- Branch `saved-requests-and-environments`, cut from `main` at `11d828e`.
- Test-strategy gaps this slice is expected to close: T2.5; the environment and source-saved-request parts of T1.2 (`test-strategy.md`, T1.2 row).
- Calibration: two days a change; slices 5–7 are mostly renderer and query work, the area that cost most in slice 4 (`roadmap.md`).
- Closed 2026-11-11: shipped. All 5 phases done and verified; review verdict merge-with-fixes, F1 and both /code-review passes fixed or accepted with reasons (CR3/R4, CR6/R6, CR8, R7); R10 fixed without a test (needs a database reconnect).

---
produced-by: lz-roadmap
current-milestone: M1
updated: 2026-11-03
---

# Roadmap

## Current: M1 — REST client that keeps every call

Appetite: about 2 weeks, sized to replace Postman/Insomnia for REST work (`shape-notes.md`).

**Exit criteria** — from `prd.md` Success criteria:
- [ ] Sending the same unchanged request twice produces two call records, each with its own timestamp.
- [ ] A call record's content does not change after it is written; edit-and-send creates a new record and the original is unchanged when viewed again.
- [ ] An exact replay sends the same method, URL, headers and body as the recorded request, and creates a new record.
- [ ] A call record disappears only after the user deletes it, one at a time or in bulk.
- [ ] A call record shows the request as sent, response status, response headers, full response body and timing.
- [ ] JSON and XML request and response bodies are shown pretty-printed.
- [ ] JSON, XML, plain-text, form-urlencoded and multipart requests can each be sent and are recorded.
- [ ] A recorded multipart call can be replayed after the uploaded file is deleted from its original location.
- [ ] History can be narrowed by environment, by saved request, by date range, and by a search term in URL or body.
- [ ] Switching the active environment changes the `baseUrl` a saved request is sent to.
- [ ] A request exported as curl, run in a terminal, sends the same method, URL, headers and body.
- [ ] The app runs as a local install on the personal machine with no account.
- [ ] *(Author's judgement)* Postman/Insomnia goes unopened for REST work for two weeks, and finding and replaying a past call is faster than in Postman.

| # | Slice | Observable outcome | Status | Change |
|---|---|---|---|---|
| 1 | Send and record | Type a method, URL, query params and headers (including a pasted auth header), send, see status, headers, body and timing; the call appears in a history list; sending twice shows two entries | next | — |
| 2 | Preview, replay, export | Open a past call and see the request as sent and the response; replay it exactly or edit and send, and a new entry appears while the original is unchanged; copy either as curl and run it | later | — |
| 3 | Bodies and formatting | Send JSON, XML, plain-text and form-urlencoded bodies; JSON and XML shown pretty-printed in the editor; a response over 16 MB is stored and shown in full | later | — |
| 4 | Multipart with file copies | Send a multipart request with a file; delete the file from disk; replay the call and the server receives the same bytes | later | — |
| 5 | Saved requests and environments | Save a request and edit it later; define environments (name + `baseUrl`), switch the active one, and the same saved request goes to the other `baseUrl`; calls link back to their saved request | later | — |
| 6 | Find calls | Narrow history by environment, by saved request, by date range, and by a substring of URL or body (for example `/orders/12`) | later | — |
| 7 | Delete and retention | Delete one call, delete a filtered set in bulk, and define a retention rule; only the targeted calls disappear | later | — |

**Order rationale:**
- Slice 1 goes first because it is both the thinnest end-to-end path and the riskiest. Recording the request exactly as it went over the wire through `undici` (T1.2, T1.3) underpins every later slice. It also carries the groundwork that has no visible outcome of its own:
  - the IPC contract with `zod`
  - the database connection with startup retry
  - the database name read from the environment, so e2e can use a `dp_test_*` database
  - the database-down behaviour

  It is expected to be the largest slice.
- Slice 2 next: immutability (T1.1) and exact replay (T1.3) are the product's reason to exist, and curl export is the same "request as data" transformation.
- Slices 3–4 before saved requests: GridFS, the 16 MB limit (T1.5) and file copies (T1.4) are technical risks with no workaround if the storage shape is wrong. They should fail while the storage design is still cheap to change.
- Slice 5 before 6: history filters by environment and by saved request need both to exist.
- Slice 7 last: bulk delete reuses slice 6's filters. Deletion is irreversible (T1.7), so it is built on filters already proven correct.
- Monaco editor arrives in slice 3, where formatting first needs it; slices 1–2 show bodies as plain text.

**Decisions needed before a slice can be planned** (PRD Open questions):
- Before slice 1: what happens when MongoDB is not running — block sending, send and warn, or start the container from the app. "Every send is recorded" points to blocking.
- Before slice 5: how saved requests are organised — directories, a flat list, or tags.

**Calibration:** the only completed change, `test-harness` (`context/archive/test-harness/record.md`), took one day including plan review, code review and two fix rounds. It was configuration-heavy and is a weak guide to feature slices. Record each slice's actual cost here as it closes.

## Later milestones

Not ordered yet; order is set when M1 closes, from what M1 cost.
- **GraphQL requests**, and grouping history by request type.
- **SOAP requests and WSDL templates** — spike WSDL parsing first (`tech-stack.md`).
- **OpenAPI templates**, stored in directories.
- **Auth per environment**, usable as a history filter.
- **Side-by-side diff of two calls.**
- **Collection runner.**
- **OAuth2 token flows, cookie jar.**
- **Proxy, client certificates (mTLS), custom CA** — moves into M1 if assumption A1 (work APIs need no proxy) proves false.
- **WebSocket, gRPC, SSE.**

## Not in any milestone

From `prd.md` Non-goals:
- Pre-request scripts, response assertions, chaining values between requests.
- Import of Postman collections and environments.
- Accounts, multiple users, shared workspaces, sync between machines.
- Mock servers.
- Environment variables other than `baseUrl`.
- Reading or committing stored data outside the app.
- Redacting secrets in history.
- Size caps or truncation of stored response bodies.

## Closed

None.

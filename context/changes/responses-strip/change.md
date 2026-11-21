---
change_id: responses-strip
title: Show every response a request has received, and let one be picked
status: new
ticket: null
created: 2026-11-21
updated: 2026-11-21
closed: null
produced-by: lz-change
---

## Intent

Roadmap M1 slice 7, "Responses to this request": "Send the same method and path three times and the response panel
shows three response chips, newest selected; pick one to view it; the call record lists the other responses of its
request".

Author, 2026-11-11: two calls are responses to "the same request" when they have the "same method and path". Left to
`lz-plan`: whether the query string is part of the path.

## Boundary

**This change covers:**
- A query for the calls with one method and path, newest first, covering every call, not only History's newest 200.
- The workspace's "Responses to this request" strip under the response header: one chip per response, newest
  selected. Picking a chip shows that response.
- The call record's "Other responses to METHOD path" chips. Picking one opens that call.

**Explicitly not in this change:**
- Deleting a response from a chip (the ×). That is slice 8, which owns delete and Undo.
- History search and filters (slice 9).
- Any change to what is sent or recorded.

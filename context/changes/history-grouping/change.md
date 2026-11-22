---
change_id: history-grouping
title: Group history by request path, optionally split by the authorization sent
status: planned
ticket: null
created: 2026-11-22
updated: 2026-11-22
closed: null
produced-by: lz-change
---

## Intent

> Let me describe the problem first. When I'm using http request app like insomnia I often edit requests on the tab on
> the left when I resend them. However I realized that It's often for me that I need a response from such request back
> in time - for instance to see how the data was changed, how the request/response has changed and like the
> undocumented api changes. It's why I need history. However grouping history by path (default) and authorization
> (optional additional) (Cookie and Authorization headers) would be useful.

Author's answers to the research questions (2026-11-22), verbatim:

> 4 is for my manual verification, I don't see the point of automating this part. 1 - both toggled. 2 - exact cookie
> header and authorization. 3 - if authorization is provided its authorization, if not - cookie, else no
> authorization.

## Boundary

**This change covers:**
- Grouping the History list by request (method + path, the slice 7 key), switchable with the existing day grouping.
- Splitting the responses views ("Responses to this request" in the workspace, "Other responses to …" on a call record)
  by authorization, switchable on and off.
- One auth key per call: the exact `Authorization` header value if present; otherwise the exact `Cookie` header value;
  otherwise none.

**Explicitly not in this change:**
- A side-by-side or automated diff of two calls — the author compares manually ("Side-by-side diff of two calls"
  stays in the roadmap's "Not ordered yet").
- Parsing individual cookies, naming a session cookie, or labelling tokens ("staging · service token") — the key is
  the whole header value.
- A cookie jar or capturing `Set-Cookie` from responses — "Not ordered yet".
- Changing the "same request" key: host, environment and query string stay out of it (slice 7 decision); OpenAPI
  template paths (`/orders/{id}`) are not a key.
- Search performance work beyond what grouping needs ("Search performance" stays in "Not ordered yet").

## Notes

- Base: this change builds on `land-slices-7-12` (PR #12, open). `main` at `6c8bd79` lacks slices 7–12, including
  `listResponses` and `authorizationOf`. Branch from `land-slices-7-12`, or from `main` once PR #12 merges.
- Research: `research.md` (moved from the session scratchpad on 2026-11-22).
- Open for `lz-plan`, from `research.md` "Unanswered": one toggle or one per place; which `Cookie` header counts when
  a request has several; whether the History search's Authorization facet adopts the Cookie fallback; cost of the
  `$regex` scan at real history size.

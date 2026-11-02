---
produced-by: lz-shape
mode: greenfield
appetite: Open-ended side project; first milestone sized to replace Postman/Insomnia for REST work within ~2 weeks
updated: 2026-11-02
---

# Shape: DigitalPigeon — local HTTP client with an immutable call history

## The idea, in the user's words
> I want to create HTTP request application. It should support REST, GraphQL and SOAP. Core
> features: preparing and handling of http requests (headers/bodies) with proper formatters. Saving
> requests and responses in files and grouping them by environment and request types. Each http call
> should be a separate file. It should allow for previewing historical calls. Another feature is
> request templates - separately from customly created requests app should allow for loading
> wsdl/openapi json files, preparing requests templates. History should also keep information about
> timestamps and allow for resending the request

Added during shaping:
> Pressing "send" twice makes no save of both requests, but only the latest. I want to keep all
> historical requests with my manual option to remove entry instead of duplicating the request and
> then pressing send.

> Requests and its calles are two different entities. However, both can be used to submit a http
> call. Request templates should also be storable in directories.

## Who it is for
The author, as a single user. Postman/Insomnia is the current tool. Reasons to leave it:
- History is weak. Sending twice does not keep both calls, so preserving a call means duplicating the request before sending.
- SOAP/WSDL support is weak.
- Accounts and cloud sync are forced on the user.

## Appetite
Open-ended side project with no deadline. Forced cut: if the tool had to replace Postman for daily
work within ~2 weeks, it would be **REST only**. That cut defines **Milestone 1**. GraphQL, SOAP and
template import move to later milestones.

## What it does

### Milestone 1 (REST)
- Runs as a desktop app. No accounts and no cloud.
- Builds REST requests with method, path, query parameters, headers, auth set on each request (a pasted token or header), and a body.
- Supports JSON, XML, plain-text, form-urlencoded and multipart (file upload) bodies, with formatting (pretty-printing) for JSON and XML.
- Formats responses for display.
- Keeps **saved requests** as editable entities, separate from calls.
- Defines an **environment** as a name plus a `baseUrl`. Requests are sent against the active environment.
- **Every send creates a new, immutable call record.** A call record holds:
  - the request exactly as sent, with auth headers and tokens stored as sent
  - the full response, at any size: status, headers, body and timing
  - timestamps
  - the environment used
  - a link to the saved request it came from, if any
  - a copy of each file uploaded in a multipart body
- Never changes a call record after it is written. The only operation on one is deletion by the user.
- Stores each call as its own record.
- Lets a saved request or a historical call start a new send.
- Offers two ways to resend from history. Both write a new call record and leave the original unchanged:
  - **exact replay:** send the recorded request as it was
  - **open in editor:** load the call, change it, then send
- Shows a preview of any historical call.
- Finds calls in history by environment, by saved request, by date range, or by full-text search over URL and body.
- Deletes history entries one at a time or in bulk. Retention rules can also remove entries.
- Exports a request or a call as a curl command.

### Later milestones (in the product, not in Milestone 1)
- GraphQL requests.
- SOAP requests.
- Grouping history by request type (REST, GraphQL or SOAP).
- Request templates built from imported OpenAPI JSON. Templates are stored in directories.
- Request templates built from imported WSDL.
- Auth per environment, so switching environment also switches credentials and auth becomes a history filter.
- Side-by-side diff of two calls.
- Collection runner: run a set of requests in sequence or as a batch.
- OAuth2 token flows.
- Cookie jar.
- Proxy settings, client certificates (mTLS) and custom CA.
- WebSocket, gRPC and SSE.

## What it explicitly does not do
| Excluded | Why | Revisit when |
|---|---|---|
| Pre-request scripts, response assertions, chaining values between requests | Not wanted | Manual chaining becomes a repeated daily cost |
| Import of Postman collections and environments | Not wanted; collections are rebuilt by hand | Never planned |
| Accounts, multi-user, shared workspaces, sync between machines | Single user; cloud and accounts are a reason for leaving Postman | Never planned |
| Mock servers | Not wanted | Never planned |
| Environment variables other than `baseUrl` (arbitrary `{{vars}}`) | Not wanted; an environment is `baseUrl` (and later auth) | Hard-coded values in requests become a repeated cost |
| Reading or committing data outside the app (editor, git) | Not required; data is only accessed through the app | Sharing or versioning requests becomes a need |
| Redacting secrets in history | History is a true record; tokens are stored as sent | The store leaves the user's machine |
| Response size caps and binary-body truncation | History stores everything | Store size becomes a problem; bulk cleanup is the only control in M1 |
| GraphQL, SOAP, OpenAPI/WSDL templates in Milestone 1 | Outside the 2-week REST cut | After Milestone 1, in the order set by `lz-roadmap` |
| Call diff, collection runner, OAuth2, cookie jar, proxy/mTLS, WebSocket/gRPC/SSE in Milestone 1 | Outside the 2-week REST cut | Later milestones |

## Decisions made
| Decision | Chosen | Rejected, and why |
|---|---|---|
| Protocol for Milestone 1 | REST only | REST+GraphQL, SOAP first, all three at a shallow level. REST is the daily need that has to replace Postman first. |
| Requests vs calls | Separate entities; either one can start a send | Calls only, with history as the only store. One file per request with calls appended, which contradicts "each call is separate". |
| Send semantics | Every send creates a new immutable call record; only the user deletes | Postman behaviour, where only the latest send is kept. This is the main reason for the project. |
| Resend from history | Both exact replay and open-in-editor; the original is never changed | Only one of the two modes |
| Environment in v1 | Name + `baseUrl` | Including auth token (deferred to a later milestone). Folder/label only. Arbitrary variable sets (excluded). |
| Form factor | Desktop app (revised 2026-11-02, after the PRD draft: "I think desktop app will be better option") | Local web UI in the browser (the original choice in shaping, replaced by the author; no reason given). Terminal UI, editor-integrated. |
| Storage access | App-only access is acceptable; storage technology is open | Human-readable files required for everything. Requests as files with history app-only. |
| Response storage | Everything, always (full body, headers, timing) | Size cap; text in full with binary metadata only |
| Secrets in history | Stored as sent | Masked on record, which breaks exact replay |
| Multipart uploads in history | A copy of each file is stored | Path, name and size only, which breaks replay if the file moves |
| Body types in Milestone 1 | JSON, XML/text, form-urlencoded, multipart | A subset |
| History lookup in Milestone 1 | By environment, by request, by date range, full-text search | A subset |
| Call diff | Later milestone | In Milestone 1. Previewing one call is enough for now. |
| OpenAPI import | Later milestone | In Milestone 1 |
| Milestone 1 extras | curl export, bulk history cleanup | Cookie jar, proxy/mTLS (moved to later milestones) |

## Still open
| Question | What would settle it |
|---|---|
| Storage technology: files on disk or a database. The user mentioned MongoDB. The original idea said "each call should be a separate file"; shaping relaxed this to "each call is its own record, app-only access". | `lz-stack`, given the requirements: app-only access, immutable records, full-text search, file copies stored |
| How saved requests are organised (directories like templates, a flat list, tags) | A decision in `lz-spec`; templates are already stated to live in directories |
| Exact replay of a call whose stored token has expired: send the old token as recorded, or offer the current one | First real use of replay against a short-lived token |
| Order of the later milestones (GraphQL, SOAP, templates, auth per environment, others) | `lz-roadmap` |
| What separates a "request template" from a "saved request" beyond its origin (imported from a spec vs hand-built) | Shaping of the templates milestone |
| Code export in languages other than curl | Need arising after curl export is in use |
| Growth of the store with full bodies, file copies and no size cap | Bulk cleanup and retention in Milestone 1; revisit if the store grows faster than cleanup handles |

## Success signals
Milestone 1 is successful when both of these are true:
- Postman/Insomnia goes unopened for REST work during two weeks of real use.
- History is the reason. A call from days earlier can be found and replayed faster than in Postman, and sending twice leaves two records.

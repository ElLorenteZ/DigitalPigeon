---
produced-by: lz-spec
updated: 2026-11-02
source: context/foundation/shape-notes.md
status: draft
---

# DigitalPigeon

## Problem
One developer uses Postman/Insomnia daily to call REST, GraphQL and SOAP APIs. Sending the same
request twice keeps only the latest call. To preserve an earlier call, the developer has to
duplicate the request before sending it, so past requests and responses are lost or hard to
recover. SOAP/WSDL work is poorly supported, and the tools require accounts and cloud sync.

## Who this is for
| Audience | What they do today | What changes |
|---|---|---|
| The author, as a single user, on a personal macOS machine and a work Windows/Linux machine | Uses Postman/Insomnia. Duplicates a request before sending to keep a previous call. Accepts forced accounts and sync. | Every call is kept until the author deletes it, can be found later and can be resent. No account is needed. |

## Success criteria
- Sending the same unchanged request twice produces two separate call records, each with its own timestamp.
- After a call record is written, its content does not change. Opening a call in the editor, changing it and sending creates a new record, and the original record is unchanged when viewed again.
- An exact replay of a call sends the same method, URL, headers and body as the recorded request, and creates a new call record.
- A call record disappears only after the user deletes it, either one entry at a time or in bulk.
- A call record shows the request as sent, the response status, response headers, the full response body and timing.
- JSON and XML request and response bodies are shown pretty-printed.
- Requests with JSON, XML, plain-text, form-urlencoded and multipart bodies can each be sent and are recorded.
- A recorded multipart call can be replayed after the uploaded file has been deleted from its original location on disk.
- History can be narrowed to the calls of one environment, the calls of one saved request, the calls within a date range, and the calls whose URL or body contains a search term.
- Switching the active environment changes the `baseUrl` that a saved request is sent to.
- Running a request exported as curl in a terminal sends the same method, URL, headers and body as the original request.
- The app runs on the author's personal machine as a local install, and is used without creating or signing in to an account.
- *(Subjective, judged by the author)* Postman/Insomnia goes unopened for REST work during two weeks of real use, and finding and replaying a past call is faster than it is in Postman.

## Non-goals
| Not doing | Why | Revisit when |
|---|---|---|
| Pre-request scripts, response assertions, chaining values between requests | Not wanted | Manual chaining becomes a repeated daily cost |
| Import of Postman collections and environments | Not wanted | Never planned |
| Accounts, multiple users, shared workspaces, sync between machines | Single user; accounts and cloud sync are a reason for leaving Postman | Never planned |
| Mock servers | Not wanted | Never planned |
| Environment variables other than `baseUrl` | Not wanted; an environment is a `baseUrl` (with auth added later) | Hard-coded values in requests become a repeated cost |
| Reading or committing stored data outside the app | Not required; data is accessed only through the app | Sharing or versioning requests becomes a need |
| Redacting secrets in history | History is a true record; tokens are stored as sent | The store leaves the user's machine |
| Size caps or truncation of stored response bodies | History stores everything | Store size becomes a problem |

## Scope

### In scope
Milestone 1 (REST):
- Use the app as a desktop application.
- Build a REST request with method, path, query parameters, headers, auth set on that request (a pasted token or header), and a body.
- Send JSON, XML, plain-text, form-urlencoded and multipart bodies, and see JSON and XML pretty-printed.
- Save a request and edit it later. Saved requests and calls are separate.
- Define environments, each a name plus a `baseUrl`, and choose the active one.
- Have every send recorded as its own immutable call record: the request as sent (with credentials), the full response, timing, timestamps, the environment used, a link to the source saved request if there is one, and a copy of every uploaded file.
- Start a send from either a saved request or a historical call.
- Resend a historical call as an exact replay, or open it in the editor, change it and send. Either way a new record is created.
- Preview any historical call.
- Find calls by environment, by saved request, by date range, or by full-text search over URL and body.
- Delete call records one at a time, in bulk, or through retention rules.
- Export a request or a call as a curl command.

### Out of scope
These are in the product but deferred past Milestone 1. `lz-roadmap` sets their order.
- GraphQL requests
- SOAP requests
- Grouping history by request type (REST, GraphQL or SOAP)
- Request templates generated from imported OpenAPI JSON, stored in directories
- Request templates generated from imported WSDL
- Auth per environment, with auth usable as a history filter
- Side-by-side diff of two calls
- Collection runner (running a set of requests in sequence or as a batch)
- OAuth2 token flows
- Cookie jar
- Proxy settings, client certificates (mTLS) and custom CA
- WebSocket, gRPC and SSE

## Constraints
| Constraint | Source | Consequence |
|---|---|---|
| Must run on macOS and on the author's work Windows/Linux machine | Author (spec session) | Rules out anything single-OS. |
| Primary target is the author's personal machine, with admin rights. The work laptop runs only IT-approved apps. | Author (infra session; revises the stack session's "signed only") | Milestone 1 runs as an unsigned local install. Use on the work laptop depends on IT approval and is deferred. |
| Budget $0. Local install only, no publishing. | Author (infra session) | No signing certificates, hosting or paid services |
| Docker is required, and Docker Desktop is installed and licensed | Author (stack and infra sessions) | The database runs in a container |
| The code must be in a language the author can review: TypeScript/JavaScript, C#, Java or Kotlin | Author (stack session) | Rules out stacks whose core logic is in another language, such as a Rust backend. |
| Open-ended side project. Milestone 1 is sized to replace Postman for REST work in about 2 weeks. | Author (shaping) | Milestone 1 scope is REST only. Every other protocol and feature waits for a later milestone. |

## Assumptions
| # | Assumption | If wrong |
|---|---|---|
| A1 | The REST APIs used at work can be reached without a proxy or client certificate. Proxy and mTLS are deferred past Milestone 1. | Milestone 1 cannot be used at work. Proxy/mTLS would have to move into Milestone 1. |
| A2 | Storing auth tokens in plain form in local history is acceptable on the work machine. | Secrets would need redaction or encryption at rest, which conflicts with exact replay. |
| A3 | Bulk delete and retention rules are enough to keep the store a manageable size when full bodies and file copies are always kept. | A size limit or archiving would be needed, which conflicts with "store everything". |
| A4 | Rebuilding existing Postman requests by hand is an acceptable one-time cost. | Postman import would come back as a candidate feature. |
| A5 | One person uses each installation. | Concurrency and ownership of records would need decisions. |
| A6 | The work laptop's IT approval, when sought, will accept an Electron app that needs Docker. | Work-laptop use would need a different distribution, or a store that does not need Docker. |

## Open questions
| Question | What would settle it | Blocks |
|---|---|---|
| How saved requests are organised: directories (as templates will be), a flat list, or tags | Author decision before Milestone 1 planning | Milestone 1 plan |
| What happens when the database (MongoDB in Docker) is not running: block sending, or send and warn that the call is not recorded, or start the container from the app | Author decision. "Every send is recorded" points to blocking. | Milestone 1 plan |
| Work laptop: which OS (Windows or Linux), and what IT approval requires (a signed installer, a known publisher, a review) | Asking the work IT department | Work-laptop use; whether signing is needed |
| On exact replay of a call whose stored token has expired, send the token as recorded or offer the current one | First real use of replay against a short-lived token | Replay behaviour detail |
| What separates a request template from a saved request beyond where it came from (imported from a spec or built by hand) | Shaping of the templates milestone | Templates milestone |
| Code export in languages other than curl | A need arising after curl export is in use | — |
| Order of the deferred milestones | `lz-roadmap` | `lz-roadmap` |

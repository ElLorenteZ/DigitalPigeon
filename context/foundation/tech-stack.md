---
produced-by: lz-stack
mode: choose
updated: 2026-11-11
---

# Tech stack

## Decision
The app is a local web app built with TypeScript (strict mode), Node.js and React. A Node.js server, bound to
`127.0.0.1` on the author's machine, sends all HTTP calls through `undici`, stores data in MongoDB, which runs in a
Docker container on the same machine, and serves the React UI to the author's browser. Response bodies and uploaded
files that are too large for a document, as well as copies of uploaded files, are stored in GridFS.

Shell revised 2026-11-11 by the author's decision, recorded in `decisions/0002-the-app-is-a-local-web-app-served-from-127-0-0-1.md`: Electron
is replaced by the local server. The reasons and the rejected options are in the ADR. The scoring below is the
2026-11-02 comparison of desktop shells; the local web app was not scored against it.

Storage revised 2026-11-02 at the author's request: "I can use mongodb database in docker
container". The earlier choice was embedded SQLite, and the reason it lost is recorded under
Alternatives rejected.

## Components
| Layer | Choice | Version | Why |
|---|---|---|---|
| Shell | Node.js server bound to `127.0.0.1`, serving the UI to the author's browser | Node.js version and HTTP server library set in roadmap slice 5b's plan | ADR 0002: the app in the author's own browser, an easier work-laptop approval than an unsigned Electron app, no Electron release cadence or packaging. Runs on macOS, Windows and Linux. Replaces Electron (45.2.1 at the switch). |
| Language | TypeScript, `strict: true` | 5.x, current at scaffold time | The author can review it. Types are checked when code is edited. |
| UI | React | 19.x | Most public code of any UI library. |
| Request/response editor | Monaco Editor | current at scaffold time | JSON formatting and syntax highlighting are built in, and XML highlighting is supported. This covers the PRD's formatter criteria. |
| HTTP client | `undici`, in the Node.js process only | pinned exactly on npm | Gives control over the exact bytes sent, which exact replay and the "request as sent" record require. Has proxy and TLS hooks for the deferred proxy/mTLS milestone. Requests do not go through the browser's `fetch`, because CORS and the browser's header rules would change what is sent. |
| Storage | MongoDB in a Docker container, accessed with the official `mongodb` Node.js driver from the Node.js process | Server: current stable 8.x image, pinned by tag at scaffold. Driver: current major at scaffold. | Chosen by the author. Records of different shapes (REST now, GraphQL and SOAP later) fit without schema migrations. Pure JavaScript driver, so there is no native module to rebuild against Electron's ABI. |
| Large bodies and file copies | GridFS in the same MongoDB instance | — | MongoDB documents are limited to 16 MB, and the PRD requires full bodies at any size and a copy of every uploaded file. GridFS keeps them in the same store and backup as the call records. |
| Container runtime | Docker (Docker Desktop on macOS and Windows) | current at setup | The author confirmed Docker can run on both machines. |
| Build | Vite for the UI; how the server is built and started is set in slice 5b's plan | current | No installer and no signing: the server runs on the machine it was built on (ADR 0002). Electron Forge is removed. |
| Validation at the API boundary | `zod` | 3.x or 4.x, pinned at scaffold | Messages between the browser UI and the server are untyped at runtime (see the costs below). The schemas in `src/shared/ipc-contract.ts` carry over from the Electron IPC contract. |

## Agent-friendliness
| Gate | Score | Basis |
|---|:-:|---|
| Typed | 4/5 | Strict TypeScript catches errors when code is edited. HTTP between the browser UI and the server is a runtime boundary that the types do not check, so it scores 4 rather than 5. |
| Convention-based | 3/5 | React and Vite fix part of the layout. The server/UI split and the API design are left to each project. |
| Popular | 5/5 | Node.js, React and TypeScript have very large public codebases. A Node.js server serving a React UI is a common shape. |
| Well-documented | 5/5 | Node.js docs are versioned per major. React and TypeScript docs are complete. |

## What this costs, and how to compensate
| Gap | Consequence | Compensation | Owner |
|---|---|---|---|
| API boundary is untyped at runtime | The server and the UI can disagree on message shapes without a compile error | Shared typed contract module. Validate every request with `zod` on the server. Treat this as a tier-1 test risk. | `lz-onboard`, `lz-test-strategy` |
| Weak structural conventions | Each change invents where code goes: what belongs on the server, in the UI | Explicit rules in `AGENTS.md`: HTTP and storage only in the Node.js process; the UI has no Node access and reaches the server only through named operations | `lz-onboard` |
| The app depends on a separate process (MongoDB in Docker) | When Docker or the container is not running, no call can be recorded. Because every send must be recorded, sending is blocked too. | The app checks the database connection at startup and before each send, and shows the state clearly. What the app does while the database is down is a PRD open question and is not decided here. | `lz-spec` (open question), `lz-test-strategy` |
| Documents have no schema | A malformed or older-shaped record reaches the UI without a type error | Validate every document read and written with `zod` schemas shared with the TypeScript types. Store a schema version on every record. | `lz-onboard`, `lz-test-strategy` |
| 16 MB document limit | A large response or upload fails to save, which breaks "store everything" | Bodies and uploads above a threshold go to GridFS, and the call record references them. Test this with a body over 16 MB. | `lz-test-strategy` |
| MongoDB text indexes split on words | Searching for part of a URL or token (for example `/orders/12`) may not match | Use a text index for whole words and a `$regex` fallback for substrings. This is acceptable at single-user volumes. Verify against real history size. | `lz-test-strategy` |
| Docker Desktop licensing and system requirements | A large employer needs a paid Docker subscription. Windows needs WSL2 or Hyper-V. | Confirm the work machine's Docker licence. A Docker-compatible runtime (for example Podman or Rancher Desktop) is the fallback. | Author; `lz-infra` |
| Data lives in a Docker volume | Removing the volume deletes all history. Moving between machines needs `mongodump`/`mongorestore`. | Named volume. Document backup and restore. | `lz-infra` |
| Local server reachable by every page in every browser on the machine | A malicious page can make the server send requests, or read history including stored credentials (cross-site requests, DNS rebinding). XSS from a response body reaches the whole API. | Bind to `127.0.0.1` only. Every endpoint requires a per-launch token and a `Host` and `Origin` that are the server's own. CSP as an HTTP header; no CORS headers admitting another origin. Never render response HTML as live DOM. (Replaces Electron's `contextIsolation`, sandbox and narrow preload, ADR 0002.) | `lz-onboard`, `lz-test-strategy` |
| The server must be running | Closing the browser tab does not stop it; starting the app means starting a server and opening a URL | How it is started is set in slice 5b's plan | `lz-plan` |
| Weaker WSDL tooling in the JS ecosystem than in JVM/.NET | The deferred WSDL template milestone may need custom parsing | Spike WSDL parsing (`lz-spike`) before planning that milestone | `lz-roadmap`, `lz-spike` |
| No native window | No window title bar or native menus; screens 01–02 draw a title bar | Rendered as a page header (roadmap slice 6) | `lz-roadmap` |

## Alternatives rejected
| Candidate | Score (gates / weighted) | Why it lost |
|---|:-:|---|
| Electron (the 2026-11-02 choice) | 17 / 33.5 | Replaced 2026-11-11 by ADR 0002. The author wants the app in their own browser, expects a local server to be easier to get approved on the work laptop than an unsigned Electron app, and wants to drop Electron's release cadence and packaging. |
| Hosted web app | — | Rejected in ADR 0002: history and tokens would leave the machine, needs accounts, costs money, and cannot reach `localhost` or VPN-only APIs. |
| Browser-only app (no server) | — | Rejected in ADR 0002: the browser's `fetch` applies CORS and rewrites headers, so exact recording and replay are impossible; no database access. |
| Avalonia 12.1 (C# / .NET) | 13 / 22 | Avalonia 12 is a recent major (12.0 RC in March 2026), so model recall mixes 11.x, 12.x and WPF APIs (popular 2/5). The best available text editor component (AvaloniaEdit) has less built-in JSON/XML formatting than Monaco, and formatting is a Milestone 1 core feature. Packaging and signing need hand-assembled `dotnet publish` + `signtool` + notarisation steps instead of one tool. |
| Compose Multiplatform Desktop 1.12 (Kotlin) | 13 / 21 | No mature code-editor component exists for Compose Desktop. It would need Swing interop (RSyntaxTextArea) for the core editing surface. Desktop is the least-used Compose target, so there is less public code (popular 2/5). Its stronger WSDL tooling on the JVM serves a deferred milestone, not Milestone 1. |
| Tauri 2 (Rust + TypeScript) | — | Fails a hard constraint. Recording the exact request and response requires the HTTP layer in the Rust backend, and the author does not know Rust well enough to review and debug it. It would otherwise have won on footprint. |
| Embedded SQLite with FTS5 (`better-sqlite3`) | — | The first choice in this session, replaced by the author. It needed no separate process and had better substring search (trigram tokenizer). It lost to the author's preference for MongoDB, which runs in Docker on both machines. Its own costs were a native module to rebuild against Electron's ABI and JSON columns for records of different shapes. Revisit if keeping Docker running becomes a daily cost. |
| Plain files as the store | — | The PRD does not require data to be readable outside the app. Filtering by environment, request and date, plus full-text search over all history, would need a separate index kept in sync with the files. |

## Criteria and weights
Hard constraints (pass/fail, applied before scoring):
1. Runs on macOS and Windows/Linux (PRD constraint). All four candidates pass.
2. Distributable as signed software (work machine allowlist, author, `lz-stack` session; relaxed by the author in the infra session, and no longer applicable to the local web app). All four pass, at a cost; see `lz-infra`. Docker on the work machine is the author's statement. Its allowlist status was not checked.
3. Written in a language the author can review: TypeScript/JavaScript, C#, Java or Kotlin (author, `lz-stack` session). Tauri fails.

Weighted score, for the candidates that passed:
| Criterion | Weight | Electron | Avalonia | Compose |
|---|:-:|:-:|:-:|:-:|
| Four gates (sum, /20) | ×1 | 17 | 13 | 13 |
| Code editor with JSON/XML formatting (Milestone 1 core) | ×2 | 5 | 3 | 2 |
| One-tool signing and packaging for macOS and Windows | ×1 | 5 | 3 | 3 |
| WSDL/OpenAPI parsing ecosystem (deferred milestone) | ×0.5 | 3 | 3 | 4 |
| **Total** | | **33.5** | **23.5** | **22** |

The editor carries double weight because formatting is part of the PRD success criteria for
Milestone 1. WSDL carries half weight because it serves a deferred milestone. A reader who weights
WSDL support above the editor would move toward the JVM, and the gap would still be about 10
points.

Gate sums: Electron 4+3+5+5 = 17. Avalonia 5+3+2+3 = 13. Compose 5+3+2+3 = 13.

## Sources
- Electron release line: [Wikipedia](https://en.wikipedia.org/wiki/Electron_(software_framework)) (44.4.5, 2026-09-23); [Electron release timelines](https://electronjs.org/de/docs/latest/tutorial/electron-timelines) (official; 44 stable 2026-08-25); [endoflife.ai](https://endoflife.ai/article-electron-42-eol) (45 scheduled 2026-10-20). A 45.x release was not confirmed.
- Native module ABI issues (disconfirming evidence): [better-sqlite3 #1062](https://github.com/WiseLibs/better-sqlite3/issues/1062), [electron/rebuild #552](https://github.com/electron/rebuild/issues/552), [TechEarl](https://techearl.com/fix-node-module-version-mismatch).
- Avalonia versions: [NuGet AvaloniaUI profile](https://www.nuget.org/profiles/AvaloniaUI) (12.1.1, 2026-07-29); [12.0.0-rc2 mirror](https://nubrowse.com/packages/Avalonia/12.0.0-rc2) (2026-03-31). Mirror and aggregator pages, not official release notes.
- Compose Multiplatform: [JetBrains compatibility docs](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html) (official, vendor); [1.12.0 announcement](https://blogs.apievangelist.com/blogs/jetbrains-2026-08-26-compose-multiplatform-1-12-0-released/) (secondary, 2026-08-26).
- That Postman, Insomnia and Bruno are Electron apps comes from model recall, not a source checked in this session.
- The scores for editor components, signing tooling and WSDL ecosystems are model judgments that were not checked against sources in this session. `lz-spike` can verify the WSDL claim before that milestone.

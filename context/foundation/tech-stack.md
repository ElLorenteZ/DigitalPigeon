---
produced-by: lz-stack
mode: choose
updated: 2026-11-02
---

# Tech stack

## Decision
The app is built with Electron, TypeScript (strict mode) and React. The Electron main process sends
all HTTP calls through `undici` and stores data in MongoDB, which runs in a Docker container on the
author's machine. Response bodies and uploaded files that are too large for a document, as well as
copies of uploaded files, are stored in GridFS.

Storage revised 2026-11-02 at the author's request: "I can use mongodb database in docker
container". The earlier choice was embedded SQLite, and the reason it lost is recorded under
Alternatives rejected.

## Components
| Layer | Choice | Version | Why |
|---|---|---|---|
| Desktop shell | Electron | 44.x stable (45.x scheduled 2026-10-20, not confirmed; take the latest stable at scaffold time) | Cross-platform (macOS, Windows, Linux). Mature signing and notarisation tooling for the signed-only constraint. The author knows TypeScript. |
| Language | TypeScript, `strict: true` | 5.x, current at scaffold time | The author can review it. Types are checked when code is edited. |
| UI | React | 19.x | Most public code of any UI library. |
| Request/response editor | Monaco Editor | current at scaffold time | JSON formatting and syntax highlighting are built in, and XML highlighting is supported. This covers the PRD's formatter criteria. |
| HTTP client | `undici`, in the main process only | the version bundled with Electron's Node, or pinned on npm | Gives control over the exact bytes sent, which exact replay and the "request as sent" record require. Has proxy and TLS hooks for the deferred proxy/mTLS milestone. Requests do not go through the renderer's `fetch`, because CORS and the browser's header rules would change what is sent. |
| Storage | MongoDB in a Docker container, accessed with the official `mongodb` Node.js driver from the main process | Server: current stable 8.x image, pinned by tag at scaffold. Driver: current major at scaffold. | Chosen by the author. Records of different shapes (REST now, GraphQL and SOAP later) fit without schema migrations. Pure JavaScript driver, so there is no native module to rebuild against Electron's ABI. |
| Large bodies and file copies | GridFS in the same MongoDB instance | — | MongoDB documents are limited to 16 MB, and the PRD requires full bodies at any size and a copy of every uploaded file. GridFS keeps them in the same store and backup as the call records. |
| Container runtime | Docker (Docker Desktop on macOS and Windows) | current at setup | The author confirmed Docker can run on both machines. |
| Packaging and signing | Electron Forge (official), Vite plugin | current at scaffold time | Signs and notarises on macOS and signs on Windows, from one config. |
| Validation at the IPC boundary | `zod` | 3.x or 4.x, pinned at scaffold | Messages crossing IPC between main and renderer are untyped at runtime (see the costs below). |

## Agent-friendliness
| Gate | Score | Basis |
|---|:-:|---|
| Typed | 4/5 | Strict TypeScript catches errors when code is edited. IPC between the main and renderer processes is a runtime boundary that the types do not check, so it scores 4 rather than 5. |
| Convention-based | 3/5 | React and Forge templates fix part of the layout. Electron leaves the main/preload/renderer split and the IPC design to each project. |
| Popular | 5/5 | Electron, React and TypeScript have very large public codebases. Postman, Insomnia and Bruno are themselves Electron apps. Electron ships a major version every 8 weeks, but its core APIs (BrowserWindow, ipcMain, contextBridge) are stable across those majors. |
| Well-documented | 5/5 | Docs are versioned per Electron major, and runnable examples exist (Electron Fiddle). React and TypeScript docs are complete. |

## What this costs, and how to compensate
| Gap | Consequence | Compensation | Owner |
|---|---|---|---|
| IPC boundary is untyped at runtime | Main and renderer can disagree on message shapes without a compile error | Shared typed IPC contract module. Validate every message with `zod` in main. Treat this as a tier-1 test risk. | `lz-onboard`, `lz-test-strategy` |
| Weak structural conventions | Each change invents where code goes: what belongs in main, in preload, in renderer | Explicit rules in `AGENTS.md`: HTTP and storage only in main; the renderer has no Node access; preload exposes a narrow API | `lz-onboard` |
| The app depends on a separate process (MongoDB in Docker) | When Docker or the container is not running, no call can be recorded. Because every send must be recorded, sending is blocked too. | The app checks the database connection at startup and before each send, and shows the state clearly. What the app does while the database is down is a PRD open question and is not decided here. | `lz-spec` (open question), `lz-test-strategy` |
| Documents have no schema | A malformed or older-shaped record reaches the UI without a type error | Validate every document read and written with `zod` schemas shared with the TypeScript types. Store a schema version on every record. | `lz-onboard`, `lz-test-strategy` |
| 16 MB document limit | A large response or upload fails to save, which breaks "store everything" | Bodies and uploads above a threshold go to GridFS, and the call record references them. Test this with a body over 16 MB. | `lz-test-strategy` |
| MongoDB text indexes split on words | Searching for part of a URL or token (for example `/orders/12`) may not match | Use a text index for whole words and a `$regex` fallback for substrings. This is acceptable at single-user volumes. Verify against real history size. | `lz-test-strategy` |
| Docker Desktop licensing and system requirements | A large employer needs a paid Docker subscription. Windows needs WSL2 or Hyper-V. | Confirm the work machine's Docker licence. A Docker-compatible runtime (for example Podman or Rancher Desktop) is the fallback. | Author; `lz-infra` |
| Data lives in a Docker volume | Removing the volume deletes all history. Moving between machines needs `mongodump`/`mongorestore`. | Named volume. Document backup and restore. | `lz-infra` |
| Electron security model | A renderer with Node access, or a broad preload, turns any XSS from a response body into code execution. Response bodies are untrusted input. | `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, strict CSP. Never render response HTML as live DOM. | `lz-onboard`, `lz-test-strategy` |
| Electron majors every 8 weeks; model recall mixes versions | Generated code may use removed or changed APIs | Pin the Electron major. Check the versioned docs rather than relying on recall. | `lz-onboard` |
| No signing for now ($0 budget, local install only; see `infrastructure.md`) | The build runs only where it was built. The work laptop needs IT approval. | Forge's signing config stays unused until work-laptop use is pursued | `lz-infra` |
| Weaker WSDL tooling in the JS ecosystem than in JVM/.NET | The deferred WSDL template milestone may need custom parsing | Spike WSDL parsing (`lz-spike`) before planning that milestone | `lz-roadmap`, `lz-spike` |
| Footprint (~100 MB+ install, multi-process memory) | Heavier than a native app | Accepted. No PRD criterion limits size or memory. | — |

## Alternatives rejected
| Candidate | Score (gates / weighted) | Why it lost |
|---|:-:|---|
| Avalonia 12.1 (C# / .NET) | 13 / 22 | Avalonia 12 is a recent major (12.0 RC in March 2026), so model recall mixes 11.x, 12.x and WPF APIs (popular 2/5). The best available text editor component (AvaloniaEdit) has less built-in JSON/XML formatting than Monaco, and formatting is a Milestone 1 core feature. Packaging and signing need hand-assembled `dotnet publish` + `signtool` + notarisation steps instead of one tool. |
| Compose Multiplatform Desktop 1.12 (Kotlin) | 13 / 21 | No mature code-editor component exists for Compose Desktop. It would need Swing interop (RSyntaxTextArea) for the core editing surface. Desktop is the least-used Compose target, so there is less public code (popular 2/5). Its stronger WSDL tooling on the JVM serves a deferred milestone, not Milestone 1. |
| Tauri 2 (Rust + TypeScript) | — | Fails a hard constraint. Recording the exact request and response requires the HTTP layer in the Rust backend, and the author does not know Rust well enough to review and debug it. It would otherwise have won on footprint. |
| Embedded SQLite with FTS5 (`better-sqlite3`) | — | The first choice in this session, replaced by the author. It needed no separate process and had better substring search (trigram tokenizer). It lost to the author's preference for MongoDB, which runs in Docker on both machines. Its own costs were a native module to rebuild against Electron's ABI and JSON columns for records of different shapes. Revisit if keeping Docker running becomes a daily cost. |
| Plain files as the store | — | The PRD does not require data to be readable outside the app. Filtering by environment, request and date, plus full-text search over all history, would need a separate index kept in sync with the files. |

## Criteria and weights
Hard constraints (pass/fail, applied before scoring):
1. Runs on macOS and Windows/Linux (PRD constraint). All four candidates pass.
2. Distributable as signed software (work machine allowlist, author, `lz-stack` session). All four pass, at a cost; see `lz-infra`. Docker on the work machine is the author's statement. Its allowlist status was not checked.
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

---
change_id: local-web-app
title: Replace the Electron shell with a local Node server and a browser UI
status: new
ticket: null
created: 2026-11-11
updated: 2026-11-11
closed: null
produced-by: lz-change
---

## Intent

"We want to do the shift from desktop application to a web application." — then, of the options offered (local web
app, hosted web app): "Right now option 1."

## Boundary

**This change covers** (roadmap M1 slice 5b, ADR 0002):
- A Node.js server bound to `127.0.0.1` that owns sending (`undici`) and storage (MongoDB) and serves the React UI.
- The sixteen operations in `src/shared/ipc-contract.ts` exposed as HTTP endpoints, validated with the same `zod`
  schemas; the UI calls them through a client with the same `PigeonApi` type in place of `window.pigeon`.
- The per-launch token and `Host`/`Origin` checks on every endpoint, refused before anything is sent or recorded; the
  CSP sent as an HTTP header.
- Every behaviour that works today working in a browser: send, history, preview, replay, curl export, bodies and
  Monaco, multipart with file copies, saved requests, environments, database-down state.
- The e2e suite moved from Playwright-on-Electron to a plain browser, still on a `dp_test_*` database.
- Removing Electron: `src/main.ts`, `src/preload.ts`, the Forge config and Electron dependencies.
- How the server is started, its port, and how the browser receives the token (left to `lz-plan` by the roadmap).
- Rewriting the AGENTS.md commands and Electron-specific notes for the server, verified.

**Explicitly not in this change:**
- Hosting the app anywhere but the author's machine — rejected in ADR 0002; needs its own decision.
- The target design's shell (logo, title bar as a page header, sidebar tabs, status bar) — roadmap slice 6.
- Any new user-facing feature (responses strip, delete, search) — roadmap slices 7–9.
- Changes to `src/core/` behaviour: what is sent, recorded and stored stays byte-for-byte the same.
- Packaging, installers, signing, auto-start of the server or of Docker.
- Work-laptop installation or IT approval — PRD open question, deferred.

## Notes

- Decision: `context/foundation/decisions/0002-the-app-is-a-local-web-app-served-from-127-0-0-1.md`.
- Roadmap: `context/foundation/roadmap.md`, M1 slice 5b, with its order rationale and calibration (about two days;
  unknowns are the e2e harness port and the localhost security model).
- The transitional non-negotiables in AGENTS.md already state the server rules this change must meet.

---
adr: 0002
title: The app is a local web app served from 127.0.0.1
status: accepted
date: 2026-11-11
deciders: author
supersedes: null
superseded-by: null
source: conversation (2026-11-11); tech-stack.md; infrastructure.md; prd.md; roadmap.md slice 5b
produced-by: lz-adr
---

# 0002. The app is a local web app served from 127.0.0.1

## Context

`tech-stack.md` chose Electron as the desktop shell (gate sum 17, against 13 for Avalonia and Compose), and `prd.md`
scopes Milestone 1 as "Use the app as a desktop application". Slices 1–5 shipped on that basis: an Electron main
process that sends with `undici` and stores in MongoDB, a sandboxed React renderer, and a preload that exposes sixteen
named functions (`src/preload.ts`, `src/shared/ipc-contract.ts`).

On 2026-11-11 the author asked to move from a desktop application to a web application. The reasons given:

- use the app in the author's own browser rather than a separate desktop window;
- work-laptop approval: the work laptop runs only IT-approved apps (`prd.md` constraints, assumption A6), and an
  unsigned Electron app is the harder thing to get approved;
- drop Electron's weight: a major release every 8 weeks, the packaged binary, Forge packaging;
- a path to hosting later, which a browser UI over an HTTP API keeps open.

Three facts bound the choice:

- **Exact bytes.** The product records the request exactly as it went over the wire, and replays it exactly. Requests
  go through `undici` in Node, not through the browser's `fetch`, "because CORS and the browser's header rules would
  change what is sent" (`tech-stack.md`). Sending cannot move into the browser.
- **Data stays local.** History stores credentials as sent, with no redaction (`prd.md` non-goals, assumption A2).
  The PRD's trigger for revisiting redaction is "the store leaves the user's machine". There are no accounts, and the
  budget is $0 (`infrastructure.md`).
- **`src/core/` has no Electron dependency** (AGENTS.md), so sending, recording, storage, replay and curl export do
  not depend on the shell.

## Decision

Run DigitalPigeon as a local web app. A Node server, bound to `127.0.0.1` on the author's machine, owns HTTP sending
(`undici`) and storage (MongoDB in Docker), and serves the React UI to the author's browser. The sixteen IPC channels
become HTTP endpoints on that server, validated by the same `zod` schemas; the browser holds no database access and
sends no target request itself. Every endpoint refuses a request without the per-launch token, or with a `Host` or
`Origin` that is not the server's own. The CSP is sent as an HTTP header. Response bodies remain untrusted input and are
never rendered as live HTML. Electron is removed.

## Alternatives

| Option | Why it lost |
|---|---|
| Keep Electron (the `tech-stack.md` choice) | The author wants the app in their own browser, expects a browser UI with a local server to be easier to get approved on the work laptop than an unsigned Electron app, and wants to drop Electron's release cadence and packaging. |
| Hosted web app (server in the cloud) | Conflicts with "data stays local": history and tokens as sent would leave the machine, which the PRD names as the trigger for redaction. Needs accounts and authentication, a non-goal, or the server is an open relay that sends requests on anyone's behalf. Costs money against a $0 budget. A cloud server cannot reach `localhost` or VPN-only APIs. The author keeps it as a later path, not now. |
| Browser-only app (no server) | The browser's `fetch` applies CORS, refuses or rewrites headers such as `Host`, `Connection`, `Content-Length` and `Cookie`, and cannot reach MongoDB. Exact recording and replay are impossible. |

## Consequences

**Gained:**
- The app opens in the author's browser, with its tabs, devtools and bookmarks.
- No Electron binary download, Forge packaging or Electron major upgrades.
- The UI talks to an HTTP API, the boundary a hosted version would need.
- e2e tests drive a plain browser.

**Given up:**
- Electron's renderer hardening (`contextIsolation`, `sandbox`, `nodeIntegration: false`, a narrow preload) no longer
  exists. A localhost server can be reached by any page open in any browser on the machine. Without the token and the
  `Host`/`Origin` checks, a malicious page could make the app send requests, or read history including stored
  credentials (DNS rebinding, cross-site requests). This check carries the security that the Electron sandbox carried.
- The app needs a running server process. Closing the browser tab does not stop it; starting the app is starting a
  server and opening a URL.
- A native window, the title bar drawn in screens 01–02, and native menus. Slice 6 renders the title bar as a page
  header.
- Work done for Electron is replaced: `src/main.ts`, `src/preload.ts`, the IPC wiring in `src/main/ipc.ts`, the Forge
  config, and the Electron-launching e2e support (`e2e/support.ts`).
- `prd.md`, `tech-stack.md`, `infrastructure.md` and the non-negotiables in AGENTS.md describe Electron and must be
  updated to this decision.

**Watch for:**
- Work-laptop approval still requires Node and Docker on that machine (assumption A6 changes, it does not disappear).
  If IT refuses either, this decision does not deliver its approval reason.
- Any endpoint added without the token and `Host`/`Origin` checks, or the server bound to anything other than
  `127.0.0.1`.
- A hosted version proposed on the strength of this ADR. Hosting reopens the PRD's non-goals (accounts, data leaving
  the machine, redaction) and needs its own decision; this ADR does not authorise it.

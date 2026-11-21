---
change_id: local-web-app
title: Replace the Electron shell with a local Node server and a browser UI
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-11
ticket: null
verdict: merge-with-fixes
outcome: shipped
milestone: M1, slice 5b (roadmap.md); ADR 0002
branch: local-web-app, merged to main as PR #4 (7635278)
raw: raw/
---

## 1. What was built

DigitalPigeon is now a `node:http` server bound to `127.0.0.1:4380` (`DP_PORT`) that serves the React UI to Chrome.
`npm start` builds and opens Chrome; `npm run dev` serves the UI through Vite middleware on the same origin.
- `registerIpc` is unchanged in behaviour. The server implements its `handle(channel, handler)` seam, and
  `POST /api/<op>` dispatches to the 16 handlers. The UI's `pigeon` client (`src/renderer/api.ts`) keeps the
  `PigeonApi` type, so call sites changed only where the object comes from.
- A tagged-JSON codec (`src/shared/wire-codec.ts`) carries `Uint8Array` as `$bytes` and `Date` as `$date`, and escapes
  objects whose keys collide with a tag as `$object`. The zod schemas and `src/core/` are untouched.
- Security (T1.9) has three layers. The `Host` must be `127.0.0.1:<port>`. A per-launch token is exchanged once at
  `/?token=` for an `HttpOnly; SameSite=Strict` cookie named `dp_<port>`. A foreign `Origin` is refused on every route,
  and `/api/*` also requires `POST` and an `Origin`. The CSP is sent as a response header.
- e2e runs Playwright on the installed Chrome. The 13 main-process handler swaps became `page.route` stubs
  (`e2e/support.ts`). All Electron and Forge code and packages are removed.

**Differs from the plan:**
- Phases 3 and 4 shipped as one commit, chosen at plan review to keep the gates green between commits.
- Vite HMR is off in dev, so pages are reloaded by hand.
- The plan applied the `Origin` rule to `/api/*` only. `lz-review` found this narrower than ADR 0002, and every route
  now refuses a foreign `Origin` (F1).
- A "server not reachable" state was out of scope. After `/code-review`, the author chose to catch rejected calls: the
  status line says the server did not answer, and failed actions show their reason. No new screen was added.

## 2. Why this approach

The handlers already ran without Electron behind a one-method stand-in. Putting HTTP in front of that seam moved the
app without touching sending or storage, which `change.md` required to stay byte-for-byte the same. A codec at the
transport kept the schemas that `src/core/` and the store validate against. Security had to move from Electron's
sandbox into the server's own checks. A cookie was chosen over a script-held token, because response bodies are
untrusted content (T1.8) and script cannot read an `HttpOnly` cookie. Middleware-mode Vite gives dev and production
one origin, so the `Origin` check needs no dev exception.

## 3. What was rejected

- **Fastify or Hono.** 16 POSTs through one dispatcher need no router, and a framework would add a second
  validation and error model beside zod. Revisit if routes that are not operations appear.
- **REST resources per operation.** That would rewrite 16 handlers and the UI call shape for no behaviour change, and
  `GET` carries no `Origin`.
- **CBOR or MessagePack.** It carries bytes natively, but adds a dependency and makes payloads unreadable in DevTools.
  Base64 was measured on 17 MiB and accepted.
- **JSON-typed schemas** (string dates, base64 strings). They touch `call-schema.ts`, which is outside the boundary.
- **Token in the URL fragment, held in `sessionStorage` and sent as a header.** An XSS could read it.
- **Test-only hooks or a `report-uri` endpoint in the server.** Production code that exists only for tests.
  `page.route` and a `securitypolicyviolation` init script do the same job from outside.
- **Requiring `Sec-Fetch-Site`.** Redundant with `Origin` in Chrome, and every non-browser test client would fake it.
- **A separate Vite dev server with an `/api` proxy.** Two origins, so the `Origin` check would need a dev exception.
- **Separate commits for the UI switch and the e2e port.** One commit would be red against the gates.
- **Hosting beyond the author's machine, packaging and auto-start.** Rejected in ADR 0002 or left out of scope.

## 4. Surprises

- **zod 4's JIT probe trips the CSP on every page load.** The probe is `Function('')`. It is caught, so nothing
  breaks, and the console does not report it. Fixed with `z.config({ jitless: true })`, imported before any schema
  (`src/renderer/zod-jitless.ts`).
- **CSP violations never reach the console.** e2e records `securitypolicyviolation` events instead.
- **Chrome requests `/favicon.ico`.** A 404 logs a console error, so the server answers 204.
- **Same-origin requests do not always carry `Origin`.** Navigations, classic scripts and worker scripts omit it, and
  only `fetch` POSTs reliably send it. This is why an absent `Origin` is allowed outside `/api/*`.
- **The IPC contract was not JSON-safe** (`Uint8Array`, `Date`), which forced the codec.
- **Calls that could not fail under IPC can fail over HTTP** (403 after a restart, network errors). Several UI call
  sites had no `catch`; `/code-review` found them.
- **Cookies are not isolated by port.** A per-port cookie name does not stop other 127.0.0.1 servers from receiving
  it. Found by `/code-review` (findings 4 and 6) and deferred.
- **On Node 22 an aborted request emits `error` (ECONNRESET)**, so the body read already rejects. Code review expected
  it to hang.

## 5. What still stands

- **The security boundary is `src/server/http.ts`.** All checks run before a handler, and T1.9 in
  `http.int.test.ts` covers them. Check there first if the app's own calls get 403.
- **Restarting the server issues a new token.** Open tabs then get 403 and show "the server did not answer… run npm
  start again". This is the intended recovery.
- **Known weakness, fix later:** any other server on 127.0.0.1 the browser visits receives the token cookie, and the
  token URL appears in stdout and in the browser-launch process arguments. Tracked in roadmap "Not ordered yet",
  "Harden the per-launch token". The fix changes ADR 0002's mechanism.
- **Removing `src/renderer/zod-jitless.ts`** (or importing a schema before it) brings back the CSP violation. The e2e
  CSP recorder catches this.
- **Verified only on Chrome 157 on macOS** (`raw/spike-browser-host.md`, Not tried). `npm run dev` uses POSIX env
  syntax and does not run in `cmd.exe`. Dev-mode HMR is still an open author choice.
- **No request-body size cap.** Accepted, because the server is local and cookie-checked.
- **`config.json` is still read from Electron's old `userData` path** (`~/Library/Application Support/DigitalPigeon`
  on macOS), so existing credentials keep working.
- **Pre-existing at archive time:** `src/core/curl.int.test.ts` "a command at the limit sends" times out at 5 s on
  `main` with or without this change. Not diagnosed.

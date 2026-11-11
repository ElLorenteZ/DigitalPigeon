---
produced-by: lz-spike
assumption: "Served from http://127.0.0.1 with the CSP as a response header, the current UI build starts Monaco's editor worker (A1); Chrome sends the server's own Origin on the app's POST calls and returns an HttpOnly SameSite=Strict cookie set on the /?token= redirect, including when the URL is opened by `open` (A2); navigator.clipboard.writeText succeeds (A3)."
verdict: holds
timebox: 45 min / about 15 min
versions: Google Chrome 157.0.8103.39 (macOS arm64); Playwright 1.64.1 (channel 'chrome'); Node v22.22.2; UI build in .vite/renderer/main_window from the last e2e run (repo at ea911b3); monaco-editor 0.57.0; zod 4 (bundled)
updated: 2026-11-11
---

# Spike: the current UI in Chrome over http://127.0.0.1

## Assumption
Plan assumptions A1, A2 and A3, stated so each could fail:
- A1: with `script-src 'self'` and no `worker-src`, sent as a header, the built UI's `getWorker` starts
  `editor.worker-*.js` and a JSON response renders in Pretty and Raw.
- A2: after `open -a "Google Chrome" http://127.0.0.1:<port>/?token=…` and a `303` that sets
  `dp=<token>; HttpOnly; SameSite=Strict; Path=/`, every later request carries the cookie, and every `fetch` `POST`
  carries `Origin: http://127.0.0.1:<port>`.
- A3: `navigator.clipboard.writeText` resolves on that origin.

## Prediction (written before running)
All three hold. Confidence medium-high. The riskiest step is A2's cookie on the first navigation from `open`.
On a timeout: the assumption counts as unsettled, and the plan replaces the `Origin` check with
`Sec-Fetch-Site: same-origin`.

## What happened
A throwaway `node:http` script served `.vite/renderer/main_window` on `127.0.0.1:4377`. It stripped the build's CSP
`<meta>` and sent the same policy as a header, with `report-uri` added. It inserted a same-origin `stub.js` that
defined `window.pigeon` as `fetch` `POST /api/<channel>` calls; `send` returned a fixed JSON result built in the page.
Every request was logged with `Host`, `Origin`, `Sec-Fetch-Site` and whether the cookie matched.
1. Real Chrome, opened by `open -a "Google Chrome" "http://127.0.0.1:4377/?token=…"`: the token request had no
   cookie (`Sec-Fetch-Site: none`), the redirected `GET /` carried it, and so did every later request. The four startup
   calls and the 2 s `db-status` poll each carried `Origin: http://127.0.0.1:4377`, `Sec-Fetch-Site: same-origin`
   and the cookie.
2. Playwright with `channel: 'chrome'`, same flow through `page.goto`. After Send, the response body rendered as 8
   Pretty lines, Raw showed the one-line original, and switching back restored Pretty. `editor.worker-CRz__AKW.js` was
   fetched from `/assets/` and listed as a running worker. `isSecureContext` was `true`; `clipboard.writeText` resolved.

## Verdict: holds
A1, A2 and A3 hold for Chrome 157 on macOS.

## Surprises
1. **The CSP blocks an `eval` on every page load.** The report names `blocked-uri: eval` in the main bundle. The source
   is zod 4's JIT probe: `if (config.jitless || …) return false; try { return Function(''), true } catch { return false }`.
   It is caught, so nothing breaks, and zod falls back to its non-JIT path. In Playwright the violation did **not**
   appear as a console message, so a console-only check (T1.8, lessons 2026-11-08) does not see it. The same bundle and
   the same policy run in Electron today, so the violation most likely exists there too; that was not checked.
2. **The browser asks for `/favicon.ico`.** The spike answered `404`, and Chrome logged
   `Failed to load resource: … 404` as a console **error**. Under `file://` in Electron no such request happens. The
   e2e console check (`body-safety.spec.ts`, `consoleErrors` must be empty) would fail on it.
3. **Not every same-origin request carries `Origin`.** The navigation, `stub.js` (a classic script) and the worker
   script request had none; module scripts, the CSS, `fetch` calls and the CSP report had it. `Sec-Fetch-Site` was
   present on every request (`none` on the user-opened navigation, `same-origin` on the rest).
4. **Only the editor worker started**, not the JSON worker. This matches `archive/editor-and-formatting/record.md:29`
   (JSON worker features are off), so the JSON worker was not exercised.

## What this means for the plan
- A1, A2, A3: verified as stated; phase 3 can proceed on them. The plan's fallback (`Sec-Fetch-Site`) is not needed.
- Phase 2: the `Origin` rule applies to `POST /api/*` only, as planned; static `GET`s and the worker script must not
  require it (surprise 3). `Sec-Fetch-Site: same-origin` is available as a second signal on API calls.
- Phase 2 or 3: the server must answer `/favicon.ico` with something other than an error (surprise 2), or phase 4's
  console check fails.
- Phase 3: consider `z.config({ jitless: true })` in the UI, so the bundle no longer trips the CSP (surprise 1). Phase 4
  can assert no CSP report by giving the test server a `report-uri` and failing on any report; the console check alone
  does not catch violations.

## Not tried
- Windows and Linux; any browser other than Chrome 157; a Chrome profile restoring the tab after a restart.
- The JSON worker, and any body larger than a few bytes.
- The refusal side: requests from another origin or without the cookie. The spike only showed the legitimate app
  passing; phase 2's tests own the refusals.
- Vite middleware (dev) mode; the spike served the production build only.
- The real server code, the codec and real handlers: `window.pigeon` was a stub.

## Code
Deleted (lived in the session scratchpad, `spike/server.mjs` and `spike/drive.mjs`). Worth keeping:

```
# open the token URL in the user's real Chrome (macOS)
open -a "Google Chrome" "http://127.0.0.1:<port>/?token=<token>"

# Playwright, installed Chrome
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });

# Set-Cookie that Chrome 157 kept and returned on the redirect and every later fetch
Set-Cookie: dp=<token>; HttpOnly; SameSite=Strict; Path=/   (with 303, Location: /)
```

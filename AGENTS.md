# DigitalPigeon

Local, single-user HTTP client (React + strict TypeScript). A Node server on `127.0.0.1` sends requests and stores
every send as a call record in MongoDB, which runs in Docker on the same machine; the UI runs in Chrome
(`context/foundation/decisions/0002-the-app-is-a-local-web-app-served-from-127-0-0-1.md`).

## Non-negotiable

- **HTTP and storage live in the server only.** `undici` and the `mongodb` driver are imported only from
  `src/server/`, `src/core/` and `test-support/`. The UI (`src/renderer/`) has no Node access and never sends a target
  request itself (a browser `fetch` changes headers). It reaches the server only through the named operations in
  `src/shared/ipc-contract.ts`, sent by `src/renderer/api.ts` and validated with `zod` on the server — never a generic
  "invoke anything" endpoint.
- **Response bodies are untrusted input.** Never render them as live HTML (`dangerouslySetInnerHTML`, `innerHTML`,
  `<iframe srcdoc>`, `webview`). Display them as text or in the editor. Never relax the production CSP.
- **The local server is reachable by every page in every browser on the machine** (ADR 0002). It binds to
  `127.0.0.1` only. Every request must carry the server's own `Host` and the per-port session cookie from the token
  exchange, and is refused if it carries any other `Origin`; every operation (`POST /api/*`) must carry the server's
  own `Origin` — checked in `src/server/http.ts` before a handler runs, so a refused request sends and records nothing. The CSP (`CSP` in `src/server/http.ts`) is sent as a header
  with the built UI. No CORS headers. Never add a route or a websocket that skips these checks.
- **Tests never touch the history database.** Integration tests get their database from
  `openTestDb()` (`test-support/test-db.ts`), a throwaway `dp_test_*` database dropped afterwards.
  e2e starts the server only through `launchWithTestDatabase()` (`e2e/support.ts`), which sets
  `DP_MONGO_DB` to a `dp_test_*` database. No code drops a database except through
  `assertTestDbName` (`test-support/test-db-name.ts`). Losing history is irreversible.

## Checks

Verified on 2026-11-11 (macOS arm64, Node v22.22.2, Google Chrome 157).

| What          | Command                    | Notes                                                                          |
| ------------- | -------------------------- | ------------------------------------------------------------------------------ |
| Types         | `npm run typecheck`        | `strict` + `noUncheckedIndexedAccess`                                          |
| Lint + format | `npm run lint`             | `npm run lint:fix` to apply fixes                                              |
| Build         | `npm run build`            | UI to `dist/ui`, server to `dist/server/main.mjs`                              |
| Run           | `npm start`                | Builds, serves on `127.0.0.1:4380` (`DP_PORT`), opens Chrome at the token URL  |
| Run (dev)     | `npm run dev`              | UI through Vite middleware, no CSP; reload by hand (no HMR)                    |
| Database      | `docker compose up -d`     | Requires `.env` (copy `.env.example`, set the password)                        |
| Unit tests    | `npm run test:unit`        | `*.test.ts`; no database, network or browser                                   |
| Integration   | `npm run test:integration` | `*.int.test.ts`; needs `docker compose up -d`, `.env`, `curl` on `PATH`        |
| E2e           | `npm run test:e2e`         | Builds first; drives the built server in the installed Google Chrome; needs DB |

There is no `npm test`; the three test commands are separate gates. One file or one test name:

```
npx vitest run --project integration test-support/capture-server.int.test.ts
npx vitest run --project unit -t refuses
npx playwright test e2e/replay.spec.ts    # runs against the last build; npm run test:e2e rebuilds
```

Which risk gets which test layer: `context/foundation/test-strategy.md`. Code that sends, records or stores calls lives
in `src/core/` and imports nothing from the browser or the HTTP layer, so integration tests run it in plain Node.

## Not obvious from the code

- The CSP is a response header on the built UI only. `npm run dev` runs without it, because React refresh needs an
  inline script. Check CSP-sensitive changes with `npm run test:e2e` or `npm start`, not `npm run dev`. The console does
  not report CSP violations: e2e records `securitypolicyviolation` events (`e2e/support.ts`), and `body-safety.spec.ts`
  fails on any. zod runs `jitless` in the UI (`src/renderer/zod-jitless.ts`) because its JIT probe is one.
- oxfmt checks Markdown too: run `npm run lint:fix` after editing any `.md` file outside
  `context/`. `context/**` is excluded on purpose.
- The app reads Mongo credentials from `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` in its environment,
  otherwise from `config.json` in the user-data directory (macOS: `~/Library/Application Support/DigitalPigeon/`;
  `userDataDir` in `src/server/main.ts`) as `{ "user", "password", "database"? }`. `DP_MONGO_DB` overrides the database (default
  `digital_pigeon`). With neither, the status line says "not configured" and Send stays disabled.
- `undici` is pinned exactly. `src/core/wire.ts` encodes the headers it writes (lowercase `host`,
  `connection` added and moved to second place, written as `close` on `HEAD` or when a typed value lists
  it and `keep-alive` otherwise, `content-length: 0` on bodiless `POST`/`PUT`/`PATCH`). After an upgrade,
  run `npm run test:integration`: the T1.3 cases in `src/core/send.int.test.ts` fail on a change to this.
- `wire.ts` refuses before anything is recorded what undici rejects or re-encodes: non-ASCII values
  (undici rejects above U+00FF and sends U+0080–U+00FF as latin1), control characters, invalid names,
  `Transfer-Encoding`, `Keep-Alive`, `Upgrade`, `Expect`, and a `Connection` value that is not a token
  list. No test fails if an upgrade adds a refusal: read `processHeader` in undici's `core/request.js`.
  Older records can still hold refused values: replay sends the recorded list unchanged, never rebuilt
  through `wire.ts`, and `toCurl` refuses them.
- In tests:
  - Run curl with async `execFile`. A synchronous call blocks the event loop hosting the capture
    server, and curl hangs.
  - The capture server decodes header values as latin1 (`node:http`). Decode with
    `Buffer.from(v, 'latin1')` before comparing a non-ASCII value.
  - Stub `navigator.clipboard` in e2e specs that press Copy, or each run overwrites the system
    clipboard.
  - An answer the server cannot be made to give (a failure, a held or reordered answer) is arranged with
    `stubOperation` in `e2e/support.ts` (`page.route` on `/api/<channel>`); `real()` passes through to the server.
    After releasing a held answer, call `settle(page)` before asserting.
  - A locator finds an element wherever it is, and clicking scrolls to it. The call panel renders below
    the history list; the form and result render above it. Assert `toBeInViewport()` for anything an
    action must bring into view.
- The Mongo container restarts `mongod` once after creating the root user on first start.
  Connections are refused for a few seconds, so database connection code must retry.
- An integration run that fails in global setup prints its reason as a line starting
  `[integration setup]`. Vitest 5.0.5 with Vite 8.3.5 replaces the thrown error itself with
  `TypeError: code.charCodeAt is not a function`; that `TypeError` is not the cause.
- The host shell does not load `.env`. Commands inside the container read the container's own
  variables: `docker compose exec -T mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p
"$MONGO_INITDB_ROOT_PASSWORD" …'`. `-u "$MONGO_ROOT_USER"` on the host fails authentication.
- All history lives in the named volume `digital-pigeon-mongo`. `docker compose down -v` deletes it.
- npm 12 blocks the `fsevents` install script. Nothing here needs it.
- `npm run dev` sets `DP_DEV=1` with POSIX syntax; it does not run under Windows `cmd.exe`.

## Deeper context

- `~/Documents/digital-pigeon.pen` (Pencil) — the target design: the final state the code works towards. Read it
  through the Pencil MCP tools, never as a file. The author's current instructions outrank the PRD, roadmap and ADRs;
  when they disagree, update the documents.
- `context/foundation/` — PRD, stack rationale and its accepted costs, infrastructure. Read
  deliberately, not every turn.
- `context/changes/` — work in flight. `context/archive/` — finished changes and what was rejected.
- `context/README.md` — which skill writes which file.

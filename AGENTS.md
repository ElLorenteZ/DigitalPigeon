# DigitalPigeon

Local, single-user desktop HTTP client (Electron + React + strict TypeScript). Every send is
recorded as a call record in MongoDB, which runs in Docker on the same machine.

## Non-negotiable

- **HTTP and storage live in the main process only.** `undici` and the `mongodb` driver are imported
  only from main-process code (`src/main.ts`, `src/main/`, `src/core/`) and from `test-support/`. The
  renderer has no Node access. `src/preload.ts` exposes a narrow, named API through `contextBridge` — never raw
  `ipcRenderer` or a generic "invoke anything" channel.
- **Renderer hardening is fixed.** Never relax `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` (`src/main.ts`) or the production CSP (`vite.renderer.config.mts`).
  Response bodies are untrusted input: never render them as live HTML (`dangerouslySetInnerHTML`,
  `innerHTML`, `<iframe srcdoc>`, `webview`). Display them as text or in the editor.
- **Tests never touch the history database.** Integration tests get their database from
  `openTestDb()` (`test-support/test-db.ts`), a throwaway `dp_test_*` database dropped afterwards.
  e2e launches the app only through `launchWithTestDatabase()` (`e2e/support.ts`), which sets
  `DP_MONGO_DB` to a `dp_test_*` database. No code drops a database except through
  `assertTestDbName` (`test-support/test-db-name.ts`). Losing history is irreversible.

## Checks

Verified on 2026-11-03 (macOS arm64), except `npm start`: last run 2026-11-02, before the app
connected to a database.

| What          | Command                    | Notes                                                                |
| ------------- | -------------------------- | -------------------------------------------------------------------- |
| Types         | `npm run typecheck`        | `strict` + `noUncheckedIndexedAccess`                                |
| Lint + format | `npm run lint`             | `npm run lint:fix` to apply fixes                                    |
| Build         | `npm run package`          | Output in `out/`                                                     |
| Run (dev)     | `npm start`                | First run downloads the Electron binary; needs network               |
| Database      | `docker compose up -d`     | Requires `.env` (copy `.env.example`, set the password)              |
| Unit tests    | `npm run test:unit`        | `*.test.ts`; no database, network or Electron                        |
| Integration   | `npm run test:integration` | `*.int.test.ts`; needs `docker compose up -d` and `.env`             |
| E2e           | `npm run test:e2e`         | Runs `npm run package` first (slow); Playwright drives `.vite/build` |

There is no `npm test`; the three test commands are separate gates. One file or one test name:

```
npx vitest run --project integration test-support/capture-server.int.test.ts
npx vitest run --project unit -t refuses
```

Which risk gets which test layer: `context/foundation/test-strategy.md`. Code that sends, records
or stores calls lives in `src/core/` and must not import `electron`, so integration tests can run it
in plain Node.

## Not obvious from the code

- The CSP `<meta>` tag is injected into production builds only. The dev server runs without it,
  because React refresh needs an inline script. Check CSP-sensitive changes with `npm run package`,
  not `npm start`.
- oxfmt checks Markdown too: run `npm run lint:fix` after editing any `.md` file outside
  `context/`. `context/**` is excluded on purpose.
- The app reads Mongo credentials from `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` in its environment,
  otherwise from `~/Library/Application Support/DigitalPigeon/config.json`
  (`{ "user", "password", "database"? }`). `DP_MONGO_DB` overrides the database (default
  `digital_pigeon`). With neither, the status line says "not configured" and Send stays disabled.
- `undici` is pinned exactly. `src/core/wire.ts` encodes the headers it writes (lowercase `host`,
  added `connection`, `connection: close` on `HEAD`, `content-length: 0` on bodiless
  `POST`/`PUT`/`PATCH`). After an upgrade, run `npm run test:integration`: the T1.3 cases in
  `src/core/send.int.test.ts` fail on any change.
- The Mongo container restarts `mongod` once after creating the root user on first start.
  Connections are refused for a few seconds, so database connection code must retry.
- An integration run that fails in global setup prints its reason as a line starting
  `[integration setup]`. Vitest 5.0.5 with Vite 8.3.5 replaces the thrown error itself with
  `TypeError: code.charCodeAt is not a function`; that `TypeError` is not the cause.
- The host shell does not load `.env`. Commands inside the container read the container's own
  variables: `docker compose exec -T mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p
"$MONGO_INITDB_ROOT_PASSWORD" …'`. `-u "$MONGO_ROOT_USER"` on the host fails authentication.
- All history lives in the named volume `digital-pigeon-mongo`. `docker compose down -v` deletes it.
- npm 12 blocks install scripts for `fsevents` and `electron-winstaller`. macOS builds do not need
  them. A Windows `make` may need `npm install-scripts approve electron-winstaller`.

## Deeper context

- `context/foundation/` — PRD, stack rationale and its accepted costs, infrastructure. Read
  deliberately, not every turn.
- `context/changes/` — work in flight. `context/archive/` — finished changes and what was rejected.
- `context/README.md` — which skill writes which file.

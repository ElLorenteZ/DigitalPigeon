# DigitalPigeon

Local, single-user desktop HTTP client (Electron + React + strict TypeScript). Every send is
recorded as a call record in MongoDB, which runs in Docker on the same machine.

## Non-negotiable

- **HTTP and storage live in the main process only.** `undici` and the `mongodb` driver are imported
  only from main-process code (`src/main.ts` and modules it imports). The renderer has no Node
  access. `src/preload.ts` exposes a narrow, named API through `contextBridge` — never raw
  `ipcRenderer` or a generic "invoke anything" channel.
- **Renderer hardening is fixed.** Never relax `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` (`src/main.ts`) or the production CSP (`vite.renderer.config.mts`).
  Response bodies are untrusted input: never render them as live HTML (`dangerouslySetInnerHTML`,
  `innerHTML`, `<iframe srcdoc>`, `webview`). Display them as text or in the editor.

## Checks

All verified on 2026-11-02 (macOS arm64).

| What          | Command                | Notes                                                   |
| ------------- | ---------------------- | ------------------------------------------------------- |
| Types         | `npm run typecheck`    | `strict` + `noUncheckedIndexedAccess`                   |
| Lint + format | `npm run lint`         | `npm run lint:fix` to apply fixes                       |
| Build         | `npm run package`      | Output in `out/`                                        |
| Run (dev)     | `npm start`            | First run downloads the Electron binary; needs network  |
| Database      | `docker compose up -d` | Requires `.env` (copy `.env.example`, set the password) |

**No test runner exists.** There is no `npm test`. Verify behaviour by running the app until
`context/foundation/test-strategy.md` chooses one.

## Not obvious from the code

- The CSP `<meta>` tag is injected into production builds only. The dev server runs without it,
  because React refresh needs an inline script. Check CSP-sensitive changes with `npm run package`,
  not `npm start`.
- oxfmt checks Markdown too: run `npm run lint:fix` after editing any `.md` file outside
  `context/`. `context/**` is excluded on purpose.
- The Mongo container restarts `mongod` once after creating the root user on first start.
  Connections are refused for a few seconds, so database connection code must retry.
- All history lives in the named volume `digital-pigeon-mongo`. `docker compose down -v` deletes it.
- npm 12 blocks install scripts for `fsevents` and `electron-winstaller`. macOS builds do not need
  them. A Windows `make` may need `npm install-scripts approve electron-winstaller`.

## Deeper context

- `context/foundation/` — PRD, stack rationale and its accepted costs, infrastructure. Read
  deliberately, not every turn.
- `context/changes/` — work in flight. `context/archive/` — finished changes and what was rejected.
- `context/README.md` — which skill writes which file.

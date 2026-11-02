---
produced-by: lz-scaffold
updated: 2026-11-02
starter: npx --yes create-electron-app@latest digital-pigeon --template vite --typescript
conflict-policy: scaffold elsewhere, then merge
---

# Scaffold verification

## What ran
1. `npx --yes create-electron-app@latest digital-pigeon --template=vite-typescript` ran in the
   scratchpad and **failed** before creating any files: `The "vite-typescript" template no longer
   exists. Use "--template vite --typescript" instead.` No partial tree was left.
2. `npx --yes create-electron-app@latest digital-pigeon --template vite --typescript` ran in the
   scratchpad and succeeded. It asked no interactive questions.

Versions installed by the starter: Electron 45.2.1 (exact), `@electron-forge/*` 8.0.x, TypeScript
6.0.3, Vite 8.3.5, oxlint 1.x, oxfmt 0.41.x.

Changes made after the merge, to match `context/foundation/tech-stack.md` and `infrastructure.md`:
| Change | Reason |
|---|---|
| `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `jsx: react-jsx`, `allowJs: false` | The starter enables only `noImplicitAny`. The stack decision requires strict mode. |
| Added `react` 19.3.1, `react-dom` 19.3.1, `@vitejs/plugin-react` 6.1.2, `@types/react`, `@types/react-dom`. `src/renderer.ts` became `src/renderer.tsx`, a minimal React root. | The stack decision names React. The starter is plain TypeScript. |
| `src/main.ts`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` set explicitly. DevTools open only when the app is not packaged. | Stack cost "Electron security model": response bodies are untrusted input. |
| `vite.renderer.config.mts`: a CSP `<meta>` tag is injected into production builds only | Packaged builds load from `file://`, so the CSP must be a meta tag. The dev server's React refresh preamble is an inline script, which a strict `script-src` would block. |
| `.oxfmtrc.json`: `ignorePatterns: ["context/**"]` | `npm run lint` failed out of the box because oxfmt reformatted the foundation markdown in `context/`. |
| `package.json`: `productName` set to `DigitalPigeon`, description set | Starter placeholders |
| `docker-compose.yml`: `mongo:8.0.34`, port `127.0.0.1:27017`, root credentials from `.env`, named volume `digital-pigeon-mongo` | Infrastructure risk register: the database must not be reachable from the network |
| `.env.example` (tracked). `.env` generated locally with a random 48-hex-character password, mode 600, gitignored. | Credentials for Compose |

Not added at scaffold time; to be added by the change that first uses each: `undici`, `mongodb`
driver, `zod`, Monaco Editor.

## Conflict policy
Scaffold elsewhere, then merge (chosen by the author). The starter ran in the session scratchpad
and its output was copied into the repo with `rsync`, excluding `.git` and `node_modules`. A
collision check before the copy found **no colliding paths**. `README.md` and `context/` were not
touched. Dependencies were installed in the repo with `npm ci`.

Before scaffolding, `context/` was committed on `main` (`66cc5b8`) so that the run could be undone.

## Protected set
| Path | Before | After | Verdict |
|---|---|---|---|
| `context/foundation/infrastructure.md` | 7492 bytes | 7492 bytes | intact |
| `context/foundation/prd.md` | 8976 bytes | 8976 bytes | intact |
| `context/foundation/shape-notes.md` | 9273 bytes | 9273 bytes | intact |
| `context/foundation/tech-stack.md` | 12040 bytes | 12040 bytes | intact |
| `README.md` | 16 bytes | 16 bytes | intact |
| `.gitignore` | — | new (from starter) | added |
| `.env` | — | new (generated, gitignored) | added |

`guard.sh verify`: lost 0, modified 0. Run after the merge and again after all changes.

## Checks
| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | Resolved. npm 12 blocked install scripts for `fsevents@2.3.3` and `electron-winstaller@5.4.4` (`allowScripts`); nothing failed because of it (see Findings). |
| Typecheck | `npx tsc --noEmit` | Exit 0 under `strict: true` |
| Lint | `npx oxlint` / `npx oxfmt --check` | Exit 0 / "All matched files use the correct format." (after the `context/**` ignore) |
| Test | — | The starter ships no tests, and no test runner is configured. `lz-test-strategy` decides. |
| Build | `npm run package` | `out/DigitalPigeon-darwin-arm64/DigitalPigeon.app` built. CSP meta tag present in `.vite/renderer/main_window/index.html`. |
| Run (packaged) | `out/.../DigitalPigeon.app/Contents/MacOS/DigitalPigeon` | Process alive after 8 s, no output on stderr. `codesign -dv` shows `Signature=adhoc`. The window contents were not inspected. |
| Run (dev) | `npm start` | Main and preload built. The Electron binary downloaded on first start. Electron main, GPU and network processes ran. Stopped manually. |
| Database | `docker compose up -d` | `mongo` 8.0.34 started. Published port `127.0.0.1:27017` only (`lsof`). Unauthenticated `listDatabases` → `Unauthorized`. Authenticated → `ok=1`. First authenticated connection succeeded ~2 s after the post-init restart. |

## Findings
1. **Forge template renamed.** `--template=vite-typescript` no longer exists in `create-electron-app` (Forge 8). Use `--template vite --typescript`.
2. **Lint fails out of the box on `context/`.** oxfmt checks markdown, so `context/**` is now in `ignorePatterns`. `lz-onboard` should keep `npm run lint` as the lint command with this ignore in place.
3. **npm 12 blocks install scripts by default.** `fsevents` (an optional macOS file watcher) and `electron-winstaller` (the Windows Squirrel maker) are blocked. The macOS dev, build and run checks pass without them. A Windows `make` was not tested and may need `npm install-scripts approve electron-winstaller`.
4. **The Electron binary downloads on the first `npm start`,** not during `npm install`. The first run needs network access.
5. **The Apple Silicon signature risk is closed.** `electron-forge package` applies an ad-hoc signature, and the locally built app launches. The infrastructure risk register's mitigation (`codesign -s -`) is not needed for local builds.
6. **The MongoDB image restarts `mongod` once after creating the root user.** Connections are refused for a moment on first start. This is relevant to the PRD open question on database-down behaviour: a startup check needs to retry.
7. **No test runner.** `npm test` does not exist. `lz-test-strategy` should choose one before `lz-onboard` prescribes a test command.
8. **Starter makers include Squirrel (Windows), DEB and RPM.** They are kept unused, because the target is local macOS only. They are relevant when work-laptop use is pursued.

---
produced-by: lz-spike
assumption: With mongodb@7.8.0 and undici@8.12.3 imported from src/main.ts, `npm run package` builds without error and the packaged DigitalPigeon.app (Electron 45.2.1, asar + fuses) connects to the Compose MongoDB, inserts and reads a document, and makes an undici.request to a local server, without throwing at load time.
verdict: holds
timebox: 45 minutes / about 3 minutes (19:57:25–19:58:04 for build and run, plus inspection)
versions: mongodb 7.8.0, undici 8.12.3, electron 45.2.1 (Node 24.22.1), @electron-forge/plugin-vite 8.0.x, vite 8.3.5, mongo:8.0.34
updated: 2026-11-03
---

# Spike: bundling mongodb and undici into the packaged main process

## Assumption
Plan assumption A1. The default Forge Vite main build bundles `mongodb` 7.8.0 and `undici` 8.12.3,
the packaged app loads them, and both work: a SCRAM-authenticated connect, insert, read and drop
against the Compose MongoDB, and one `undici.request` to an in-process `node:http` server.
Negative result: the build fails, or the packaged app throws when either module loads or is used.

## Prediction (written before running)
"Build ok, runtime fails — the build passes (warnings about unresolved optional peers), but the
packaged app throws on loading mongodb because a bundled optional require is broken. Undici works.
Medium confidence." (author's choice, 2026-11-03)

## What happened
A throwaway git worktree (an APFS clone of `node_modules` plus `undici@8.12.3` installed with
`--no-save`) replaced `src/main.ts` with a probe. On `app.whenReady()` the probe connected with
credentials from the repo `.env`, inserted and read a document in `dp_test_spike_a1`, dropped that
database, then sent `undici.request` to a local server. It wrote the results to a file and quit.
`npx electron-forge package` exited 0 with no warnings; `.vite/build/main.cjs` was 1.5 MB. The
packaged binary at `out/DigitalPigeon-darwin-arm64/DigitalPigeon.app/Contents/MacOS/DigitalPigeon`
wrote:
`{"node":"24.22.1","electron":"45.2.1","packaged":true,"mongoRead":{"_id":"a","v":1},"mongo":"ok","undici":{"status":200,"body":"pong"}}`
Nothing was printed to stderr, and no `dp_test_spike_a1` database remained.

## Verdict: holds

## Surprises
- **The build produced no warnings.** The prediction expected warnings about the optional peers.
  Vite 8 replaces each unresolvable optional import with a stub that throws when called
  (`throw Error('Could not resolve "kerberos" imported by "mongodb". Is it installed?')`).
- **The runtime did not fail.** The driver loads each optional module inside `try/catch`
  (`getKerberos()` and similar in `mongodb/lib/deps.js`) and turns a failure into a
  `MongoMissingDependencyError` that fires only when that feature is used. SCRAM authentication,
  CRUD and dropDatabase never touch them.
- The prediction rested on a model of Rollup leaving `require("kerberos")` calls unresolved at
  load. Vite 8's bundler does not behave that way: stubs, not bare requires.

## What this means for the plan
- A1 holds. Phases 4–5 can import `mongodb` and `undici` from main-process code with the default
  Forge Vite config. No externals configuration and no `node_modules` copying are needed.
- A known boundary of this approach: Kerberos authentication, `zstd` or `snappy` wire
  compression, client-side field-level encryption, AWS or GCP authentication, and SOCKS proxying
  are unavailable in the packaged app. They fail with `MongoMissingDependencyError` when used.
  None is used: the app connects with SCRAM to `127.0.0.1`. A later proxy or mTLS milestone would
  need to revisit `socks`.
- The probe used `undici.request` with an explicit `Host` header; A2 (undici adds no headers) was not
  tested here and stays with phase 2.

## Code
Deleted: the worktree at `scratchpad/spike-a1` was removed with `git worktree remove --force`.
The working connection string for the app, for reference:
`mongodb://${user}:${password}@127.0.0.1:27017/?authSource=admin` (encode user and password with
`encodeURIComponent` in real code).

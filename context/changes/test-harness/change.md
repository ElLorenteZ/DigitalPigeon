---
change_id: test-harness
title: Install the unit, integration and e2e test harness from the test strategy
status: new
ticket: null
created: 2026-11-02
updated: 2026-11-02
closed: null
produced-by: lz-change
---

## Intent

"do it" — in reply to the proposal to pick up the harness work listed under Known gaps in
`context/foundation/test-strategy.md`:

> - Vitest with separate unit and integration projects, and the `test:unit` / `test:integration`
>   scripts.
> - An integration helper that creates and drops a uniquely named test database on the Compose
>   MongoDB, using the credentials in `.env`.
> - A local HTTP server helper that captures raw requests, for T1.2–T1.4.
> - `@playwright/test` with `_electron` launching the packaged app, and the `test:e2e` script.

## Boundary

**This change covers:**
- Vitest installed and configured with separate unit and integration projects; `npm run test:unit`
  and `npm run test:integration` scripts.
- An integration helper that creates a uniquely named database on the Compose MongoDB (credentials
  from `.env`) and drops it after the run, never touching the history database.
- A local HTTP server helper on `127.0.0.1` with an ephemeral port that captures raw requests
  (method, URL, header order and case, body bytes).
- `@playwright/test` launching the packaged app through `_electron`; `npm run test:e2e` script.
- One smoke test per layer proving the command runs and the helper works, so each gate can be
  marked verified.

**Explicitly not in this change:**
- Tests for the T1/T2 risks themselves. The features they test do not exist yet; each feature
  change writes its own tests within the layer contract.
- The shared IPC contract module (T2.1) and `zod` schemas. They belong to the first feature that
  crosses IPC or stores a document.
- Hosted CI. The author chose local gates only (2026-11-02).
- Deciding database-down behaviour (PRD open question, blocks T1.6).
- Updating `AGENTS.md` with the new test commands. That is `/lz-onboard`, run after this change
  verifies them.
- Restructuring `src/` so main-process logic does not import `electron`. That constraint applies
  to code written by feature changes.

## Notes

- Source: `context/foundation/test-strategy.md`, sections Layer contract, Quality gates and Known
  gaps.
- The CSP is injected into production builds only, so e2e runs against `npm run package` output
  (`context/scaffold-verification.md`).

---
change_id: reimport-and-errors
produced-by: lz-tdd
updated: 2026-11-21
---

# Progress: re-import and errors

## Phase 1: parser errors with locations, and re-import in the store

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/openapi.ts`:
  - JSON errors give "line L, column C", computed from the parser's position.
  - A path item or operation that is not an object throws `paths["/x"] is not an object` or
    `paths["/x"].get is not an object`.
- `src/core/template-store.ts`:
  - `importOpenApi` matches an existing source by kind and title. It updates templates by `METHOD path`, keeping their
    ids, inserts new ones and deletes gone ones.
  - It returns `ImportOutcome`: `reimported`, `added`, `updated`, `removed`.
- `ImportResultSchema` carries the outcome.
- Tests:
  - `openapi.test.ts`: 2 cases.
  - `template-store.int.test.ts`: 1 case, which also checks that the `sends` and `completions` counts are unchanged.
  - The earlier "with the environment…" test now imports two different titles, because the same title is a re-import.

**Verification**

```
$ (before) unit: × gives the line and column… · × names a path item…   integration: × re-importing the same spec…
$ npx vitest run --project unit src/core/openapi.test.ts → 12 passed
$ npx vitest run --project integration src/core/template-store.int.test.ts src/server/ → 47 passed
```

## Phase 2: the dialog says re-import or where it failed

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `ImportDialog`:
  - it takes `existingNames`;
  - when the parsed title exists, it says "Re-imports “Title”…" and the button reads "Update N templates";
  - its footer note is back to "Re-importing updates templates in place; History is never touched."
- `TemplatesTree` shows the outcome ("1 added · 3 updated · 1 removed").
- `e2e/templates.spec.ts`: 2 new scenarios.

**Verification**

```
$ npx playwright test e2e/templates.spec.ts      # before the UI
  ✘ re-importing a changed spec… (toContainText)  ✓ an invalid file says where it failed… (phase 1's parser message already reached the dialog)
$ npx playwright test e2e/templates.spec.ts --repeat-each=3 → 12 passed
$ npx playwright test → 84 passed (1.3m) · npm run test:unit → 383 passed · typecheck 0 · lint clean
```

The invalid-file scenario was not red at the e2e layer. Its behaviour came from phase 1, where it was red.

**Drift:** none.

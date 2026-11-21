---
change_id: openapi-import
produced-by: lz-tdd
updated: 2026-11-21
---

# Progress: OpenAPI import

## Phase 1: parse and group

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/openapi.ts`:
  - `parseOpenApi`: title, version and servers; one operation per path and method, in spec order; the name from the
    summary, else the `operationId`, else method and path; path- and operation-level parameters merged; a JSON body
    from `example`, else the first of `examples`; `SpecError` for invalid JSON, a document that is not OpenAPI 3, or
    one with no `paths`.
  - `groupOperations(ops, 'tag' | 'path')`.
- `src/core/openapi.test.ts`: 8 cases.

**Verification**

```
$ npx vitest run --project unit src/core/openapi.test.ts     # before
 FAIL  Error: Cannot find module './openapi'
$ npx vitest run --project unit src/core/openapi.test.ts → Tests 8 passed (8)
```

## Phase 2: import and list through the store and the operations

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/template-store.ts`: collections `templateSources` and `templates`, with `importOpenApi`, `list` and `get`.
  With the environment, a template's URL is the path; without it, the spec's first server joined to the path.
- The contract gains `pigeon:import-openapi`, `pigeon:list-templates` and `pigeon:get-template`, with their handlers
  and client methods.
- Tests: `src/core/template-store.int.test.ts`, 4 cases. The all-operations HTTP test now imports, lists and gets a
  template.

**Verification**

```
$ npx vitest run --project integration src/server/http.int.test.ts -t "every operation"   # before the contract
     × TypeError: Cannot read properties of undefined (reading 'replace')
$ npx vitest run --project integration src/server/ src/core/template-store.int.test.ts → Tests 45 passed (45)
```

The store tests were written in the same step as the store and were not run red first. The contract test was.

## Phase 3: screen 05 and the Templates tab

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/renderer/app.tsx`:
  - The first sidebar tab is Templates (`TemplatesTree`): "N in K sources", "Import OpenAPI / WSDL", and a
    source → directory → template tree of `details` elements. A template is a button named `METHOD path — name`.
  - `ImportDialog` (`role="dialog"`, "Import templates"):
    - the Source segment, with WSDL disabled;
    - a file chooser, parsed in the browser, showing a summary or the error;
    - "Group into directories by", Tag or Path segment;
    - the environment checkbox;
    - a preview by directory with method badges;
    - Cancel, and "Generate N templates".
  - `openTemplate` loads the form unlinked and shows the request.
- `src/index.css`: tree and dialog styles.
- `e2e/templates.spec.ts` (new): 2 scenarios.

**Verification**

```
$ npx playwright test e2e/templates.spec.ts         # before the UI
  2 failed
$ npx playwright test e2e/templates.spec.ts --repeat-each=3 → 6 passed (5.3s)
$ npx playwright test → 82 passed (1.3m)
$ npm run test:unit → 379 passed · npm run test:integration → 362 passed · typecheck 0 · lint clean
$ screenshot: context/changes/openapi-import/shot-import.png, compared with jXmWR (screen 05)
```

**Drift:**
- decision: the dialog's footer says "Importing never touches History." The design's "Re-importing updates templates
  in place" waits for slice 11, which builds it.
- decision: there is no "Folder" button and no template filter box, which the design shows. Neither is in any M2
  criterion.

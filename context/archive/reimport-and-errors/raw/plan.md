---
change_id: reimport-and-errors
title: Re-import a spec in place, and say where an invalid file failed
produced-by: lz-plan
revision: 1
created: 2026-11-21
updated: 2026-11-21
inputs: change.md, archive/openapi-import, prd.md (Templates criteria)
---

# Plan: re-import and errors

## Approach

- **The same spec** means the same `kind` and the same title (`info.title`). This is the only identity a spec carries;
  the file name changes between downloads.
- **Re-import, in `importOpenApi`.** Existing templates are keyed by `METHOD path`:
  - an operation whose key exists updates that template (directory, name, request, order) and keeps its `_id`;
  - a new key is inserted;
  - a key that is no longer in the spec is deleted.

  The source's grouping, file name and time are updated. The result adds `{ reimported, added, updated, removed }`.
  `sends` and `completions` are never read or written; the test checks this.
- **Errors, in `parseOpenApi`.**
  - JSON: the parser message's `position N` becomes "line L, column C" of the text.
  - A path item that is not an object: `paths["/x"] is not an object`.
  - An operation that is not an object: `paths["/x"].get is not an object`.
- **UI.**
  - The dialog's file box shows the error with its location, and Generate is disabled.
  - When a source with the parsed title exists, the dialog says "Re-imports “Title”: templates are updated in place;
    History is not touched", and the button reads "Update N templates".
  - After the import, a line under the tree reports "N added · M updated · K removed".

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Identity by file name | The same spec is downloaded under different names; the title is what it says it is. |
| Replace all of a source's templates | Template ids would change on every re-import. Keeping ids means a template open elsewhere still resolves. |

## Phases

### Phase 1: parser errors with locations, and re-import in the store (lz-tdd)
- **Files:** `src/core/openapi.ts` and its test, `src/core/template-store.ts` and its int test, `ImportResultSchema`.
- **Verification:** unit and integration, red then green.

### Phase 2: the dialog says re-import or where it failed (lz-e2e)
- **Files:** `src/renderer/app.tsx`, `e2e/templates.spec.ts`.
- **Scenarios:** a changed spec re-imported updates the tree (one added, one removed) and History's count is unchanged;
  an invalid file shows its line and column, with no Generate.
- **Verification:** red, then green 3×. The full suite green.

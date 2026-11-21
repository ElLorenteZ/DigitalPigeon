---
change_id: openapi-import
title: Import an OpenAPI JSON file as request templates in a Templates tab
produced-by: lz-plan
revision: 1
created: 2026-11-21
updated: 2026-11-21
inputs: change.md, prd.md (Templates criteria), the Pencil design (jXmWR screen 05), roadmap M2 decision
---

# Plan: OpenAPI import

## Approach

- **Parser (`src/core/openapi.ts`, pure).** `parseOpenApi(text)` → `{ title, version, servers, operations[] }` or a
  thrown `SpecError` with a message.
  - Each operation has: method (from the eight path-item keys), path, the first tag, the summary or `operationId` as
    its name, query and header parameters (path-level and operation-level, merged by name and `in`), and a JSON
    request-body text from `example`, or else from the first of `examples`.
  - `groupOperations(ops, by)` files operations by their first tag (else "default") or by the first path segment
    (else "root").
  - The UI uses it for the preview, and the server uses it for the import, so the two always agree.
- **Store (`src/core/template-store.ts`).** Collections `templateSources`
  (`{ _id, name, kind: 'openapi', importedAt, grouping }`) and `templates`
  (`{ _id, sourceId, directory, name, request: WireInput }`). `importOpenApi({ text, filename, grouping,
  useEnvironment })` parses on the server and writes one source and its templates.
  - With `useEnvironment`, a template's URL is the path, so it is sent against the active environment (slice 5's
    rule). Without it, the URL is the spec's first server URL joined to the path.
  - Path parameters stay as `{id}` in the URL, for the user to fill.
- **Contract.** `pigeon:import-openapi`, `pigeon:list-templates` (sources with templates, without request bodies) and
  `pigeon:get-template`.
- **UI.**
  - The sidebar's first tab is "Templates": a source → directory → template tree with counts, and an "Import OpenAPI /
    WSDL" button.
  - The import dialog has:
    - a source segment (OpenAPI JSON; WSDL shown but disabled until slice 12);
    - a file chooser, read in the browser, with the parsed summary (version, title, operations, tags, servers);
    - "Group into directories by" Tag or Path segment;
    - "Use the active environment's baseUrl";
    - a preview of the directories with method badges;
    - Cancel, and "Generate N templates".
  - Opening a template loads it into the form unlinked (roadmap decision), and the view shows the request.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| A dependency such as `@apidevtools/swagger-parser` | Full `$ref` resolution and YAML are out of scope. The slice needs a few fields, and a dependency must clear `tech-stack.md`. |
| Parse only in the browser and send templates to the server | The server is the boundary that validates. Parsing again there keeps one source of truth for what is stored. |
| Templates as saved requests in a folder | ADR 0001 keeps saved requests a flat list. The design gives templates their own tab and directories. |

## Phases

### Phase 1: parse and group (unit, lz-tdd)
- **Files:** `src/core/openapi.ts`, `src/core/openapi.test.ts`.
- **Verification:** `npx vitest run --project unit src/core/openapi.test.ts`, red then green.

### Phase 2: import and list through the store and the operations (integration, lz-tdd)
- **Files:** `src/core/template-store.ts` and its `.int.test.ts`; the contract, `ipc.ts`, `api.ts`, and the
  all-operations test.
- **Verification:** `npx vitest run --project integration src/core/template-store.int.test.ts src/server/`, red then
  green.

### Phase 3: screen 05 and the Templates tab (e2e, lz-e2e)
- **Files:** `src/renderer/app.tsx`, `src/index.css`, `e2e/templates.spec.ts`; `shell.spec.ts` if the tab order
  matters.
- **Scenarios:**
  1. Choosing a spec shows its summary and a preview by tag; switching to path segment changes the preview; Generate
     fills the tree.
  2. A template opens into the form and sends to the environment's `baseUrl`, and the call is recorded.
- **Verification:** red, then green 3×. The full suite green.

---
change_id: openapi-import
title: Import an OpenAPI JSON file as request templates in a Templates tab
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-21
ticket: null
verdict: merge
outcome: shipped
milestone: M2, slice 10 (roadmap.md)
branch: openapi-import, PR #9 (stacked on #8; archived on the branch before merge)
raw: raw/
---

## 1. What was built

- A Templates tab, first in the sidebar, with a source → directory → template tree.
- An "Import templates" dialog (screen 05). It reads an OpenAPI 3 JSON file in the browser, shows its summary, and
  previews directories by tag or by first path segment. "Generate N templates" stores one template per operation.
- The server parses the file again (`src/core/openapi.ts`) and writes `templateSources` and `templates`.
- A template opens into the form unlinked. With "Use the active environment's baseUrl", its URL is the path alone.

**Differs from the plan:**
- Code review led to skipping TRACE, falling back to the path for unusable server URLs, writing JSON for object
  examples, latest-wins guards, and inserting templates before their source.
- The footer's re-import promise waits for slice 11.

## 2. Why this approach

One small parser for exactly what a template needs. It has no Node imports, so the UI previews with it and the server
imports with it, and the two cannot disagree. Templates are form content (`WireInput`). Opening one reuses the form,
and sending one reuses everything slices 1–5 built.

## 3. What was rejected

- **A spec library (`swagger-parser`).** YAML and full `$ref` resolution are out of scope. A dependency must clear
  `tech-stack.md`.
- **Parsing only in the browser.** The server is the boundary that validates what it stores.
- **Templates as saved requests in folders.** ADR 0001 keeps saved requests a flat list, and the design gives templates
  their own tab.

## 4. Surprises

- What the parser accepts and what the form can send must match. TRACE and templated server URLs (`https://{region}…`)
  made templates that listed but could not open. Code review found both.

## 5. What still stands

- The PRD's open question (can a template be edited, or turned into a saved request?) is answered provisionally: it
  opens unlinked, and Save makes a saved request. The author is to confirm.
- Path parameters stay as `{id}` in the URL. `$ref`, YAML and Swagger 2.0 are not supported.
- Re-import is not yet in place: importing again makes a second source until slice 11.

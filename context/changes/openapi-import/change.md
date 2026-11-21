---
change_id: openapi-import
title: Import an OpenAPI JSON file as request templates in a Templates tab
status: new
ticket: null
created: 2026-11-21
updated: 2026-11-21
closed: null
produced-by: lz-change
---

## Intent

Roadmap M2 slice 10, "OpenAPI import": "Choose an OpenAPI JSON file; the dialog previews directories by tag or path
segment; Generate fills the Templates tab tree (source → directory → operation); a template opens into the form and
sends to the active environment's `baseUrl`".

## Boundary

**This change covers:**
- Parsing OpenAPI 3.x JSON into operations: the method, path, tag, summary, query and header parameters, and a JSON
  request-body example.
- A template store: sources and templates.
- The import dialog of screen 05, for OpenAPI JSON only.
- The Templates tab with its tree, and opening a template into the form.

**Explicitly not in this change:**
- Re-import in place, and error positions for invalid files (slice 11). An invalid file is refused here with the
  parser's message.
- WSDL (slice 12).
- YAML specs, `$ref` resolution beyond `#/components/…` request-body examples, and Swagger 2.0.
- Editing templates.

---
change_id: reimport-and-errors
title: Re-import a spec in place, and say where an invalid file failed
status: new
ticket: null
created: 2026-11-21
updated: 2026-11-21
closed: null
produced-by: lz-change
---

## Intent

Roadmap M2 slice 11: "Importing the same spec again updates its templates in place, adding new operations and removing
gone ones, with History unchanged; an invalid file imports nothing and the dialog says where it failed (JSON position,
or the path that is missing)".

## Boundary

**This change covers:**
- Re-import: a source with the same title and kind is updated in place. Templates are matched by method and path:
  existing ones are updated and keep their ids, new operations are added, and missing ones are removed. The dialog says
  that it will re-import.
- Errors: invalid JSON reports its line and column. A path item or operation that is not an object reports its path.
  The dialog shows the error and offers no Generate.

**Explicitly not in this change:** WSDL (slice 12), deleting a source, renaming a source.

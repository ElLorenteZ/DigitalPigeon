---
change_id: workspace-shell
title: Give the app the target design's workspace shell (screens 01 and 02)
status: closed
ticket: null
created: 2026-11-21
updated: 2026-11-21
closed: 2026-11-21
produced-by: lz-change
---

## Intent

Roadmap M1 slice 6, "Workspace shell in the design": "The app looks like screens 01 and 02: the logo in the title bar,
the environment selector in the title bar, a sidebar with Saved and History tabs (Templates appears in M2), request
above response, the status bar; every existing e2e journey still passes".

Author, 2026-11-21: "continue as long as you can - its a test about what will be made. finish when roadmap will be
finished".

## Boundary

**This change covers:**
- The shell of screens 01 and 02 in `~/Documents/digital-pigeon.pen`:
  - a title bar with the logo, the app name and the environment selector;
  - a sidebar with Saved and History tabs;
  - the main area, with the request above the response or the opened call record;
  - a status bar with the database state.
- The design's colour, type and spacing tokens applied to what already works:
  - the request bar, the Query/Headers/Body sections, the body editor;
  - the send result, the call record, the history and saved lists, the environments editor.
- Keeping every existing e2e journey passing. Steps may gain a tab or panel click; no title changes.

**Explicitly not in this change:**
- The Templates tab and import (M2).
- The responses strip and "other responses" chips (slice 7).
- Delete, Undo and the Delete button on the call record (slice 8).
- History search, filters, facet counts and resend (slice 9).
- Any change to `src/core/`, `src/server/` or the operations contract. This is renderer-only.
- Drawing the window's traffic lights. The app is a browser page (ADR 0002); the title bar becomes a page header.
- Fetching web fonts. The CSP is `default-src 'self'`; fonts fall back to local Inter or JetBrains Mono, else system
  fonts.

## Notes

- Target: `~/Documents/digital-pigeon.pen`, frames `pyg23` (01) and `aJeTB` (02); components `UWrNk` (Logo Small),
  `TUcWi` (History Row), `lej2z` (Method Badge), `FAc0D` (Status Pill), `Dgb4H` (Tab), `EuE17` (Segment).
- Roadmap order rationale: the shell goes before slices 7–9 so their UI is built once, in place.
- Outcome (2026-11-21): closed as done. The app has the shell of screens 01 and 02. All 3 plan phases are verified, the
  review verdict is merge, and all 10 code-review findings are fixed. PR #5. Open: an editable request body in the code
  editor (roadmap, "Not ordered yet").

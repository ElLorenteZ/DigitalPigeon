---
change_id: workspace-shell
title: Give the app the target design's workspace shell (screens 01 and 02)
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-21
ticket: null
verdict: merge
outcome: shipped
milestone: M1, slice 6 (roadmap.md)
branch: workspace-shell, PR #5 (archived on the branch before merge; merging needs the author's approval)
raw: raw/
---

## 1. What was built

The app now has the shell of design screens 01 and 02:
- a title bar with the logo (inline SVG of Logo Small), the name, the Environment select, and an Environments toggle
  that opens the editor in a panel;
- a sidebar with Saved and History tabs. History rows have a method badge, the path, `host · time`, the code coloured
  by class and the duration, grouped by day;
- a main area that shows the workspace (request above response), or the opened call in its place;
- a status bar.

The request has Query, Headers and Body tabs with counts. The body type is a segment of pressed buttons. The response
has a header with a status pill, the duration, the size and a Recorded chip, then Body and Headers tabs. The call record
has a breadcrumb, the request line, chips, actions, the immutability note, and Request as sent beside Response. The
design's tokens are CSS custom properties, and Monaco has a dark theme built from them. The change is renderer-only.

**Differs from the plan:**
- "Back to the call" was added. Replay shows its result in the workspace, and journeys go on to act on the original.
- The body type became buttons, not radios. Code review found that arrow keys on radios changed the type and threw the
  body away.
- Phases 2 and 3 were committed together.

## 2. Why this approach

`App` kept all its state and handlers, and only where things render changed. That kept every behaviour the e2e suite
guards, and the suite was the regression check. Panels stay mounted and are hidden with `hidden`, so a half-typed form
and the Monaco models survive tab and view switches. A history row's visible text was split into columns, so its
accessible name carries the whole call (`METHOD URL — outcome · time`). Journeys assert on that name.

## 3. What was rejected

- **Tailwind or a component library.** A dependency and a build step for one stylesheet. The tokens map directly to
  custom properties.
- **Keeping every section visible and only restyling.** It would not look like the screens, which show one list and one
  request section at a time.
- **Unmounting inactive panels.** Typed input and editor models would be lost on every switch.
- **The call record below the request, as before.** Screen 02 replaces the main area, and below-the-fold panels needed
  scroll workarounds.
- **Web fonts from Google, or bundled font files.** The first is blocked by the CSP. The second adds about 400 KB and
  two licences for a look the system fonts approximate.
- **Radios for the body type.** Arrow keys change the selection at once. See section 1.

## 4. Surprises

- **Monaco's automatic layout and the main pane's scrollbar resized each other in a loop** on a 1 MiB response. The
  page never settled, and a journey hung for 15 minutes. Fixed with `scrollbar-gutter: stable`.
- **A tab panel named by its tab collided with a field label.** The panel was named "Body Text" after its tab, which
  matched the "Body text" textbox. Panels use `aria-label`.
- **The column class `info` collided with the `.info` colour utility**, and history paths turned blue.
- **Role queries skip elements inside hidden panels.** Checks on hidden state need CSS locators (`bodyTypeButton`).
- **Machine load changed e2e timing 10–20×.** The suite took 51 s idle and 20 minutes under a load average of 9–26. One
  journey failed only under load.

## 5. What still stands

- e2e journeys move around the shell with `showRequestTab`, `showSidebarTab`, `showRequest`, `showCall`,
  `openEnvironments`, `chooseBodyType`, `rowName` and `containing` (`e2e/support.ts`). Each is a no-op when its state is
  already shown. Specs that share an app reset to the request with History shown in `beforeEach`.
- If a hidden-panel assertion fails, check whether it uses a role query. Role queries ignore hidden elements.
- Errors render outside the panel that may be closed: environment errors under the title bar. Saved-request failures
  switch to the workspace.
- Known gaps are listed in the ledger:
  - the request body is a textarea, not the design's numbered editor (roadmap "Not ordered yet");
  - no traffic lights;
  - "Replay", not "Resend exactly".

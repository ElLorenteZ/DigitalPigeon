---
change_id: workspace-shell
title: Give the app the target design's workspace shell (screens 01 and 02)
produced-by: lz-plan
revision: 1
created: 2026-11-21
updated: 2026-11-21
inputs: change.md, the Pencil design (frames pyg23, aJeTB and components, read 2026-11-21), src/renderer/app.tsx, src/index.css, e2e/*.spec.ts
---

# Plan: workspace shell

## Approach

The work is renderer-only. `App` keeps every piece of state and every handler it has today. What changes is where each
part renders and how it looks:

```
<header class="title-bar">   logo · "DigitalPigeon" · spacer · Environment select · "Environments" toggle
<div class="body">
  <aside class="sidebar">    tabs Saved | History (role=tablist) → SavedRequestList | HistoryList (one panel visible)
  <main class="main">        view "workspace": SavedRequestBar · RequestForm · CurlView · ResultView
                             view "call":      CallPanel (screen 02), with a "← Request" button back to the workspace
<footer class="status-bar">  StatusBar · "Every send is kept as its own immutable record" · version
```

- **Views.** Opening a history row sets the view to `call`. The following set it back to `workspace`, which is what the
  `showRequest()` scrolls do today:
  - Replay; the result shows in the workspace;
  - Edit;
  - opening a saved request;
  - New;
  - the back button.
  The panes scroll on their own, so the page never scrolls.
- **Tabs.**
  - The sidebar opens on History (screen 01) and switches to Saved on a click.
  - The request has Query, Headers and Body tabs with counts, opening on Body (screen 01).
  - The body type becomes the design's segment: a `radiogroup` named "Body type" with None, JSON, XML, Text, Form and
    Multipart. Multipart is not in the design, but it is a shipped behaviour that must stay.
  - Tab panels stay mounted, using `hidden`, so a half-typed form and the Monaco models survive a tab switch.
- **Environments.** The `Environment` select moves to the title bar. The editor opens from an "Environments" button in
  the title bar as a panel under it, and closes from the same button.
- **History rows** follow the History Row component:
  - a method badge coloured by method;
  - the path, with `host · time` below it;
  - the status code coloured by class, with the duration below it;
  - grouping under Today, Yesterday and the date.
  The visible text no longer carries `METHOD URL — outcome`. The row button's accessible name does (`aria-label`), and
  the e2e text assertions move to the accessible name.
- **Styling.**
  - The design tokens (`bg`, `surface`, `raised`, `border`, `text`, `muted`, `faint`, `accent`, `ok`, `warn`, `err`,
    `info`, `violet`) become CSS custom properties in `src/index.css`.
  - Fonts are `Inter` and `JetBrains Mono` when installed locally, else system fonts. No web fonts: the CSP is
    `default-src 'self'`.
  - The logo is an inline SVG built from the Logo Small paths (`UWrNk`).
  - No CSS framework: the project has none, and one stylesheet holds the shell.
- **Call record (screen 02).**
  - A breadcrumb row.
  - The method and the URL in mono.
  - Chips for status, state, duration, sent time and environment.
  - The existing actions restyled: Replay as the primary "Resend exactly", Edit, Copy as curl. Their labels stay as
    today, so the journeys keep their selectors.
  - Two columns: Request as sent, and Response.
  The note "Replaying or editing never changes this record" is shown.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Tailwind or a component library | A new dependency and build step for one stylesheet. The design's tokens map directly to CSS custom properties. |
| Keep every section visible and only restyle | It does not look like screens 01 and 02, which show one sidebar list and one request section at a time. The slice's outcome is the design. |
| Unmount inactive tab panels | Loses half-typed input and Monaco models on every switch. `hidden` keeps them mounted. |
| The call record below the request, as today | Screen 02 replaces the main area with the record. Keeping both means the record sits below the fold at 800 px. |
| Load Inter and JetBrains Mono from Google Fonts | The CSP is `default-src 'self'`; AGENTS.md fixes it. |
| Bundle the font files | About 400 KB and two licences, for a look the system fonts approximate. Revisit if the author asks. |

## Out of scope

- The Templates tab (M2).
- Search and filter controls in the sidebar (slice 9).
- The responses strip and other-responses chips (slice 7).
- The Delete button (slice 8).
- Drawing the window's traffic lights.
- A light theme.
- Responsive layouts below 1000 px wide.
- Anything in `src/core/`, `src/server/` or `src/shared/`.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | Every e2e journey can reach what it needs with an added tab, panel or back click. No journey depends on two panels being visible at once. | Some panel must stay visible beside another, and the layout changes. | yes. Phase 1 settles it by running the full suite. |
| A2 | Monaco lays out correctly when its container goes from `hidden` to shown. | The editor draws at zero size after a tab switch. | yes, for the Body tab. Monaco's `automaticLayout` handles resizes, and phase 1's body journeys check it. |
| A3 | The CSP allows inline SVG in JSX and `style` attributes. | Logo or colours blocked. | no. React sets `style` through the DOM, which `style-src 'unsafe-inline'` allows, and inline SVG is markup, not a resource. |

## Phases

### Phase 1: The shell's structure, with every journey passing

- **Goal:**
  - The title bar holds the logo, the name, the environment select and the Environments toggle.
  - The sidebar has Saved and History tabs.
  - The main area switches between the workspace and the call record.
  - The request has Query, Headers and Body tabs, and the body type is a segment.
  - History rows have the new structure and their accessible name.
  - A status bar sits at the bottom.
  - Minimal styling only.
- **Files:** `src/renderer/app.tsx`, `src/index.css`, `e2e/*.spec.ts`, `e2e/support.ts`, and a new `e2e/shell.spec.ts`.
- **Executor:** lz-e2e. The risk is layout and visibility, which only the assembled page shows (test-strategy E2E
  layer).
- **New scenarios in `e2e/shell.spec.ts`**, written first:
  1. The title bar shows the logo and the name, and the environment select sits in it.
  2. The status bar is at the bottom of the viewport, and the page does not scroll.
  3. The sidebar opens on History, Saved switches the list, and each tab's list keeps its content.
  4. A call opened from History replaces the request. "← Request" brings the form back with what was typed.
  5. The request opens on Body. Headers shows the header rows, and the counts follow the rows.
- **Verification:** `npx playwright test e2e/shell.spec.ts` red before the code, then green 3×; `npm run test:e2e` all
  green with every earlier title present (`titles-before.txt`); typecheck; lint.

### Phase 2: The design's look on the shell and the workspace

- **Goal:** what screen 01 shows of shipped behaviour now looks like it: tokens, the title bar, sidebar tabs, history
  rows (badges, status colours, day groups), the request bar, tabs with counts, the segment, the response header with
  status pill, duration, size and Recorded chip, and the status bar.
- **Files:** `src/index.css`, `src/renderer/app.tsx` (class names, small presentational components such as
  `MethodBadge`, `StatusPill` and `Logo`).
- **Executor:** lz-build. The work is presentational and its check is visual. The behaviour is already guarded by
  phase 1.
- **Verification:**
  - A Playwright screenshot of the workspace at 1440×900 with seeded calls, compared by eye with
    `pyg23.png`. Differences are listed in the ledger.
  - `npm run test:e2e` green. The CSP recorder must report no violations.
  - Typecheck and lint.

### Phase 3: The call record looks like screen 02

- **Goal:**
  - The breadcrumb, the method and URL, and the chips.
  - The actions, with Resend exactly as the primary.
  - The immutability note.
  - Two columns, Request as sent and Response, with headers as key/value tables and bodies in the existing editor.
- **Files:** `src/renderer/app.tsx` (`CallPanel`, `CompletionView`), `src/index.css`.
- **Executor:** lz-build.
- **Verification:**
  - A screenshot of an opened call at 1440×900, compared by eye with `aJeTB.png`, with differences listed.
  - `npm run test:e2e` green, typecheck, lint.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| e2e churn hides a behaviour change | medium | High | Titles unchanged. Each edited step is a navigation click, or an assertion moved from text to accessible name. The ledger lists every spec edit. |
| Monaco inside hidden panels | medium | Medium | `automaticLayout`. Body journeys run after tab switches. |
| A visual match judged by eye | high | Low | The ledger lists the differences. The author reviews them on the PR. |

## For the reviewer

- The environment editor moves behind a title-bar toggle. Screen 01 shows only the selector, so this placement is a
  choice.
- "← Request" is not in screen 02. The design's "History" breadcrumb has no target in a page with no History route.
- Multipart is kept in the body-type segment although the design's segment lacks it.

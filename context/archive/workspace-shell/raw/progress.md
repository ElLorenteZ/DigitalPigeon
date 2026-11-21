---
change_id: workspace-shell
produced-by: lz-build
updated: 2026-11-21
---

# Progress: workspace shell

## Phase 1: the shell's structure, with every journey passing

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/renderer/app.tsx`:
  - `App` renders a title bar (`banner`): the `Logo` (inline SVG of the design's Logo Small), the `DigitalPigeon`
    heading, the Environment select (moved out of `RequestForm`), and an "Environments" toggle (`aria-expanded`) that
    opens `EnvironmentsEditor` in a panel under the title bar.
  - The sidebar is a `tablist` named "Sidebar" with Saved and History tabs, opening on History. Panels use `hidden`.
  - The main area has two views. The workspace holds the saved-request bar, the form, the curl view and the result. The
    call view holds `CallPanel`.
    - Opening a history row switches to the call view.
    - Back to the workspace: Replay, Edit, opening a saved request, New (through `showRequest`), and "Back to the request".
    - "Back to the call" returns to the opened call.
  - The status bar (`contentinfo`) has the database state, the immutability note and the version.
  - `RequestForm` has a `tablist` named "Request" with Query, Headers and Body tabs, opening on Body. The tabs show
    counts, and Body shows its type label. Panels are labelled Query, Headers and Body. The body type is a `radiogroup`
    named "Body type" with six radios, Multipart included.
  - `HistoryList`: rows are grouped under Today, Yesterday or the date. The day headers are `aria-hidden`. Each row is a
    method badge, the path with `host · time`, and the code with the duration. The button's `aria-label` is
    `METHOD URL — outcome · sent time`. The count sits beside the History heading, not inside it.
- `src/index.css`: a full-height flex shell, with panes that scroll on their own and `[hidden] { display: none }`. The
  `.main` pane has `scrollbar-gutter: stable`.
- `e2e/shell.spec.ts` (new) has 5 scenarios.
- `e2e/support.ts`: new helpers `showRequestTab`, `showSidebarTab`, `showRequest`, `showCall`, `openEnvironments`,
  `chooseBodyType`, `bodyTypeRadio` (a CSS locator, so it still finds the radio while the form is hidden), `rowName`
  and `containing`.
- The 12 earlier specs have no title changed. The step edits are of five kinds:
  - a tab, view or panel click inserted before an action, through the helpers;
  - `selectOption` on Body type replaced by `chooseBodyType`, and `toHaveValue` by `toBeChecked`;
  - history-row `toContainText` replaced by `rowName(...).toHaveAccessibleName(containing(...))` (18 assertions);
  - a `beforeEach` in each shared-app spec, which returns to the request with History shown;
  - `multipart-edit-failures`: "a change to the form while Edit reads a stored body" now returns to the request before
    typing. The behaviour under test, that typing ends the pending Edit, is unchanged.

**Verification**

```
$ npx playwright test e2e/shell.spec.ts            # before the shell
  ✘ 1–5 (toBeVisible / toHaveAttribute / toBeHidden failed)   5 failed
$ npx playwright test e2e/shell.spec.ts --repeat-each=3
  15 passed (5.6s)
$ npx playwright test --global-timeout 1200000      # full suite
  ✘ replay.spec.ts › opening a call brings its panel into view, even from a long history (3.1m; history count 0, expected 3)
  59 passed (3.9m)
$ npx playwright test e2e/replay.spec.ts
  2 passed (4.2s)
$ comm -23 titles-before.txt titles-after.txt       # every earlier title present
(no output) — 55 before, 60 after
$ npm run typecheck → 0 errors
$ npm run lint      → All matched files use the correct format.
$ npm run test:unit → Tests  371 passed (371)
```

PASS, with one note. The long-history replay journey failed once in the full run while the machine's load average was
9–26. It took 3.1 minutes, against 1.6 s alone. It passed alone. Phase 2's full run rechecks it.

**Drift:**
- decision: "Back to the call" in the workspace. The plan named only the way back to the request. Replay shows its result
  in the workspace, and journeys go on to act on the original call (Edit after Replay, T2.7).
- decision: request tab panels use `aria-label`, not `aria-labelledby`. With labelledby, a panel was named "Body Text"
  after its tab, which collided with the "Body text" textbox.
- decision: `scrollbar-gutter: stable` on `.main`. Without it, a 1 MiB response looped: Monaco's automatic layout and the
  main pane's scrollbar kept resizing each other, and T2.9 never saw the Pretty button settle.

## Phase 2: the design's look on the shell and the workspace

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/index.css`:
  - the design tokens (`bg`, `surface`, `raised`, `hover`, `border`, `border-strong`, `text`, `muted`, `faint`,
    `accent`, `accent-ink`, `accent-soft`, `violet`, `ok`, `warn`, `err`, `info`) as custom properties;
  - Inter and JetBrains Mono when installed, else system fonts;
  - styles for the title bar, sidebar tabs, history rows (method badges by method, status colours by class, day groups),
    the request bar, request tabs with counts, the body-type segment (radios visually hidden), the saved bar, status
    pills, the Recorded chip, the header tables and the status bar.
- `src/renderer/app.tsx`:
  - `CompletionView` has a header row: "Response", a status pill with the reason phrase (`STATUS_TEXT`), the duration,
    the size, and a "Recorded · time" chip. It then has Body and Headers tabs. Headers are a `HeaderTable` (a `dl`).
  - Monaco gets a `pigeon` dark theme built from the tokens.
  - The history row's column class is now `row-info`. As `info` it collided with the `.info` colour utility.
- `e2e/support.ts`: `chooseBodyType` clicks the segment's label, as a person does, and then checks the radio is
  checked. The visually hidden radio cannot be `check()`ed.
- `e2e/shell.spec.ts`: tabs are scoped to the Sidebar and Request tab lists. The response now has its own Body tab.

**Verification:** run together with phase 3. See below.

## Phase 3: the call record looks like screen 02

- **Executor:** lz-build
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `CallPanel`, top to bottom:
  - a breadcrumb `History › Call #short-id`, where "Call" is the `h2` the journeys look for;
  - the request line: a method badge, the URL in mono, then "· sent …". `call-request-line` keeps its exact text.
  - the actions "Copy call as curl", "Edit" and "Replay" (primary). The labels are unchanged.
  - chips for the status pill, the state (`call-state`), the duration, the environment (`call-environment`), the saved
    request (`call-saved-request`) and an abbreviated Authorization;
  - the immutability note;
  - two columns. "Request as sent" holds the header table (`call-request-headers`, whose text still reads
    `Name: value` through a visually hidden separator) and the body, or "No body was sent with this request".
    "Response" holds the completed time and `CompletionView` without its own heading.

**Verification (phases 2 and 3)**

```
$ screenshots at 1440×900 of the workspace and an opened call, with seeded calls
  context/changes/workspace-shell/shot-workspace.png   compared with pyg23.png
  context/changes/workspace-shell/shot-call.png        compared with aJeTB.png
$ npm run typecheck → 0 errors
$ npm run lint      → All matched files use the correct format.
$ npx playwright test
  60 passed (51.0s)
```

Phase 1's long-history replay failure did not recur. The run took 51 s, against 3.9 minutes under load.

**Differences from the design, kept:**
- No traffic lights; the title bar is a page header (ADR 0002).
- No Templates tab (M2).
- No sidebar search or filters (slice 9).
- No responses strip (slice 7).
- No Delete button (slice 8).
- The request body is a plain textarea, not a numbered editor. Monaco is read-only here, and an editable Monaco is
  outside this slice.
- A saved-request bar above the request bar. The design does not place saving.
- "Replay", not "Resend exactly". The journeys select by the current name.
- "Back to the request" and "Back to the call" are added.
- The sent time sits on its own line, starting "· sent".
- The environment select shows `name — baseUrl` as text, not the design's chip with a coloured dot.

**Drift:**
- decision: phases 2 and 3 were verified together and committed as one commit. Phase 3's source was written while
  phase 2's e2e run was in progress.

## Code-review fixes: /code-review findings 1–10

- **Executor:** lz-e2e (findings 1, 3, 4 and 8); lz-build (the rest)
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- 1: `environments-error` renders under the title bar, outside the editor. A failed choice made in the title-bar select
  now shows with the editor closed.
- 2: `showRequest` triggers a `useLayoutEffect` that scrolls after the view change commits. Before, it scrolled a
  `display:none` workspace.
- 3: when opening or deleting a saved request fails, the view switches to the workspace, where the saved bar shows the
  error.
- 4: the body type is a `group` of `aria-pressed` buttons (`data-type`), not radios. An arrow key no longer changes the
  type or throws the body away. `e2e/support.ts` has `bodyTypeButton` in place of `bodyTypeRadio`, and `chooseBodyType`
  presses the button.
- 5 and 9: history groups by day across the whole list, in order of first appearance, with today computed once per
  render.
- 6: `outcomeClass` reuses `statusClass`.
- 7: the dead `.sidebar-panel h2 .count` rule and the second `.sidebar-panel` block are removed.
- 8: `CompletionView` is keyed by the completion id, so each call or result opens on Body.
- 10: `statusLabel` gives `418`, not `418 ` with a trailing space, when no reason phrase is known.
- `e2e/shell.spec.ts`: 4 new scenarios, one each for findings 1, 3, 4 and 8.

**Verification**

```
$ npx playwright test e2e/shell.spec.ts          # before the fixes
  ✘ the request opens on Body… / arrow keys… / each call opened…   (no body-type buttons yet)
  ✘ a failed environment choice is shown…        (environments-error not visible)
  ✘ a saved request that cannot be opened…       (saved-requests-error not visible)
  5 failed, 4 passed
$ npx playwright test e2e/shell.spec.ts --repeat-each=3
  27 passed (8.1s)
$ npx playwright test
  64 passed (50.5s)
$ npm run typecheck → 0 errors · npm run lint → clean · npm run test:unit → 371 passed
```

The first red run of findings 4 and 8 failed because the button control did not exist yet. That is a different reason
from the defect itself. The defect, arrow keys changing the type, comes from the radio element and was not reproduced
on its own.

**Drift:** none. Each fix is the one its finding names.

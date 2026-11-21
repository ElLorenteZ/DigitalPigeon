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

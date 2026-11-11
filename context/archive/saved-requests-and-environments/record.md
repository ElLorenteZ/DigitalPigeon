---
change_id: saved-requests-and-environments
title: Save and edit requests, and send them to the active environment's baseUrl
produced-by: lz-archive
archived: 2026-11-11
change-opened: 2026-11-10
ticket: null
verdict: merge-with-fixes
outcome: shipped
milestone: M1, slice 5 (roadmap.md)
branch: saved-requests-and-environments, uncommitted at archive time
raw: raw/
---

## 1. What was built

Environments (`name`, `baseUrl`) and saved requests (`name`, the form's content) as two mutable collections beside the
insert-only call collections. One URL rule for every request: a URL starting with `/` joins the `baseUrl` of the
environment the send names; a full URL is sent as typed. Main composes the URL (`src/core/url.ts`), loads the
environment by id (`resolveEnvironment`), and records the composed URL, an environment snapshot (`id`, `name`,
`baseUrl`, only when the URL was a path) and the saved request's id. Replay copies both; Edit unlinks and restores the
path. Saved requests keep body text and file bytes, inline to 1 MiB in total, then in the `bodies` bucket. The app has
an Environment select, an Environments editor, a Save / Save as new / New bar, a saved-request list with Delete, and
the call panel names the environment and the saved request. The preload API went from eight to sixteen functions.

**Differs from the plan:**
- The deleted-environment refusal lives in `resolveEnvironment`, called by the send handler, not in `sendAndRecord`.
- The round-trip check compares forms, not wire requests: a multipart form without a boundary gets a new one per build.
- A send naming a deleted saved request goes out without the link (review R2, decided in phase 4).
- Save as new is disabled while the form is unlinked; Save already creates a new entry then.
- Labels say "base address", not "base URL": `getByLabel('URL')` matched them.
- A path with `.` or `..` segments (including `%2e`) is refused; the plan did not name it (second code review, R2).
- Save is disabled while a save is in flight; environment choices are stored in order, each failure shown on its own.

## 2. Why this approach

The call path stays insert-only and records what went on the wire. Saved requests and environments never touch `sends`
or `completions`; a call links to them through an id and a snapshot written once, so editing or deleting an
environment never changes what an old call means. The send carries the environment id the select shows because IPC
handlers in main run concurrently: reading the stored active setting at send time lets a send right after a switch go
to the old host. The stored setting only picks the select's value at startup. Main never takes a `baseUrl` from the
renderer.

## 3. What was rejected

- **The environment replaces scheme, host and port of a full URL** — no path in the form; harder to see where a request goes. Author chose "Path joins baseUrl".
- **Environments only for saved requests** — two URL rules. Author chose one rule for typed and saved requests.
- **The renderer composes the URL and sends it with a snapshot** — the record would hold what the renderer claimed.
- **Main reads the stored active environment at send time** — races a switch (plan review B1); a scenario holding the switch's save proved it.
- **Recording only the environment id** — an edit to the environment would change old records.
- **Saved file parts without bytes, re-picked before send** — the saved request could not be sent as-is. Author: "Keep the file bytes".
- **Saved files shared with call files by reference** — needs reference counting; slice 3a rejected the same.
- **Saved requests as versions** — the PRD asks to edit; history of a saved request is not a requirement.
- **Active environment in renderer state or browser storage** — lost on restart; main cannot read it.
- **Edit of a call keeping its saved-request link** — Save would overwrite the saved request with an old call. Author: "No, unlinked".
- **Edit loading the composed URL** — a saved request made from it would be pinned to one host. Author: "Restore the path".
- **Refusing duplicate names** — author allowed them; entries are told apart by method and URL, or `baseUrl`.
- **Deletion deferred to slice 7** — test entries would stay for the rest of M1. Author: "Delete one at a time".
- **Out of scope:** history filters (slice 6), cleaning files left by save-over or delete (slice 7), directories and tags (ADR 0001), variables other than `baseUrl`, auth per environment, import and export, search.

## 4. Surprises

- **A scenario could not detect the regression it was named for.** With main reading the stored setting, the switch-and-send scenario passed 5 of 5: the save landed first. Holding the save in main made it deterministic.
- **State captured before an `await`, applied after it — four more times:** "Add environment" cleared fields typed during its save; a Save linked a form replaced by New (CR1); a slow open overwrote typing (CR2); quick environment choices stored the older one (CR5). Six instances across two changes.
- **The test helper had the same defect:** `holdFirstAnswer` set its release gate after an `await`, so `release()` could be a no-op. CR1 and CR2 scenarios were re-proved by mutation after the fix.
- **A rename recorded as done had not run.** macOS `sed -E` ignores `\b`; nothing matched, gates stayed green. The second `/code-review` found the old names. A rename's evidence is `grep` for the old name.
- **A 17 MiB `toEqual` crashed the Vitest worker (SIGABRT)** — second incident after slice 4. Large values are compared by length and SHA-256.
- **Second `/code-review` pass found a path escape:** `/../x` left the `baseUrl`'s path while recording the environment.

## 5. What still stands

- **Files left in GridFS** when a saved request is saved over or deleted (R7, accepted); slice 7 finds them.
- **The 1 MiB inline budget counts body text and file bytes only**, not rows or field values; a field over 16 MB fails the save and leaves files (CR6, accepted).
- **Replay keeps a deleted saved request's link** (CR3, accepted) so slice 6's filter finds replays; the panel says "deleted".
- **A saved request opens in one IPC answer**; tested at 17 MiB, not larger.
- **R10 (stale list error) is fixed without a test**: it needs a database reconnect.
- **The second `/code-review` pass's fixes have not had a third review.**
- **Fragile tests:** `e2e/saved-requests.spec.ts` and `e2e/environments.spec.ts` use Electron's private `ipcMain._invokeHandlers`; an Electron upgrade fails them at setup. The B1 scenario replaces `setActiveEnvironment` for the launch and must stay last; so must the overlap scenario in its file.
- **If a path goes to the wrong host**, check the `environmentId` the renderer sends, then `resolveEnvironment` in `src/core/environment-store.ts`, then `composeUrl` and `hasDotSegment` in `src/core/url.ts`.
- **If the form shows the wrong saved request or loses typing**, check `formIdentity`, `latestSavedOpen`, `endPendingEdit` and `saving` in `src/renderer/app.tsx`.
- **If Edit loads a full URL where a path was expected**, check `pathFor` and that `formFromCall` receives the call's environment.

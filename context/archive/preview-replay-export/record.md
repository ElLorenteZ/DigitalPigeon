---
change_id: preview-replay-export
title: Open a past call, replay it exactly or edit and resend it, and export a request as curl
produced-by: lz-archive
archived: 2026-11-06
change-opened: 2026-11-05
ticket: null
verdict: merge-with-fixes
outcome: shipped
milestone: M1, slice 2 (roadmap.md)
branch: preview-replay-export, commit 1846ce8, stacked on unmerged send-and-record; not pushed
raw: raw/
---

# Record: preview, replay, export

## 1. What was built

A history row opens the call: request as sent, response, timing. From the panel, **Replay** sends the
recorded header list as a new call, **Edit** loads the form, and **Copy call as curl** exports it. The form
has its own **Copy as curl**. Originals are never changed (T1.1). Bodiless requests only.

- **Core:** `getCall`, `replayCall` and `sendWireAndRecord` in `src/core/`, plus two pure mappings,
  `form-from-call.ts` and `curl.ts`, which the renderer imports.
- **Slice 1's send path changed:** `wire.ts` refuses what undici would refuse before anything is recorded,
  and trims values of space and tab. A new `invalid-request` code covers what is still refused later.
- **Tests:** unit 130, integration 112, e2e 12.

**Differs from the plan:**
- A phase was added before planning finished: the non-ASCII spike disproved its prediction, which turned
  header refusal into phase 1.
- The panel placement in the plan was a defect. It opened below the fold and looked like a dead click.
  Replay, Cancel and Edit had the same problem. Fixed with scrolling and viewport tests (F7, R5).
- Phase 1 claimed to refuse everything undici rejects. Code review found it did not (R2–R4). The refused
  names and the rule for the recorded `Connection` value were added after review.
- Replay of a call with an unreadable completion is refused although its request is known (decision).
- `toCurl` refuses anything `wire.ts` would refuse, not only non-ASCII (decision).

## 2. Why this approach

**Replay sends the recorded list, not one rebuilt through `wire.ts`.** The record is the claim about what
was sent. Rebuilding would apply today's rules to yesterday's request, so an undici upgrade would change
what "exact replay" means.

**Refuse before recording, so each new record means one set of bytes.** undici rejects or re-encodes values
that curl sends differently. Refusing them up front keeps the record, the replay and the curl export in
agreement, and leaves no send document for a request that never went out.

**`formFromCall` hides managed headers equal to what `wire.ts` generates.** Edit shows what the user typed.
Changing the URL or method then recomputes them.

**T2.4 runs curl for real.** Globbing, `-H 'Name: '` removing a header and curl's own default headers are
invisible in a string assertion.

## 3. What was rejected

- **Replay rebuilt through `wire.ts`** — recomputes managed headers with today's rules (see §2).
- **Opening a call by filtering `listCalls` with bodies** — loads up to 200 bodies to show one; slice 1
  review #9 removed that cost.
- **Allowing U+0080–U+00FF as latin1** — curl export would need raw latin1 bytes, which POSIX `sh` single
  quotes cannot express. Author chose to refuse all non-ASCII.
- **Percent-encoding non-ASCII values** — the server would receive something other than what was typed.
- **Recording refused input as `invalid-request`, refusing only non-ASCII up front** — leaves a record of a
  request that never went out. Kept as the fallback only.
- **Keeping surrounding whitespace in values** — the record would differ from what a server reads, and curl
  drops a whitespace-only value.
- **Exact header order and case in the curl promise** — curl places `Host` itself. The promise is the same
  names and values, including duplicates.
- **Curl export tested on the string at unit level** — see §2.
- **All recorded headers as editable rows** — invites edits `wire.ts` recomputes anyway.
- **Clipboard through a new main-process IPC call** — another preload function for something the renderer
  can do; the selectable `<pre>` is the fallback.
- **A separate change for header validation** — replay and curl depend on it, and nothing had started.
- **Recording which call a replay came from** — the PRD asks for a link to a source saved request only.
- **Refreshing an open in-flight panel (R9); reading only the send document on replay (R10)** — accepted.
  Clicking the row refreshes; the cost applies to large bodies, and slice 3 can revisit it.

## 4. Surprises

- **Prediction wrong:** undici does not send non-ASCII values as UTF-8. It rejects above U+00FF and sends
  U+0080–U+00FF as single latin1 bytes.
- **undici refuses by name, and ignores a valid `Connection`.** `Connection: Upgrade` was accepted and
  `keep-alive` went out, so records were false. The phase 1 probe tried characters, never specific names.
  `processHeader` in undici's `core/request.js` holds the rules.
- **undici moves `connection` to second place** whatever position it is given. A test named for this passed
  under a mutation it should have caught, because a rebuild kept `connection: close`.
- **The curl spike hung:** `execFileSync` blocked the event loop hosting the capture server.
- **The spike's "holds" was narrower than the request shapes.** Plan review found `?filter[a]=1` fails and
  `?a={1,2}` sends two requests without `--globoff`.
- **Presence checks passed for what the user could not see.** Scripted observations found the panel below
  the fold, and a first viewport test with 8 rows passed with no fix, because Playwright centres the row it
  clicks. 30 rows were needed.
- **"Nothing happens" had two causes:** an `.app` process from three days earlier, which `open` only
  brought forward, and the off-screen panel.
- **A URL's user and password:** undici sends no `Authorization` header; curl adds one.

## 5. What still stands

**Load-bearing**
- `src/core/wire.ts` holds a copy of undici 8.12.3's rules, and `undici` is pinned exactly. After an upgrade
  run `npm run test:integration`. No test fails if undici adds a refusal, so read `processHeader` too; such
  a request records `invalid-request`.
- `curl.ts` holds for curl 8.7.1 on macOS and POSIX `sh`. Each flag is there for a tested reason (top of the
  file).

**Accepted weaknesses**
- An API that needs a non-ASCII header value cannot be called from the app.
- Old records keep what they hold. Replay sends them as recorded. Curl refuses non-ASCII ones. One holding a
  typed `Connection` such as `Upgrade` exports that literal value, which differs from what undici sent.
- A call with an unreadable completion cannot be replayed (R10). A panel opened in flight goes stale (R9).
- The renderer has no unit layer, so T2.9 and T2.10 are e2e, and T2.9 covers named actions only.

**Not verified**
- Packaged `.app`: Copy call as curl has direct evidence. Open and Replay rest on the author's "ok, continue".
  The scroll and review fixes were not tried there.
- The fixes for R1–R8 have not had a second `/code-review`.
- A real 30 s timeout on replay, and an out-of-date open that fails.

**If something breaks**
- A record disagrees with the wire: `wire.ts`, then the T1.3 cases in `send.int.test.ts`.
- A click seems to do nothing: check the scroll regions in `app.tsx`, and for an old `.app` process.

---
change_id: preview-replay-export
status: draft
produced-by: lz-plan
created: 2026-11-05
updated: 2026-11-06
inputs: [change.md, spike-curl-export.md, spike-non-ascii-headers.md, plan review 2026-11-06, foundation/prd.md, foundation/test-strategy.md, foundation/roadmap.md, foundation/lessons.md, foundation/tech-stack.md, archive/send-and-record/record.md]
---

# Plan: Open a past call, replay it exactly or edit and resend it, and export a request as curl

## Approach

Everything that decides correctness lives in the Electron-free core (`src/core/`), as in slice 1,
and is tested against the Compose MongoDB and the capture server.

**First, every new record gets one exact byte meaning, and nothing undici refuses is recorded as
sent.** undici 8.12.3 rejects header values above U+00FF and sends U+0080–U+00FF as single latin1
bytes, while curl sends UTF-8 (`spike-non-ascii-headers.md`). It also rejects, with nothing on the
wire, values containing LF, CR, NUL or DEL, and names that are empty or contain a space, a colon or a
non-ASCII character (plan review probe, 2026-11-06). `buildWireRequest` therefore refuses all of
these with `InvalidHeaderError` before anything is recorded, and the form shows it as invalid input.
Refusing non-ASCII values is the author's decision; extending the same check to the other input
undici rejects follows from the plan review. Tab inside a value and an empty value are sent fine and
are not refused.

`buildWireRequest` also trims leading and trailing whitespace from each value. HTTP does not treat it
as part of the value: the capture server read `  a  ` as `a` from both undici and curl (revision
probe, 2026-11-06), so a record keeping it would differ from what a server reads.

This changes slice 1's send path; replay and curl export both depend on it. Anything undici still
refuses after a send document is written, such as replaying an old record, is recorded with a new
error code, `invalid-request`, not `network`.

The core then gains three things:
- **`getCall(sendId)`** reads one call with its bodies. History rows stay body-less (slice 1
  review #9).
- **Replay.** `sendAndRecord` is split into `buildWireRequest` plus a `sendWireAndRecord(store,
  wire, options)` that both paths use. Exact replay loads the recorded send document and passes
  its `request` (method, URL, header list) to `sendWireAndRecord` unchanged. A new send document
  and completion are written; the original is untouched.
- **Two pure mappings:**
  - `formFromCall(send)` turns a recorded request into form input for edit-and-send
  - `toCurl(request)` turns a recorded or form request into a shell command

Replay sends the **recorded** header list, not one rebuilt through `wire.ts`. The recorded list
is already in the form undici writes, so it reproduces what was recorded even if `wire.ts`
changes later, for example after an undici upgrade.

Edit-and-send loads the recorded URL, which already includes its query, into the URL field.
Header rows come from the recorded headers, with the managed ones (`host`, `connection`,
`content-length`) left out when they equal what `wire.ts` would generate. They are kept as rows
when they differ, such as a typed `Host` or `Connection: close` on a non-`HEAD` request (author
decision, this session). Sending goes through the existing path, so it is a new call.

**curl export** produces `curl --http1.1 -sS --globoff -X <METHOD> '<url>'`, or `--head` for `HEAD`,
then:
- `-H 'User-Agent:' -H 'Accept:'` to suppress curl's own headers
- one `-H` per recorded header, in recorded order, written `-H 'Name;'` when the value is empty,
  because curl treats `-H 'Name: '` as removing the header

`--globoff` is required: without it `?filter[a]=1` fails with a curl error and `?a={1,2}` sends two
requests (plan review probe).

Every argument is single-quoted, with `'` written as `'\''`. "Same headers" means the same names
and values, including duplicates, and nothing else; order may differ (author decision, this session). T2.4 is proven at
the integration layer: the exported string is run with `sh -c` and the system curl against the
capture server, and what arrives is compared with the recorded request (author decision, this
session; moves T2.4 from unit).

The app gets IPC `getCall` and `replay`, and the renderer gets a call detail panel opened from a
history row. It has three actions:
- **Replay**, which sends at once
- **Edit**, which loads the form
- **Copy as curl**, through `navigator.clipboard.writeText`, with the command also shown in a
  selectable `<pre>`

Curl export of the current form request uses the same `toCurl` on the request `wire.ts` builds.

Records made before this change can still hold non-ASCII header values:
- **Replay** sends them as recorded, so a U+0080–U+00FF value keeps its latin1 bytes, and a value
  above U+00FF records `invalid-request`.
- **Copy as curl** refuses a non-ASCII record and shows why, because curl would send different
  bytes.
- **Edit** loads them, and Send refuses them until the value is changed.

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Replay by rebuilding the request through `wire.ts` from the recorded header rows | Recomputes managed headers with today's rules; after any `wire.ts` change (an undici upgrade) the replay would no longer send what was recorded. |
| Open a call by filtering `listCalls({ includeBodies: true })` | Loads up to 200 bodies to show one; slice 1 review #9 removed exactly that cost. |
| curl export matching header order and case exactly | Author chose "same set, curl extras removed"; curl places `Host` itself, so exact order is not promised. |
| curl export verified by unit tests on the string | Author chose integration: only running curl shows what curl sends, including quoting through a real shell. |
| Show every recorded header (including `host`, `connection`, `content-length`) as editable rows | Author chose hiding them when they equal the generated value; editing them as rows invites edits that `wire.ts` recomputes anyway. |
| Allow U+0080–U+00FF as latin1, reject only above | Author chose rejecting all non-ASCII. Curl export would have to emit raw latin1 bytes, which POSIX `sh` single quotes cannot express (`$'\xe9'` needs bash or zsh). |
| Encode non-ASCII values (for example percent-encoding) | The server would receive something other than what was typed, which conflicts with "request as sent". |
| A separate change for header validation before this slice | Author chose the first phase of this change: replay and curl both depend on it, and nothing has started. |
| Record rejected control characters and bad names as `invalid-request`, refusing only non-ASCII up front | Leaves a send document for a request that never went out, which is the defect phase 1 exists to remove (plan review). `invalid-request` stays only as the fallback. |
| Keep leading and trailing whitespace in recorded values | The record would differ from what a server reads, and curl drops a whitespace-only value entirely (revision probe). |
| Copy to clipboard through a new main-process IPC call | Adds another preload function for something the renderer can do; the selectable `<pre>` is the fallback if the renderer clipboard fails (A4). |
| Record which call a replay came from | Out of scope in `change.md`; the PRD requires a link to a source saved request only. |

## Out of scope

- Updating `test-strategy.md` for T2.4's move to integration, and `AGENTS.md` for any new check or
  the non-ASCII rule. Their producers do it after this change (`/lz-test-strategy`, `/lz-onboard`).
- Sending non-ASCII header values at all. An API that needs a latin1 header cannot be called from
  the app (accepted by the author, this session). Revisit if that becomes a real need.
- Rewriting or migrating existing records that hold non-ASCII values. Records are immutable.
- Request bodies in replay or curl (`--data-binary`). Requests have no body until slice 3.
- A curl export for an interrupted or unreadable call: those have a recorded request, so the
  export works for any call with a readable send document. Unreadable rows offer no actions.
- Shells other than POSIX `sh` (Windows `cmd` / PowerShell quoting). The work-laptop target is
  deferred.
- Keyboard shortcuts, persisting the selected call across restarts.

## Assumptions

| # | Assumption | If wrong | Load-bearing? |
|---|---|---|---|
| A1 | Passing a recorded header list (wire-contract form) back to `undici.request` reproduces it exactly, for all seven methods. | Replay records a request that differs from the original; phase 2 stalls. | yes — supported: T1.3 already proves contract-form lists go out unchanged for all seven methods (`src/core/send.int.test.ts`). Phase 2's replay test confirms it for replays. |
| A2 | curl 8.7.1 with `--http1.1 --globoff`, `-H 'User-Agent:' -H 'Accept:'`, `-H` for `host`, `connection`, the user's headers (`-H 'Name;'` for an empty value) and `content-length: 0`, sends exactly those names and values and nothing else, and `--head` sends `HEAD` with the same headers. | The export cannot promise "same headers"; phase 4 changes. | yes — **verified 2026-11-05 and 2026-11-06** (`spike-curl-export.md`, plan review and revision probes): all seven methods; bracket and brace URLs send one request as written; `Name;` sends an empty value; a typed `User-Agent` or `Accept` is sent once; duplicate names are both sent. curl writes the name `Host` capitalised. |
| A3 | `sh -c` with single-quoted arguments and `'\''` passes header values containing spaces, `"`, `'`, `$` and `\` unchanged to curl. | Some values are mangled in a terminal; phase 4's quoting changes. | no — shown in `spike-curl-export.md`; phase 4's test covers it |
| A4 | `navigator.clipboard.writeText` works in the sandboxed `file://` renderer under the production CSP. | Copy fails; the command is still selectable in the `<pre>`. | no |
| A5 | `curl` is on `PATH` where integration tests run. | Phase 4's tests cannot run. | no — verified: curl 8.7.1 on this machine; tests run locally only |
| A6 | undici 8.12.3 rejects, with `UND_ERR_INVALID_ARG` and nothing on the wire, values containing LF, CR, NUL or DEL and names that are empty or contain a space, a colon or a non-ASCII character; it sends tab inside a value, empty values and duplicate names. | The check in phase 1 refuses too much or too little; phase 1's tests show which. | no — **verified 2026-11-06** (plan review probe) |
| A7 | Refusing non-ASCII values removes the need to know undici's behaviour under Electron's Node 24. The spike ran on Node 22.22.2 only. | None for new sends. Replay of an old non-ASCII record could differ; recorded as a completion either way. | no |

A1 and A2 are settled: no load-bearing assumption is unverified. The two spikes also changed the
plan: the latin1 result added phase 1, and the curl spike added two requirements to phase 4 (run
curl asynchronously; expect `Host` capitalised). The plan review's probe added `--globoff` and the
empty-value form.

## Phases

| # | Goal | Touches | Executor | Verified by |
|---|---|---|---|---|
| 1 | A header undici would refuse is refused before anything is recorded, values are trimmed, and anything undici still rejects is recorded as `invalid-request` | `src/core/wire.ts`, `src/core/send.ts`, `src/core/call-schema.ts`, `src/main/ipc.ts`, tests beside them | lz-tdd | `npm run test:unit`, `npm run test:integration` |
| 2 | A past call can be read in full and replayed exactly as a new call, leaving the original unchanged | `src/core/call-store.ts`, `src/core/send.ts`, tests beside them | lz-tdd | `npm run test:integration` (getCall, T1.3 replay half, T1.1) |
| 3 | A recorded request turns into form input that, sent again, reproduces the request; editing it creates a new call | `src/core/form-from-call.ts`, tests beside it | lz-tdd | `npm run test:unit`, `npm run test:integration` |
| 4 | A curl command exported from a recorded request sends the same method, URL and headers when run in a shell | `src/core/curl.ts`, `src/core/curl.int.test.ts` | lz-tdd | `npm run test:integration` (T2.4) |
| 5 | In the app, a history row opens the call; Replay, Edit and Copy as curl work from it | `src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/preload.ts`, `src/renderer/app.tsx` | lz-build | `npm run typecheck`, `npm run lint`; scripted observation against the built app |
| 6 | The journey send → open → replay → a new row, with the original unchanged, holds in the built app | `e2e/replay.spec.ts` | lz-e2e | `npm run test:e2e` |

### Phase 1 — A header undici would refuse is refused before anything is recorded

**Changes:**
- `src/core/wire.ts`: `InvalidHeaderError` (naming the header). `buildWireRequest` throws it for any
  header row whose value contains a non-ASCII character, LF, CR, NUL or DEL, or whose name is empty
  or is not an HTTP token. This includes a typed `Host` or `Connection`. Values are trimmed of
  leading and trailing whitespace before they are checked and recorded.
- `src/core/send.ts`: `classifySendError` maps `UND_ERR_INVALID_ARG` to `invalid-request`.
- `src/core/call-schema.ts`: `invalid-request` added to the error code enum of both completion
  schemas. `schemaVersion` stays 1: the change only adds a value, so existing documents still parse.
- `src/main/ipc.ts`: `InvalidHeaderError` becomes the `invalid-input` result, which the renderer
  already shows as "Not sent: …". Reached through `sendAndRecord`, so no new IPC channel.
- Unit tests:
  - `buildWireRequest` refuses `zażółć`, `🐦`, `café`, values with LF, CRLF, NUL and DEL, and names
    `X A`, `X:A`, `Xż` and empty
  - it accepts printable ASCII, a tab inside a value, an empty value and duplicate names
  - it trims `  a  ` to `a`, and a whitespace-only value to empty
  - a call schema parses `invalid-request`; `classifySendError` maps `UND_ERR_INVALID_ARG`
- Integration tests:
  - T1.2: sending a refused header rejects with `InvalidHeaderError`; no send document exists
    afterwards and the capture server received nothing
  - T1.3: an empty value, a tab inside a value, duplicate names and a padded value each reach the
    capture server as recorded (a list comparison, so a lost duplicate fails)

**Verification:**
```
$ npm run test:unit && npm run test:integration
expected: exit 0; new wire, send and schema tests listed and passing
```

**Done when:** both pass. Three mutations must each fail a test:
- removing the check from `buildWireRequest`
- running the check after the send document is inserted
- removing the trim

**Executor:** lz-tdd.

### Phase 2 — A past call can be read in full and replayed exactly

**Changes:**
- `src/core/call-store.ts`: `getCall(sendId, inFlight)` returns the call with full bodies
  (`completed`, `in-flight`, `interrupted`, or `unreadable`); `null` for an unknown id. In-flight
  rows can be opened, so it takes the same set as `listCalls`.
- `src/core/call-store.int.test.ts:191`: the test pinning the store's keys gains `getCall` and still
  asserts that no update or delete exists.
- `src/core/send.ts`: extract `sendWireAndRecord(store, wire, options)` from `sendAndRecord`
  (no behaviour change; existing tests are the net). Add `replayCall(store, sendId, options)`:
  loads the send document and calls `sendWireAndRecord` with its `request` minus `body`. It
  rejects for an unknown or unreadable call.
- Integration tests:
  - `getCall` returns bodies, `in-flight` when the id is in the set, and `null` for an unknown id
  - T1.3 replay half: for each of the seven methods, a replay's send document equals the
    original's request, and what the capture server received for the replay equals what it
    received for the original
  - T1.1: after a replay, `getCall(original)` is deep-equal to before; there are two distinct
    send documents
  - replay of an unreadable call rejects
  - replay of a seeded old record holding `zażółć` records an `invalid-request` completion, and the
    capture server received nothing
  - replay of a seeded old record holding `café` sends the same bytes as undici sends for it (`e9`)

**Verification:**
```
$ npm run test:integration
expected: exit 0; getCall and replay tests listed and passing
```

**Done when:** tests pass. Two mutations must each fail a test:
- replaying through `buildWireRequest` with recomputed headers
- inserting the replay as an update of the original

**Executor:** lz-tdd.

### Phase 3 — A recorded request turns into form input; editing creates a new call

**Changes:**
- `src/core/form-from-call.ts`: `formFromCall(request)` returns `{ method, url, queryRows: [],
  headerRows }`. Header rows omit `host` when it equals the URL host, `connection` when it is
  `keep-alive` (or `close` for `HEAD`), and `content-length` when it is the value `wire.ts` adds.
  All other headers are kept, in order.
- Unit tests:
  - round trip: `buildWireRequest(formFromCall(r))` equals `r` for requests built by `wire.ts`
  - a typed `Host` and `Connection: close` survive as rows
- Integration test (T1.1 edit half): load a recorded call, change a header value, send. The new
  call has the changed header; `getCall(original)` is unchanged.

**Verification:**
```
$ npm run test:unit && npm run test:integration
expected: exit 0
```

**Done when:** both pass. Dropping a kept header (for example a typed `Host`) fails the round-trip
test.

**Executor:** lz-tdd.

### Phase 4 — A curl export sends the same method, URL and headers

**Changes:**
- `src/core/curl.ts`: `toCurl(request)` per Approach, with the verified flags (`--globoff`, `Name;`
  for an empty value, including an old record's whitespace-only value). It throws `InvalidHeaderError` for a request holding a non-ASCII header
  value, because curl would send UTF-8 where undici sent latin1.
- `src/core/curl.int.test.ts`:
  - For each of the seven methods, `sh -c "<toCurl(request)>"` against the capture server. The
    received method and URL equal the recorded ones; the received header names and values, compared
    as sorted lists with names lowercased (curl writes `Host` capitalised), equal the recorded ones.
  - A URL with `?filter[a]=1&b={1,2}` sends exactly one request with that URL.
  - An empty value, a duplicate name, and a typed `User-Agent` and `Accept` arrive as recorded.
  - Header values containing spaces, `"`, `'`, `$` and `\` arrive unchanged (A3).
  - curl runs through asynchronous `execFile`. A synchronous call blocks the event loop hosting the
    capture server and hangs (`spike-curl-export.md`).
  - `toCurl` refuses a request holding `café`.

**Verification:**
```
$ npm run test:integration
expected: exit 0; curl tests listed and passing
```

**Done when:** tests pass. Each of these changes must fail a test: removing `-H 'User-Agent:'`,
removing `--globoff`, writing an empty value as `-H 'Name: '`, quoting without `'\''`.

**Executor:** lz-tdd.

### Phase 5 — A history row opens the call; Replay, Edit and Copy as curl work

**Changes:**
- `src/shared/ipc-contract.ts`: `getCall(sendId)` → full call view or not found; `replay({
  clientRequestId, sendId })` → `SendResult`. Bodies stay `Uint8Array`.
- `src/main/ipc.ts`: handlers for both. Replay uses the same `AbortController`, in-flight and
  not-recorded handling as `send`.
- `src/preload.ts`: `getCall` and `replay` added (six named functions).
- `src/renderer/app.tsx`:
  - history rows are buttons that open a call detail panel showing the request as sent (method,
    URL, headers in order), status, response headers, body as text, duration and timestamps
  - the panel has **Replay**, **Edit** (fills the form with `formFromCall`) and **Copy as curl**
    (clipboard, plus a selectable `<pre>`)
  - `RequestForm` owns its fields today (`src/renderer/app.tsx:187-190`); they move up to `App` so
    Edit and the form's Copy as curl can reach them
  - Replay is disabled unless status is `up` and while a send is in flight; a replay in flight shows
    Cancel like a send does
  - the form gets a **Copy as curl** for the request currently in it
  - **Copy as curl** shows the reason when `toCurl` or `buildWireRequest` refuses a non-ASCII value
  - unreadable rows open nothing
  - `outcome` shows the `invalid-request` code like any other error

**Verification:**
```
$ npm run typecheck && npm run lint
expected: exit 0
$ scripted observation against the built app (throwaway Playwright script, deleted afterwards),
  dp_test_ database, capture server:
observe: open a history row → request headers in recorded order, response body shown
observe: Replay → a new row appears, the opened call's panel is unchanged
observe: Edit → form filled; change a header; Send → new row with the changed header
observe: Copy as curl → the <pre> holds the command; running it reaches the capture server
observe: type a header value with `ż`; Send → "Not sent: …" naming the header, no new history row
observe: open an in-flight row → it shows in flight, not interrupted
$ grep -c 'MongoClient' / 'undici' in .vite/build/preload.cjs and the renderer bundle
expected: 0 — the renderer now imports src/core/wire.ts and the new pure modules
```

**Done when:** all observations hold and are recorded with output.

**Executor:** lz-build.

### Phase 6 — The replay journey holds in the built app

**Changes:**
- `e2e/replay.spec.ts` (T2.7 replay half):
  1. Through `launchWithTestDatabase()`, send to the capture server and open the history row.
  2. Press Replay; expect two history rows and the capture server to have received two identical
     requests.
  3. Reopen the original; expect its details unchanged.

**Verification:**
```
$ npm run test:e2e
expected: all specs pass; 3 clean runs; no dp_test_ database remains
```

**Done when:** the spec passes three times, and fails when the Replay handler re-fetches nothing.

**Executor:** lz-e2e.

## Risks

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| A valid request is refused because its header value is non-ASCII | low | That API cannot be called from the app | Accepted by the author; the message names the header |
| A typed value's surrounding whitespace was meaningful to a server | very low | The server would not have seen it anyway: the capture server read the value trimmed from both clients | Trim recorded in Approach |
| A curl upgrade changes what its flags send | low | Export promise weakened | Phase 4 compares sets against the capture server on every integration run |
| Extracting `sendWireAndRecord` changes slice 1 behaviour | low | T1.x regressions | Pure extraction with the existing integration tests as the net |
| A replay of an old call fails because the recorded host is gone | expected | Error completion recorded | Same as any send: recorded as `network` |
| Copy fails in the sandboxed renderer (A4) | low | User copies from the `<pre>` | Fallback built in |

## For the reviewer

- **Weakest link:** phase 1 changes slice 1's send path inside a slice 2 change. Check that the
  check runs before the send document is inserted, and that `invalid-request` belongs in
  `schemaVersion: 1` as an added value.
- Two plan decisions the author has not separately confirmed, both following from the review:
  extending the refusal from non-ASCII values to everything undici rejects, and trimming values.
- The capture server uses Node's parser, which trims and decodes as latin1, so it cannot show
  whether undici wrote the surrounding whitespace. Trimming in `wire.ts` makes that question moot
  for new records.
- Records made before this change: replay sends them as recorded, curl refuses them. Check that
  this is the right split.
- T2.4 moves from unit to integration, which differs from `test-strategy.md`. Check that this is
  the one layer for it, and that the strategy update is assigned (Out of scope).
- The replay sends the recorded list rather than rebuilding it. Check that this is the right
  reading of "exact replay" when `wire.ts` and the recording disagree, for example after an
  undici upgrade.

## References

- `context/archive/send-and-record/record.md` §1, §5 — wire contract, body-less history, insert-only
  store.
- `context/foundation/lessons.md` (2026-11-03, 2026-11-04) — probe new request shapes; compare the
  whole record with the wire.
- `context/foundation/test-strategy.md` — T1.1, T1.3, T2.4, T2.7.
- Plan review, 2026-11-06, and revision probe (undici 8.12.3, curl 8.7.1, capture server): curl
  globbing and `--globoff`; `-H 'Name: '` removes a header, `-H 'Name;'` sends it empty; undici's
  rejected names and values; whitespace trimmed as read by Node's parser. All findings addressed in
  this revision.
- `spike-curl-export.md` — A2 and A3 hold; curl must run asynchronously in tests.
- `spike-non-ascii-headers.md` — undici rejects above U+00FF, sends U+0080–U+00FF as latin1.
- `src/core/wire.ts:21` — `buildWireRequest`, gains the check.
- `src/core/send.ts:132` — `classifySendError`.
- `src/main/ipc.ts:88` — the `send` handler and its `invalid-input` result.
- `src/core/send.ts:47` — `sendAndRecord`, to be split.
- `src/core/call-store.ts:50` — `listCalls`, which keeps its body-less default.

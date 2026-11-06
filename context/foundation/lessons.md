---
produced-by: lz-lessons
updated: 2026-11-07
standing-rules: 2
---

# Lessons

Standing rules are loaded as priors by framing, planning, review and debugging. They are
capped at 20 deliberately — a long file is a diluted file. The observation log is read on
demand and binds nothing.

## Standing rules

### Probe what undici does before a plan relies on it

- **Rule:** Before a plan relies on what undici writes or refuses for a new request shape, send that shape
  to `test-support/capture-server.ts` and record the result. A claim covering everything undici refuses
  cites undici's source for the version pinned, not a sample of inputs.
- **Because:** undici rewrites, reorders, re-encodes and refuses headers according to their name and value,
  so a request passed to it is not the request sent. A record built on an assumption about this states
  something false about the wire, and records are immutable.
- **Incidents:** send-and-record (2026-11-03: `Host` lowercased, `connection` and `content-length` added,
  `connection: close` forced on `HEAD`), preview-replay-export (2026-11-06: non-ASCII values refused or sent
  as latin1, against a written prediction of UTF-8; `Transfer-Encoding`, `Keep-Alive`, `Upgrade` and `Expect`
  recorded and then refused, and a typed `Connection` recorded but not sent, because phase 1's probe tried
  characters and not names)
- **Promoted:** 2026-11-06
- **Check:** The plan's Assumptions cite a probe or a T1.3 case for every new method, body type or header
  rule. A claim of "everything undici rejects" cites `processHeader` in undici's `core/request.js`.

### List what a spike did not try, and cite it only for what it tried

- **Rule:** A spike record states which inputs and states it did not try. A plan's assumption that cites a spike
  claims only what the spike ran. For a call that can fail, the untried list covers each state the call can be made
  in, such as before, during and after a stream ends.
- **Because:** A spike runs a few cases, and its verdict reads as covering the whole assumption. A plan then builds
  on "holds", and the gap surfaces in plan review or code review, after more depends on it.
- **Incidents:** preview-replay-export (2026-11-06: `spike-curl-export.md` held for one URL and one set of header
  values; `?filter[a]=1` fails and `?a={1,2}` sends two requests without `--globoff`), request-bodies-and-storage
  (2026-11-07: `spike-gridfs-streaming.md` called `abort()` only before a stream ended and the driver refuses it
  afterwards, so a failed `finish()` left its chunks; range reads ran only with chunks present, and a read with them
  removed returns short with no error)
- **Promoted:** 2026-11-07
- **Check:** Each `spike-*.md` has a "Not tried" entry. Each plan assumption citing a spike uses wording the
  spike's output supports, and a phase relying on an untried state has a test for it.

## Observation log

### 2026-11-02 — Commands run in the host shell do not see `.env` values

Two incidents of one class. (1) The scaffold's backup comment in `docker-compose.yml` runs
`mongodump -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD"` from the host. (2) The test-harness
plan's phase 2 check ran `mongosh -u "$MONGO_ROOT_USER"` from the host. Both expand to empty
strings and fail authentication. Plan review caught (2) by running it. The working form reads the
container's own variables: `docker compose exec -T mongo sh -c '… -u "$MONGO_INITDB_ROOT_USERNAME"
…'`. Not promoted to a standing rule: the bar is met, but the fact is already a line in `AGENTS.md`
("Not obvious from the code"), which agents load every turn. A second copy here would duplicate it.
Incident (1) is unfixed at the time of writing.
Source: `context/archive/test-harness/raw/review.md`, Lessons candidates; host code review #1.

### 2026-11-02 — Vitest 5.0.5 with Vite 8.3.5 hides errors thrown from a global-setup file

Any error thrown from a Vitest global-setup file is reported as `TypeError: code.charCodeAt is not
a function` (Vite `extractInlineSourceMap`), and the original message is lost. Reproduced with a
bare `throw new Error(...)`. Workaround: write the message to stderr before throwing
(`fail()` in `test-support/mongo-global-setup.ts`). Single incident; applies to any future global
setup until Vitest or Vite is upgraded. Recheck on upgrade, and remove the workaround and the
`AGENTS.md` line if fixed.
Source: `context/archive/test-harness/raw/progress.md`, Phase 2 drift.

### 2026-11-03 — undici 8.12.3 does not send the headers it is given unchanged

Two occurrences, one change (`send-and-record`), one module (`src/core/wire.ts`), one mechanism.
The plan assumed that headers passed explicitly to `undici.request` go out as given. They do not:
- a plan-review probe showed `Host` lowercased, `connection: keep-alive` added, and
  `content-length: 0` added to a bodiless `POST`
- phase 2 showed `connection: close` forced on `HEAD`

Both were caught only by sending through undici to the capture server. Not promoted: the two are
the same mechanism inside the same change, not two distinct incidents.

Promoted to a standing rule on 2026-11-06, after a distinct incident in `preview-replay-export`.
Source: `context/archive/send-and-record/raw/review.md` Lessons candidates; `raw/progress.md`
phase 2.

### 2026-11-04 — The record-versus-wire comparison was narrower than the record

T1.3 compared only the received path and query with the recorded URL's path and query. A URL with a
`#fragment` and query rows recorded `…/items#top?page=2` while `/items` was sent, and every T1.3 case
passed. Host code review found it. The comparison now checks the full recorded URL (origin plus
received path and query). One incident.

Generalises to every later T1.x comparison: bodies (slice 3) and multipart (slice 4) should compare
everything the record claims, not a projection of it. Distinct from the undici entry above: that
one was caught by the comparison; this one passed it.
Source: `context/archive/send-and-record/raw/review.md` Host code review #1.

### 2026-11-03 — A renderer re-fetch raced a write in the main process

The history list re-fetched the moment Send was pressed, before main had inserted the send
document, so the in-flight row never appeared. Fixed by re-fetching every 500 ms while a send is in
flight. Found by a scripted observation, not by a test. One incident. It would recur wherever the
renderer reads state that main writes asynchronously after an IPC call starts.
Source: `context/archive/send-and-record/raw/progress.md` phase 4 drift.

### 2026-11-06 — A spike's "holds" was narrower than the request shapes

`spike-curl-export.md` recorded that the curl command shape holds, from one URL and one set of header
values. Plan review then found that `?filter[a]=1` fails and `?a={1,2}` sends two requests without
`--globoff`, and that `-H 'Name: '` removes a header. Same family as the 2026-11-04 entry and through a
different mechanism: that one was a test comparing too little, this one a probe trying too few inputs. Not
promoted: a rule covering both reduces to "verify enough", which has no usable check. Recheck when slice 3
adds body comparisons and body shapes. A third case with a specific shared check would justify a rule.

Promoted to a standing rule on 2026-11-07 for spikes only, after `request-bodies-and-storage`. A list of what was not
tried is the check this entry lacked. The 2026-11-04 test comparison stays out of the rule.
Source: `context/archive/preview-replay-export/raw/review.md`, Lessons candidates.

### 2026-11-06 — A test named for a behaviour passed with that behaviour broken

`a replay sends the recorded list even when wire.ts would build another` still passed when replay was
rebuilt through `wire.ts`, because a rebuild keeps a typed `connection: close`. A mutation exposed it, and
the test was replaced with an old record holding a padded value. One incident.
Source: `context/archive/preview-replay-export/raw/progress.md` phase 2, cycle 4.

### 2026-11-06 — Presence checks passed for an element the user could not see

The call panel opened below the fold, and every scripted observation and e2e locator found it. The author
reported "when I click on history row nothing happens". A first viewport test with 8 rows also passed with
no fix, because Playwright centres the row it clicks; 30 rows were needed. Code review then found the same
problem for Replay and Edit (R5). One change, one mechanism. Not promoted: `AGENTS.md` and test-strategy
T2.9 already state the check, so a rule here would duplicate them.
Source: `context/archive/preview-replay-export/raw/review.md` F7, R5.

### 2026-11-07 — A rendered failure was attributed before it was measured

The 17 MiB e2e scenario failed its viewport check at page 11. The failure was blamed on text length, and a scroll
correction was added to `app.tsx`. Measuring the `<pre>` showed its width changing from 960 to 481, because DevTools had
docked. The correction was removed. One incident. The fix passed a first reading because it answered the wrong cause
with plausible code.
Source: `context/archive/request-bodies-and-storage/raw/progress.md`, phase 6.

### 2026-11-07 — DevTools docks during e2e and halves the page width

`src/main.ts` opens DevTools when the app is not packaged, which holds under `launchWithTestDatabase()`. Docking happens
some time after launch, so a position check on long text can fail depending on timing. `e2e/bodies.spec.ts` waits for
DevTools, closes it and waits for the page to fill the window. Other specs do not, and have not failed from it. One
incident. A second would make this a line for `AGENTS.md` through `lz-onboard`, or a step in `launchWithTestDatabase()`.
Source: `context/archive/request-bodies-and-storage/raw/progress.md`, phase 6.

### 2026-11-07 — Code review found what plans, tests and lz-review did not

Three changes. `send-and-record`: a URL with a `#fragment` recorded a request that was not sent, past every T1.3 case.
`preview-replay-export`: R1 to R8. `request-bodies-and-storage`: two passes, including a failed `finish()` leaving chunks,
and a paging defect all e2e scenarios missed. Recurring, and not promoted: `/code-review` ran on all three, so a rule
requiring it would have changed no outcome, and `lz-review` already names it. A pass after the last round of fixes did not
run on this change, and no defect is known from that. If one appears, that is the incident for a rule requiring a pass on
the final code. Whether it is a gate belongs to `test-strategy.md`.
Source: `context/archive/request-bodies-and-storage/raw/review.md`, Code review findings.

### 2026-11-07 — A test helper's unbounded loop cost a red step

A `while` in a curl test helper never ended against unimplemented code, so the first run hung. The rerun used `timeout`,
which does not exist on macOS, and the code was then written, so phase 3's tests were not seen failing. Mutations stood in.
One incident. Different mechanism from the curl spike's hang in `preview-replay-export`, where `execFileSync` blocked the
event loop.
Source: `context/archive/request-bodies-and-storage/raw/progress.md`, phase 3.

### 2026-11-07 — `toMatchObject({ length })` also matched bytes

Two phase 4 tests expected a file reference by its `length`, and passed before the code existed, because a `Uint8Array` has
a `length` too. They now require a `fileId`. One incident. Same family as "A test named for a behaviour passed with that
behaviour broken" (2026-11-06), through a different mechanism. Not promoted: `lz-tdd`'s red step already states the check,
and this is how the case was found.
Source: `context/archive/request-bodies-and-storage/raw/progress.md`, phase 4.

### 2026-11-07 — undici's headers timer runs during the upload

The second code review found it, and a probe confirmed it: a 30 MiB `Uint8Array` at 1 MiB per second failed with
`UND_ERR_HEADERS_TIMEOUT` at 2.5 s against a 2 s limit. `spike-undici-bodies.md` sent 2 MiB and compared bytes and headers,
not timing. The standing undici rule covers what undici writes or refuses, so this is not an incident under it. One
incident of timing behaviour. Recheck when slice 4 sends file bodies, and when undici is upgraded.
Source: `context/archive/request-bodies-and-storage/raw/progress.md`, second code review follow-up.

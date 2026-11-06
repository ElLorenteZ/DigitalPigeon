---
produced-by: lz-lessons
updated: 2026-11-06
standing-rules: 1
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

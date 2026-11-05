---
produced-by: lz-lessons
updated: 2026-11-04
standing-rules: 0
---

# Lessons

Standing rules are loaded as priors by framing, planning, review and debugging. They are
capped at 20 deliberately — a long file is a diluted file. The observation log is read on
demand and binds nothing.

## Standing rules

None yet. A finding becomes a standing rule on its second distinct incident.

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

Ready rule for the next distinct incident, likely slice 3 (request bodies, `content-length`,
`transfer-encoding`): "Before a plan relies on what undici writes for a new request shape, send
that shape to `test-support/capture-server.ts` and record the result. Check: the plan's
Assumptions cite a probe or a T1.3 case for every new method, body type or header rule."
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


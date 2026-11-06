---
change_id: preview-replay-export
title: Open a past call, replay it exactly or edit and resend it, and export a request as curl
status: closed
ticket: null
created: 2026-11-05
updated: 2026-11-06
closed: 2026-11-06
produced-by: lz-change
---

## Intent

"/lz-change preview-replay-export" — opening slice 2 of M1 as cut in
`context/foundation/roadmap.md`:

> | 2 | Preview, replay, export | Open a past call and see the request as sent and the response;
> replay it exactly or edit and send, and a new entry appears while the original is unchanged; copy
> either as curl and run it | next | — |

## Boundary

**This change covers:**
- Opening a past call from history: the request as sent (method, URL, headers in wire order), the
  response status, headers, full body as text, timing and timestamps. Error and interrupted calls
  show what was recorded.
- Exact replay of a past call: the same method, URL and headers as recorded, sent as a new call.
  The original call is unchanged.
- Edit and send: a past call loaded into the request form, changed, and sent as a new call. The
  original is unchanged when viewed again.
- Copying a recorded call, or the request currently in the form, as a curl command that sends the
  same method, URL and headers when run in a terminal.
- Refusing non-ASCII header values before anything is recorded, and recording anything undici
  still rejects as `invalid-request`. This changes slice 1's send path. Added 2026-11-06 by author
  decision, because replay and curl export depend on it (`spike-non-ascii-headers.md`). The plan
  review extended the refusal to everything undici rejects (control characters, invalid names) and
  added trimming of surrounding whitespace; the author proceeded without objection.
- Tests for the risks this slice introduces or completes, at the layers `test-strategy.md`
  assigns:
  - T1.1, the edit-and-send half
  - T1.3, the replay half
  - T2.4, curl export
  - T2.7, the replay half of the journey
- The exit criteria this slice can meet, from `roadmap.md`:
  - a record does not change, and edit-and-send creates a new one
  - an exact replay sends what was recorded
  - a call record shows the request as sent, the response and timing
  - a curl export runs and sends the same request

**Explicitly not in this change:**
- Request bodies, pretty-printing, Monaco, bodies over 16 MB — slice 3. Replay and curl cover
  bodiless requests only.
- Multipart replay and file copies — slice 4.
- Saved requests and environments; replay into a different environment — slice 5.
- Filtering or searching history — slice 6.
- Deleting calls — slice 7.
- Recording which call a replay came from. The PRD requires a link to a source saved request
  only.
- Offering a current token instead of the recorded one on replay of an expired token (PRD open
  question; test-strategy T3.7). Exact replay sends what was recorded.
- Code export in languages other than curl (PRD open question).
- Side-by-side diff of two calls (later milestone).
- Fixing the backup comment in `docker-compose.yml` — a separate fix.

## Notes

- Built on `send-and-record` (`context/archive/send-and-record/record.md`):
  - the call store is insert-only, and history rows are body-less summaries, so opening a call
    needs a full read with bodies
  - the wire contract in `src/core/wire.ts` decides what a replay sends; recorded headers already
    hold undici's normalised form (`host`, `connection`, `content-length`)
- Observation log (`lessons.md`, 2026-11-03): probe undici against the capture server before
  relying on what it writes for a new request shape. Replaying a recorded header list is such a
  shape.
- Branch: `send-and-record` is not merged; the roadmap update from 2026-11-05 is uncommitted on it.
- Outcome (2026-11-06): all six phases verified and every finding fixed or accepted (`review.md`), committed as `1846ce8` on branch `preview-replay-export`. Not pushed: the slice 1 pull request (F4) and a second `/code-review` of the fixes have not happened.

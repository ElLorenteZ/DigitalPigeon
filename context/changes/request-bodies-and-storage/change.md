---
change_id: request-bodies-and-storage
title: Send, replay and export request bodies, and store bodies over 16 MB in full
status: new
ticket: null
created: 2026-11-06
updated: 2026-11-06
closed: null
produced-by: lz-change
---

## Intent

"/lz-change bodies-and-formatting" — opening slice 3 of M1 as cut in
`context/foundation/roadmap.md`:

> | 3 | Bodies and formatting | Send JSON, XML, plain-text and form-urlencoded bodies; JSON and XML
> shown pretty-printed in the editor; a response over 16 MB is stored and shown in full | next | — |

Asked how to cut the slice, the author chose "Two, bodies first": bodies and storage in this change,
the editor and formatting in a second one. The id `request-bodies-and-storage` replaces
`bodies-and-formatting`, as stated in that option.

## Boundary

**This change covers:**
- Typing a JSON, XML, plain-text or form-urlencoded request body in the form, sending it, and recording
  the body as sent.
- Exact replay, edit-and-send and curl export of a call with a body.
- Storing a response or request body over 16 MB in full (GridFS), and showing it in full as text.
- Tests for the risks this change introduces or completes, at the layers `test-strategy.md` assigns:
  - T1.2 and T1.3, the body half
  - T1.5, a body over 16 MB
  - T2.4, bodies other than multipart
  - T2.2, if the stored document shape changes
- The exit criteria this change can meet or advance, from `roadmap.md`:
  - a call record shows the full response body
  - JSON, XML, plain-text and form-urlencoded requests can each be sent and are recorded (multipart
    remains)
  - an exact replay sends the same body
  - a curl export sends the same body (multipart remains)

**Explicitly not in this change:**
- Monaco, pretty-printing JSON and XML, T2.6 and T1.8: the second change from this cut, next in order.
  Bodies stay plain text in this change.
- Multipart bodies and file copies, T1.4: slice 4.
- Saved requests and environments: slice 5.
- Filtering or searching history, including search inside bodies: slice 6.
- Deleting calls, including removing GridFS files: slice 7.
- Size caps or truncation of stored bodies: PRD non-goal.
- Fixing the backup comment in `docker-compose.yml`: a separate fix.

## Notes

- Standing rule (`lessons.md`): probe what undici writes or refuses for each new request shape before the
  plan relies on it. `content-length` is managed by `wire.ts` today and `Transfer-Encoding` is refused.
  Bodies change both assumptions.
- Observation log (2026-11-04): T1.x comparisons should cover everything the record claims. Bodies are the
  case that entry names.
- `/lz-roadmap` needs to split slice 3 in `roadmap.md`, which still names one slice with no change.
- `formFromCall`, `replayCall`, `toCurl` and `buildWireRequest` assume no body
  (`context/archive/preview-replay-export/record.md`).
- Branch: `preview-replay-export` holds slice 2 at `1846ce8`. The slice 2 archive, `lessons.md` and the
  roadmap update are uncommitted, and slices 1 and 2 are neither pushed nor merged.

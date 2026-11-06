---
produced-by: lz-spike
assumption: undici 8.12.3 (Node 22.22.2), given a header value containing non-ASCII characters, writes the UTF-8 bytes of that value to the wire, so a send document holding the value as a string is a truthful record.
verdict: fails
timebox: 15 minutes / under 1 minute (23:53:23)
versions: undici 8.12.3, Node 22.22.2 (the test runtime; Electron's Node 24.22.1 not checked)
updated: 2026-11-05
---

# Spike: non-ASCII header values through undici

## Assumption
A header value such as `Bearer zażółć`, passed to `undici.request`, reaches the wire as the UTF-8
encoding of that string. Negative result: the request is rejected, or the bytes differ from UTF-8.

## Prediction (written before running)
"Sends UTF-8 bytes — undici writes the value's UTF-8 bytes unchanged; the record is truthful and T1.3
just needs a non-ASCII case." (author's choice, 2026-11-05)

## What happened
A scratch script used the repo's `undici` 8.12.3 and a copy of the capture server. It sent `GET` with
the header list in wire-contract form plus `X-Value` set to three values, then compared the raw
bytes received (`Buffer.from(rawValue, 'latin1')`) with the value's UTF-8 encoding.

```
undici 8.12.3 node 22.22.2
"Bearer zażółć" -> ERROR InvalidArgumentError UND_ERR_INVALID_ARG invalid X-Value header
"Bearer 🐦" -> ERROR InvalidArgumentError UND_ERR_INVALID_ARG invalid X-Value header
"Bearer café" -> wire bytes 42656172657220636166e9 | utf8 42656172657220636166c3a9 | equal: false
```

## Verdict: fails

## Surprises
- **Characters above U+00FF are rejected, not encoded.** `ż`, `ó`, `ł`, `ć` and the emoji make
  undici throw `InvalidArgumentError` (`UND_ERR_INVALID_ARG`) before anything is written.
- **Characters in U+0080–U+00FF are sent as single latin1 bytes.** `é` went out as `e9`, not UTF-8
  `c3 a9`. A server decoding UTF-8 receives an invalid byte; one decoding latin1 sees `é`.
- The prediction rested on a model in which undici treats header values like body text (UTF-8).
  It treats them as byte strings limited to latin1.

## What this means for the plan
The current core (slice 1) is affected, not only this slice:
- **Unrecorded failure.** `sendAndRecord` inserts the send document before dispatch. A value above
  U+00FF then makes undici throw, and the completion records `network`. The record shows a request
  that never reached the wire, labelled as a network error. `classifySendError` maps
  `UND_ERR_INVALID_ARG` to `network`.
- **curl mismatch.** A value in U+0080–U+00FF is recorded as a string. undici sends latin1, while a
  curl export run from a UTF-8 shell sends UTF-8 (`spike-curl-export.md`). The export would then
  send different bytes from the original, a T2.4 mismatch.
- **Untested.** T1.3 used ASCII values only, so neither case was covered.

Options for the plan review:
- **(a)** Reject non-ASCII header values in `wire.ts` before anything is recorded, and show it in
  the form as invalid input. Simplest; every recorded request then has an exact byte meaning.
- **(b)** Reject only above U+00FF, and make curl export emit latin1 bytes for U+0080–U+00FF. This
  needs shell syntax beyond POSIX `sh` single quotes.
- **(c)** Encode values (for example percent-encoding). That changes what the user typed, which
  "request as sent" forbids.

In every option, `UND_ERR_INVALID_ARG` should not be classified as `network`.

## Code
Deleted. It lived in `scratchpad/spike-nonascii/`. The byte check that worked:
`Buffer.from(rawHeaders[i], 'latin1')` recovers the bytes received; compare with
`Buffer.from(value, 'utf8')`.

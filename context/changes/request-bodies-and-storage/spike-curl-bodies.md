---
produced-by: lz-spike
assumption: curl 8.7.1 with --data-binary, plus suppressing the Content-Type it adds and the Expect: 100-continue it adds to larger bodies, sends the recorded bytes and only the recorded headers for each method that accepts a body, and the command-length limit can be measured.
verdict: fails
timebox: 60 minutes shared by three spikes / about 30 seconds of run time (02:52:08 end of this run)
versions: curl 8.7.1 (x86_64-apple-darwin26.0), /bin/sh on macOS 27, ARG_MAX 1048576, Node 22.22.2 execFile
updated: 2026-11-06
---

# Spike: what curl sends for an exported body

## Assumption
Plan A2. Negative result: different bytes, an added or dropped header, or no measurable limit.

## Prediction (written before running)
Asked for a prediction, with options naming about 1 MB or less, the author answered: "limit should be about 100MB".

## What happened
A scratch script ran commands through `sh -c` and async `execFile` against a raw `net` server.

```
no suppression, no Content-Type in the list, 6 methods  → adds Content-Type: application/x-www-form-urlencoded
-H 'Content-Type:', 6 methods                           → host, connection, Content-Length: 18; bytes 18
recorded content-type and content-length, POST          → host, connection, content-type, content-length: 18; recorded order
--head with --data-binary                               → curl exit 2, nothing sent
-X HEAD with --data-binary                              → HEAD sent with bytes 18
newlines, CRLF, ' " $HOME \ ` %41 tab, 48 bytes         → equal
--data-binary '@/etc/hosts'                             → body is the contents of /etc/hosts, 213 bytes
--data-raw '@/etc/hosts'                                → body is the text @/etc/hosts, 11 bytes
--data-raw with the same tricky text                    → equal

Size of the body, single-byte text, through sh -c:
1 KiB … 1000 KiB   → sent, all bytes, no Expect header
1023 KiB and above → spawn E2BIG, nothing sent (1024 KiB, 1100 KiB, 2048 KiB, 100 MiB)
```

## Verdict: fails
`--data-binary` is the wrong flag. The rest of the assumption holds with `--data-raw`.

## Surprises
- **`--data-binary` reads a local file when the body starts with `@`.** A recorded body of `@/etc/hosts` would send that file's contents to the server. The plan
  named this flag. A wrong flag here is a data leak from the author's disk, as well as a false export. `--data-raw` sends the text as written.
- **The limit is about 1 MiB, not 100 MB.** The prediction was off by a factor of 100. `ARG_MAX` on this machine is 1048576 bytes and counts the environment as well as
  the command, so the failure point is between 1000 KiB and 1023 KiB here and moves with the environment.
- **`Expect: 100-continue` never appeared.** Every body that fits in a command is below the size at which curl adds it. No suppression is needed. The plan assumed one.
- **`--head` cannot carry a body:** exit 2. `-X HEAD` sends one, but curl may wait for a body if a response announces a length. That wait was not tried: the
  server here answered `content-length: 0`.
- Multi-byte text and quoting grow the command beyond the body's size, since `'` becomes `'\''`. The limit applies to the command, not to the body.

## What this means for the plan
- Phase 3 uses `--data-raw`, never `--data-binary`. A test must send a body starting with `@` and assert that it arrives as text.
- The refusal measures the **command's bytes**, against a limit with a margin below `ARG_MAX`, such as 900 KiB. It does not measure the body.
- `-H 'Content-Type:'` is needed only when the list has no `Content-Type`. No `Expect` handling.
- `HEAD` with a body has no reliable export. Options for the revision: the form offers no body on `HEAD`, or curl refuses it.
- The exit criterion "a request exported as curl sends the same body" holds only up to about 900 KiB. Inline bodies go up to 1 MiB, so an inline body can also be refused.
- Not tested: pasting a long command into a terminal, whose own limit may be lower. Automation cannot reach it.
- Other platforms differ. Linux has a separate per-argument limit that was not measured. The work-laptop target is deferred.

## Code
Deleted. It lived in `.probe/a2.mts`. The working shape:
```
curl --http1.1 -sS --globoff -X 'POST' '<url>' -H 'User-Agent:' -H 'Accept:' \
  -H 'host: …' -H 'connection: keep-alive' -H 'content-type: …' -H 'content-length: N' --data-raw '<text>'
```

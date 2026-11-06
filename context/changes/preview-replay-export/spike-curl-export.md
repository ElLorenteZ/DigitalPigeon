---
produced-by: lz-spike
assumption: curl 8.7.1, run through `sh -c` with `--http1.1 -sS`, `-X <METHOD>` (or `--head` for HEAD), `-H 'User-Agent:' -H 'Accept:'`, then `-H` for host, connection, the user's headers and `content-length: 0` (POST/PUT/PATCH), delivers exactly that set of header names and values, with the same method and URL, for all seven methods.
verdict: holds
timebox: 30 minutes / about 61 minutes of wall clock (04:50:38–05:51:25). Most of it was a hung first run caused by the probe itself (see Surprises); active work was a few minutes.
versions: curl 8.7.1 (x86_64-apple-darwin26.0, libcurl/8.7.1 SecureTransport), /bin/sh on macOS 27, Node 22.22.2 node:http (capture server)
updated: 2026-11-05
---

# Spike: what curl sends for an exported command

## Assumption
Plan assumption A2. The exported command shape, run through `sh -c`, sends exactly the recorded set
of header names and values, plus the recorded method and URL, for `GET`, `HEAD`, `DELETE`,
`OPTIONS`, `POST`, `PUT` and `PATCH`. Negative result: any header added or dropped, a different
value, or a different method or URL.

## Prediction (written before running)
"Exact set, all methods: empty -H 'User-Agent:' and -H 'Accept:' remove curl's defaults, custom
host, connection and content-length go through, and --head sends HEAD with the same set." (author's
choice, 2026-11-05)

## What happened
A scratch script started a copy of `test-support/capture-server.ts`. For each method it built the
command by hand: every argument single-quoted, with `'` written as `'\''`. The URL was
`…/orders?q=two%20words&a=1`. The headers were `host`, `connection` (`close` for `HEAD`),
`X-Zeta: 1`, an `Authorization` value containing `'`, `"`, `$HOME`, `\` and `zażółć`, and
`accept: */*`, plus `content-length: 0` for `POST`/`PUT`/`PATCH`. It ran each command with
`sh -c` through async `execFile`.

Final run, with received values decoded latin1 → UTF-8 and names lowercased:
```
GET     method=GET url=true set=true order=true
HEAD    method=HEAD url=true set=true order=true
DELETE  method=DELETE url=true set=true order=true
OPTIONS method=OPTIONS url=true set=true order=true
POST    method=POST url=true set=true order=true
PUT     method=PUT url=true set=true order=true
PATCH   method=PATCH url=true set=true order=true
ALL SET MATCH: true | requests: 7
```

## Verdict: holds

## Surprises
- **curl kept the order as well as the set.** Lowercased names arrived in exactly the `-H` order.
  The plan promises only the set (author decision); order holding is a bonus, not a contract.
- **curl writes the custom host under its own name `Host`,** capitalised, in the first position,
  even though the `-H` argument was `host: …`. Names compared case-insensitively match.
- **The capture server shows non-ASCII header values as latin1.** curl sent the correct UTF-8 bytes
  for `zażółć`, but `node:http` decodes header values as latin1, so `rawHeaders` held `zaÅ¼Ã³ÅÄ`.
  The first comparison failed on this alone. Consequences beyond this spike:
  - any capture-server comparison of a non-ASCII header must decode `Buffer.from(v, 'latin1')
    .toString('utf8')`
  - the T1.3 tests in `send.int.test.ts` use ASCII values only, so what undici does with a
    non-ASCII header value (send UTF-8, reject, or something else) is untested
- **The probe hung on its first run.** `execFileSync` blocked the event loop of the process that
  hosted the capture server, so curl never got a response, and the probe's own timeout timer could
  not fire. Running curl through async `execFile` fixed it. Phase 3's integration tests must run
  curl asynchronously for the same reason.

## What this means for the plan
- A2 holds. Phase 3 can promise "same method, URL and header set" with the planned flags; no flag
  changes are needed.
- A3 (quoting through `sh`) is also shown for `'`, `"`, `$`, `\` and non-ASCII; phase 3's test still
  covers it.
- Phase 3's test must:
  - spawn curl asynchronously
  - decode received header values latin1 → UTF-8 before comparing
- New, outside A2: undici's handling of non-ASCII header values is unknown. It affects T1.3
  (`send`) and replay (phase 1) for any header with non-ASCII characters. This is for the plan
  review: add a T1.3 case, or state a limit.

## Code
Deleted. It lived in `scratchpad/spike-curl/`. The command shape that worked, for `POST`:
```
curl --http1.1 -sS -X POST '<url>' -H 'User-Agent:' -H 'Accept:' \
  -H 'host: <host>' -H 'connection: keep-alive' -H '<Name>: <value>' … -H 'content-length: 0'
```
`HEAD` uses `--head` in place of `-X HEAD`. Quoting a value: `'` + value with each `'` replaced by
`'\''` + `'`.

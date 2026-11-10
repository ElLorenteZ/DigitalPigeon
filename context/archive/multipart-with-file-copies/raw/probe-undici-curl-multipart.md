---
produced-by: lz-plan
purpose: Evidence for plan assumptions A1 and A2, required by the standing rule "Probe what undici does before a plan relies on it" (lessons.md)
versions: undici 8.12.3, Node v22.22.2 (standalone, not Electron), curl 8.7.1 (macOS), sh -c
run: 2026-11-08
---

# Probe: undici and curl with a multipart body

## What ran

A standalone Node script started a `node:http` server on `127.0.0.1` that recorded `rawHeaders` and the body bytes.

1. **undici:** `request(url, { method: 'POST', headers, body })` with `headers` in the order `wire.ts` builds them:
   `host`, `connection: keep-alive`, `content-type: multipart/form-data; boundary=dpboundary0123456789abcdef`,
   `content-length: 276`. The body was a `Uint8Array` with two parts:
   - a field `note` whose value is `hello\r\nworld`
   - a file part with `filename="zażółć.bin"` (UTF-8), `Content-Type: application/octet-stream`, and the bytes
     `00 0d 0a ff 2d 2d 41`
2. **curl:** the command shape `toCurl` produces (`curl --http1.1 -sS --globoff -X 'POST' '<url>' -H 'User-Agent:'
   -H 'Accept:' -H 'content-type: multipart/form-data; boundary=…' --data-raw '<body>'`), run through `sh -c` with
   async `execFile`. The body was text only: the `note` field with CRLF, 123 bytes.

## Result

| Probe | Headers received, in order | Body equal |
|---|---|---|
| undici | `host`, `connection: keep-alive`, `content-type: multipart/form-data; boundary=…`, `content-length: 276` | yes, 276 bytes |
| curl | `Host`, `content-type: multipart/form-data; boundary=…`, `Content-Length: 123` | yes, 123 bytes, CRLF kept |

curl writes `Host` and `Content-Length` in its own case and order, as for every other body; the existing T2.4
comparison already handles this.

## Not tried

- Electron's Node (24). The probe ran on Node 22.
- A body over 1 MiB, which `send.ts` stores in GridFS before dispatch.
- A typed `Content-Type` beside the multipart body (the plan refuses it in `wire.ts`).
- curl with a non-ASCII field value, or with a binary part (expected refused by `bodyText`, `src/core/curl.ts:28-43`).
- Methods other than `POST`.

Phases 1 to 3 of `plan.md` add T1.3 and T2.4 cases for these.

## Code

Deleted with the session scratchpad. The undici call, verbatim:

```js
const headers = [['host', new URL(url).host], ['connection', 'keep-alive'],
  ['content-type', `multipart/form-data; boundary=${B}`], ['content-length', String(u8.length)]];
const r = await request(url, { method: 'POST', headers: headers.flat(), body: u8 });
```

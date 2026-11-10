---
produced-by: lz-spike
assumption: In this app's production build, a file picked through <input type="file"> is read with File.arrayBuffer() under the production CSP, Playwright's setInputFiles drives the input, and a 17 MiB Uint8Array sent with ipcRenderer.invoke arrives in main as a Uint8Array that z.instanceof(Uint8Array) accepts, with SHA-256 equal to the file's.
verdict: holds
timebox: 60 min / under 5 min (16:34 to 16:36 by the clock, build included)
versions: electron 45.2.1, @playwright/test as pinned in package.json, zod as pinned, macOS arm64; renderer built by electron-forge package from main at 00dc9d3
updated: 2026-11-08
---

# Spike: file input and bytes over IPC (plan assumptions A3, A4)

## Assumption

A file picked through `<input type="file">` in this app's sandboxed renderer, under the production CSP, is read whole
with `File.arrayBuffer()`. Playwright's `setInputFiles` drives the input. A 17 MiB `Uint8Array` passed to
`ipcRenderer.invoke` arrives in main, passes `z.instanceof(Uint8Array)` alone and nested in a `z.strictObject`, and its
SHA-256 equals the file's. False if any step throws, a CSP or page error is logged, the type check fails, or the
hashes differ.

## Prediction (written before running)

"Both hold": File.arrayBuffer works under the CSP, setInputFiles drives it, the 17 MiB Uint8Array arrives in main as a
Buffer that passes z.instanceof(Uint8Array) with equal SHA-256. No console or page errors. Confidence: medium-high.
(Author, 2026-11-08.)

## What happened

A throwaway git worktree of `main` at `00dc9d3` added a file input and an output `<pre>` to `App`, two temporary
preload functions, and two `ipcMain.handle` channels. One channel returned the received value's constructor name,
`Buffer.isBuffer`, length, SHA-256 and two `zod` parses. The other received `{ type, parts: [{ kind, bytes }] }`
and returned the nested bytes' constructor and length. The app was built with `electron-forge package`, which injects
the production CSP (checked in the page's `<meta>`). Playwright launched `.vite/build` with `args: ['.']`, as
`e2e/support.ts` does, and recorded `console` errors and `pageerror` together.

| File | Size | `File.type` | read | IPC | main receives | `zod` | SHA-256 equal |
|---|---|---|---|---|---|---|---|
| `small.json` | 7 B | `application/json` | 1 ms | 12 ms | `Uint8Array`, not a Buffer | passes, alone and nested | yes |
| `big.bin` | 17 MiB | `application/macbinary` | 17 ms | 88 ms | `Uint8Array`, not a Buffer | passes, alone and nested | yes |
| `huge.dat` | 256 MiB | `""` | 308 ms | 716 ms | `Uint8Array`, not a Buffer | passes, alone and nested | yes |

Console errors and page errors: none in either run. `File.path` is `undefined` in every case.

## Verdict: holds

## Surprises

- **Main receives a plain `Uint8Array`, not a Node `Buffer`.** The prediction said Buffer. `z.instanceof(Uint8Array)`
  passes either way. Code in main that calls Buffer methods on these bytes (for example `toString('latin1')`) must
  wrap them first.
- **`File.type` comes from the extension through Chromium's MIME table, not from the content.** `.bin` gives
  `application/macbinary`, not `application/octet-stream`. An extension Chromium does not know (`.dat`) gives `""`.
  The plan's fallback to `application/octet-stream` covers only the empty case. A file part's recorded `Content-Type`
  is whatever Chromium guesses.
- **256 MiB worked and took under 1.1 s from read to main.** The plan's risk row treated 17 MiB as the size to check.
  Memory at that size was not measured.
- **`File.path` is absent.** Electron removed it; `webUtils.getPathForFile` in preload replaces it. The plan does not
  need a path, so this only rules out showing the original location.

## Not tried

- The real `pigeon:send` handler with `SendInputSchema`. The nested test used a separate channel and an ad hoc schema.
- Files over 256 MiB, and the `ArrayBuffer` and IPC limits beyond that (about 2 GiB). Peak memory in renderer and main
  at any size.
- A person picking through the native file dialog. `setInputFiles` sets the files without opening it.
- The packaged `.app`: its fuses block Playwright. The `.vite/build` output with the production CSP was used, as in
  every e2e run.
- A file removed or changed between picking and reading. The design reads at pick time, so the window is small.
- More than one file input on the page, and picking several files in one input.
- Windows and Linux.

## What this means for the plan

- A3 and A4 hold for this renderer, the production CSP and `.vite/build`, at 7 B, 17 MiB and 256 MiB. The file-input
  design stands; the fallback to a main-process dialog is not needed.
- Phase 5 no longer needs to check A3 and A4 first. Its e2e test through the real `send` channel covers the first Not
  tried item.
- Phase 1: a file part's content type is the browser's guess and can be empty; the encoder's `application/octet-stream`
  fallback stays. A test names the `.bin` → `application/macbinary` case so the behaviour is not mistaken for a defect.
- Main-side code that handles part bytes treats them as `Uint8Array`, never `Buffer`.
- The risk row on memory can name 256 MiB as tried for transfer, not for memory.

## Code

Deleted: the worktree at the session scratchpad (`spike-wt`) and the test files (`spike-files`). The pieces worth
keeping:

```ts
// renderer: read a picked file and send it to main
const bytes = new Uint8Array(await e.target.files![0]!.arrayBuffer());
const main = await window.pigeon.spike(bytes);

// main: what arrived
ipcMain.handle('pigeon:spike', (_e, raw: unknown) => ({
  zodOk: z.instanceof(Uint8Array).safeParse(raw).success,
  ctor: (raw as object)?.constructor?.name, // "Uint8Array"
  isBuffer: Buffer.isBuffer(raw),           // false
}));

// Playwright: setInputFiles on the input, in a page launched as e2e/support.ts launches it
await win.getByTestId('spike-file').setInputFiles(path);
```

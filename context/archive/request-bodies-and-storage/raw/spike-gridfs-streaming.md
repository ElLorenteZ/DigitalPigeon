---
produced-by: lz-spike
assumption: Driver 7.8.0's GridFSBucket takes a string id, removes chunks on abort(), reads a byte range with start and end, and handles a stream over 16 MB with undici's body as the source, under backpressure.
verdict: holds
timebox: 60 minutes shared by three spikes / about 40 seconds of run time (02:52:48 end of this run)
versions: mongodb driver 7.8.0, MongoDB 8.0.34 (Compose), undici 8.12.3, Node 22.22.2 (not run in the bundled main process)
updated: 2026-11-06
---

# Spike: GridFS streaming, abort and range reads

## Assumption
Plan A3. Negative result: a string id refused, chunks left after `abort()`, wrong bytes from a range, or memory growing with the body.

## Prediction (written before running)
"All holds": "String ids, abort removing chunks, exact range reads and a 17 MiB stream under backpressure all work as the plan assumes." (author's choice, 2026-11-06)

## What happened
A scratch script used a `dp_test_spike_*` database, dropped afterwards, and a local HTTP server sending a 17 MiB patterned body, in 256 KiB writes that wait for drain.

```
stream, pipeline(undici body, upload)   files 1, chunks 69, length 17825792, SHA-256 equal, RSS peak +51 MB
file document                           _id is a string, chunkSize 261120
range [0,10), across a chunk, across two chunks, last 10   exact bytes
range start=end, and start=length       0 bytes, no error
range end past the length               MongoInvalidArgumentError: Stream end must not be more than the length
range start past the length             MongoInvalidArgumentError
range with start and no end             MongoInvalidArgumentError: Stream start must not be greater than stream end (0)
unknown file                            MongoRuntimeError: FileNotFound
abort mid-write                         16 chunks → 0; no file document; other files untouched
cancel through undici's signal          pipeline rejects AbortError (code 20); 12 chunks LEFT; abort() then succeeds; 0 chunks
server dies mid-body                    pipeline rejects UND_ERR_SOCKET; after abort(), 0 chunks
bytes from memory, 17 MiB               equal
same id uploaded twice                  E11000 duplicate key
16 MiB Buffer in one document           rejected: size 16777246 over the maximum
```

## Verdict: holds
With two conditions the plan must carry.

## Surprises
- **`pipeline` does not clean up.** On a cancel it rejects and leaves the chunks. `abort()` must be called explicitly on every failure path. It is safe after the stream is destroyed. The prediction took "abort removes chunks" to cover this; it covers only a call to `abort()`.
- **A range needs an explicit `end` within the file.** Omitting `end` with a non-zero `start` throws, and so does an `end` past the length. `readBody` must clamp `end` to the stored `length`. An out-of-range request from the renderer would otherwise surface as a driver error.
- **Chunks exist before the file document.** A crash mid-stream leaves chunks with no file document, as the plan's Out of scope says. The orphans are in `bodies.chunks`, so slice 7 must look there and not only in `bodies.files`.
- RSS rose 51 MB for a 17 MiB body, under pipeline backpressure. One measurement, not a bound.

## What this means for the plan
- Phase 4: every failure path calls `abort()` explicitly, with a test for cancel and for a server dying mid-body.
- `readBody` clamps to the recorded `length`. A read at or past the end returns nothing rather than an error. An unknown file is reported as an error.
- A string id is viable, so `{ fileId: string, length }` fits the schemas' existing string ids.
- Slice 7 note: orphan chunks can exist without a file document.
- A4 is still open: the bundled main process runs in phases 5 and 6.

## Code
Deleted. It lived in `.probe/a3.mts`. The working calls:
```
const bucket = new GridFSBucket(db, { bucketName: 'bodies' });
const upload = bucket.openUploadStreamWithId(id, id);
await pipeline(res.body, upload);            // on failure: await upload.abort()
bucket.openDownloadStream(id, { start, end }) // end exclusive, required, at most the file's length
```

---
change_id: send-and-record
title: Send a REST request from the app and record every send as its own call record
produced-by: lz-archive
outcome: shipped
closed: 2026-11-04
archived: 2026-11-04
milestone: M1, slice 1 (roadmap.md)
branch: send-and-record (uncommitted at archive time)
---

# Record: send and record

## 1. What was built

The first working slice of the product. A request (method, URL, query rows, headers; no body)
typed in the window is sent from the main process through `undici` 8.12.3 (pinned exactly). Its
response is shown as text, and every send becomes its own record in MongoDB.

- **Call records:** a call is two insert-only documents:
  - a **send** document written before dispatch, holding the exact wire request
    (`src/core/wire.ts`)
  - a **completion** document holding the response or a `timeout` / `cancelled` / `network` error
- **No update or delete:** the store (`src/core/call-store.ts`) has neither. History lists
  completed, in-flight, interrupted and unreadable calls, without bodies.
- **Database handling:** sending is blocked while MongoDB is unreachable. Credentials come from
  the environment, then `~/Library/Application Support/DigitalPigeon/config.json`, and
  `DP_MONGO_DB` overrides the database. Startup retries continue after `down`.
- **Tests:** unit 69, integration 38, e2e 3.

**Differs from the plan:**
- **The wire contract was wrong twice:** undici forces `connection: close` on `HEAD` (phase 2),
  and a `#fragment` swallowed query rows (host code review).
- **Bad documents:** a document failing its schema shows as an `unreadable` row instead of
  breaking the list.
- **In-flight rows:** history polls every 500 ms while a send runs; otherwise the in-flight row
  never appeared.
- **Core addition:** an `onSent` callback was added so main knows in-flight send ids.
- **IPC contract:** it changed after review. History rows are body-less summaries, and the send
  result carries the full completion.
- **Dev mode:** `npm start` was never observed. The packaged app was checked by the author.

## 2. Why this approach

The core (`src/core/`) imports no `electron`, so the risky parts — what reaches the wire, what is
stored, what happens when the database is down — are tested in plain Node against the real
MongoDB and a capture server. Electron is a thin IPC layer over it. Writing the send document before
dispatch is what makes "every send is recorded" hold even when the app crashes mid-request; two
insert-only documents make immutability a property of the store, not of discipline. The record is
compared byte-for-byte against what the capture server received (T1.3), for all seven methods.

## 3. What was rejected

- **One record written after completion** — a crash mid-request would leave no trace of a send
  that reached the wire (author's choice).
- **A pending document updated in place on completion** — an update path contradicts
  insert-only records (T1.1).
- **Trusting undici to send what it is given** — it lowercases `host`, adds `connection`, adds
  `content-length: 0` to bodiless `POST`, and forces `connection: close` on `HEAD`. The core builds
  the exact list instead.
- **Recording the `undici:client:sendHeaders` diagnostics block** — it omits `content-length`
  and arrives after the bytes are written.
- **Recording response headers in received case and order** — undici 8 exposes only a lowercased
  object; the PRD asks for "response headers".
- **Credentials from the environment only** — a Finder-launched packaged app has none.
- **Pointing the app at the repo `.env`** — ties the installed app to the repo's location.
- **Starting the Mongo container from the app** — rejected by the author.
- **When the database is down: send and warn, or start Docker** — the author chose blocking.
- **Bundling externals or copying `node_modules`** — unnecessary: the spike showed the default
  Forge Vite build works.
- **Using the runtime's bundled undici** — Node 22 (tests) and Electron's Node 24 ship different
  undici majors.
- **Failing or skipping unreadable records** — failing blocks all history, and skipping hides
  corruption.

## 4. Surprises

- **The spike predicted a failure that did not happen.** Vite 8 replaces the driver's unresolvable
  optional imports (Kerberos, compression, encryption, cloud auth, SOCKS) with stubs that throw
  only when called. The driver's `try/catch` absorbs them, so the default packaged build works.
- **A plan-review probe proved assumption A2 false** before any code existed. This is why the
  wire contract exists.
- **`HEAD` was the one method the probe skipped,** and undici forces `connection: close` on it.
- **Host code review found a tier-1 record mismatch the T1.3 tests missed.** They compared only
  path and query, so a fragment-swallowed query passed. The recorded URL is now compared in full.
- **First scripted observation:** the in-flight row was missing. The renderer re-fetched before
  main had inserted the send document.

## 5. What still stands

- **The wire contract is undici-specific.** `src/core/wire.ts` encodes 8.12.3's behaviour. After any
  undici upgrade, run `npm run test:integration`; the T1.3 cases in `send.int.test.ts` fail on any
  change. A typed `Host` header's case and a typed `Connection` on `HEAD` are not honoured.
- **"Interrupted" needs care.** A send document with no completion is "interrupted" unless main
  has it in its in-memory in-flight set. A crash, or a completion insert failing after the
  response arrived, both show as interrupted; the latter also shows "Response received but NOT
  recorded" at the time.
- **Bodies are stored inline.** A response near or over 16 MB cannot be recorded (accepted;
  GridFS and T1.5 are slice 3). Request bodies do not exist yet.
- **The packaged app has driver limits.** Kerberos, wire compression, field-level encryption,
  AWS/GCP auth and SOCKS fail there with `MongoMissingDependencyError`. A proxy milestone must
  revisit SOCKS.
- **If the status line is wrong,** check `src/core/db-connection.ts`. Status follows heartbeat
  events every 2 s, server selection times out after 2 s, and retries continue after `down`.
- **Three paths are untested.** The renderer's catch for a rejected `send`, and history's error
  line when `listCalls` fails mid-heartbeat, were never exercised. The per-database store cache
  was only read, not tested.
- **The app now needs credentials.** The author's `config.json` exists (mode 600). One real
  `GET https://example.com` call is in `digital_pigeon`.
- **e2e safety:** e2e always runs against a `dp_test_*` database through
  `test-support/e2e-database.ts`. Keep it that way; `AGENTS.md` makes it non-negotiable.

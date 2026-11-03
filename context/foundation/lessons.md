---
produced-by: lz-lessons
updated: 2026-11-03
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

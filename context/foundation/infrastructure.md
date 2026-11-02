---
produced-by: lz-infra
updated: 2026-11-02
platform: Local install on the author's personal machine; MongoDB in Docker Compose on the same machine
---

# Infrastructure

## Decision
DigitalPigeon is built from source and installed as an unsigned local package on the author's
personal machine, where the author has admin rights. MongoDB runs on the same machine in a Docker
Compose service that is reachable only from localhost. Nothing is published, nothing is hosted, and
nothing is signed.

The constraint that most drove this: **budget $0, local install only** ("I don't need to publish
that app yet. For now local install only so budget is 0").

## Constraints that decided this
| Constraint | Source | Consequence |
|---|---|---|
| Budget $0. No publishing. | Author, `lz-infra` session | No signing certificates, no Apple Developer ID, no paid CI, no hosting |
| Primary target is the author's personal machine, with admin rights | Author, `lz-infra` session ("it is the primary goal") | Unsigned locally built packages are acceptable |
| The work laptop allows only IT-approved apps | Author, `lz-infra` session | Use at work depends on IT approval, not only on a signature. Deferred; see Risk register. |
| Docker is a requirement. Docker Desktop is installed and licensed. | Author, `lz-infra` session ("i have docker installed, keep it as requirement") | MongoDB runs in a container. No native MongoDB install. |
| Single user, data stays local | PRD (Non-goals: no accounts or sync; leaving cloud sync is a reason for the project) | No cloud database, no remote backend |
| History stores auth tokens as sent | PRD, Assumption A2 | The database must not be reachable from other machines |
| Data residency, traffic shape, latency, uptime | Not stated. Not applicable to a single-user local app. | No requirement imposed |

## Comparison

### Distribution
| Option | Cost (2026-11) | Fits constraints | Exit cost | Verdict |
|---|---|---|---|---|
| Run from source (`npm start` in dev mode) | $0 | Yes, on the personal machine | None | Kept as the development loop. Not the daily-use install, because dev mode starts slowly and depends on the dev toolchain. |
| **Unsigned local package** (Electron Forge `make` on the personal machine, installed locally) | $0 | Yes, on the personal machine | None | **Chosen** |
| Signed builds published to GitHub Releases from CI | Apple Developer ID ~$99/yr, plus a Windows signing certificate (~$120–$300+/yr) | Breaks the $0 budget and the "no publishing" constraint | Low | Deferred until work-laptop use is pursued |

### Database runtime
| Option | Cost (2026-11) | Fits constraints | Exit cost | Verdict |
|---|---|---|---|---|
| **Docker Compose service in the repo** (pinned `mongo` 8.x image, named volume, port bound to `127.0.0.1`) | $0 (Docker Desktop already licensed) | Yes | `mongodump` to move the data | **Chosen** |
| The app starts and stops the container itself through the Docker API | $0 | Yes | Low | Not chosen for now. Depends on the PRD open question about what happens when the database is down. |
| MongoDB installed natively | $0 | Conflicts with "keep Docker as requirement" | Low | Rejected |
| MongoDB Atlas free tier (cloud) | $0 up to the tier's limits | Conflicts with "data stays local". Tokens stored as sent would leave the machine. | Medium | Rejected |

## Alternatives rejected
| Platform | Why it lost |
|---|---|
| Signed builds published through GitHub Releases | Costs about $220–$400/yr in certificates against a $0 budget, and publishes an app the author does not want to publish yet. Revisit when the work laptop is pursued. |
| Native MongoDB install | The author requires Docker. A native install adds a background service to manage on each OS. |
| MongoDB Atlas (cloud) | Moves history, including stored tokens, off the machine. Accounts and cloud data are a reason the project exists. |
| App-managed container lifecycle | Not rejected on merit. It waits for the PRD decision on database-down behaviour. A Compose file is the simpler first step and stays usable if the app later manages it. |

## Risk register
| Risk | Trigger | Impact | Mitigation | Accepted? |
|---|---|---|---|---|
| MongoDB reachable from the network | Publishing the port as `27017:27017` binds to all interfaces. The official image runs without authentication unless root credentials are set. | Anyone on the same network can read every stored token and response | Bind to `127.0.0.1:27017`. Set root credentials through the Compose environment, from an untracked `.env`. | Mitigated |
| History lost with the Docker volume | `docker compose down -v`, a Docker Desktop reset, or a reinstall | All call history lost | Named volume. Document a `mongodump` backup command. No automatic backup. | Yes (accepted; manual backup only) |
| macOS blocks or kills the unsigned build | Building on Apple Silicon without a valid signature, or copying the build from another machine, which adds the quarantine attribute | The app does not launch | Build on the machine it runs on. Apply an ad-hoc signature (`codesign --force --deep -s -`) if the packaged app is killed at launch. Not verified for this Electron version; check at the first package build. | Yes |
| Work-laptop use not possible | IT does not approve the app, or approval requires a signed installer from a known publisher | DigitalPigeon is usable only on the personal machine | None now. The IT approval process is an open question. Signing is the first step if approval needs it. | Yes (deferred by the author) |
| Docker not running when the app starts | Docker Desktop is not started after a reboot | No call can be recorded | App behaviour is the PRD open question. Enable Docker Desktop's "start at login" setting on the personal machine. | Monitored |
| Docker Desktop licence or terms change | A Docker subscription change, or a change of employer | Docker Desktop no longer covered at work | Compose file kept runtime-neutral (no Desktop-only features), so Podman or Docker Engine can run it | Monitored |
| Electron or Docker image updates fall behind | No update mechanism and no publishing | Security fixes in Electron's Chromium or in MongoDB are not applied | Rebuild locally on Electron major upgrades. Bump the pinned image tag deliberately. No auto-update. | Yes |

## Not in scope
- Publishing, auto-update and installers for other people. Single user, $0 budget, "local install only".
- Code signing and notarisation, until work-laptop use is pursued.
- Hosted CI. No PRD requirement. `lz-test-strategy` may add it. GitHub Actions is the default if it does, because the repo is already on GitHub.
- Cloud hosting of any component, including MongoDB Atlas.
- Database replication and scheduled backups. Single user; a manual `mongodump` is the backup.
- Kubernetes or any orchestration beyond one Compose file.

## Sources
- Apple Developer Program fee ($99/yr), Windows code-signing price ranges, and Docker Desktop's free-use threshold for small businesses come from model recall and were not fetched in this session. They are dated 2026-11 as unchecked, so check them before the signing decision.
- That the official `mongo` image has no authentication unless root credentials are set comes from model recall of the Docker Hub image documentation (vendor) and was not fetched in this session.
- Apple Silicon's signature requirement for arm64 executables comes from model recall and was not checked against the Electron version in use.

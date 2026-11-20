---
produced-by: lz-infra
updated: 2026-11-11
platform: Local web app — a Node.js server on 127.0.0.1 on the author's personal machine, used in the browser; MongoDB in Docker Compose on the same machine
---

# Infrastructure

## Decision
DigitalPigeon runs on the author's personal machine, where the author has admin rights, as a local
web app: a Node.js server built from source, bound to `127.0.0.1`, serves the UI to the author's
browser. MongoDB runs on the same machine in a Docker Compose service that is reachable only from
localhost. Nothing is published, nothing is hosted, and nothing is signed.

Revised 2026-11-11 (`decisions/0002-the-app-is-a-local-web-app-served-from-127-0-0-1.md`): the app was an unsigned local Electron
package. The rows below that describe the Electron package are kept and marked as replaced.

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
| History stores auth tokens as sent | PRD, Assumption A2 | Neither the database nor the app server may be reachable from other machines, or from other origins in the browser |
| Data residency, traffic shape, latency, uptime | Not stated. Not applicable to a single-user local app. | No requirement imposed |

## Comparison

### Distribution
| Option | Cost (2026-11) | Fits constraints | Exit cost | Verdict |
|---|---|---|---|---|
| **Local server built from source on the personal machine, opened in the browser** | $0 | Yes, on the personal machine | None | **Chosen** (ADR 0002). Daily use runs the built bundle: `npm start` builds, serves on `127.0.0.1:4380` (`DP_PORT`) and opens Chrome at the per-launch token URL. `npm run dev` is the development loop. |
| Unsigned local package (Electron Forge `make` on the personal machine, installed locally) | $0 | Yes, on the personal machine | None | Chosen 2026-11-02; replaced 2026-11-11 by ADR 0002 |
| Hosted web app (server in the cloud) | Hosting cost, plus accounts | Breaks "data stays local", the $0 budget and the no-accounts non-goal; cannot reach `localhost` or VPN-only APIs | Medium | Rejected (ADR 0002) |
| Signed builds published to GitHub Releases from CI | Apple Developer ID ~$99/yr, plus a Windows signing certificate (~$120–$300+/yr) | Breaks the $0 budget and the "no publishing" constraint | Low | Applied to the Electron package. No longer applicable: a local server has no installer to sign |

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
| Unsigned Electron package | Replaced by ADR 0002: the author wants the app in their own browser, a local server is expected to be easier to get approved on the work laptop, and Electron's release cadence and packaging are dropped. |
| Hosted web app | Rejected in ADR 0002: history and tokens leave the machine, accounts are needed, it costs money, and it cannot reach `localhost` or VPN-only APIs. |
| Signed builds published through GitHub Releases | Costs about $220–$400/yr in certificates against a $0 budget, and publishes an app the author does not want to publish yet. Not applicable to a local server. |
| Native MongoDB install | The author requires Docker. A native install adds a background service to manage on each OS. |
| MongoDB Atlas (cloud) | Moves history, including stored tokens, off the machine. Accounts and cloud data are a reason the project exists. |
| App-managed container lifecycle | Not rejected on merit. It waits for the PRD decision on database-down behaviour. A Compose file is the simpler first step and stays usable if the app later manages it. |

## Risk register
| Risk | Trigger | Impact | Mitigation | Accepted? |
|---|---|---|---|---|
| MongoDB reachable from the network | Publishing the port as `27017:27017` binds to all interfaces. The official image runs without authentication unless root credentials are set. | Anyone on the same network can read every stored token and response | Bind to `127.0.0.1:27017`. Set root credentials through the Compose environment, from an untracked `.env`. | Mitigated |
| App server reachable from other machines or other origins | The server bound to `0.0.0.0`; a malicious page in any browser on the machine calling it (cross-site request, DNS rebinding) | A remote party or a web page sends requests through the app, or reads every stored token and response | Bind to `127.0.0.1`. Every endpoint requires a per-launch token and the server's own `Host` and `Origin`. No CORS headers admitting another origin (ADR 0002). | Mitigated (from slice 5b) |
| History lost with the Docker volume | `docker compose down -v`, a Docker Desktop reset, or a reinstall | All call history lost | Named volume. Document a `mongodump` backup command. No automatic backup. | Yes (accepted; manual backup only) |
| Work-laptop use not possible | IT does not approve Node.js or Docker, or does not allow a local server | DigitalPigeon is usable only on the personal machine | None now. The IT approval process is an open question (PRD A6, revised for ADR 0002). | Yes (deferred by the author) |
| Docker not running when the app starts | Docker Desktop is not started after a reboot | No call can be recorded | App behaviour is the PRD open question. Enable Docker Desktop's "start at login" setting on the personal machine. | Monitored |
| Docker Desktop licence or terms change | A Docker subscription change, or a change of employer | Docker Desktop no longer covered at work | Compose file kept runtime-neutral (no Desktop-only features), so Podman or Docker Engine can run it | Monitored |
| Node.js or Docker image updates fall behind | No update mechanism and no publishing | Security fixes in Node.js or MongoDB are not applied | Update Node.js on the machine. Bump the pinned image tag deliberately. No auto-update. The browser updates itself. | Yes |

## Not in scope
- Publishing, auto-update and installers for other people. Single user, $0 budget, "local install only".
- Code signing and notarisation. A local server has no installer to sign.
- Hosted CI. No PRD requirement. `lz-test-strategy` may add it. GitHub Actions is the default if it does, because the repo is already on GitHub.
- Cloud hosting of any component, including the app server (ADR 0002) and MongoDB Atlas.
- Database replication and scheduled backups. Single user; a manual `mongodump` is the backup.
- Kubernetes or any orchestration beyond one Compose file.

## Sources
- Apple Developer Program fee ($99/yr), Windows code-signing price ranges, and Docker Desktop's free-use threshold for small businesses come from model recall and were not fetched in this session. They are dated 2026-11 as unchecked, so check them before the signing decision.
- That the official `mongo` image has no authentication unless root credentials are set comes from model recall of the Docker Hub image documentation (vendor) and was not fetched in this session.

# TerraFlow Desktop Runtime — Implementation Plan

Status: **IMPLEMENTED** (runtime layer v0.1.0 — see `../src/`, `../test/`, and the README quick start). This was the Desktop track's original plan; the Core/Web roadmap lives in the Core repository and is intentionally separate. Failure/recovery requirements below remain the reference contract.

## Goals

- Provide a downloadable/installable TerraFlow application for Windows that makes the existing Core service locally runnable and continuously operational.
- Keep Watchers running in the background independent of any browser tab.
- Host the existing Core Web/PWA UI locally (no new UI).
- Depend on Core through contracts/build artifacts only (see `CONTRACT_WITH_CORE.md`).

## Non-goals

- No native desktop UI (Electron or otherwise).
- No single-exe compilation for its own sake (Node SEA rejected).
- No engine, API, domain or database re-implementation.
- No UI fork.

## Phase 0 — Discovery

- Read the Core master handoff: `docs/desktop/MASTER_HANDOFF.md` (in the Core repository).
- Verify the contract facts in `docs/CONTRACT_WITH_CORE.md` against the Core checkout.
- Acceptance: a checklist confirming every contract (ports, env vars, output paths, watcher persistence, Docker compose) matches the live Core checkout.

## Phase 1 — Runtime packaging

- Decide how the Core runtime is shipped to the install dir without duplicating or forking source (copy of packages + `apps/api` + workspace layout, or an npm workspace tarball; `npm ci --omit=dev` in the install dir).
- Produce the Web/PWA bundle with `VITE_WATCHER_ENABLED=true` and stage it into the API's static dir.
- Acceptance: a clean install dir in `%LOCALAPPDATA%\TerraFlow` whose `node apps/api/src/server.js` boots and answers `/api/health`.

## Phase 2 — Launcher

- Double-clickable launcher that: checks the runtime, boots PostgreSQL if needed, starts the Core API, opens the browser at `http://localhost:3000`.
- Acceptance: launcher idempotent (safe to click when services are already running).

## Phase 3 — Process lifecycle

- Start the API as a hidden background process; capture stdout/stderr to logs; detect a running instance on the port before starting another.
- Acceptance: exactly one API instance; clean logs; no orphan processes after uninstall.

## Phase 4 — Docker / PostgreSQL lifecycle

- Ensure Docker Desktop is running, `docker compose up -d`, wait for port 5432 (bounded wait), then start the API.
- Handle "Docker unavailable" and "Postgres unavailable" with clear user-facing messages and retry policy.
- Acceptance: first launch cold-boots PostgreSQL; subsequent launches reuse the running container; data volume persists.

## Phase 5 — Health / recovery

- Health loop that monitors the API (`/api/health`) and the API process; restart on crash with backoff; stop loop on uninstall.
- On API boot Core already recovers interrupted jobs and restarts `runOnStartup` watchers.
- Acceptance: API crash → auto-restart; watchers resume; no duplicate instance.

## Phase 6 — Installation

- Install into `%LOCALAPPDATA%\TerraFlow`: copied (packages, API src, web bundle, `.env`, docker-compose), generated (launcher/scripts, autostart registration), persistent (whole `output/`, Postgres volume), never deleted (output, volume).
- Register auto-start on login so watchers resume after reboot.
- Acceptance: clean install on a fresh user profile; upgrade overwrites app code but preserves `output/` and the DB volume; uninstall removes autostart + processes, keeps the user's data volume (documented choice).

## Phase 7 — Testing

- Implement the matrix in `docs/TESTING.md` (clean install, first/subsequent launch, already-running services, Docker/PG unavailable, API/engine/watcher crash, browser closed, machine restart, login, corrupted state, upgrade, uninstall, resume).
- Acceptance: every scenario in the matrix has a pass/fail result recorded.

## Phase 8 — Release packaging

- Produce the downloadable distribution artifact (installer or self-extracting bundle) and a versioning/update story tied to Core versions.
- Acceptance: fresh machine install from the artifact works; upgrade path documented and tested.

## Failure / recovery requirements

- Postgres down at launch → attempt Docker bootstrap; if impossible, tell the user clearly and keep retrying on demand.
- API crash at runtime → restart with bounded backoff, preserve logs.
- Machine restart / login → autostart brings Docker+PG+API back; watchers with `runOnStartup` resume.
- Browser closed → runtime keeps running.
- Corrupted JSON stores → Core treats them as fresh stores (per Core behavior); report rather than silently destroying user data.

## Future compatibility (preserve, do not implement now)

- Keep the runtime layer portable in structure: a `launcher` + `services` + `installer` split so Linux/macOS variants and non-Docker database strategies can be added later without reworking Core contracts.
- Keep cloud deployment possible by leaving Core API/UI platform-independent.

# TerraFlow-Desktop

TerraFlow **Desktop Runtime** — a thin, platform-specific distribution/runtime layer that makes the existing TerraFlow product locally runnable and continuously operational.

TerraFlow is **ONE product** with **TWO development tracks**:

```
              TERRAFLOW PRODUCT
                     │
        ┌────────────┴────────────┐
        │                         │
    CORE / WEB              DESKTOP RUNTIME   ← this repository
        │                         │
    Product logic             Runtime layer
    Engine                     Launcher
    API                        Installer
    PWA                        Process lifecycle
    Domain                     Watcher hosting
    Features                   Local services
        │                         │
        └────────── CONTRACT ─────┘
```

## What this repository is

This repository contains **only** the platform/runtime/distribution layer:

- downloadable / installable package
- launcher
- runtime / process lifecycle
- auto-start on login
- environment & runtime validation
- PostgreSQL / Docker lifecycle where required
- starting and supervising the Core runtime
- keeping Watchers running in the background (independent of any browser)
- health / recovery handling
- opening / hosting the existing Core Web UI locally
- update & uninstall

## What this repository is NOT

- NOT a second TerraFlow product.
- NOT a second Engine — the Engine lives in the Core repository and is never duplicated here.
- NOT a second API — the API lives in the Core repository and is hosted, not re-implemented.
- NOT a second UI — the Web/PWA interface is Core-owned source; the Desktop only consumes/hosts the Core-produced build.
- NOT a fork of business/domain logic. The Desktop adapts to Core; Core is not distorted to fit Desktop.

## How it depends on Core

The Desktop depends on the Core through **defined contracts, build artifacts and runtime interfaces** — never through duplicated source code:

- **Runtime interface:** the Core API is a single-port Express service on `http://localhost:3000` serving both `/api/*` and the static Web/PWA build.
- **Artifact contract:** the Web/PWA production build is produced by the Core repo and consumed by the Desktop runtime.
- **Environment contract:** PostgreSQL connection variables, Groq/AI variables, watcher/source directories — documented in `docs/CONTRACT_WITH_CORE.md`.
- **Data contract:** all runtime data lives under `<install>/output/` (jobs, workflows, watchers, templates, drafts, settings, uploads) and in the PostgreSQL volume.

The Core repository (`TerraFlow`) remains the source of truth for the Engine, API, Web/PWA, domain model, database contracts, artifact contracts, execution model, watcher contracts, and platform-independent product architecture.

## Status

**IMPLEMENTED — working runtime (v0.2.0).**

- **One-click install:** double-click `Install-TerraFlow.cmd` → installs Node.js if missing (per-user, no admin), stages the Core, creates **Desktop + Start Menu shortcuts**, enables login autostart, and launches the app.
- `bin/terraflow.mjs` + `src/` — full CLI and runtime: `setup` / `launch` / `stop` / `status` / `health` / `install` / `uninstall` / `autostart` / `version`.
- Process supervision with health-check polling, crash detection and exponential backoff (2s → 30s), foreground or detached-daemon modes.
- Docker/PostgreSQL 16 bootstrap (auto-starts Docker Desktop, `docker compose up`, bounded wait on 5432, graceful degradation).
- Idempotent, upgrade-safe Windows installer (`%LOCALAPPDATA%\TerraFlow`, preserves `output/` user data), `.bat`/`.vbs` launchers, HKCU run-on-login autostart, data-preserving uninstall.
- `npm test` — unit/integration tests (`node:test`).

Documentation:

- `docs/PLAN.md` — desktop implementation plan (phases 0–8, requirements, failure/recovery).
- `docs/CONTRACT_WITH_CORE.md` — the exact contracts the Desktop must respect when consuming Core.
- `docs/TESTING.md` — acceptance test matrix (install, launch, failure, recovery, upgrade, uninstall).
- `reference/install-draft.mjs` — superseded untested prototype kept as reference material only.

## Quick start

### One-click (recommended for end users)

1. Extract the full TerraFlow folder (keep it together).
2. Double-click **`Install-TerraFlow.cmd`** and follow the window:
   - installs Node.js automatically if needed (per-user, no admin rights),
   - finds the Core checkout (`./core`, `TERRAFLOW_CORE_DIR`, or asks via a folder picker),
   - stages everything, creates a **TerraFlow** icon on the Desktop and in the Start Menu,
   - enables start-at-login, and opens TerraFlow in the browser.
3. From then on: **double-click the TerraFlow desktop icon** any time. Use
   *Start Menu → TerraFlow → Uninstall TerraFlow* to remove it.

### From the CLI

```sh
# same as the one-click installer (add --no-launch / --no-autostart / --no-deps to customize)
node bin/terraflow.mjs setup --core <path-to-core>

# individual steps
node bin/terraflow.mjs install --core <path-to-core>
node bin/terraflow.mjs launch

# inspect / stop
node bin/terraflow.mjs status
node bin/terraflow.mjs stop
```

## Master handoff

The authoritative handoff for the future Desktop agent lives in the Core repository:

> `docs/desktop/MASTER_HANDOFF.md`

It explains product vision, what Core owns, what Desktop owns, what Desktop must NOT touch, why watchers require a local runtime, and how the runtime is expected to work. It is self-contained and does not depend on any conversation.

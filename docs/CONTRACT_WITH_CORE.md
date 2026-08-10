# Contract with Core

The TerraFlow Desktop Runtime consumes the TerraFlow Core through contracts, build artifacts and runtime interfaces. It never re-implements, forks or duplicates Core source code.

This document states the contracts exactly as they exist today in the Core repository. It is written from repository evidence (Core commit `5293e24`, branch `main`).

## 1. Runtime interface

The Core exposes a **single-process, single-port** service:

- Express server, entry `apps/api/src/server.js`.
- Listens on `PORT` (default **3000**), `http://localhost:3000`.
- Serves both:
  - REST API under `/api/*` (see `docs/architecture/README.md` in Core for the full route table).
  - The static Web/PWA production build from `apps/api/public`.
- Server-Sent Events (SSE) at `/api/pipeline/events` and `/api/jobs/events` for live progress.

The Desktop runtime starts this process and opens the browser to `http://localhost:3000`. The browser is **not** the runtime; it is only a UI surface.

## 2. Environment contract

The API reads configuration from the environment (`.env` at the process working directory, loaded via `dotenv`). Variable names used by Core today:

| Variable | Purpose | Notes |
|---|---|---|
| `PORT` | HTTP port (default 3000) | optional |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | PostgreSQL connection (defaults `localhost`/`5432`/`terraflow`/`terraflow`/`terraflow`) | required for DB features |
| `GROQ_API_KEY` | Groq AI key | required for the `ai` stage |
| `GROQ_MODEL` | Groq model (default `llama-3.3-70b-versatile`) | optional |
| `AI_PROVIDER`, `GROQ_BASE_URL` | AI provider overrides | optional |
| `SOURCE_KMZ_DIR` | default KMZ source folder for legacy watch/pipeline | optional |
| `DONE_KMZ_DIR` | where processed KMZ files are moved | optional |
| `EXCEL_TEMPLATE` | default Excel template path | optional |
| `ORIGINAL_EXCEL` | original workbook path (has a repo-relative default outside the repo root) | optional |
| `EXCEL_OUTPUT_NAME` | default output workbook name | optional |

The Desktop runtime must preserve this variable contract exactly. It may inject its own platform variables (e.g. install dir) but must not rename or remove Core variables.

## 3. Artifact / build contract

- The Web/PWA bundle is produced by the Core repo (`apps/web`, Vite build → `dist`).
- For a desktop install the bundle must be built with **`VITE_WATCHER_ENABLED=true`** so the watcher UI is present (Core `apps/web/.env` sets this locally). The public web build leaves it unset.
- The Desktop runtime consumes the Core-produced bundle and serves it from the Core API's static directory (`apps/api/public`).

## 4. Data / artifact contract (what must survive)

All runtime data lives under the engine's `ROOT/output/` directory (where `ROOT` resolves to the monorepo root in Core; in a desktop install it resolves to the install directory because the engine layout is preserved). Subdirectories:

| Path | Contents |
|---|---|
| `output/json/` | standard JSON (source of truth), AI-enriched JSON, dedupe report |
| `output/jobs/` | `jobs.json`, `workflows.json`, `watchers.json`, per-job dirs `job-<id>/` (records, AI results, drafts) |
| `output/drafts/` | declared (unused by engine today) |
| `output/uploads/` | uploaded raw files |
| `output/mappings/` | Excel mapping profiles |
| `output/settings/` | `ai.json`, `ai-usage.json` |
| `output/templates/` | versioned Excel templates (`<id>/v<N>/...` + `index.json`) |
| `output/excel/`, `output/backup/` | generated workbooks and forced backups |
| `output/watches/` | per-watcher incremental sync state |

Watchers persist in `output/jobs/watchers.json` with a `runOnStartup` flag; the Core watcher manager resumes them on boot (`watcherManager.boot()` in `apps/api/src/server.js`).

## 5. PostgreSQL / Docker contract

- Core assumes a PostgreSQL 16 instance; the provided `docker-compose.yml` runs `postgres:16-alpine` (container `terraflow_pg`), mapping port 5432, with a named volume `terraflow_pgdata` that **must persist** across upgrades.
- Schema is mounted at first-init from `packages/database/schema.sql` (tables `properties` and `records`).
- The Desktop runtime is responsible for ensuring PostgreSQL is reachable before the Core API is started (start Docker Desktop if needed, `docker compose up -d`, wait for port 5432).

## 6. Process lifecycle contract

- The Core API process must run as a single long-lived Node process.
- Watchers run **inside** that process (`fs.watch`), so the process must stay alive independent of any browser tab.
- If the process exits, `recover()` marks interrupted jobs as failed on next boot; watchers with `runOnStartup` are restarted by the manager.
- The Desktop runtime supervises this process and must not run multiple API instances against the same `output/` dir concurrently (engine JSON stores have no cross-process locking).

## 7. What Desktop must NOT touch

- Engine source (`packages/engine`) — never duplicated, never forked.
- Domain/business logic — never re-implemented.
- Web/PWA UI source (`apps/web/src`) — never duplicated; only the Core-produced build is hosted.
- API route semantics — treated as an external, stable contract.
- Database schema — owned by Core (`packages/database/schema.sql`).

If the Desktop implementation proves a genuine Core change is required (platform incompatibility), it must **propose** that change as a documented contract/change request to the Core track — it must not implement speculative Core changes itself.

## 8. Known platform facts the Desktop must account for

- Core uses `path.resolve`/`path.join` everywhere (portable), but `ROOT` is computed relative to the engine package location — preserving the `packages/engine/src` layout (via npm workspaces symlinks or copied layout) keeps `output/` resolution correct.
- Watchers filter on `.kmz` (folder mode) by default.
- Core depends on Node.js (>= 18, tested on 24.x) and Docker Desktop for PostgreSQL.
- PowerShell `Set-Content` writes a UTF-8 BOM that breaks the engine's JSON.parse for template store files — those files must be written by Node only.

# TerraFlow — Phase 0 Audit: Current Architecture Report

Date: 2026-09-06 · Scope: engine core + desktop runtime · Read-only audit, nothing modified.

## 1. Repositories audited

| Repo | Path | Role |
|---|---|---|
| **Engine core** | `C:\Users\USER\Desktop\CRM_PRO\New folder (2)` | The real product: Express API + React/Vite web app + 5 workspace packages + Postgres + Vercel SPA deploy (v0.1 → v0.7.5) |
| **Desktop runtime** | `C:\Users\USER\Desktop\CRM_PRO\TerraFlow-Desktop` | Local runtime wrapper: start/stop/supervise the core API process, Docker/Postgres boot, autostart, uninstall |

> Git: a **single shared repo** at `C:\Users\USER\Desktop\CRM_PRO` (origin `github.com/babanedjarmahdi/Aguira-Tunnel`, branch `main`) spans the core, Desktop, and sibling products (`TerraFlow Dashboard`, `TerraFlow AMS`, `TerraFlow Ecosystem`, `TerraFlow ecosystem prototype`, `TerraFlow Matching system`).

## 2. Current architecture (what exists today)

```
┌─────────── Browser ───────────────┐
│  Spa ngs Vercel CDN (static SPA)  │  apps/web → Vite build (React 18, HashRouter)
└──────────────┬────────────────────┘
               │ https://…trycloudflare.com  (VITE_API_URL baked at build time)
               ▼
┌── Cloudflare quick-tunnel ────────┐
│  ephemeral tunnel (restart = new URL) │
└──────────────┬────────────────────┘
               │ localhost:3000
               ▼
┌── local Node process (Core API) ──┐   apps/api/src/server.js — Express :3000
│  REST /api/* + /api/v1/* (84 routes)│ SSE /api/pipeline/events, /api/jobs/events
│  static web bundle from apps/api/public
│  watchers run in-process (fs.watch)
└──────────────┬────────────────────┘
               │ postgres:5432
               ▼
┌── Docker Postgres 16 (terraflow_pg)─┐
│  volume terraflow_pgdata (must persist)
└────────────────────────────────────┘
         +  output/ on disk: jobs, json, drafts, uploads, mappings,
            settings, templates, excel, backup, watches
```

## 3. Engine core inventory (New folder (2))

### Workspaces (npm, root `package.json`)
| Package | Key deps | Role |
|---|---|---|
| `@terraflow/api` | engine, database, express ^4.21 | `apps/api/src/server.js` (~43 KB, 84 routes, dual `/api` + `/api/v1` prefix, **no auth**) |
| `@terraflow/web` | react 18, react-router 6, lucide-react; vite 5 | 12 pages + 10 components; `src/api.js` fetch wrapper (`VITE_API_URL`) |
| `@terraflow/engine` | shared, ai, database, excel, adm-zip, fast-xml-parser | orchestrator.js, stages.js, extractor.js, kmz.js, csv.js, cleaning.js, draft.js, jobs.js, workflows.js, watch.js, watchers.js, templates.js, plugins.js, workspaces.js, user.js, config.js, contract.js, events.js, cli.js, **rules.js (untracked WIP)** |
| `@terraflow/ai` | shared | provider.js (interface), groq.js (Groq adapter + free-tier guard/usage budget), index.js |
| `@terraflow/excel` | shared, exceljs | fill.js (fillCopy, fillInPlace, fillInPlaceSync, unshareSharedFormulas), rows.js, mapping.js (TYPE_PREFIX, SELLER, statusValue, buildNotes), price.js, inspect.js |
| `@terraflow/database` | shared, dotenv, pg | client.js, records.js, migrate.js, backup.js, cli.js, schema.sql, migrations/001_initial.sql |
| `@terraflow/shared` | — | normalize.js, price.js, async.js, standard.js |

### Database (Postgres 16 via docker-compose)
- `properties`: id, source_file, placemark_idx, name, area_m2, description, lat/lon/alt, property_type, status, location, price, price_note, owner_name, seller, owner_phone, notes, ai_raw JSONB, created_at · UNIQUE(source_file, placemark_idx)
- `records`: workflow_type, source_file, source_row, payload JSONB, UNIQUE(workflow_type, source_file, source_row)
- `schema_migrations`: reversible per-tablespace; applied on API boot.
- **No photo/matching columns.**

### Vercel deployment
- `.vercel/project.json`: only `apps/web` (framework `vite`, `rootDirectory: apps/web`, build → dist, node 24).
- `apps/web/vercel.json`: SPA rewrite → index.html. **The API is NOT and cannot be on Vercel** (persistent process, file-backed `output/`, fs.watch watchers, SSE). Failed serverless attempt preserved in `.vercel/output/`.
- `VITE_API_URL` in `.vercel/.env.production.local` currently points to a **cloudflare quick-tunnel** URL. Chain: Browser → Vercel CDN → tunnel → local API :3000 → Postgres :5432 → workbook disk.

## 4. Desktop runtime inventory (TerraFlow-Desktop)

| File | Role |
|---|---|
| `bin/terraflow.mjs` | CLI entry |
| `src/{cli,supervisor,supervisor-cli,runtime,api,docker,installer,autostart,uninstaller,state,paths,net,log}.js` | lifecycle management |
| `docs/{CONTRACT_WITH_CORE,PLAN,TESTING}.md` | contracts; CONTRACT_WITH_CORE is authoritative for Core integration |
| `reference/install-draft.mjs` | installer draft |

Desktop responsibilities (per contract): start the Core API process, serve web bundle from `apps/api/public`, boot Docker Postgres (`docker compose up -d`, wait :5432), autostart via HKCU Run + startup.vbs, supervise process, no concurrent API instances on same `output/`.

## 5. Features inventory (implemented vs present-but-sibling vs absent)

| Feature | Status | Location |
|---|---|---|
| KMZ→AI→Excel pipeline | ✅ v0.4 | packages/engine (`stages.js`, `extractor.js`, `fill.js`) |
| Jobs + draft/preview/apply | ✅ v0.4 | jobs.js, draft.js, workflows.js |
| Single-port web serving | ✅ v0.4 | apps/api/public (build:web) |
| Watch mode + incremental sync | ✅ v0.5.x | watch.js, watchers.js, fillInPlaceSync |
| AI config, free-tier Groq guard, cost | ✅ v0.5.x | config.js, ai/groq.js, output/settings/ai*.json |
| Excel template manager | ✅ v0.5.x | templates.js, excel/inspect.js |
| CSV→processing→DB plugin pair | ✅ v0.6 | plugins/csv-input.js, plugins/db-output.js, cleaning.js |
| Versioned /api/v1 + OpenAPI | ✅ v0.7.1 | server.js dual-prefix helper |
| Embeddable engine contract | ✅ v0.7.0 | contract.js, docs/desktop/MASTER_HANDOFF.md |
| Workspaces + backup/restore | ✅ v0.7.2 | workspaces.js (tar.gz) |
| Plugin registry (install/enable/disable) | ✅ v0.7.3 | plugins.js, output/plugins/ |
| Local-first user scaffold | ✅ v0.7.4 | user.js, UserGate.jsx |
| DB migrations + JSON backups | ✅ v0.7.5 | migrate.js, backup.js, docker-compose.yml |
| **Rules-based Arabic extraction (offline LLM fallback)** | 🔄 **uncommitted WIP** | packages/engine/src/rules.js (untracked) + modified config.js/index.js/stages.js + rebuilt bundle |
| **Photos feature** | ❌ **does not exist in core** | 0 refs in any .js; only planned v2 `photos[]` field in docs/STANDARD_JSON.md. Lives in sibling `TerraFlow Dashboard` |
| **Matching engine (MATCH_W 0.50/0.20/0.15/0.15, AUTO_THRESHOLD 0.80)** | ❌ **does not exist in core** | `M` (تطابق) column is `null (future)`. Lives in sibling `TerraFlow Matching system` (commits ec5d67c–ac09ef9, v0.6.1) |
| Telegram bridge | ❌ removed v0.5.12 | dead files only: output/telegram/*, telegram_bridge.log |

## 6. Risk register (pre-migration)

| # | Risk | Evidence |
|---|---|---|
| R1 | **One git repo spans all products** — a monorepo re-org at core must first split/subtree, else sibling dirt (Dashboard .api-test.js, AMS, etc.) lands in every commit | `git status` at CRM_PRO |
| R2 | **Zero auth**, product already reachable via public tunnel | server.js (~line 1099) |
| R3 | **Photos + matching do not exist in core** — the target plan's `packages/matcher` and photo feature must import from sibling repos, not extract | grep across repo = 0 hits |
| R4 | Secrets in tree: `.env` (GROQ/telegram), `.vercel/.env.production.local` (VERCEL_OIDC_TOKEN) | files exist, gitignored |
| R5 | Uncommitted WIP: `rules.js` + modified stages/config/index + rebuilt bundle — working tree ≠ v0.7.5 | `git status` |
| R6 | Tunnel URL baked into SPA at build; each tunnel restart ⇒ rebuild + redeploy | apps/web vercel.json + .vercel/.env.production.local |
| R7 | Excel write-safety (`safeWriteExcel`, fillInPlaceSync, RTL preservation) is hard-won; must not be bypassed | OPERATIONS.md locking history (`EPERM`) |
| R8 | Vercel can never host the API (persistent process + FS + watchers) — cloud story must be a control-plane, not API hosting | .vercel/output/diagnostics |
| R9 | Concurrent API processes against same `output/` = corruption (no cross-process file locking) | CONTRACT_WITH_CORE §6 |
| R10 | `rules.js` confidence threshold (0.55) is a new engine contract — must freeze before phase 1 | rules.js |

## 7. Contract requirements carried into the target (from program notes)

- Keep `MATCH_W = {name 0.50, type 0.20, area 0.15, token 0.15}`, `AUTO_THRESHOLD = 0.80` (to be imported from the Matching system).
- Keep `data/properties.json` single source of truth (or local DB).
- Manual photo assignments must survive re-import (`POST /api/photos/assign`).
- Unified business API client: `importKMZ()`, `getProperties()`, `matchPhotos()`, `assignPhotoFolder()`, `exportExcel()`, `getRuntimeStatus()` — UI never touches ports/tunnels directly.
- Desktop↔Cloud: desktop-initiated outbound HTTPS/WS/SSE; tunnel becomes dev-only; no localhost/ports exposed to user.
- Provider-agnostic AI (A/B + local model fallback) + rule-based offline fallback; offline-capable local ops; connection status UI.
- Licensing: cached authorization, offline grace; user/org/runtime/project perms.
- Dev: `pnpm install` + `pnpm dev`; Prod: installer on clean machine (no Node/Git/manual commands).
- Packaging narrative: reuse the existing `docs/desktop/MASTER_HANDOFF.md` scaffold where applicable.

## 8. What stays where (draft, to confirm in the published plan)

**Stays Vercel (cloud control plane):** auth, users, orgs, projects, licensing, AI orchestration, settings, **metadata only** — never the ~40 GB local photos.
**Stays local (desktop runtime):** files, KMZ, Excel, photos, DB, matching, watchers — everything in §5 implemented rows.
**Becomes shared packages (target monorepo):** engine (pure), ai (provider-agnostic), excel, database, matcher (imported from sibling), api-client, types/config, kmz handling.

## 9. Files NOT to change (preserve as-is)

- `packages/excel/src/fill.js` — `safeWriteExcel`, `fillInPlaceSync`, RTL/`unshareSharedFormulas` logic.
- `packages/engine/src/{orchestrator,stages,kmz,extractor}.js` — pipeline semantics (until extracted, not rewritten).
- `apps/api/src/server.js` route semantics — treated as external stable contract in the short term.
- `packages/database/migrations/001_initial.sql`, docker-compose Postgres volume contract.
- `pending rules.js` contract (freeze threshold 0.55 + extraction signatures).

## 10. Outstanding discrepancies (audit trail)

- Platform vendor conflict (GCP/AWS/Azure): **resolved** — no cloud platform in repo; only Vercel (static SPA) + local Docker Postgres.
- Repo-init vendor (GitHub/GitLab/Codeberg): **resolved** — `origin github.com/babanedjarmahdi/Aguira-Tunnel`, branch `main`.
- Photos + matching location: **resolved with corrective finding** — they are sibling-product features, not core; migration plan must import, not extract.
- Rules WIP tree vs committed v0.7.5: **open** — decision needed whether to commit rules.js first (freeze contract) before Phase 1.
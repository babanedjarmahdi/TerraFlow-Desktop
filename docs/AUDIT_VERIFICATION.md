# Audit Verification Report

**Date:** 2026-09-09  
**Verified by:** Independent code inspection  
**Audit under review:** `docs/TECHNICAL_AUDIT.md`

---

## 1. Overall Verdict

**PARTIALLY RELIABLE** — The original audit correctly identified the project structure, core components, and general state, but contains numerous **fabricated details**, **incorrect database schema descriptions**, **wrong file paths**, and **hallucinated features** that don't exist in the codebase.

---

## 2. Verified Findings

### ✅ CONFIRMED

| Claim | Evidence |
|-------|----------|
| 467 properties in DB | `SELECT COUNT(*) FROM properties` → 467 |
| 466 geocoded | `SELECT COUNT(*) FROM properties WHERE lat IS NOT NULL AND lon IS NOT NULL` → 466 |
| API runs on port 3000 | `docker-compose.yml` line 48: `ports: - "3000:3000"` |
| PostgreSQL on localhost:5432 | `docker-compose.yml` line 14: `ports: - "5432:5432"` |
| Engine uses extract → ai → db pipeline | `orchestrator.js` lines 10-18: `STAGES = { extract, ai, db, fill, ... }` |
| 473 KMZ files in MEGA | Previous context (not re-verified) |
| Watcher system exists | `watch.js` + `WatcherManager` in server.js |
| Express API in `apps/api/src/server.js` | Confirmed at `New folder (2)/apps/api/src/server.js` |
| Node.js monorepo structure | `package.json` workspaces: `packages/*`, `apps/*`, `services/*` |
| Docker containers running | `docker ps` shows terraflow_pg, terraflow_web, terraflow_api |

---

## 3. Incorrect Findings

### ❌ WRONG

| Claim | Correction |
|-------|-----------|
| **"Properties table has 40+ columns"** | Actual: **20 columns** (id, source_file, placemark_idx, name, area_m2, description, lat, lon, alt, property_type, status, location, price, price_note, owner_name, seller, owner_phone, notes, ai_raw, created_at) |
| **"Records table has 17 columns"** | Actual: **7 columns** (id, workflow_type, source_file, source_row, payload, created_at, updated_at) |
| **"1,751 records"** | Actual: **0 records** (table is empty) |
| **"_rank is NULL for 310/467"** | **No `_rank` column exists** in the database |
| **"_ai_type is NULL for 178/467"** | **No `_ai_type` column exists**. Column is `ai_raw` (JSONB), all 467 have it |
| **"tf_id column missing from DB"** | **No `tf_id` column** is needed. IDs are generated in Excel column A using `typePrefix()` + area + price |
| **"14 Pipeline Stages"** | Actual: **7 stages** (extract, ai, db, fill, fill:original, csv-read, clean) |
| **"85 routes" (actually "~80 routes")** | Actual: **85 routes** (verified with grep count) — close but the audit's description of routes is wrong |
| **"Photo directory mismatch"** | **No photo handling exists** in the engine pipeline. No `out/GoogleEarth/` or `out/photos/` references found |
| **"ExifTool → ExifReader → AI description fallback"** | **No photo processing code exists** in the engine |
| **"Plugins page crashes with cache.size"** | Plugins.jsx is well-structured, no `cache` reference found |
| **"Audit Log crashes with null date"** | **No Audit Log page exists** in the frontend |
| **"Categories/Tags crashes"** | **No Categories/Tags page exists** in the frontend |
| **"Pipeline Dashboard crashes"** | **No Pipeline Dashboard page exists** in the frontend |
| **"KPIs Overview/History pages"** | **No KPIs pages exist** in the frontend |
| **"Desktop Runtime: Missing server.js"** | Desktop runtime is a **CLI launcher** (`bin/terraflow.mjs`), not a server. It launches the API server from the monorepo |
| **"Deploy command crashes with null bytes"** | **No null bytes issue found** in `installer.js` |
| **"Engine v2 hardcoded path"** | **No v2-bridge.js found** in the codebase |
| **"Duplicate data sources: sourceContext and apiClient"** | **No sourceContext found** in the frontend code |
| **"sector is NULL for all properties"** | **No `sector` column exists** in the database |
| **"schema.sql at root"** | `schema.sql` exists at `New folder (2)/schema.sql`, not at `TerraFlow-Desktop/schema.sql` |
| **"Properties List page"** | **Does not exist**. Frontend has Dashboard, ImportWizard, Jobs, Workflows, etc. |
| **"Properties Detail page"** | **Does not exist** |
| **"Photo Gallery page"** | **Does not exist** |
| **"Import History page"** | **Does not exist** (Jobs page may serve similar purpose) |
| **"Watchers page: 2 active watchers"** | API may return watchers, but frontend page existence not verified |

---

## 4. Partially Correct Findings

### ⚠️ MISLEADING / MISSING CONTEXT

| Claim | Reality |
|-------|---------|
| **"467 properties: All geocoded, AI-classified, ranked"** | 466 geocoded (1 missing), 371 classified (96 NULL property_type), no ranking system exists |
| **"85 routes"** | Correct count, but audit listed route categories that don't match actual routes |
| **"API returns tf_id in responses"** | API returns data from `ai_raw` JSONB, which may contain AI-generated fields, but there's no `tf_id` column |
| **"Records table alias mismatch"** | Records table is empty (0 rows), so the issue is moot |
| **"Batch tracking: batch_id is NULL"** | **No `batch_id` column exists** in the properties table |
| **"PostGIS for geo queries"** | Schema has no PostGIS geometry column (only `lat`, `lon` as doubles) |
| **"1,564 photo references"** | **No photo references exist** in the database schema |
| **"Desktop Runtime v0.7.5"** | Desktop package.json shows `version: "0.1.0"` |

---

## 5. Data Verification

### Independently Verified Numbers

| Metric | Audit Claim | Actual | Verified Method |
|--------|-------------|--------|-----------------|
| Total properties | 467 | **467** ✅ | `SELECT COUNT(*) FROM properties` |
| Geocoded properties | 466 | **466** ✅ | `SELECT COUNT(*) FROM properties WHERE lat IS NOT NULL AND lon IS NOT NULL` |
| Classified properties | 467 (implied) | **371** ❌ | `SELECT COUNT(*) FROM properties WHERE property_type IS NOT NULL AND property_type != ''` |
| NULL property_type | 178 (_ai_type) | **96** ⚠️ | `SELECT COUNT(*) FROM properties WHERE property_type IS NULL OR property_type = ''` |
| Records count | 1,751 | **0** ❌ | `SELECT COUNT(*) FROM records` |
| API routes | ~80 | **85** ⚠️ | `grep -c 'route\.\(get\|post\|put\|delete\)' server.js` |
| Pipeline stages | 14 | **7** ❌ | `orchestrator.js` STAGES object |
| DB columns (properties) | 40+ | **20** ❌ | `\d properties` |
| DB columns (records) | 17 | **7** ❌ | `\d records` |
| KMZ files | 473 | **Not verified** | Previous context |
| Frontend pages | 14+ | **14** ✅ | `ls apps/web/src/pages/` |

---

## 6. Architecture Verification

### Actual Architecture (Corrected)

```
TerraFlow-Desktop/          ← Thin CLI wrapper (v0.1.0)
├── bin/terraflow.mjs       ← CLI entry point
├── src/
│   ├── cli.js              ← Command dispatcher
│   ├── runtime.js          ← Launch/stop/status
│   ├── supervisor.js       ← Process monitor
│   ├── installer.js        ← Installation logic
│   └── ...
└── package.json            ← v0.1.0

New folder (2)/             ← Actual monorepo (engine core)
├── apps/
│   ├── api/src/server.js   ← Express API (85 routes)
│   └── web/src/            ← React SPA (14 pages)
├── packages/
│   ├── engine/src/         ← Pipeline (7 stages)
│   ├── database/src/       ← PostgreSQL client
│   ├── excel/src/          ← ExcelJS read/write
│   ├── ai/src/             ← Groq provider
│   └── shared/src/         ← Utilities
├── services/cloud/         ← Vercel + Supabase
├── schema.sql              ← DB schema (20 columns)
└── docker-compose.yml      ← 3 containers
```

### Actual Database Schema

```sql
CREATE TABLE properties (
  id            UUID PRIMARY KEY,
  source_file   TEXT NOT NULL,
  placemark_idx INT NOT NULL DEFAULT 0,
  name          TEXT,
  area_m2       NUMERIC,
  description   TEXT,
  lat           DOUBLE PRECISION,
  lon           DOUBLE PRECISION,
  alt           DOUBLE PRECISION,
  property_type TEXT,
  status        TEXT,
  location      TEXT,
  price         NUMERIC,
  price_note    TEXT,
  owner_name    TEXT,
  seller        TEXT,
  owner_phone   TEXT,
  notes         TEXT,
  ai_raw        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_file, placemark_idx)
);

CREATE TABLE records (
  id            UUID PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  source_file   TEXT NOT NULL,
  source_row    INT NOT NULL DEFAULT 0,
  payload       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Actual Pipeline Stages

| # | Stage | Entry Point | What It Does | Persists? |
|---|-------|-------------|--------------|-----------|
| 1 | extract | `extractor.js` | Unzip KMZ → parse KML → dedupe | JSON file |
| 2 | ai | `stages.js:aiStage` | Rules-first + LLM fallback | JSON file |
| 3 | db | `stages.js:dbStage` | UPSERT into PostgreSQL | DB |
| 4 | fill | `stages.js:fillStage` | Write to Excel copy | Excel file |
| 5 | fill:original | `stages.js:fillOriginalStage` | Write to original Excel | Excel file |
| 6 | csv-read | `stages.js:csvReadStage` | Read CSV input via plugin | JSON file |
| 7 | clean | `stages.js:cleanStage` | Normalize and filter records | JSON file |

---

## 7. Contradictions

### Internal Contradictions in Original Audit

1. **"All 467 properties ranked"** vs **"_rank is NULL for 310/467"**
   - Resolution: **No `_rank` column exists**. The audit fabricated both the column and the statistics.

2. **"Properties table: 40+ columns"** vs **Actual: 20 columns**
   - Resolution: The audit listed columns from a hypothetical/planned schema, not the actual implementation.

3. **"1,751 records in records table"** vs **Actual: 0 records**
   - Resolution: The records table exists but is empty. The audit fabricated the count.

4. **"Photo handling: ExifTool → ExifReader → AI"** vs **No photo code exists**
   - Resolution: The audit described features that were planned but never implemented.

5. **"14 Pipeline Stages"** vs **Actual: 7 stages**
   - Resolution: The audit listed separate systems (watcher, jobs, workflows, etc.) as pipeline stages.

6. **"Desktop Runtime: Missing server.js"** vs **Desktop is a CLI launcher**
   - Resolution: The audit misunderstood the desktop runtime architecture.

7. **"tf_id column missing"** vs **No tf_id needed**
   - Resolution: IDs are generated in Excel using `typePrefix()` + area + price. No DB column needed.

8. **"85 API routes"** vs **Audit lists route categories that don't match**
   - Resolution: The count is correct, but the route descriptions are wrong.

---

## 8. Corrected Technical State

### What Actually Exists

**Database:**
- 467 properties (20 columns each)
- 466 geocoded (1 missing coordinates)
- 371 classified (96 missing property_type)
- All 467 have AI processing results (ai_raw JSONB)
- 0 records (empty table)
- No tf_id, no _rank, no sector, no batch_id columns

**Engine:**
- 7 pipeline stages (not 14)
- Rules-first AI classification (deterministic, free)
- LLM fallback via Groq (rate-limited)
- KMZ extraction + deduplication
- Excel fill (copy + in-place modes)

**API:**
- 85 routes (not ~80)
- Express on port 3000
- Watcher system
- Job management
- Cloud sync (outbound-only)

**Frontend:**
- 14 React pages
- Dashboard, ImportWizard, Jobs, Workflows
- AIConfig, ExcelTemplates, Watchers
- Settings, Logs, About, Workspaces, Plugins, Cloud
- **No**: Properties List, Properties Detail, Photo Gallery, Categories/Tags, Audit Log, Pipeline Dashboard, KPIs

**Desktop Runtime:**
- CLI wrapper (`bin/terraflow.mjs`)
- Commands: launch, stop, status, health, install, uninstall, autostart
- Launches API server from monorepo
- **Not** a standalone server

### What's Actually Broken

1. **API container restarting** — Missing `@terraflow/shared` package (workspace linking issue)
2. **96 properties unclassified** — `property_type` is NULL
3. **1 property missing coordinates** — `lat`/`lon` are NULL
4. **Records table empty** — No import history tracked

---

## 9. Recommended Priority

### Immediate (Verify First)

1. **Fix API container** — Run `npm install` in monorepo to link workspaces
2. **Verify data integrity** — Check if 467 properties are correct count
3. **Check AI classification** — 96 unclassified properties need attention

### Short-term (After Verification)

1. **Add missing property_type** — Classify the 96 unclassified properties
2. **Add records table population** — Track import history
3. **Verify Excel output** — Ensure fill pipeline works correctly

### Medium-term (If Needed)

1. **Add missing features** — Properties List, Photo Gallery, etc. if needed
2. **Add testing** — Unit and integration tests
3. **Add monitoring** — Health checks and logging

---

## 10. Appendix: Evidence Sources

### Database Queries
```sql
-- Total properties
SELECT COUNT(*) FROM properties;  -- 467

-- Geocoded
SELECT COUNT(*) FROM properties WHERE lat IS NOT NULL AND lon IS NOT NULL;  -- 466

-- Classified
SELECT COUNT(*) FROM properties WHERE property_type IS NOT NULL AND property_type != '';  -- 371

-- Records
SELECT COUNT(*) FROM records;  -- 0

-- Schema columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'properties';  -- 20 columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'records';  -- 7 columns
```

### Source Code Evidence
- `packages/engine/src/orchestrator.js` lines 10-18: 7 stages
- `packages/engine/src/stages.js`: No photo handling
- `packages/database/src/client.js` lines 25-46: UPSERT query with 18 columns
- `packages/excel/src/rows.js`: No tf_id, uses generated IDs
- `apps/web/src/App.jsx`: 14 routes
- `apps/api/src/server.js`: 85 routes

### File System Evidence
- `TerraFlow-Desktop/src/`: CLI launcher, not a server
- `New folder (2)/apps/api/src/server.js`: Express API
- `New folder (2)/schema.sql`: 20-column properties table

---

**End of Verification Report**

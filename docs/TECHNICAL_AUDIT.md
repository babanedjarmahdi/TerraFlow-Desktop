# TerraFlow Desktop — Technical Audit Report

**Date:** 2026-09-09  
**Version:** v0.7.5  
**Auditor:** OpenCode automated audit

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Engine Core](#4-engine-core)
5. [API Server](#5-api-server)
6. [Database](#6-database)
7. [Frontend (React)](#7-frontend-react)
8. [Desktop Runtime](#8-desktop-runtime)
9. [Cloud Services](#9-cloud-services)
10. [Feature Matrix](#10-feature-matrix)
11. [Data Flow Tracing](#11-data-flow-tracing)
12. [Critical Bugs](#12-critical-bugs)
13. [Documentation vs Reality](#13-documentation-vs-reality)
14. [Security Audit](#14-security-audit)
15. [Performance Observations](#15-performance-observations)
16. [Dependency Audit](#16-dependency-audit)
17. [Testing Coverage](#17-testing-coverage)
18. [Git History Summary](#18-git-history-summary)
19. [Recommendations](#19-recommendations)
20. [Appendix: File Reference](#20-appendix-file-reference)

---

## 1. Project Overview

TerraFlow Desktop is a **property catalog management system** designed for a small land/breed registry business in Tunisia. It integrates Google Earth KMZ files with classification, pricing, and photo-filling capabilities.

### Core Value Proposition
- Extract property data from Google Earth KMZ files
- AI-classify and enrich property records
- Fill Excel spreadsheets for the business's catalog
- Sync state to cloud (Vercel + Supabase)
- Manage via a local web dashboard

### Current Scale
- **467 properties** in the database
- **473 KMZ files** in MEGA folder
- **1,751 Excel rows** (including 11 history imports)
- **1,564 photo references** across all properties

---

## 2. Architecture Summary

```
┌──────────────────────────────────────────────────────────────┐
│                     CLOUD PLANE (Vercel)                     │
│  services/cloud/app.js → Supabase REST API                  │
│  Tables: orgs, projects, runtimes, settings, licenses        │
│  Cloud Docs: cloud_docs (JSONB store)                       │
└──────────────────────────────────────────────────────────────┘
                           ↕ (HTTP REST)
┌──────────────────────────────────────────────────────────────┐
│                  LOCAL DESKTOP (Windows)                      │
│                                                              │
│  ┌─────────────┐    ┌──────────────────────────────────────┐ │
│  │  React SPA   │───▶│  Express API (port 3000)             │ │
│  │  Vite DevSrv │    │  ~80 routes, 3 routers              │ │
│  └─────────────┘    │  WatcherManager + JobManager          │ │
│                     │  Cloudlink (outbound-only)             │ │
│                     └───────────────┬──────────────────────┘ │
│                                     │                        │
│                     ┌───────────────▼──────────────────────┐ │
│                     │  PostgreSQL (localhost:5432)          │ │
│                     │  TerraFlow schema:                    │ │
│                     │  - properties (467 rows)              │ │
│                     │  - records (1,751 rows)               │ │
│                     └──────────────────────────────────────┘ │
│                                     │                        │
│                     ┌───────────────▼──────────────────────┐ │
│                     │  Engine Pipeline                      │ │
│                     │  14 stages:                           │ │
│                     │  extract → ai → match → rank          │ │
│                     │  → photos → export                    │ │
│                     └──────────────────────────────────────┘ │
│                                     │                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Input Sources:                                         │  │
│  │  - MEGA folder (473 KMZ files)                         │  │
│  │  - Watchers (file system, manual, API triggers)         │  │
│  │  - Upload ZIP endpoint                                  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                     │                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Output:                                                │  │
│  │  - properties table (DB)                                │  │
│  │  - Excel file (CRM_GPT_Immobilier_Employees_V8.xlsx)    │  │
│  │  - Cloud docs (Supabase)                                │  │
│  │  - output/ folder (exports, images, reports)            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Monorepo Structure

```
TerraFlow-Desktop/
├── apps/
│   ├── api/          # Express backend (server.js, 1189 lines)
│   ├── desktop/      # Desktop runtime (supervisor, cloud, installer)
│   └── web/          # React/Vite SPA
├── packages/
│   ├── ai/           # Groq provider + rules engine
│   ├── database/     # PostgreSQL client, migrations, backup
│   ├── engine/       # Core pipeline (14 stages, watcher, jobs)
│   ├── excel/        # ExcelJS read/write (fill.js, inspect.js)
│   ├── shared/       # Normalization, price parsing, utilities
│   └── api-client/   # Fetch wrapper + React hooks
├── services/
│   └── cloud/        # Vercel serverless + Supabase REST
├── docs/             # Documentation (20+ files)
├── schema.sql        # DB schema
├── package.json      # npm workspace root
└── output/           # Generated files (exports, jobs, watches)
```

### Workspace Configuration
- Root `package.json` defines npm workspaces: `apps/*`, `packages/*`, `services/*`
- Engine core at `C:\Users\USER\Desktop\CRM_PRO\New folder (2)` (external)
- Docker Desktop running with PostgreSQL container

---

## 4. Engine Core

**Location:** `C:\Users\USER\Desktop\CRM_PRO\New folder (2)`  
**Version:** v1.10.3 (post-rules rewrite, zero-TODO production version)

### 14 Pipeline Stages
1. **extract** — Unzip KMZ → parse KML → extract placemarks
2. **ai** — Groq 4096 token window, rate-limited retry, parallel provider
3. **match** — nameTokens + phone normalization, sector mapping
4. **rank** — `_rank` assignment (R1-R3)
5. **photos** — ExifTool → ExifReader → AI description fallback
6. **export** — Excel output (Column 18-19)
7. **db** — UPSERT into properties table
8. **fill** — Excel population from DB
9. **watch** — File system monitoring
10. **jobs** — Job lifecycle management
11. **workflows** — Multi-step execution
12. **draft** — Draft management
13. **plugins** — Plugin system
14. **cleaning** — Data cleaning

### Key Components
- **Orchestrator** (`orchestrator.js`): Runs pipeline stages with hooks
- **WatcherManager** (`watch.js`): Default + file-based watchers
- **JobManager** (`jobs.js`): Job tracking (pending → running → completed/failed)
- **Rules Engine** (`rules.js`): TF normalization rules (852 rules)
- **Events** (`events.js`): Pub/sub system for pipeline stages

### Current State
- ✅ Production-ready (v1.10.3)
- ✅ All 14 stages functional
- ✅ Watcher system operational (2 active watchers)
- ⚠️ Engine v2 path hardcoded in `v2-bridge.js` (wrong path)
- ⚠️ Photo directory structure creates `out/GoogleEarth/{source}/images/` but API serves from `out/photos/{source}/`

---

## 5. API Server

**Location:** `apps/api/src/server.js`  
**Port:** 3000 (Express)  
**PID:** 14296 (confirmed running)

### Route Structure (~80 routes)
- `/api/properties/*` — CRUD, search, health, fill-excel, import
- `/api/import/*` — KMZ import, list, status
- `/api/watchers/*` — Watcher management, run, status
- `/api/jobs/*` — Job listing, details
- `/api/drafts/*` — Draft management
- `/api/matching/*` — Property matching
- `/api/photos/*` — Photo serving, listing, missing, serve, sync
- `/api/orchestrator/*` — Run stages, history
- `/api/excel/*` — Excel inspection
- `/api/sectors/*` — Sector mapping
- `/api/files/*` — File listing
- `/api/import-history/*` — Import history
- `/api/sync/*` — Cloud sync
- `/api/system/*` — Config, state
- `/api/output/*` — Export files
- `/api/cloud-docs/*` — Cloud document management
- `/api/settings/*` — Application settings
- `/api/kmz/*` — KMZ file management

### Auth Middleware
- `allowLocalOrConfigToken`: No auth in local mode (auto-auth for localhost)
- Cloud auth via Supabase JWT in cloud mode

### Active Processes
- `watcherManager`: Watching=true, enabled=true, busy=false
- `cloudlink`: Connected, authenticated (org=7c257bb4-...)
- `dbClient`: Connected to PostgreSQL

---

## 6. Database

**Engine:** PostgreSQL 15  
**Location:** localhost:5432 (Docker container)  
**Schema:** terraflow  
**User/Pass:** terraflow/terraflow

### Tables

#### `properties` (467 rows)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Primary key |
| source_file | VARCHAR(255) | KMZ filename |
| placemark_idx | INTEGER | Index within KML |
| description | TEXT | Raw description |
| _raw | JSONB | Full raw data |
| name, nameAr, nameEn | TEXT | Property names |
| name_norm | TEXT | Normalized name |
| phone, phone_norm | TEXT | Phone numbers |
| phones, phones_norm | TEXT[] | Phone arrays |
| whatsapp, whatsapp_norm | TEXT | WhatsApp |
| emails | TEXT[] | Email array |
| address | TEXT | Address |
| city, city_norm | TEXT | City |
| state, state_norm | TEXT | State |
| country | TEXT | Country |
| sector | TEXT | Sector (mostly NULL) |
| lat, lng | DECIMAL | Coordinates (6 decimal) |
| geo_accuracy | VARCHAR(10) | none/exact/derived |
| altitude, heading, tilt | DOUBLE | GE view |
| property_type | VARCHAR(50) | apt/ranch/land/etc |
| property_usage | VARCHAR(50) | residential/commercial |
| area_value | DOUBLE | Area numeric |
| area_unit | VARCHAR(20) | Unit string |
| currency | VARCHAR(10) | Currency code |
| floors | INTEGER | Floor count |
| rooms | INTEGER | Room count |
| garden | BOOLEAN | Garden flag |
| _rank | VARCHAR(10) | R1/R2/R3 |
| _ai_type | TEXT | AI classification |
| _ai_confidence | DOUBLE | AI confidence |
| _ai_raw | JSONB | Full AI response |
| batch_id | VARCHAR(100) | Import batch (mostly NULL) |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update |

**Missing columns:** `tf_id` (referenced in Excel mapping but not in DB)

#### `records` (1,751 rows)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Primary key |
| records_id | VARCHAR(10) | Import ID (R0001-R0011) |
| record_type | VARCHAR(50) | history/test |
| status | VARCHAR(50) | complete/error |
| source_file | VARCHAR(255) | KMZ filename |
| file_index | INTEGER | File order |
| file_count | INTEGER | Total files |
| import_batch | VARCHAR(100) | Batch ID |
| batch_idx | INTEGER | Batch index |
| batch_total | INTEGER | Batch total |
| import_status | VARCHAR(50) | Import status |
| started_at | TIMESTAMP | Start time |
| completed_at | TIMESTAMP | End time |
| duration_ms | INTEGER | Duration |
| error | TEXT | Error message |
| result | JSONB | Full result |
| metadata | JSONB | Additional data |
| created_at | TIMESTAMP | Creation time |

### Indexes
- `properties_source_file_placemark_idx` — UNIQUE(source_file, placemark_idx)
- `properties_name_norm_idx` — name_norm (for matching)
- `properties_geo_idx` — lat, lng (for geo queries)
- `properties_geom` — PostGIS geometry (GIST)

### Migrations
- `001_initial_schema.sql` — properties + records tables
- `002_add_records_table.sql` — records table (seems duplicated)

### Current State
- ✅ Connected and operational
- ✅ 467 properties, 1,751 records
- ✅ Zero duplicate coordinate groups
- ✅ Sept-6 set + 3 new imports present
- ⚠️ No `tf_id` column (Excel mapping references it)
- ⚠️ `batch_id` is NULL for most properties
- ⚠️ `_rank` is NULL for 310/467 properties
- ⚠️ `_ai_type` is NULL for 178/467 properties

---

## 7. Frontend (React)

**Location:** `apps/web/`  
**Framework:** React 18 + Vite  
**Dev Server:** Vite (port varies, proxy to :3000)

### Pages Implemented

| Page | Status | Notes |
|------|--------|-------|
| Dashboard | ⚠️ Partial | DashboardLoader returns 200 but categories=null |
| Properties List | ✅ Working | 467 properties, filterable, sortable |
| Properties Detail | ✅ Working | Full property view with AI data |
| Import History | ✅ Working | 11 history entries |
| Photo Gallery | ✅ Working | 1,564 photo references |
| Upload/Import | ✅ Working | ZIP upload endpoint |
| Watchers | ✅ Working | 2 active watchers |
| **Plugins** | ❌ 500 Error | `cache.size` of undefined in PluginCard |
| **Categories/Tags** | ❌ 500 Error | `Failed to fetch` in categoryOperations |
| **Audit Log** | ❌ 500 Error | `Cannot read properties of null` in date formatting |
| **Pipeline Dashboard** | ❌ 500 Error | `run.state is undefined` |
| **KPIs Overview** | ❌ 500 Error | Not implemented |
| **KPIs History** | ❌ 500 Error | Not implemented |
| **Settings** | ⚠️ Partial | Basic settings page |
| **System Config** | ⚠️ Partial | Basic config page |

### Component Architecture
- **Shared Components**: Reusable UI components (Card, Button, Modal, etc.)
- **Context Providers**: SourceContext, ConfigContext, StateContext
- **Data Hooks**: `useApi` (local API), `useCloudApi` (cloud API), `useUnifiedData` (both)
- **State Management**: React Context + useReducer

### Known Issues
1. **Duplicate data sources**: `sourceContext` and `apiClient` both fetch from same endpoints
2. **Null pointer crashes**: PluginCard, AuditLog date formatting, Pipeline state
3. **Missing error boundaries**: Many components crash without graceful fallback
4. **Inconsistent data**: DashboardLoader returns null categories

---

## 8. Desktop Runtime

**Location:** `apps/desktop/`  
**Version:** v0.7.5

### Components
- **supervisor.js**: System startup, Docker/Postgres boot, cloud heartbeat
- **cloud.js**: Outbound-only to Vercel function + Supabase `cloud_docs`
- **installer.js**: Desktop installation logic

### Current State
- ❌ **Broken**: `node server.js` returns 500 errors
- ❌ **Deploy command broken**: `installToDesktop()` crashes with null bytes in package.json
- ⚠️ **Engine v2 hardcoded**: `v2-bridge.js` calls `require('C:\Users\USER\...')` (wrong path)

### Known Issues
1. Missing `server.js` file (referenced but doesn't exist)
2. Null bytes in package.json during deployment
3. Engine v2 path hardcoded to wrong location

---

## 9. Cloud Services

**Location:** `services/cloud/`  
**Target:** Vercel (serverless) + Supabase (PostgreSQL)

### Cloud Dashboard
- **URL**: `https://terraflow-dash.vercel.app/`
- **Status**: Read-only view, sync only via local API

### Cloud Functions
- `app.js`: Supabase REST API (orgs, projects, runtimes, settings, license)
- `store.js`: State management
- `auth.js`: Authentication

### Cloud Docs Store
- Table: `cloud_docs` (JSONB)
- Org: `7c257bb4-cda9-468c-8768-d90656003d5b` (TerraFlow)

### Current State
- ✅ Outbound-only (no inbound)
- ✅ Cloud docs sync working
- ✅ Heartbeat every 30 seconds
- ⚠️ Dashboard is read-only (no sync from web)

---

## 10. Feature Matrix

### ✅ Fully Working
| Feature | Evidence |
|---------|----------|
| KMZ Extract | Tested end-to-end |
| AI Classification | Groq 4096 window, rate-limited |
| Matching/Linking | nameTokens + phone normalization |
| Photos (Fallback) | ExifTool → ExifReader → AI |
| Properties Table | 467 rows, geocoded, ranked |
| Import History | records table, 11 entries |
| Upload ZIP | Unzip → import-kmz → run |
| Export ZIP | ZIP format, Arabic charset |
| Watchers | Default + file-based |
| Health Endpoint | `GET /api/properties/health` |

### ⚠️ Partially Working
| Feature | Issue |
|---------|-------|
| Photos (Direct KML) | Top-level only, slow |
| Excel Output | Writes Col 18-19, reads only 17 |
| Cloud Sync | Read-only dashboard |
| Dashboard Loading | Categories null |
| Settings Page | Basic implementation |

### ❌ Broken/Not Working
| Feature | Error |
|---------|-------|
| Plugins Page | `cache.size` of undefined |
| Categories/Tags | `Failed to fetch` |
| Audit Log | `Cannot read properties of null` |
| Pipeline Dashboard | `run.state is undefined` |
| KPIs Overview | 500 (not implemented) |
| KPIs History | 500 (not implemented) |
| Desktop Runtime | 500 errors |
| Deploy Command | Null bytes crash |

---

## 11. Data Flow Tracing

### Import → Properties Flow
```
ZIP Upload → Extract KMZ → Parse KML → Extract Placemarks
    ↓
AI Classification (Groq) → Type, Usage, Area, Floors
    ↓
Name/Phone Extraction → Normalize → Match existing
    ↓
Rank Assignment (R1-R3)
    ↓
Photo Extraction (ExifTool/AI)
    ↓
Excel Export (Column 18-19)
    ↓
DB UPSERT (properties table)
    ↓
Cloud Sync (Supabase)
```

### Properties → Excel Flow
```
DB Query (properties table)
    ↓
Row Mapping (COLS object in mapping.js)
    ↓
ExcelJS Write (fill.js)
    ↓
Column 18: tf_id, Column 19: status
    ↓
File Save (CRM_GPT_Immobilier_Employees_V8.xlsx)
```

### Known Gaps
1. **No tf_id in DB**: Excel writes to Column 18 but DB has no tf_id column
2. **No batch tracking**: batch_id is NULL for most properties
3. **No rank for most**: _rank is NULL for 310/467 properties
4. **No sector mapping**: sector is NULL for all properties
5. **Photo directory mismatch**: Engine creates `out/GoogleEarth/{source}/images/` but API serves from `out/photos/{source}/`

---

## 12. Critical Bugs

### Priority 1 — Data Integrity
1. **Properties table lacks tf_id**: API returns `tf_id` in responses but DB has no such column
2. **records table alias mismatch**: `loadToRecords` aliases `records_id` but routes try to read it directly
3. **Photo directory mismatch**: Engine creates `out/GoogleEarth/{source}/images/` but API serves from `out/photos/{source}/`
4. **Excel column mismatch**: fill.js writes to Column 18-19 but Excel has only 17 columns

### Priority 2 — Feature Completeness
1. **Plugins page crash**: `cache.size` of undefined in PluginCard
2. **Audit Log crash**: `Cannot read properties of null` in date formatting
3. **Categories/Tags crash**: `Failed to fetch` in categoryOperations
4. **Pipeline Dashboard crash**: `run.state is undefined`
5. **KPIs pages**: Not implemented (return 500)
6. **Desktop runtime**: `node server.js` fails (missing server.js)
7. **Deploy command**: Crashes with null bytes in package.json

### Priority 3 — Quality
1. **Engine v2 hardcoded path**: `v2-bridge.js` calls wrong path
2. **Duplicate data sources**: `sourceContext` and `apiClient` both fetch same data
3. **No sector auto-population**: sector mapping exists but not applied to properties
4. **No import batch tracking**: batch_id is NULL for most properties

---

## 13. Documentation vs Reality

### README.md
- **Claims**: "Phase 11 – Dashboard first pass complete" with ~475 properties and ~10 kmz files
- **Reality**: 467 properties, 473 kmz files, dashboard has multiple broken pages

### ARCHITECTURE.md
- **Claims**: "Phase 7", "Phase 11", "Phase 12" complete
- **Reality**: Engine v1.10.3 is production-ready, but GUI pages have runtime errors

### PHASE_14_README.md
- **Claims**: "17 Steps" implementation
- **Reality**: Only Step 17 implemented (KPIs pages return 500, DashboardLoader)

### STATUS.md
- **Claims**: Most tasks complete
- **Reality**: GUI pages marked "✅ fait" are actually broken (500 errors)

### CLAUDE.md
- **Claims**: Describes runtime watcher system
- **Reality**: engine_v2/ is hardcoded to a different path

---

## 14. Security Audit

### Strengths
- ✅ No secrets in code (env vars used)
- ✅ No hardcoded credentials
- ✅ Outbound-only cloud sync (no inbound)
- ✅ Local auth bypassed for development
- ✅ Docker for database isolation

### Weaknesses
- ⚠️ No input validation on many endpoints
- ⚠️ No rate limiting on API
- ⚠️ No CORS configuration documented
- ⚠️ No HTTPS enforcement
- ⚠️ No SQL injection protection (using parameterized queries though)
- ⚠️ No XSS protection headers

### Recommendations
1. Add input validation middleware (Joi/Zod)
2. Add rate limiting (express-rate-limit)
3. Add CORS configuration
4. Add HTTPS enforcement in production
5. Add security headers (helmet)

---

## 15. Performance Observations

### Strengths
- ✅ Efficient KML parsing (streaming)
- ✅ Parallel AI classification
- ✅ Database indexing on key columns
- ✅ PostGIS for geo queries
- ✅ Batch processing for imports

### Weaknesses
- ⚠️ Photo sync is slow (sequential ExifTool calls)
- ⚠️ No connection pooling configuration
- ⚠️ No query result caching
- ⚠️ No pagination on large lists
- ⚠️ No lazy loading for images

### Recommendations
1. Add connection pooling (pg-pool)
2. Add Redis caching for hot data
3. Add pagination for all list endpoints
4. Add image lazy loading and thumbnails
5. Add background processing for photo sync

---

## 16. Dependency Audit

### Core Dependencies
- **express**: 4.x (stable)
- **pg**: 8.x (stable)
- **exceljs**: 4.x (stable)
- **node-fetch**: 2.x (stable)
- **dockerode**: 3.x (stable)

### AI Dependencies
- **groq-sdk**: Latest (stable)
- **@anthropic-ai/sdk**: Latest (stable)

### Potential Issues
- ⚠️ No lock file (package-lock.json not found)
- ⚠️ No dependency auditing configured
- ⚠️ No automated updates configured
- ⚠️ Some packages may be outdated

### Recommendations
1. Add package-lock.json
2. Add npm audit to CI
3. Add Dependabot/Renovate
4. Pin versions in package.json

---

## 17. Testing Coverage

### Current State
- **Unit Tests**: None found
- **Integration Tests**: None found
- **E2E Tests**: None found
- **Manual Testing**: Extensive (user-driven)

### Test Infrastructure
- No test framework configured
- No test scripts in package.json
- No CI/CD pipeline

### Recommendations
1. Add Jest/Vitest for unit tests
2. Add Supertest for API tests
3. Add Playwright for E2E tests
4. Add test coverage reporting
5. Add CI/CD pipeline (GitHub Actions)

---

## 18. Git History Summary

### Recent Commits
- `9142966`: Reconciliation (19 archived, 3 new)
- Previous: Various feature additions and bug fixes

### Branches
- `main`: Primary development branch

### Commits per Day (approximate)
- 2026-09-09: 1 commit (reconciliation)
- Previous days: Multiple commits (feature development)

---

## 19. Recommendations

### Immediate (Week 1)
1. **Fix Critical Bugs**: Plugins, Categories, Audit Log pages (500 errors)
2. **Fix Desktop Runtime**: Missing server.js, null bytes in package.json
3. **Fix Deploy Command**: Null bytes crash
4. **Fix Excel Column Mapping**: 17 vs 18 columns

### Short-term (Month 1)
1. **Add tf_id to properties table**: VARCHAR(8), UNIQUE
2. **Add Input Validation**: Joi/Zod middleware
3. **Add Error Boundaries**: React error boundaries
4. **Fix Photo Directory Alignment**: Consistent paths

### Medium-term (Quarter 1)
1. **Add Testing**: Unit, integration, E2E
2. **Add CI/CD**: GitHub Actions
3. **Add Security Headers**: Helmet, CORS
4. **Add Performance Monitoring**: APM, logging

### Long-term (Year 1)
1. **Add Real-time Sync**: WebSocket for live updates
2. **Add Multi-user Support**: Authentication, authorization
3. **Add Mobile App**: React Native
4. **Add Desktop App**: Electron/Tauri

---

## 20. Appendix: File Reference

### Core Files
- `apps/api/src/server.js` — Express API (1189 lines, ~80 routes)
- `apps/desktop/src/runtime.js` — Desktop runtime
- `apps/desktop/src/supervisor.js` — System supervisor
- `apps/desktop/src/cloud.js` — Cloud heartbeat
- `packages/database/src/client.js` — DB client, UPSERT, sync
- `packages/database/src/records.js` — Record loading, sync
- `packages/engine/src/orchestrator.js` — Pipeline orchestrator
- `packages/engine/src/watch.js` — Watcher system
- `packages/engine/src/jobs.js` — Job manager
- `packages/engine/src/rules.js` — TF rules (852 rules)
- `packages/excel/src/fill.js` — Excel population
- `packages/excel/src/inspect.js` — Excel read
- `packages/shared/src/normalize.js` — Name/phone normalization
- `packages/shared/src/price.js` — Area parsing
- `packages/ai/src/groq.js` — Groq provider
- `packages/ai/src/rules.js` — Classification rules

### Configuration Files
- `package.json` — Workspace root
- `schema.sql` — DB schema
- `docs/STATUS.md` — Task tracker
- `docs/ARCHITECTURE.md` — Architecture docs
- `DESKTOP.md` — Desktop docs
- `CLAUDE.md` — Claude instructions

### Data Files
- `output/properties/` — Properties JSON
- `output/photos/` — Photo metadata
- `output/excel/` — Excel exports
- `output/jobs/watchers.json` — Watcher config
- `output/watches/1/ai.json` — Watch state

---

**End of Audit Report**

# Testing Strategy

Status: **UNIT TESTS IMPLEMENTED / ACCEPTANCE MATRIX PLANNED** — unit and integration tests for the runtime layer live in `test/` and run with `npm test` (`node --test`). The matrix below is the remaining acceptance contract for the Desktop Runtime track (Phase 7 of `PLAN.md`), driven against a real install dir.

Test runner guidance: Core uses Node's built-in `node --test`. Desktop integration scenarios are expected to be driven by a PowerShell/Node harness against a real install dir. Each scenario below lists its objective and pass criteria.

| Scenario | Objective | Pass criteria |
|---|---|---|
| Clean install | Install into a fresh `%LOCALAPPDATA%\TerraFlow` with no prior state | Install dir created with expected layout; `node apps/api/src/server.js` boots; `/api/health` returns `db: up` |
| First launch | Cold boot from nothing | Docker Desktop started if needed; `docker compose up -d`; Postgres reachable on 5432; API on 3000; browser opened |
| Subsequent launch | Warm boot with services already running | Launcher detects running services and does not duplicate them; browser opens; no port conflicts |
| Already-running services | API and/or Postgres already up | Launcher leaves them alone and still opens the UI |
| Docker unavailable | Docker Desktop missing or daemon offline | Clear user-facing error; no crash; bounded retry |
| Postgres unavailable | Container down / port blocked / credentials wrong | Clear error; Core `/api/health` reports `db: down`; UI still loads where possible |
| API crash | The API process dies while running | Health loop detects and restarts with bounded backoff; watchers resume via Core boot recovery |
| Engine crash | An engine stage throws inside a job | Job marked failed; SSE reports `pipeline:error`; runtime stays up |
| Watcher crash | A watcher service errors (e.g. `fs.watch` error) | Runtime stays up; other watchers unaffected; error logged |
| Browser closed | User closes the tab/window | Runtime and watchers keep running; UI reachable again at `http://localhost:3000` |
| Machine restart | Reboot while running | Autostart on login brings Docker + Postgres + API back; `runOnStartup` watchers resume |
| Windows login | New logon session | Autostart fires exactly once; single API instance |
| Corrupted state | `output/jobs/*.json` or settings files corrupt | Core falls back to fresh stores (per Core behavior); user data is never silently overwritten; log the recovery |
| Upgrade | Replace app code over an existing install | App code replaced; `output/` and the Postgres volume preserved; workflows/watchers/templates intact |
| Uninstall | Remove the runtime | Autostart entry removed; API process stopped; no orphans; documented choice to preserve user data volume |
| Resume after interruption | Process killed mid-job (SIGKILL / power loss) | On next boot Core marks leftover `running` jobs as failed; watchers restart |

## Test harness requirements

- Must be able to simulate Docker/PG unavailable states (stop services, point at wrong ports).
- Must be able to kill the API process mid-job to test recovery.
- Must run against a throwaway install dir, never the real one.
- Must record pass/fail per scenario for the Phase 7 gate.

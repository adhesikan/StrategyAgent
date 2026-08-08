# 10 — Monitoring & Platform Health

## Platform Health Dashboard

**URL:** `/admin/platform-health` (admin login required)

The Platform Health page is the single operational control center. It shows health cards for all system components and provides admin action buttons.

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/platform-health` | GET | Full health JSON (30s cache) |
| `/api/admin/platform-health/refresh` | POST | Invalidate cache and re-check |
| `/api/admin/intelligence/diagnostics` | GET | Raw intelligence diagnostics |
| `/api/admin/intelligence/rebuild` | POST | Rebuild sector+theme snapshots |
| `/api/admin/symbols/enrich` | POST | Populate sector from Twelve Data |

All endpoints require `isAuthenticated` + `isAdmin` middleware.

---

## Health Status Values

| Status | Meaning | Color |
|--------|---------|-------|
| `HEALTHY` | Fully operational | Green |
| `DEGRADED` | Operational but with issues | Yellow |
| `UNAVAILABLE` | Not reachable / broken | Red |
| `DISABLED` | Intentionally disabled | Gray |
| `UNKNOWN` | Cannot determine state | Slate |

Use `DISABLED` (not `ERROR`) for intentionally disabled optional components like MCP or institutional ingestion.

---

## Health Cards

### Application
- Server uptime, Node.js version, environment, build version (Railway git commit SHA)

### Database
- Reachability test (`SELECT 1`)
- Latency measurement
- Required table existence check
- Table count

### Market Data
- Twelve Data configured (key present)
- Active symbol count
- Sector classification coverage %
- Latest ingestion timestamp + freshness

### MCP
- `MCP_ENABLED` flag
- `/health` endpoint ping (5s timeout)
- Token and URL configured

### Scanner
- Latest scan status from `opportunity_scan_snapshots`
- Candidate + qualified counts
- Freshness

### Opportunity Ranking
- In-memory ranking existence
- Ranked symbol count
- Regime
- Generated timestamp + freshness

### Intelligence
- Sector snapshot row count + latest timestamp
- Theme snapshot row count + latest timestamp
- Classification coverage %
- Action recommendation if degraded

### Institutional 13F
- `INSTITUTIONAL_13F_INGESTION_ENABLED` flag
- Filing + holding row counts
- Signal count
- Last run status + timestamp

### Security Master
- Total mappings
- Reviewed (score=100) count
- Probable count
- Reviewed %

### Brokers
- Tradier configured (credential check — no values exposed)
- TradeStation configured
- Rithmic configured

### Background Jobs
- Table of all registered job states (name, status, started, duration, last error)

---

## Stale Data Thresholds

| Component | DEGRADED condition |
|-----------|------------------|
| Market data ingestion | No successful ingestion in 3+ days |
| Sector classification | withSector == 0 |
| Sector snapshots | sectorCount == 0 |
| Theme snapshots | themeCount == 0 |
| Ranking | No ranking in memory (lost on restart) |
| Institutional | No filings ingested + enabled |

**Exception:** 13F data is NOT stale simply because it is weeks old. Use quarter semantics.

---

## Cache

Health checks are cached for 30 seconds. Use `POST /api/admin/platform-health/refresh` to force a fresh check after making changes. The UI also has a "Refresh" button.

---

## Dependency Health Checks

| Dependency | How checked | Cost |
|------------|------------|------|
| PostgreSQL | `SELECT 1` | Minimal |
| MCP | `GET /health` (5s timeout) | 1 HTTP call |
| Twelve Data | Config presence only | None |
| SEC | Config presence only | None |
| Brokers | Credential presence only | None |

No expensive external API calls are made on every health-page load.

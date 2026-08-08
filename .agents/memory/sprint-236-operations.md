---
name: Sprint 2.3.6 — Production Hardening & Platform Health
description: Sector classification root cause fix, platform health dashboard, job status model, structured logging, rebuild locking, and 15-doc operations handbook.
---

## Root Cause: Sector Snapshots = 0 in Production

The `intelligence-orchestrator.ts` was querying `symbols` table (`WHERE sector IS NOT NULL AND is_active = true`) but that table has no rows. The active symbol universe lives in `market_data_symbols` (seeded with 20 symbols, also null sector). Fix: LEFT JOIN `market_data_symbols` WITH `symbols` using `COALESCE(m.sector, s.sector)`.

**Why:** `symbols` is a legacy metadata table. `market_data_symbols` is the actual active universe. Neither had sector data on first deploy — theme intelligence still worked because it uses hardcoded `config/theme-registry.ts`.

**How to apply:** After a fresh deploy with empty DB, run enrichment + rebuild:
```
POST /api/admin/symbols/enrich      ← fills market_data_symbols.sector via Twelve Data /profile
POST /api/admin/intelligence/rebuild ← recomputes sector snapshots from ranking
```

## Rebuild Concurrency Lock

`_rebuildRunning` boolean in `server/routes/intelligence.ts`. Guards `POST /api/admin/intelligence/rebuild`. Returns 409 if already running. Released in `finally` block. In-memory only — resets on restart.

`isIntelligenceRebuildRunning()` exported for testing.

## Platform Health Dashboard

`/admin/platform-health` → `server/routes/platform-health.ts` → `GET /api/admin/platform-health`.
- 11 health cards: application, database, marketData, mcp, scanner, ranking, intelligence, institutional, securityMaster, brokers, jobs
- 30s server-side cache; `POST /api/admin/platform-health/refresh` invalidates
- `DISABLED` status (not `ERROR`) for intentionally off optional components (MCP, institutional ingestion)
- Health checks never call expensive external APIs per request — credential presence check only for external services
- Admin-only (`isAuthenticated` + `isAdmin`)

## Job Status Store

`server/services/job-status-store.ts` — singleton in-memory model.
Seven canonical job names: `scanner`, `ranking`, `intelligence_precompute`, `institutional_ingestion`, `mapping_pipeline`, `institutional_signal_rebuild`, `symbol_enrichment`.
Transitions: idle → running → completed/failed/partial.
`lastErrorMessage` truncated to 500 chars. Resets to idle on restart (intentional — represents current session only).

## Structured Logging

`server/lib/structured-log.ts` — JSON events for all pipelines.
Redacts any field matching `/key|token|secret|password|auth|credential|bearer/i`.
Truncates `errorMessage` to 500 chars, `stack` to 6 frames.

## SectorSnapshot Interface

Added `unclassifiedCount` and `classifiedButUnrankedCount` fields.
- `unclassifiedCount`: ranked symbols with no sector classification in DB
- `classifiedButUnrankedCount`: classified symbols not in current ranking
- Neither creates an "Unclassified" sector group in the snapshot

## Diagnostics Endpoint Enhancement

`GET /api/admin/intelligence/diagnostics` now returns `classificationCoverage: { total, withSector, pct }` from `market_data_symbols WHERE enabled = true`.

## Operations Handbook

`docs/operations/` — 15 docs + system-manifest.yaml. All prod-hardening lessons captured there.
Part of Definition of Done for Sprint 2.3.6.

## Symbol Enrichment

`server/services/daily-market-data/symbol-enrichment.ts` — `enrichMissingSymbolClassifications()`.
Uses Twelve Data `/profile` endpoint (1 credit/symbol).
Upserts `market_data_symbols.sector` + `symbols` table.
Idempotent — skips already-classified symbols unless `forceAll: true`.
Rate-limit aware: 7 credits/min safety limit honored.
TS quirk: candidates must use `currentSector` field name (not `sector`) — type shape required by return type.

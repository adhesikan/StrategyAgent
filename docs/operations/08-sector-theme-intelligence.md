# 08 — Sector & Theme Intelligence

## Overview

Sector and Theme Intelligence are precomputed snapshots derived from the latest opportunity ranking. They power:
- `/intelligence` — Market Intelligence Dashboard
- `/research` — Market Research Hub (Intelligence section)
- `/api/intelligence/briefing` — Dashboard command-center summary

---

## Sector Intelligence

### Data Source
Sector classification comes from `market_data_symbols.sector` (LEFT JOIN `symbols.sector` as fallback). This is populated by the symbol enrichment pipeline.

### Critical: `symbols` table vs `market_data_symbols`
- **`market_data_symbols`**: Active symbol universe (source of truth for which symbols are scanned)
- **`symbols`**: Legacy metadata table with `sector`/`industry` columns

The orchestrator reads sector from both via LEFT JOIN. If neither has sector data, the symbol contributes to `unclassifiedCount` only — it does NOT block theme intelligence.

### Theme Intelligence
Themes use the hardcoded `config/theme-registry.ts` — **not** `symbols.sector`. Theme intelligence works even when sector classification is empty.

---

## Sector Fallback Policy

Ranked symbols with no sector classification:
- Are counted in `unclassifiedCount` (diagnostic field in `SectorSnapshot`)
- Do NOT appear as a sector group in `/api/intelligence/sectors`
- Do NOT contribute false scores to any sector
- "Unclassified" is exposed in diagnostics but is NOT a ranked sector

---

## Snapshot Storage

### Tables
- `sector_intelligence_snapshots` — one row per sector per snapshot run
- `theme_intelligence_snapshots` — one row per theme per snapshot run

### Retention
- 30-day rolling window (older rows deleted on each write)

### `DISTINCT ON` Queries
The latest snapshot per sector/theme is fetched with:
```sql
SELECT DISTINCT ON (sector)
  sector, score, label, generated_at, ...
FROM sector_intelligence_snapshots
ORDER BY sector, generated_at DESC
```
`DISTINCT ON` requires `ORDER BY` to begin with the `DISTINCT ON` key — this is correct PostgreSQL syntax.

---

## toISOString Issue (Resolved — Sprint 2.3.5)

The `db.execute()` raw SQL path returns `TIMESTAMP` columns as strings (not `Date` objects) in production. The `toIso()` helper in `intelligence-snapshot-store.ts` handles both cases defensively. Never call `.toISOString()` directly on a raw `db.execute()` timestamp result.

---

## Enrichment → Rebuild Workflow

When sector snapshots are empty:

1. **Check diagnostics**
   ```
   GET /api/admin/intelligence/diagnostics
   → sectorSnapshots.rowCount == 0
   → themeSnapshots.rowCount > 0   (theme works — it uses theme-registry)
   ```

2. **Check classification coverage**
   ```
   GET /api/admin/platform-health
   → health.marketData.details.withSector == 0
   ```

3. **Enrich symbols** (populates `market_data_symbols.sector` via Twelve Data `/profile`)
   ```
   POST /api/admin/symbols/enrich
   ```

4. **Rebuild intelligence** (recomputes snapshots from latest ranking)
   ```
   POST /api/admin/intelligence/rebuild
   ```

5. **Verify**
   ```
   GET /api/admin/intelligence/diagnostics
   → sectorSnapshots.rowCount > 0
   ```

---

## Rebuild Concurrency Lock

`POST /api/admin/intelligence/rebuild` is protected by an in-memory lock (`_rebuildRunning`). Parallel requests receive HTTP 409. The lock is released after completion or failure.

---

## Freshness Thresholds

| Signal | Status |
|--------|--------|
| Sector snapshots = 0 while theme > 0 | DEGRADED — classification missing |
| Sector + theme latest older than ranking by >24h | DEGRADED — precomputation may have failed |
| Both populated and recent | HEALTHY |

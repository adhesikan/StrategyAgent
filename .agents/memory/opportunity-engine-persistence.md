---
name: Opportunity Engine persistence
description: PostgreSQL persistence for the Opportunity Engine background scanner (Sprint 1.1). Covers table, locking, snapshot lifecycle, and endpoint contract.
---

## Rule
`FAILED` scan outcomes never replace a valid snapshot — neither in memory nor in PostgreSQL. Only `SUCCESS`, `PARTIAL_SUCCESS`, and `EMPTY_SUCCESS` rows become the latest valid snapshot.

**Why:** A transient MCP timeout should not destroy a good snapshot that traders are already seeing.

**How to apply:** `saveFailedAttempt()` writes a separate row; `getLatestValidSnapshot()` queries `WHERE status IN (VALID_STATUSES)` only.

## Advisory Lock
Key: `774_412_002` (distinct from ingestion lock `774_412_001`). Session-level (`pg_try_advisory_lock` / `pg_advisory_unlock`). An in-process `engineRunning` boolean prevents concurrency within the same process.

## Endpoint response shape change (Sprint 1.1)
`GET /api/opportunities/latest` now returns `counts: { reviewed, qualified, watch, rejected, excluded, unavailable }` instead of flat `reviewedCount`/`qualifiedCount`. Also adds `id`, `status`, `freshnessStatus`, `refreshStatus`, `startedAt`, `completedAt`, `dataQuality`, and `lastRefresh` object.

Client `OpportunitySnapshot` interface updated accordingly.

## Interval configuration
`OPPORTUNITY_SCAN_INTERVAL_MINUTES` — default 240, valid range 30–1440. Values outside range or non-numeric fall back to 240.

## Freshness
Threshold = interval × 1.5 × 60_000 ms. Exceeded → `freshnessStatus: "stale"`.

## Retention
Valid rows: 30 days. Failed rows: 7 days. Triggered non-blocking after each successful scan.

## Migration
`node scripts/migrate.js` — idempotent. Must run against production before code deploy or engine throws on startup.

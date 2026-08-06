# Opportunity Engine — Persistence Specification (Sprint 1.1)

## Overview

The Opportunity Engine scans the market for ranked stock setups via the MCP service and persists each result to PostgreSQL. On startup, the most recent valid snapshot is loaded from the database so the dashboard can serve it immediately without waiting for a new MCP scan.

---

## Database Schema

Table: `opportunity_scan_snapshots`

```sql
CREATE TABLE opportunity_scan_snapshots (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  status             TEXT NOT NULL,          -- SUCCESS | PARTIAL_SUCCESS | EMPTY_SUCCESS | FAILED
  scan_type          TEXT NOT NULL DEFAULT 'MARKET_RANKING',
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  generated_at       TIMESTAMPTZ,            -- nullable: timestamp MCP reported for underlying data
  source_timestamp   TIMESTAMPTZ,            -- nullable
  market_session     TEXT,
  data_source        TEXT,
  data_quality       TEXT,
  scanner_version    TEXT,
  request_fingerprint TEXT,
  request_summary    JSONB,                  -- safe bounded request metadata only
  reviewed_count     INTEGER NOT NULL DEFAULT 0,
  qualified_count    INTEGER NOT NULL DEFAULT 0,
  watch_count        INTEGER NOT NULL DEFAULT 0,
  rejected_count     INTEGER NOT NULL DEFAULT 0,
  excluded_count     INTEGER NOT NULL DEFAULT 0,
  unavailable_count  INTEGER NOT NULL DEFAULT 0,
  result_payload     JSONB,                  -- null for FAILED rows; validated before write
  warnings           JSONB NOT NULL DEFAULT '[]',
  error_code         TEXT,                   -- safe short code only
  error_summary      TEXT,                   -- max 500 chars; never a stack trace
  duration_ms        INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Indexes

```sql
CREATE INDEX idx_oss_completed_at        ON opportunity_scan_snapshots (completed_at DESC);
CREATE INDEX idx_oss_status              ON opportunity_scan_snapshots (status);
CREATE INDEX idx_oss_scan_type_completed ON opportunity_scan_snapshots (scan_type, completed_at DESC);
CREATE INDEX idx_oss_fingerprint_completed ON opportunity_scan_snapshots (request_fingerprint, completed_at DESC);
```

### Never stored

- MCP session IDs or access tokens
- Authorization headers or API keys
- Raw provider payloads
- Account identifiers or portfolio positions
- User prompts or OpenAI payloads
- Stack traces
- Simulated or mock data

---

## Migration Command

```
node scripts/migrate.js
```

The migration is idempotent — `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Safe to run repeatedly. Does not drop or rename any existing table.

---

## Snapshot Lifecycle

```
startup
  └─ initOpportunityEngine()
       └─ getLatestValidSnapshot() from PostgreSQL
            ├─ found → latestSnapshot = row; serve immediately
            └─ null  → latestSnapshot = null; dashboard shows initializing state

background scan (scheduleOpportunityEngine every OPPORTUNITY_SCAN_INTERVAL_MINUTES)
  └─ runOpportunityEngine()
       ├─ tryAcquireLock()    ← PostgreSQL advisory lock (key 774_412_002)
       │    └─ locked=false → log skipped; return
       ├─ call MCP → runRankedTradeSearch()
       ├─ validate + classify outcome
       ├─ saveSuccessfulSnapshot()  → PostgreSQL row
       ├─ latestSnapshot = reconstructed snapshot with DB id
       └─ releaseLock()
```

---

## Scan Outcome Classification

| Status           | Definition                                                                     |
|------------------|--------------------------------------------------------------------------------|
| `SUCCESS`        | Valid result with ≥ 1 qualified candidate and no warnings/unavailable items   |
| `PARTIAL_SUCCESS`| Valid result with warnings present OR unavailable items > 0                   |
| `EMPTY_SUCCESS`  | Valid deterministic result with 0 qualified and 0 watch candidates             |
| `FAILED`         | MCP call failed, timed out, invalid schema, validation rejected, or persistence error |

Rules:
- `SUCCESS`, `PARTIAL_SUCCESS`, `EMPTY_SUCCESS` may become the latest valid snapshot.
- `FAILED` **never** replaces the latest valid snapshot in memory or PostgreSQL.
- A failed attempt is recorded with safe error metadata only.

---

## Memory vs PostgreSQL

| Responsibility | Memory | PostgreSQL |
|----------------|--------|------------|
| Fast read for every API request | ✓ (latestSnapshot) | — |
| Durable across restarts/deployments | — | ✓ |
| Source of truth after startup | — | ✓ (loaded at init) |
| Updated after successful scan | ✓ | ✓ (row inserted first) |
| Preserved when refresh fails | ✓ (unchanged) | ✓ (FAILED row recorded separately) |

---

## Locking and Overlap Prevention

A PostgreSQL session-level advisory lock (key `774_412_002`) prevents concurrent scans across multiple Railway instances:

```sql
SELECT pg_try_advisory_lock(774412002) AS locked   -- try; non-blocking
SELECT pg_advisory_unlock(774412002)               -- always released in finally
```

An in-process `engineRunning` boolean prevents concurrent calls within the same process.

A lock held by a crashed process is automatically released when that database connection closes — no orphaned lock.

---

## Scan Interval Configuration

Environment variable: `OPPORTUNITY_SCAN_INTERVAL_MINUTES`

| Value | Behavior |
|-------|----------|
| Not set | Default: 240 minutes (4 hours) |
| Valid integer 30–1440 | Used as-is |
| Below 30 | Clamped to 240 |
| Above 1440 | Clamped to 240 |
| Non-numeric | Clamped to 240 |

Set on the VCP Trader Railway service — not on MCP.

---

## Stale-While-Refresh Behavior

| State | Response |
|-------|----------|
| Fresh snapshot | `freshnessStatus: "fresh"` |
| Background refresh running | Previous valid snapshot with `refreshStatus: "running"` |
| Refresh failed | Previous valid snapshot with `refreshStatus: "failed"` |
| Snapshot older than 1.5× interval | `freshnessStatus: "stale"` |
| No valid snapshot | `snapshot: null` |

Freshness threshold: `OPPORTUNITY_SCAN_INTERVAL_MINUTES × 1.5 × 60_000` ms.

---

## Retention

| Row type | Retention period |
|----------|-----------------|
| `SUCCESS`, `PARTIAL_SUCCESS`, `EMPTY_SUCCESS` | 30 days |
| `FAILED` | 7 days |

Retention is triggered non-blocking after each successful scan. A cleanup failure does **not** fail the scan or invalidate the snapshot.

---

## Endpoint Contract

`GET /api/opportunities/latest` — requires authentication.

**When a valid snapshot exists:**

```json
{
  "snapshot": {
    "id": "uuid",
    "status": "SUCCESS | PARTIAL_SUCCESS | EMPTY_SUCCESS",
    "freshnessStatus": "fresh | stale",
    "refreshStatus": "idle | running | failed",
    "startedAt": "ISO",
    "completedAt": "ISO",
    "generatedAt": "ISO",
    "dataSource": "Twelve Data via MCP",
    "dataQuality": "Latest daily market data",
    "scannerVersion": "mcp-v1",
    "marketRegime": "TRENDING | null",
    "counts": {
      "reviewed": 200,
      "qualified": 5,
      "watch": 3,
      "rejected": 10,
      "excluded": 12,
      "unavailable": 0
    },
    "topGrowth": [],
    "topIncome": [],
    "topWatchlist": [],
    "approachingQualification": [],
    "warnings": []
  },
  "lastRefresh": {
    "status": "idle | running | failed",
    "attemptedAt": "ISO | null",
    "errorSummary": null
  }
}
```

**When no valid snapshot exists:**

```json
{
  "snapshot": null,
  "lastRefresh": {
    "status": "idle | running | failed",
    "attemptedAt": "ISO | null",
    "errorSummary": "safe message or null"
  }
}
```

Never exposes: stack traces, MCP session details, tokens, account IDs, or internal URLs.

---

## Observability Events

| Event | When |
|-------|------|
| `opportunity_snapshot_loaded` | Startup: valid snapshot loaded from PostgreSQL |
| `opportunity_snapshot_load_failed` | Startup: PostgreSQL load error (non-fatal) |
| `opportunity_scan_started` | Lock acquired, scan begins |
| `opportunity_scan_skipped_locked` | Lock held by another instance (or in-process guard) |
| `opportunity_scan_completed` | SUCCESS result persisted |
| `opportunity_scan_partial` | PARTIAL_SUCCESS result persisted |
| `opportunity_scan_empty` | EMPTY_SUCCESS result persisted |
| `opportunity_scan_failed` | Scan error (MCP, validation, or persistence) |
| `opportunity_snapshot_persisted` | Row successfully written to PostgreSQL |
| `opportunity_snapshot_persistence_failed` | DB write failed after scan succeeded |
| `opportunity_snapshot_served` | Endpoint served a fresh valid snapshot |
| `opportunity_snapshot_served_stale` | Endpoint served a stale valid snapshot |
| `opportunity_snapshot_retention_completed` | Retention cleanup completed |

Safe fields only: id, status, counts, duration, freshness, scanner version, data source, lock result, safe error code. Never logs full payloads, symbols from private data, tokens, or session IDs.

---

## Deployment Sequence

### Phase 1 — Migration + Code Deploy

1. Run `node scripts/migrate.js` against production PostgreSQL.
2. Deploy code with persistence enabled (current branch).
3. Dashboard endpoint contract is backward compatible.

### Phase 2 — Verify Startup + Persistence

1. Watch Railway logs for `opportunity_snapshot_loaded` — confirms startup load.
2. Watch for `opportunity_scan_started` → `opportunity_scan_completed` or `opportunity_scan_partial`.
3. Watch for `opportunity_snapshot_persisted` — confirms DB write.

### Phase 3 — Verify Restart Resilience

1. Restart VCP Trader Railway service.
2. Confirm `opportunity_snapshot_loaded` fires with a non-null `id`.
3. Confirm dashboard returns `snapshot` immediately (before first new scan completes).

No MCP deployment required.

---

## Rollback Strategy

If persistence causes issues:
1. Roll back code to the previous version (snapshot continues without DB persistence).
2. The `opportunity_scan_snapshots` table is additive — rolling back code does not require dropping it.
3. Data written to the table can be ignored or deleted independently.

---

## Known Limitations

- Only one active scan type (`MARKET_RANKING`). Additional scan types (e.g. income-focused, sector-specific) are not yet implemented.
- `topIncome` bucket is typically empty for stock-only scans — MCP returns momentum-focused candidates by default.
- Market regime is fetched via a separate `getMarketRegime()` call; if that fails, `marketRegime` is null in the snapshot.
- `result_payload` stores all candidate arrays as JSONB — not normalised into child rows. This is appropriate for Sprint 1; child-row normalisation is deferred.
- Advisory lock is session-level — a process crash releases the lock automatically on disconnect. However, if a scan is mid-flight when a process crashes, the in-flight result is not persisted and the old snapshot is preserved.

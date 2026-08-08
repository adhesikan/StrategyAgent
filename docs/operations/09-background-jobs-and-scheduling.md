# 09 — Background Jobs & Scheduling

## Job Status Model

All background jobs report into the in-memory `JobStatusStore` (`server/services/job-status-store.ts`). This state is visible at `/admin/platform-health` under the "Background Job Status" section.

### Fields
| Field | Description |
|-------|-------------|
| `jobName` | Canonical job identifier |
| `status` | `idle` \| `running` \| `completed` \| `failed` \| `partial` |
| `startedAt` | ISO timestamp of current/last run start |
| `completedAt` | ISO timestamp of completion |
| `durationMs` | Run duration in milliseconds |
| `processed` | Items processed in last run |
| `remaining` | Items remaining (for resumable jobs) |
| `lastSuccessAt` | Timestamp of last successful completion |
| `lastErrorCode` | Short error code from last failure |
| `lastErrorMessage` | Truncated error message (max 500 chars) |
| `nextScheduledRun` | ISO timestamp of next scheduled execution |
| `meta` | Free-form additional context |

### Job Names
| Job Name | Trigger |
|----------|---------|
| `scanner` | Scheduled (every N minutes) |
| `ranking` | After scanner completes |
| `intelligence_precompute` | After ranking (fire-and-forget) |
| `institutional_ingestion` | Scheduled quarterly + admin trigger |
| `mapping_pipeline` | Admin trigger |
| `institutional_signal_rebuild` | After ingestion or mapping |
| `symbol_enrichment` | Admin trigger (POST /api/admin/symbols/enrich) |

### Note on Restarts
Job status is in-memory. It resets to `idle` on server restart. This is intentional — job state represents the current session, not historical job history.

---

## Scheduling

### Scanner + Ranking + Intelligence
- Interval: `OPPORTUNITY_SCAN_INTERVAL_MINUTES` (default 240, min 30, max 1440)
- Timer armed on server startup
- Advisory lock prevents concurrent scans (key 774_412_002)

### 13F Ingestion
- Quarterly schedule, configurable
- `INSTITUTIONAL_13F_INGESTION_ENABLED=true` required
- Advisory lock prevents concurrent ingestion (key 774_412_003)

### Market History Ingestion
- Daily, triggered by Twelve Data scheduler
- Incremental — fetches only new bars

---

## Structured Logging

Key events emit structured JSON logs (see `server/lib/structured-log.ts`):

```json
{ "event": "scanner_started", "timestamp": "..." }
{ "event": "scanner_completed", "count": 5, "durationMs": 12000 }
{ "event": "intelligence_precompute_completed", "sectorCount": 8, "themeCount": 12 }
{ "event": "institutional_ingestion_started" }
{ "event": "institutional_ingestion_progress", "processed": 120, "remaining": 340 }
```

In Railway: view structured logs in the Railway dashboard "Logs" tab. Filter by `event` field.

---

## Advisory Locks

PostgreSQL advisory locks prevent concurrent execution of the same job:

| Job | Lock Key |
|-----|---------|
| Opportunity scan | 774_412_002 |
| Institutional ingestion | 774_412_003 |

If a lock is held (e.g. after a crash without cleanup), the next trigger will skip. The lock auto-releases when the PostgreSQL session ends (server restart clears it).

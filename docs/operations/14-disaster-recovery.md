# 14 — Disaster Recovery

## Data Classification

| Category | Examples | Recovery |
|----------|---------|---------|
| Source data | `institutional_filings`, `institutional_holdings`, user accounts | Re-ingest from SEC only |
| Derived data | `sector_intelligence_snapshots`, `institutional_symbol_signals`, `opportunity_scan_snapshots` | **Rebuild using admin endpoints** |
| Cache | In-memory ranking, health cache, session cache | Cleared on restart — automatically rebuilt |
| User data | `partner_users`, compliance records, email campaigns | Never delete casually — restore from backup |

**Rule:** Derived data may be rebuilt. Source/user data must never be casually deleted.

---

## Scenario: Bad Deployment

**Symptoms:** Production returns 500s. New errors in logs after deploy.

**Recovery:**
1. Navigate to Railway → Deployments
2. Identify last known-good deployment
3. Click "Redeploy" on that deployment
4. Monitor logs — confirm 500s stop
5. Investigate root cause in dev before re-attempting deploy

**Data impact:** None — Railway redeployment does not modify the database.

---

## Scenario: Broken Migration

**Symptoms:** Server fails to start after deploy. Logs show migration errors.

**Recovery:**
1. Rollback the deployment (see above)
2. In dev, reproduce the migration error against a copy of the schema
3. Fix the schema change in `shared/schema.ts`
4. Test `drizzle-kit push` locally
5. Redeploy

**If migration partially applied:**
1. Do NOT run destructive cleanup without understanding what was applied
2. Inspect `information_schema.tables` and `information_schema.columns` to see what changed
3. Use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for safe forward migration

---

## Scenario: Database Unavailable

**Symptoms:** All API endpoints return 500. Logs show connection errors.

**Recovery:**
1. Check Railway PostgreSQL service status
2. If Railway DB: check Railway dashboard for service outage
3. If external DB: check connection string and network
4. Restart server after DB recovers (connections will re-pool)

**No data action needed** — PostgreSQL handles its own durability.

---

## Scenario: MCP Outage

**Symptoms:** Scanner returns no candidates. MCP health shows DEGRADED/UNAVAILABLE.

**Recovery:**
1. Check `MCP_ENABLED` and `MCP_BASE_URL`
2. Ping MCP health: `curl -H "Authorization: Bearer $MCP_SERVICE_TOKEN" $MCP_BASE_URL/health`
3. If MCP is down: the platform continues to serve precomputed data (opportunities, intelligence snapshots)
4. No immediate data action needed — existing snapshots remain valid
5. When MCP recovers, next scan cycle picks up automatically

---

## Scenario: Market Data Provider Outage

**Symptoms:** Market data health shows DEGRADED. Ingestion fails.

**Recovery:**
1. Check Twelve Data status page
2. Market history bars from previous ingestion remain available — scanner continues working with stored data
3. DEGRADED status will self-resolve when ingestion succeeds again
4. No manual action needed unless outage exceeds several trading days

---

## Scenario: Institutional Ingestion Corruption

**Symptoms:** Holdings data looks wrong (e.g., values 1000× too large, missing manager names).

**Recovery:**
1. Do NOT delete source data (`institutional_filings`, `institutional_holdings`) without explicit approval
2. Identify affected data range (quarter)
3. If parser was wrong: fix parser, mark affected run as `failed`, re-run ingestion for that quarter
4. If VALUE unit was wrong: fix fund-service (remove `* 1000`), rebuild signals only (holdings source is correct)

**Rebuild signals without re-ingesting:**
```
POST /api/admin/intelligence/rebuild   # rebuilds intelligence from ranking
```
(Signal rebuild from holdings requires a separate admin endpoint — see institutional admin routes)

---

## Scenario: Scheduled Job Stuck

**Symptoms:** Scanner or ingestion shows `status: "running"` for hours. No progress.

**Recovery:**
1. Check server logs for last activity from the job
2. If process died: advisory lock auto-releases on server restart
3. Restart server → lock released → next trigger runs normally
4. For ingestion: set stale run to `partial` status

```sql
-- Use Railway "Query" tab or local psql with DATABASE_URL:
UPDATE institutional_ingestion_runs
SET status = 'partial'
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '4 hours';
```

---

## Scenario: Ranking Unavailable After Restart

**Symptoms:** Dashboard shows no opportunities. `getLatestRanking()` returns null.

**Recovery:** This is expected after every restart. No action needed — wait for next scheduled scan (up to `OPPORTUNITY_SCAN_INTERVAL_MINUTES` minutes). Intelligence snapshots from before restart are still valid and served.

**To accelerate:** Trigger a manual scan via admin (if endpoint exists) or reduce `OPPORTUNITY_SCAN_INTERVAL_MINUTES` temporarily.

---

## Scenario: Intelligence Snapshots Corrupt or Missing

**Symptoms:** `/api/intelligence/sectors` count = 0. `/intelligence` dashboard blank.

**Recovery:**
1. `POST /api/admin/symbols/enrich` — populate sector classifications
2. `POST /api/admin/intelligence/rebuild` — rebuild from latest ranking
3. Verify: `GET /api/admin/intelligence/diagnostics`

Snapshot tables are derived data — rebuilding is always safe.

---

## Emergency Feature Flag Disables

If a feature is causing production issues:

```
MCP_ENABLED=false                           # disable MCP tool calls
INSTITUTIONAL_13F_INGESTION_ENABLED=        # remove var to disable ingestion
INSTITUTIONAL_INTELLIGENCE_ENABLED=false    # hide institutional UI
MARKET_HISTORY_DATABASE_FIRST=false         # fallback for market history
TRADER_BRAIN_ENABLED=false                  # disable TraderBrain
```

Set via Railway environment variables → redeploy (or restart if supported).

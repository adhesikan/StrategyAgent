# 03 — Database & Migrations

## Schema Ownership

All production tables are defined in `shared/schema.ts` using Drizzle ORM. This file is the **source of truth** for the schema.

There are two migration paths:

### Path 1: Drizzle Kit Push (primary — runs on every Railway deploy)
```bash
npx tsx script/migrate.ts
# → drizzle-kit push --force
```
Creates/alters all tables defined in `shared/schema.ts`. Safe to run repeatedly.

### Path 2: Startup Migrations (supplement — runs when server starts)
`server/index.ts` → `runStartupMigrations()` runs `CREATE TABLE IF NOT EXISTS` statements for a few tables added inline rather than in the Drizzle schema:
- `sector_intelligence_snapshots`
- `theme_intelligence_snapshots`

Both paths run on every Railway deploy (migrate.ts first, then server startup).

---

## Lesson: psql Not Available in Railway Application Shell

Railway's application runtime shell does NOT include `psql`. Do not attempt:
```bash
psql $DATABASE_URL   # Will fail — command not found
```

**Preferred alternatives:**
1. Use `npx tsx script/migrate.ts` for schema changes (already in deploy pipeline)
2. Use admin API endpoints for data operations
3. Use the Railway "Query" tab in their dashboard for one-off SQL if available
4. For recovery, use a PostgreSQL client on your local machine connecting via the Railway DATABASE_URL

---

## Do Not Manually Alter Production Tables

> DO NOT run `ALTER TABLE` manually against production unless following an approved recovery runbook.

Manual schema changes bypass Drizzle's schema tracking and will conflict with `drizzle-kit push` on the next deploy.

**Approved path for schema changes:**
1. Add to `shared/schema.ts`
2. Test locally (`npm run dev`)
3. Deploy → Railway auto-runs `drizzle-kit push --force`
4. Verify with `GET /api/admin/platform-health`

---

## Verification Steps After Migration

```bash
# Check table existence
curl -b "session=..." $PROD/api/admin/intelligence/diagnostics | jq '.sectorSnapshots.tableExists'

# Check platform health database card
curl -b "session=..." $PROD/api/admin/platform-health | jq '.health.database'
```

---

## Table Inventory (key tables)

| Table | Owner | Purpose |
|-------|-------|---------|
| `symbols` | Legacy | Company metadata (sector/industry) |
| `market_data_symbols` | Sprint 5 | Active symbol universe |
| `market_history_bars` | Sprint 5 | Normalized OHLCV daily bars |
| `opportunity_scan_snapshots` | Sprint 1 | Scanner results + persistence |
| `opportunity_history` | Sprint 2 | Opportunity lifecycle tracking |
| `sector_intelligence_snapshots` | Sprint 2.3.3 | Precomputed sector intelligence |
| `theme_intelligence_snapshots` | Sprint 2.3.3 | Precomputed theme intelligence |
| `institutional_filings` | Sprint 2.2.5 | 13F filing headers |
| `institutional_holdings` | Sprint 2.2.5 | 13F position rows |
| `security_master` | Sprint 2.2.6 | CUSIP→ticker master mapping |
| `institutional_symbol_signals` | Sprint 2.2.5 | Per-symbol accumulation signals |
| `partner_users` | Core | Partner/affiliate accounts |
| `agent_decisions` | AI | AI agent decision log |

---

## Data Classification

| Category | Examples | Can Rebuild? |
|----------|---------|-------------|
| Source data | `institutional_filings`, `institutional_holdings` | No — re-ingest from SEC only |
| Derived data | `sector_intelligence_snapshots`, `institutional_symbol_signals` | **Yes** — rebuild endpoints exist |
| Cache | In-memory ranking, health cache | **Yes** — cleared on restart / explicit refresh |
| User data | `partner_users`, `agent_decisions` | Never delete casually |

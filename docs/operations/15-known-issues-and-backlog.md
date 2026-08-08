# 15 — Known Issues & Backlog

## Active Known Issues

### KI-001: Sector snapshots require manual enrichment after first deploy

**Status:** Requires one-time operator action after each fresh deployment to a new database.

**Details:** The `market_data_symbols` table seeds 20 symbols but without sector/industry data. After the first scan cycle, sector intelligence produces 0 snapshots because no sector classifications exist.

**Workaround:** After first scan:
1. `POST /api/admin/symbols/enrich` — enriches from Twelve Data
2. `POST /api/admin/intelligence/rebuild` — generates sector snapshots

**Long-term fix:** Automatically trigger enrichment after first successful scan, or seed sector data alongside symbol seed.

---

### KI-002: Ranking is lost on server restart

**Status:** By design. In-memory only.

**Details:** `getLatestRanking()` returns null after any server restart until the next scan cycle completes.

**Impact:** Dashboard shows no opportunities for up to `OPPORTUNITY_SCAN_INTERVAL_MINUTES` minutes after restart.

**Workaround:** Reduce `OPPORTUNITY_SCAN_INTERVAL_MINUTES` if rapid recovery is needed.

**Long-term fix:** Persist latest ranking to PostgreSQL (would require schema change + loader on startup).

---

### KI-003: psql not available in Railway application shell

**Status:** Platform limitation. Not fixable by application code.

**Workaround:** Use local psql with `DATABASE_URL`. Use admin API endpoints. Use Railway Query tab.

---

### KI-004: Railway ARG/ENV secret warnings from Nixpacks

**Status:** Build-time warning, not a runtime exposure.

**Details:** Nixpacks may warn about secrets in environment. Current setup uses Railway Variables (runtime), not build-time ENV. The warning is a false positive for the current configuration.

**Workaround:** Investigate and confirm no secret values are in Dockerfile ARG/ENV statements.

---

## Deferred Features

The following are explicitly deferred and must NOT be implemented until explicitly scheduled:

- Portfolio Research Intelligence
- Portfolio recommendations
- AI Research Assistant
- Autonomous agents / loops / graphs orchestration
- Knowledge graph
- Mapping auto-approval
- New brokerage providers (beyond Tradier/TradeStation/Rithmic)
- Event data provider
- Voice interface
- Dashboard redesign
- Large-scale code splitting (unless essential)

## Pre-existing TypeScript Errors (Non-blocking)

The following files have pre-existing TS errors that are known and excluded from "new errors" gates:

- `server/services/portfolio-intelligence-engine.ts`
- `server/agents/agent-worker.ts`
- `server/routes/ask.ts`
- `server/routes.ts` (some)
- `server/routes/agent.ts`

Do not fix these without a dedicated sprint. Do not count them as new errors in release gates.

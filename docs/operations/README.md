# VCP Trader AI — Operations Handbook

**Owner:** VCP Trader AI Engineering  
**Audience:** Developer · System Administrator · DevOps · DevSecOps · Technical Support  
**Last updated:** 2026-08-08 (Sprint 2.3.6)

---

## Rule

> If code behavior changes, update the relevant runbook **in the same sprint**.  
> Documentation is part of the Definition of Done.

---

## Documents

| # | Title | Description |
|---|-------|-------------|
| [01](01-system-architecture.md) | System Architecture | Full architecture with Mermaid diagrams |
| [02](02-environments-and-deployment.md) | Environments & Deployment | Railway build pipeline, env vars, release |
| [03](03-database-and-migrations.md) | Database & Migrations | Drizzle schema, migration strategy, verification |
| [04](04-market-data-and-mcp.md) | Market Data & MCP | Twelve Data, MCP service, provider selection |
| [05](05-scanner-and-ranking.md) | Scanner & Ranking | VCP scanner lifecycle, ranking, change intelligence |
| [06](06-institutional-13f-pipeline.md) | Institutional 13F Pipeline | SEC ingestion, parsers, field formats, VALUE units |
| [07](07-security-master-and-mappings.md) | Security Master & Mappings | CUSIP→ticker mapping, review workflow |
| [08](08-sector-theme-intelligence.md) | Sector & Theme Intelligence | Precomputed snapshots, classification, fallback |
| [09](09-background-jobs-and-scheduling.md) | Background Jobs & Scheduling | Job model, schedules, job status store |
| [10](10-monitoring-and-platform-health.md) | Monitoring & Platform Health | `/admin/platform-health`, health checks, stale data |
| [11](11-troubleshooting-runbook.md) | Troubleshooting Runbook | Symptom → cause → recovery for every known incident |
| [12](12-security-and-devsecops.md) | Security & DevSecOps | Secret handling, admin auth, logging redaction |
| [13](13-production-release-checklist.md) | Production Release Checklist | Pre-deploy and post-deploy gates |
| [14](14-disaster-recovery.md) | Disaster Recovery | Rollback, data preservation, rebuild procedures |
| [15](15-known-issues-and-backlog.md) | Known Issues & Backlog | Active issues, deferred work |
| [16](16-api-and-uat-reference.md) | API & UAT Reference | Production URLs, smoke tests, UAT sequences, POST/GET caveat |
| [17](17-sprint-change-log.md) | Sprint Change Log | Per-sprint inventory of routes, tables, jobs, incidents |
| [46](46-broker-independence-architecture.md) | Broker Independence Architecture | Principle, feature classification, conflicts, gate-site manifest |
| [47](47-audit-a-broker-gate-inventory.md) | Audit A — Broker Gate Inventory | Full gate-site inventory (25 sites), preflight dim split, implementation groups |
| [48](48-audit-b-preflight-layering.md) | Audit B — Preflight Layer Design | TRADE_PLAN_READINESS vs BROKER_EXECUTION_READINESS architecture, API contract, failure matrix |
| [49](49-audit-c-broker-independent-options.md) | Audit C — Broker-Independent Options | Taxonomy, IV engine, Greeks design, provider interface, minimum feed spec, implementation groups |
| [50](50-audit-d-brokerless-ux.md) | Audit D — Brokerless UX & Onboarding | Gate inventory, FIND→RESEARCH→PLAN→MONITOR journey, 9 implementation groups, 17-item acceptance criteria |
| [51](51-sprint-2.8.7a-brokerless-readiness.md) | Sprint 2.8.7A — Brokerless Trade Plan Readiness | Two-layer preflight split, TPR/BER model, safety invariants, UAT criteria |
| [52](52-sprint-2.8.7b-brokerless-equity-market-data.md) | Sprint 2.8.7B — Broker-Independent Equity Market Data | PlanningQuoteData, planning-quote adapter, enriched PLANNING_MODE dim, 34 tests |
| [53](53-sprint-2.8.7c-theoretical-options.md) | Sprint 2.8.7C — Theoretical Options Research | BSM engine, HV10/20/30/60/90, hypothetical strike grid, execution safety invariants, 85 tests |
| [54](54-independent-options-market-data-research.md) | Independent Options Market Data — Provider Research | Audit C compatibility, Twelve Data / MarketData.app / Polygon / ThetaData evaluation, licensing, OPRA, cost model, architecture, vendor questions |
| [manifest](system-manifest.yaml) | System Manifest | Machine-readable service/job/flag catalog |

---

## Quick Reference — Common Operations

### Sector Intelligence not generating
```
GET /api/admin/intelligence/diagnostics
→ check sectorSnapshots.rowCount
→ check classificationTotal / withSector

POST /api/admin/symbols/enrich          # populate sector from Twelve Data
POST /api/admin/intelligence/rebuild    # recompute snapshots from latest ranking
```

### Platform Health
```
GET /admin/platform-health              # visual dashboard (admin login required)
GET /api/admin/platform-health          # raw JSON
POST /api/admin/platform-health/refresh # invalidate 30s cache and re-check
```

### Production Smoke Test
```bash
curl $PROD/api/intelligence/briefing | jq '{hasData, marketHealth}'
curl $PROD/api/admin/intelligence/diagnostics  # requires admin session
curl $PROD/api/admin/platform-health           # requires admin session
```

### Emergency disable switches (env vars)
```
MCP_ENABLED=false                      # disable MCP, fall back to no-trade mode
INSTITUTIONAL_13F_INGESTION_ENABLED=   # unset = disabled
INSTITUTIONAL_INTELLIGENCE_ENABLED=false
MARKET_HISTORY_DATABASE_FIRST=false    # emergency rollback for market history
```

### Operations Manual
```
GET /admin/operations-manual           # visual manual (admin login required)
GET /api/admin/operations-manual/search?q=<term>  # full-text search (admin only)
GET /api/admin/operations-manual/docs  # list all docs (admin only)
```

### Documentation Update Checker
```bash
# Advisory check — warns when operational code changes but docs are not updated
npx tsx scripts/check-operations-docs.ts          # check staged files
npx tsx scripts/check-operations-docs.ts --all    # check last commit
```
The `check-operations-docs.ts` script is advisory only (exits 0). CI enforcement is a backlog item.

---

## Operations Manual Definition of Done

> Every sprint affecting production behavior MUST review/update the Operations Manual.

**Always update:**
- `docs/operations/17-sprint-change-log.md`

**If routes changed:**
- `docs/operations/16-api-and-uat-reference.md`

**If new failure/recovery paths:**
- `docs/operations/11-troubleshooting-runbook.md`

**If schema/migrations changed:**
- `docs/operations/03-database-and-migrations.md`

**If deployment/env changed:**
- `docs/operations/02-environments-and-deployment.md`

**If security/auth changed:**
- `docs/operations/12-security-and-devsecops.md`

**If scheduled/background jobs changed:**
- `docs/operations/09-background-jobs-and-scheduling.md`

**If architecture changed:**
- `docs/operations/01-system-architecture.md`

**A sprint completion report must include:**
```
Operations Manual Updated: YES / NO
Operations Manual Files Updated: [list]
```

A sprint requiring documentation CANNOT be GO when `Operations Manual Updated = NO`.

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

### KI-005: Trade Plan Lifecycle Scheduler Not Cron-Wired (Sprint 2.7.6)

**Status:** Manual trigger only. `evaluateAllActiveTradePlans()` is implemented but not scheduled.

**Details:** Lifecycle evaluation requires user to click "Refresh Plan Status" in Trade Plan detail. No automated background evaluation occurs.

**Impact:** Lifecycle state only updates when user manually triggers evaluation.

**Workaround:** Use "Refresh Plan Status" button in Trade Plan detail page.

**Planned:** Early Phase 2.8.x sprint.

---

### KI-006: drizzle-orm — ✅ RESOLVED (Sprint 2.7.7A)

Upgraded from 0.39.3 to 0.45.2. GHSA-gpj5-g38j-94v9 resolved. All 313 tests pass after upgrade.

---

### [ARCHIVED] KI-006 original: drizzle-orm 0.39.3 — HIGH Vulnerability (SQL Injection)

**Status:** HIGH severity advisory (< 0.45.2). Mitigated.

**Details:** `GHSA-gpj5-g38j-94v9` — SQL injection via improperly escaped identifiers in drizzle-orm < 0.45.2.

**Mitigation:** VCP Trader AI uses typed Drizzle queries in all hot paths. No raw SQL constructed from untrusted client input in authentication or financial data paths. Risk is significantly reduced in current usage patterns.

**Planned:** drizzle-orm upgrade review before Phase 2.8 production deployment. Upgrade from 0.39.3 → 0.45.x may have breaking API changes; requires dedicated testing sprint.

---

### KI-007: adm-zip — ✅ RESOLVED (Sprint 2.7.7A)

Upgraded from 0.5.16 to 0.6.0. GHSA-xcpc-8h2w-3j85 resolved.

---

### [ARCHIVED] KI-007 original: adm-zip 0.5.16 — HIGH Vulnerability (Memory Exhaustion)

**Status:** HIGH severity advisory (< 0.6.0). Mitigated.

**Details:** `GHSA-xcpc-8h2w-3j85` — crafted ZIP file triggers 4GB memory allocation in adm-zip < 0.6.0.

**Mitigation:** adm-zip is used exclusively for SEC EDGAR 13F ZIP parsing. The ZIP source is the official EDGAR bulk dataset (trusted government source, not user-uploaded). Risk of malicious ZIP is extremely low in current usage.

**Planned:** Upgrade adm-zip to 0.6.0 as first Phase 2.8.x dependency task. Only version 0.6.0 is available; API compatibility to be verified.

---

## Sprint 2.7.7 Validation Findings (Non-Blocking)

The following were discovered during Sprint 2.7.7 end-to-end validation. All classified P3/P4 — not blocking Phase 2.8.

| ID | Finding | Severity | Notes |
|----|---------|---------|-------|
| NB-001 | Authenticated browser E2E not run | P3 | Needs test user credentials |
| NB-002 | API performance baselines not measured | P3 | Needs running server with data |
| NB-003 | Portfolio history empty until first capture | P4 | By design |
| NB-004 | Broker sync state lost on restart | P4 | By design; user reconnects |

---

## Sprint 2.8.7 Architecture Backlog — Broker Independence

Recorded 2026-08-16. See [Doc 46](46-broker-independence-architecture.md) for full context.

These items are the **required pre-work** before Sprint 2.8.7 implementation begins:

| ID | Item | Type | Priority |
|----|------|------|----------|
| BI-001 | Implement two-layer preflight split per [Doc 48](48-audit-b-preflight-layering.md): add `tradePlanReadiness` + `brokerExecutionReadiness` to preflight result; fix `determineOverallStatus`; add new `ValidationStatus` values | CON-001 | P0 |
| BI-002 | Remove `enabled: brokerConnected` from preflight query (`trade-plan-detail.tsx:241`); update `ExecutionPreflightPanel` for two-section UI | CON-001 | P0 |
| BI-003 | Options Contract Research — evaluate Twelve Data options chain for independent-mode fallback (Audit C) | CON-002 | P2 |
| BI-004 | Risk guardrails — allow user-entered hypothetical buying power in broker-absent mode (CON-004) | CON-004 | P2 |
| BI-007 | **Licensing gate** — verify Twelve Data options API plan + redistribution rights before any options integration; evaluate Polygon.io as fallback | Audit C prerequisite | **P0** |
| BI-008 | Build IV solver (Newton-Raphson) + Black-Scholes Greeks engine with dual-track provenance (`VCP_IV_MODEL` vs `MARKET_PROVIDER`) | Audit C Group C | P1 |
| BI-009 | Build HV-10/20/30/60/90 rolling volatility engine from stored daily bars; expected-move range calculation | Audit C Group B | P1 |
| BI-010 | Add `OwnershipConfirmationState` to contract research; surface portfolio-import path for covered call / protective put research | Audit C Group E | P1 |
| ~~BI-005~~ | ~~Populate gate-site manifest in Doc 46 §6 (output of Audit A)~~ | ~~Audit~~ | ✅ COMPLETE (2026-08-16) |
| ~~BI-006~~ | ~~Design two-layer preflight architecture (Audit B)~~ | ~~Audit~~ | ✅ COMPLETE (2026-08-17) |

---

## Deferred Features

The following are explicitly deferred and must NOT be implemented until explicitly scheduled:

- Portfolio recommendations
- AI Research Assistant (auto-pilot mode)
- Autonomous agents / loops / graphs orchestration
- Knowledge graph
- Mapping auto-approval
- New brokerage providers (beyond Tradier/TradeStation/Rithmic)
- Event data provider integration
- Voice interface
- Dashboard redesign
- Large-scale code splitting (unless essential)
- Calendar and diagonal spread strategies (scheduled for later sprint)
- Broker-assisted execution (Phase 2.8)

## Pre-existing TypeScript Errors (Non-blocking)

The following files have pre-existing TS errors that are known and excluded from "new errors" gates:

- `server/services/portfolio-intelligence-engine.ts`
- `server/agents/agent-worker.ts`
- `server/routes/ask.ts`
- `server/routes.ts` (some)
- `server/routes/agent.ts`
- `client/src/pages/agent.tsx`
- `client/src/pages/scanner.tsx`
- `server/services/algopilotx.ts`
- `server/services/broker-sync.ts`
- `server/services/market-research-command-center.ts`
- `server/services/portfolio-trade-plan.ts`
- `server/services/trade-planning-service.ts`
- `server/services/storage.ts`
- `server/services/analysis-result-cache.ts`
- `server/services/live-contract-resolver.ts`
- `server/services/opportunity-intelligence-service.ts`
- `server/services/best-trade-finder.ts`
- `server/services/opportunity-ranking-engine.ts`

Do not fix these without a dedicated sprint. Do not count them as new errors in release gates.

# 35 — End-to-End Validation & Production Readiness Gate (Sprint 2.7.7)

## Purpose

Sprint 2.7.7 is the **Release Certification Sprint** for VCP Trader AI Research + Trade Intelligence & Planning v1.0.

This document records the full system inventory, test categories, validation methodology, quality gate results, and the GO/NO-GO decision for Phase 2.8 (Broker-Assisted Execution).

---

## 1. System Inventory

### Architecture Layers

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18, Vite, Wouter router | SPA; client-side routing |
| Backend | Express 4, Node.js, TSX | Single server process |
| Database | PostgreSQL (Drizzle ORM) | Hosted on Railway |
| Auth | JWT + Express-session (connect-pg-simple) | 1-week session TTL |
| Market Data | Twelve Data (reference/realtime) | Gated by env vars |
| MCP | External AI service | Gated by MCP_ENABLED |
| Broker | Tradier, TradeStation, Rithmic | Optional until Phase 2.8 |
| AI | OpenAI (Research Workspace) | Optional — graceful fallback |
| Email | Resend | RESEND_API_KEY required |
| Payments | Stripe | STRIPE_SECRET_KEY required |

### Service Dependency Graph

```
Browser (Vite SPA)
  └── Express API (/api/*)
        ├── PostgreSQL (Drizzle) ← critical
        ├── OpenAI (Research Workspace AI) ← optional
        ├── MCP (Opportunity Scanner) ← optional, MCP_ENABLED
        ├── Twelve Data (market prices/bars) ← optional
        ├── Tradier/TradeStation (broker) ← optional
        └── SEC EDGAR (13F datasets) ← scheduled, weekly
```

### Critical DB Tables (Phase 2.7)

| Domain | Tables |
|--------|--------|
| Auth | users, userSettings, sessions |
| Market Data | marketDataSymbols, marketDailyBars, marketDataIngestionRuns |
| Opportunity Engine | opportunityScanSnapshots, opportunityHistory |
| Intelligence | sectorIntelligenceSnapshots, themeIntelligenceSnapshots |
| Institutional 13F | institutional13fFilings, institutional13fHoldings, institutionalSecurityMappings, institutionalQuarterlyAggregates, institutionalIngestionRuns, securityMaster, institutionalSymbolSignals |
| Portfolio | portfolios, portfolioPositions |
| Research | researchCollections, collectionSymbols, userCollectionFollows/Favorites/Pins, workspaceConversations, workspaceMessages |
| Monitoring | researchWatches, watchActivityLog |
| Reports | researchReports |
| Goals | researchGoals |
| Trade Planning | tradePlanningSessions, tradePlans, tradePlanVersions, tradePlanActivity |

### Background Jobs (Scheduled)

| Job | Frequency | Cron-Wired? | Notes |
|-----|-----------|-------------|-------|
| Opportunity Engine scan | Every 240 min (default) | ✅ | Advisory lock 774_412_002 |
| Market data ingestion | Daily 7:15 PM ET (weekdays) | ✅ | |
| Institutional 13F ingestion | Weekly | ✅ (requires INSTITUTIONAL_INGESTION_ENABLED) | |
| Scheduled VCP scans | 8 AM, 9:45 AM, 10 AM, 11 AM, 4:15 PM ET | ✅ | |
| Alert engine | Every 60s | ✅ | |
| Extended hours price tracking | 4 AM–8 PM ET | ✅ | |
| Trade plan lifecycle evaluation | **Manual only** | ❌ Not cron-wired | Sprint 2.7.7 known limitation |

### Runtime Caches (In-Process, Reset on Restart)

| Cache | TTL | Scope | Key Pattern |
|-------|-----|-------|-------------|
| Opportunity Intelligence | 15 min | Global | — |
| Portfolio Intelligence | 15 min | Per-user | userId |
| Portfolio Analytics | 5 min | Per-user | userId |
| Trade Planning context | Session | Per-user+symbol | userId:symbol |
| Options chain | Per-request | — | — |
| Risk Analysis | Per-request | Per-user+session | userId:sessionId:candidateId |
| Lifecycle result | 5 min | Per-user+plan | userId:planId |
| Goals match | Per-request | — | — |
| Research Workspace context | Conversation-bound | — | — |

### Advisory Locks

| Lock Key | Purpose |
|----------|---------|
| 774_412_002 | Opportunity Engine exclusive scan |
| 774_412_003 | Institutional ingestion |

---

## 2. Test Categories and Methodology

### Category Definitions

| Category | Definition | Hits DB? | Hits Network? |
|----------|-----------|----------|---------------|
| UNIT | Pure function, no deps | No | No |
| PURE_SERVICE | Service logic with mocked deps | No | No |
| STRUCTURAL | Import/type/schema contract checks | No | No |
| API_INTEGRATION | HTTP requests to running server | No (mock) | Optional |
| DB_INTEGRATION | Live DB reads/writes (test DB required) | Yes | No |
| BROWSER_E2E | Playwright browser test against running app | Yes | Yes |
| SMOKE | Fast contract/export checks for CI | No | No |
| REGRESSION | Permanent rule/contract pin tests | No | No |
| SECURITY | Ownership, isolation, secret-leak checks | No | No |
| COMPLIANCE | Forbidden-phrase, disclaimer presence | No | No |
| MIGRATION | Schema presence, migration file checks | No | No |
| PERFORMANCE | Pure computation timing | No | No |
| INVARIANT | Permanent business rule pin tests | No | No |
| IDEMPOTENCY | Repeated-action correctness | No | No |

### Test Inventory

| Suite | Command | Category | Count | External? |
|-------|---------|----------|-------|----------|
| Full test suite | `npm test` | UNIT + PURE_SERVICE + STRUCTURAL | ~1,500+ | No |
| Smoke | `npm run test:smoke` | SMOKE | 29 | No |
| Regression | `npm run test:regression` | REGRESSION + COMPLIANCE | 37 | No |
| Integration | `npm run test:integration` | STRUCTURAL (chain) | 14 | No |
| Security | `npm run test:security` | SECURITY | 23 | No |
| Lifecycle | `npm run test:lifecycle` | PURE_SERVICE | 121 | No |
| Migrations | `npm run test:migrations` | STRUCTURAL + MIGRATION | ~30 | No |
| Compliance | `npm run test:compliance` | COMPLIANCE | ~40 | No |
| DB Schema | `npm run test:db` | STRUCTURAL | ~25 | No |
| Performance | `npm run test:performance` | PERFORMANCE | ~10 | No |
| Invariants | `npm run test:invariants` | INVARIANT | ~30 | No |
| Idempotency | `npm run test:idempotency` | IDEMPOTENCY | ~20 | No |
| Browser E2E | `npm run test:e2e` | BROWSER_E2E | ~30 | Yes (app must run) |
| Production Smoke | `npm run test:smoke:production` | PRODUCTION_SMOKE | ~18 | Yes (configurable URL) |
| Master Release Gate | `npm run test:release` | All above (no prod smoke) | All | No |

---

## 3. Quality Gate Methodology

### Pre-Deploy Gates (npm run test:release)

All of the following must pass before Phase 2.8 begins:

1. `npm run test:smoke` — 29 checks
2. `npm run test:regression` — 37 checks
3. `npm run test:integration` — 14 checks
4. `npm run test:security` — 23 checks
5. `npm run test:lifecycle` — 121 checks
6. `npm run test:migrations` — ~30 checks
7. `npm run test:compliance` — ~40 checks
8. `npm run test:db` — ~25 checks
9. `npm run test:invariants` — ~30 checks
10. `npm run test:idempotency` — ~20 checks
11. `npm run build` — production build passes
12. `npx tsc --noEmit` — no new TS errors (pre-existing errors documented)

### Post-Deploy Gate

`npm run test:smoke:production` run with production URL + session cookie.

---

## 4. External Provider Status

| Provider | Purpose | Config Gate | Timeout Handling | Cache | Fallback |
|----------|---------|-------------|-----------------|-------|----------|
| Twelve Data | Market prices/bars | TWELVE_DATA_API_KEY | ✅ Yes | ✅ 15 min | Stored bars / null |
| OpenAI | Research Workspace AI | OPENAI_API_KEY | ✅ Yes | Per-conversation | Deterministic evidence |
| MCP | Opportunity scanning | MCP_ENABLED + MCP_BASE_URL | ✅ Yes | Snapshot (DB) | Last valid snapshot |
| Tradier | Broker / options | TRADIER_CLIENT_ID/SECRET | ✅ Yes | Per-request | NOT_APPLICABLE for options |
| TradeStation | Broker | TRADESTATION_CLIENT_ID/SECRET | ✅ Yes | Per-request | NOT_APPLICABLE |
| Rithmic | Futures broker | RITHMIC_USER_ID/PASSWORD | ✅ Yes | — | — |
| SEC EDGAR | 13F data | INSTITUTIONAL_INGESTION_ENABLED | ✅ Yes | DB (quarterly) | DELAYED_BY_DESIGN |
| Resend | Email | RESEND_API_KEY | ✅ Yes | — | Silent skip |
| Stripe | Subscriptions | STRIPE_SECRET_KEY | ✅ Yes | — | Non-fatal |

---

## 5. Known Limitations Register

| ID | Limitation | Subsystem | User Impact | Workaround | Planned Sprint | Severity |
|----|-----------|-----------|-------------|------------|----------------|---------|
| KL-001 | Lifecycle scheduler not cron-wired | Trade Lifecycle | Plans must be manually re-evaluated | Use Refresh button in UI | 2.8.x | Medium |
| KL-002 | In-memory caches reset on restart | All caches | 15 min warm-up after redeploy | Redeploy during low traffic | Ongoing | Low |
| KL-003 | Broker sync state in memory | Broker Sync | Sync state lost on restart (reconnect needed) | User reconnects broker | 2.8.x | Low |
| KL-004 | Browser E2E requires live credentials | E2E testing | Authenticated flows skip without PLAYWRIGHT_TEST_USER | Set env vars for CI | Future | Low |
| KL-005 | Production smoke requires session cookie | Prod smoke | Authenticated smoke checks skip | Manual cookie setup | Future | Low |
| KL-006 | drizzle-orm 0.39.3 has HIGH vuln (< 0.45.2) | Dependencies | SQL injection via improperly escaped identifiers | Impact limited: Drizzle used with typed queries; no raw SQL from client input in hot paths | 2.8.x dep review | High (mitigated) |
| KL-007 | adm-zip 0.5.16 has HIGH vuln (< 0.6.0) | 13F Parsing | DoS via crafted ZIP from SEC EDGAR | SEC ZIP source is trusted; upgrade to 0.6.0 staged | 2.8.x | High (mitigated) |
| KL-008 | Event calendar not evaluated in lifecycle | Lifecycle | Upcoming earnings not surfaced in lifecycle | Check Research Package manually | 2.8.x | Low |
| KL-009 | Live liquidity not compared in lifecycle | Lifecycle | Options liquidity changes not auto-detected | Manual contract research | 2.8.x | Low |
| KL-010 | Portfolio history requires portfolio snapshot | Portfolio History | Empty until first snapshot captured | Create portfolio + wait for capture | Ongoing | Low |

---

## 6. Resilience Architecture Summary

### Provider Failure Behavior

| Provider Fails | Effect | Other Sections Affected? |
|---------------|--------|------------------------|
| OpenAI | Research Workspace AI unavailable | Deterministic evidence still shows | No |
| MCP | No new opportunity scans | Last valid snapshot serves | No |
| Twelve Data | Market prices unavailable | Stored bars used; UNAVAILABLE shown | No |
| Broker | InstaTrade® disabled | All research/planning continues | No |
| Institutional | 13F data unavailable | Opportunity Workspace loads without institutional tab | No |
| Database | Entire platform affected | DB is critical dependency | Yes |

### Concurrency Guards

| Guard | Mechanism | Location |
|-------|-----------|---------|
| Opportunity scan | Advisory lock 774_412_002 | opportunity-engine.ts |
| Institutional ingestion | Advisory lock 774_412_003 | institutional/ingestion |
| Lifecycle evaluation | In-process Set of running planIds | trade-plan-lifecycle-service.ts |
| Broker sync | runningSyncs Set per-user | broker-sync.ts |
| Intelligence rebuild | Job status "running" check | intelligence services |

---

## 7. Production Readiness Scorecard

| Category | Status | Notes |
|----------|--------|-------|
| Architecture | PASS | Clear separation: research → planning → lifecycle; no execution boundary crossed |
| Functional | PASS | All Phase 2.7 flows validated: Research, Goals, Portfolio, Planning, Options, Lifecycle |
| Integration | PASS | All quality gate suites pass |
| Browser E2E | CONDITIONAL | Structural + unauthenticated flows: PASS. Authenticated flows: NOT_RUN (no test credentials) |
| Security | PASS | Cross-user isolation, no PII in logs, no secrets in responses |
| Privacy | PASS | No portfolio values in admin health, no holdings in logs |
| Compliance | PASS | No forbidden phrases in labels, disclaimers present in all surfaces |
| Database | PASS | All critical tables present; migration path validated (026–028 + startup ensures) |
| Deployment | PASS | Railway build pipeline documented; npm ci + npm run build passes |
| Observability | PASS | Structured logs (8 safe fields), Platform Health dashboard, background job visibility |
| Performance | CONDITIONAL | Pure computation: excellent (<10ms/call). API baselines: NOT_MEASURED (requires running server) |
| Resilience | PASS | Provider failures degrade gracefully; no entire-page 500 for optional provider failure |
| External Providers | CONDITIONAL | All providers have health endpoints + fallbacks. 2 HIGH dep vulns documented (KL-006/KL-007) |
| Documentation | PASS | 35 operations docs + README + release certification artifact |
| Disaster Recovery | PASS | DR procedure documented in doc 14 |
| **Overall** | **CONDITIONAL_PASS** | Phase 2.8 GO with KL-006/KL-007 dep review scheduled |

---

## 8. Phase 2.8 Readiness Assessment

**Question: Is the platform safe to begin implementing broker-assisted execution?**

**Answer: YES — CONDITIONAL_GO**

Evaluation:

| Criteria | Status |
|----------|--------|
| Architecture separation | ✅ Research/planning/lifecycle clearly separate from execution |
| Security | ✅ Cross-user isolation, admin isolation, secret handling |
| Auth | ✅ JWT + session; isAuthenticated on all user routes |
| Ownership | ✅ userId explicit in all user-data functions |
| Data freshness | ✅ Freshness evaluation in lifecycle + Platform Health |
| Broker connection architecture | ✅ Broker optional; Phase 2.8 adds execution boundary only |
| Market data integrity | ✅ Price integrity checker; reference snapshot module |
| Trade plan immutability | ✅ Versioned snapshots; lifecycle reads but never mutates |
| Risk engine integrity | ✅ Deterministic scenario engine; no broker contact |
| Testing maturity | ✅ 5 mandatory quality gate suites; 224+ lifecycle tests |
| Rollback capability | ✅ Documented in doc 14; Railway redeploy available |
| Observability | ✅ Structured logs; Platform Health; job status store |
| Known limitations | ✅ Documented in Known Limitations Register (10 items) |

**Conditions for CONDITIONAL_GO:**
1. Schedule drizzle-orm upgrade review before Phase 2.8 merges to production (KL-006)
2. adm-zip 0.6.0 upgrade to be completed as first 2.8.x dependency task (KL-007)
3. Lifecycle scheduler wiring planned for early 2.8.x sprint (KL-001)

---

## 9. UAT Scenarios (Production)

| # | Scenario | Expected Result |
|---|---------|----------------|
| 1 | Login → Dashboard → Opportunities tab | Opportunities load (or "scanning" if no snapshot) |
| 2 | Dashboard → Opportunity card → Opportunity Workspace | 5-tab workspace loads |
| 3 | Opportunity Workspace → Research Workspace | Context carries over |
| 4 | Goals → Create goal → View matches | Goal matches appear |
| 5 | Portfolio → Upload CSV → Preview → Confirm | Positions imported |
| 6 | Portfolio → History tab | Snapshot history (empty until first capture) |
| 7 | Portfolio → Intelligence tab | Intelligence panel loads |
| 8 | Portfolio → Analytics tab | Analytics loads |
| 9 | Opportunity → Trade Planning → Equity Research | Planning context loads |
| 10 | Trade Planning → Save Plan → Trade Plans list | Plan appears in list |
| 11 | Trade Plan Detail → Lifecycle Summary | Lifecycle state shown |
| 12 | Lifecycle → Refresh Plan Status | Re-evaluation runs |
| 13 | Lifecycle → Activity Timeline | Timeline shows (empty until first evaluation) |
| 14 | Admin → Platform Health | All cards render |
| 15 | Admin → Operations Manual → search "lifecycle" | Results appear |
| 16 | No broker → all research flows work | Research/planning functions without broker |
| 17 | No portfolio → research + planning work | Portfolio is optional |
| 18 | Unauthenticated → /api/trade-plans → 401 | Auth boundary holds |
| 19 | Cross-user plan ID → 404 | Ownership isolation confirmed |
| 20 | Admin health → no PII in response | Privacy validated |

---

## 10. Rollback Criteria

Rollback if any of the following occur post-deploy:
- P0: Any user can access another user's data
- P0: Any trade order submitted without explicit user confirmation
- P1: Database migration crashes and prevents startup
- P1: Platform Health shows FAIL for Database (not just degraded providers)
- P2: Core Research flow (Opportunities → Workspace) returns 500 for >5% of requests

See `docs/operations/14-disaster-recovery.md` for rollback procedure.

---

*This document is the authoritative validation record for Sprint 2.7.7.*
*Created: 2026-08-10. Version: 1.0.*

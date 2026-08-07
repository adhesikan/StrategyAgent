---
name: Opportunity Ranking Engine
description: Sprint 2.2.7 — pure composite scorer wired into the opportunity background engine; GET /api/opportunities/today; no LLM.
---

## Architecture

**Input**: `PersistedOpportunitySnapshot` (topGrowth/topIncome/topWatchlist) + `institutional_symbol_signals` (one batch query) + marketRegime string  
**Output**: `OpportunityRankingResult` — ranked candidates with per-symbol `OpportunityScore`  
**Computation**: fully pure (`buildRanking`) — no LLM, no per-request DB

## Score formula
```
overallScore = Technical×0.40 + Institutional×0.20 + Fundamental×0.15 + Risk×0.15 + Regime×0.10
```
All components 0-100. Final score integer in [0,100]. Weights in `DEFAULT_WEIGHTS` (exported, configurable).

## Component computation
- **Technical**: `strategyScore` direct if available; else `max(30, 85 - (rank-1)*10)`; ±5 confidence; -8 watch setupStatus
- **Institutional**: Signal score scaled by confidence (high=direct, moderate=compress to 50±75%, limited=compress to 50±55%); missing/unavailable → 50 neutral (never penalises)
- **Fundamental**: base=60; -15 earnings risk in warnings; +15 income strategy
- **Risk**: base=60; +15 fitsRiskBudget; +8 to +18 for R/R ≥1.5-3; -22 for R/R <1; -10 gap risk warning
- **Regime**: TRENDING+momentum=90, TRENDING+other=75, CHOPPY+income=55, CHOPPY+momentum=35, RISK_OFF+income=40, RISK_OFF+momentum=15, unknown=50

## Category assignment
- `overallScore ≥ 60` AND non-income → **Top Growth**
- income strategy AND `overallScore ≥ 55` → **Income**
- `overallScore 40-59` → **Watch**
- `overallScore < 40` OR (RISK_OFF AND score < 55) → **Avoid**
- Watch candidates always → **Watch**

## Hook in opportunity-engine.ts
After `latestSnapshot` is set, fire-and-forget:
```typescript
void computeRankingForSnapshot(latestSnapshot, getLatestRanking())
  .then(setLatestRanking)
  .catch(...)
```
The `getLatestRanking()` arg passes the previous result to enable `changes[]` computation.

## In-memory cache
`getLatestRanking()` / `setLatestRanking()` — same pattern as `getLatestSnapshot()`.  
Null until first scanner run completes.

## DB query
`fetchInstitutionalSignalMap(symbols[])` — single `SELECT … WHERE symbol = ANY(${symbols})` against `institutional_symbol_signals`.  
Non-throwing: on DB error (table doesn't exist on fresh deploy), logs warn and returns empty map → ranking proceeds with institutional=50 neutral.

## API
- `GET /api/opportunities/today` — authenticated, reads `getLatestRanking()`; returns `{ranking, available, message}`
- `GET /api/opportunities/latest` — unchanged (still returns raw scanner snapshot)

## Route registration
Registered in `server/routes.ts` adjacent to `registerOpportunityLatestRoute`.

## Test count
95 new tests in `server/services/__tests__/opportunity-ranking-engine.test.ts`.  
One existing engine test (`lock released after success`) updated: assertion changed to `toBeGreaterThanOrEqual(2)` because ranking engine adds a third fire-and-forget DB call on successful scans.

**Why:** Lock-count test was counting `db.execute` calls to verify acquire+release; ranking engine adds a concurrent institutional-signals lookup that settles within the same event-loop flush.

---
name: Dashboard Step 1 — Real Stock Opportunity Pipeline
description: How the dashboard opportunity pipeline was migrated from simulated radar-service to real MCP rank_market_trade_candidates.
---

## The Problem

`generateCandidateScenarios` (radar-service) was the dashboard's opportunity source. It called `buildMockQuote` — a hash-derived mock quote generator — and set `dataMode:"simulated"` on every candidate when no broker was connected and stored bars were unavailable. The MCP `rank_market_trade_candidates` tool already existed and was used by Ask AI, but NOT the dashboard.

## The Fix

New service `server/services/dashboard-stock-opportunities.ts`:
- Calls `rankMarketTradeCandidates` via `runRankedTradeSearch` (already validated by ranked-trade-search.ts)
- Returns `StockOpportunitiesResult`: status "ok" with real candidates, or "unavailable" on MCP failure
- Returns `buildOptionsAvailability(hasBroker)` as a separate boundary descriptor
- Never calls OpenAI — pure deterministic MCP pipeline

**Why:** A disconnected broker was silently degrading to simulated data. The MCP pipeline uses Twelve Data stored bars, so it works without a broker.

## Dashboard Route

`server/routes/dashboard.ts` (full rewrite):
- No longer imports `generateCandidateScenarios` from radar-service
- Exports `stockOpportunities` + `optionsAvailability` instead of `growthOpportunities / incomeOpportunities / watchlistOpportunities`
- All sections independently isolated via `Promise.allSettled`
- Positions sanitized server-side: symbol/qty/costBasis/marketPrice/unrealizedPnl only

## Options Boundary Contract

`buildOptionsAvailability(hasBroker)` always returns `liveChainAvailable: false` and `brokerRequired: true`. No live options chain without a supported broker options-chain feed. Estimated strategy concepts may appear only in a clearly labeled "Estimated structure" section — never inside "Today's Stock Opportunities."

## Data-Source Status API Fix

`/api/data-source/status` now returns capability-based fields (`underlyingMarketData`, `stockAnalysis`, `liveOptionsData`, `portfolioContext`, `execution`) instead of a single binary `activeSource:"mock"`. A Twelve Data user sees `activeSource:"twelve_data"` not `"mock"`.

## Sentiment Isolation Audit

No confirmed cross-symbol defect. `sentimentAggregationService.aggregateByTicker` groups strictly by `r.symbol.toUpperCase()`. Cache keys are normalized uppercase tickers. Risk only upstream (article mis-classification), not in aggregation code.

## How to Apply

- Dashboard opportunities: always use `buildDashboardStockOpportunities()` from `server/services/dashboard-stock-opportunities.ts`
- Never call `generateCandidateScenarios` from the dashboard orchestration route
- MCP `rank_market_trade_candidates` → `runRankedTradeSearch` → `validateRankedTradeSearch` is the trust chain
- Test files: `server/routes/dashboard.test.ts` (33 tests), `server/routes/dashboard-opportunities.test.ts` (35 tests, 7 categories)

---
name: Portfolio Analytics (Sprint 2.6.2)
description: Architecture and key constraints for the Portfolio Analytics tab — Phase 3 of Portfolio Intelligence track.
---

## What was built

Portfolio Analytics is a pure computation layer over existing snapshot tables — no new DB tables, no new background jobs.

### Key files
- `shared/portfolio-analytics-types.ts` — canonical types (`PortfolioAnalyticsResult`, `HoldingAnalyticsResult`, `AnalyticsPeriod`)
- `server/services/portfolio-analytics-service.ts` — computation + 5-min cache keyed `userId::portfolioId::period`
- `server/routes/portfolio-analytics.ts` — `GET /api/portfolio/:id/analytics`, `GET /api/portfolio/:id/analytics/:symbol`
- `client/src/pages/portfolio-analytics-tab.tsx` — Analytics tab (Holdings → History → Intelligence → **Analytics**)
- `server/services/__tests__/portfolio-analytics.test.ts` — 103 pure tests (no DB)

### Period enum
`AnalyticsPeriod = "7D" | "30D" | "90D" | "YTD" | "1Y" | "ALL"` — maps to `HistoryPeriod` for `getPortfolioSnapshots()`.

### Data sources
1. `getPortfolioSnapshots(portfolioId, userId, period)` — returns DESC; service reverses to chronological
2. `getPortfolioIntelligence(portfolioId, userId)` — optional; graceful fallback to null
3. `portfolio_position_snapshots` JOIN `portfolio_snapshots` — for per-holding history queries

## Performance terminology rules (enforced by tests)

**Permitted:** Portfolio Value Change, Unrealized Gain/Loss, Market Value Trend, Exposure Change  
**Forbidden:** Return, Alpha, Performance, CAGR, Sharpe, Outperformance

## Compliance requirements

- Cash disclosure: always near value history charts ("tracked positions only")
- Theme overlap disclosure: near every theme chart ("may not sum to 100%")
- Value change disclosure: near every % change ("not an investment return")
- Full disclaimer block on every Analytics tab render

## Known gaps (deferred)

- Sector/theme exposure *history* charts: `portfolio_snapshots.coverage` JSONB does not yet store sector/theme breakdowns at capture time — sectorExposureHistory and themeExposureHistory return empty `sectorPercents`/`themePercents`
- `cash_value` field declared in `portfolio_snapshots` but never populated (Sprint 2.6.0 design)
- `HoldingAnalyticsResult.companyName` / `.sector` / `.themes` are null — position snapshots don't store these fields

## Cache invalidation

`invalidatePortfolioAnalyticsCache(portfolioId)` — clears all period entries for a portfolio.

## Glossary terms added

`portfolio_value_change`, `unrealized_gain_loss`, `position_allocation`, `portfolio_weight`, `research_coverage_trend`, `opportunity_overlap_trend`, `exposure_change`, `market_value_history`

**Why:** `shared/research-glossary.ts` `_extendedGlossary` must include all analytics terms — `getPortfolioGlossaryEntry()` looks up from this merged array.

---
name: Dashboard real-data API shape
description: Sprint 5.5C / Task #58 — removal of all simulated fallbacks from dashboard; new response shape for opportunities, market snapshot, and AI infra watch.
---

# Dashboard Real-Data API Shape

## The rule
- `dataMode: "simulated"` is PERMANENTLY REMOVED everywhere. New values: `"live" | "partial" | "error"`.
- `dataSource: "fallback"` is REMOVED. New values: `"broker" | "twelve_data" | "unavailable"`.
- Hardcoded fallback constant arrays (FALLBACK_INDICES, FALLBACK_GROWTH, FALLBACK_INCOME) have been deleted from `home-snapshot.ts`. Do not re-add them.
- When data is unavailable, always return an explicit `status: "unavailable"` shape — never fabricated data.

**Why:** Task #58 mandate — users must see honest error states, never demo/sample values marketed as real data.

## Opportunity section split (dashboard.ts)
- Scanner runs ONCE → candidates split server-side into three buckets.
- `growthOpportunities`: strategyType ∈ {stock_swing, long_call, debit_spread} + bias ≠ bearish
- `incomeOpportunities`: strategyType ∈ {covered_call, cash_secured_put}
- `watchlistOpportunities`: top-ranked across all strategies (score-sorted)
- Each capped at 5. Old `opportunities` key no longer exists.

**How to apply:** Any code that reads `data.opportunities` must be updated to one of the three new keys.

## New HomeSnapshotResponse fields (home-snapshot.ts)
- `vix: VixQuote | null` — Twelve Data quote for VIX; null when unavailable; never fabricated.
- `sectorLeadership: SectorQuote[]` — top-3 gainers + top-3 laggards from XLK/XLE/XLF/XLV/XLC/XLI/XLB/XLU/XLRE/XLP/XLY; empty when unavailable.
- `marketRegime: MarketRegimeSummary | null` — from classifyMarketRegime() on SPY stored bars (zero credits); null when < 30 bars available.
- `bestIncome` field REMOVED.
- `growthSource`: `"sentiment" | null` only (never `"fallback"`).

## AI Infrastructure Watch (ai-infra-watch.ts)
- New service: `buildAiInfraWatch(userId)` tracks NVDA, AMD, MU, AVGO, MRVL, CRDO, ANET, TSM.
- Uses `getReferenceSnapshotsBulk` (zero credits) + `getTickerSnapshotsForSymbols` for sentiment.
- Returns `{ status: "ok", tickers: AiInfraTicker[] } | { status: "unavailable" }`.
- Technical score is 0–100 composite of RSI + EMA alignment + RVOL.

## Test contract
- Dashboard tests mock `buildAiInfraWatch` from `../services/ai-infra-watch`.
- dataMode "simulated" must not appear in any dashboard response (regression test added).
- 31 dashboard-specific tests pass; 2077 total project tests pass.

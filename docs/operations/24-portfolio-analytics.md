# Portfolio Analytics — Operations Manual

**Sprint:** 2.6.2  
**Module:** Portfolio Analytics  
**Phase:** Portfolio Intelligence Track — Phase 3

---

## 1. Overview

Portfolio Analytics is the third phase of the Portfolio Intelligence track. It surfaces time-series analytics, allocation breakdowns, and trend intelligence sourced exclusively from existing platform data — no new scoring, no new background jobs, and no new database tables.

Portfolio Analytics uses:
- **`portfolio_snapshots`** and **`portfolio_position_snapshots`** (Sprint 2.6.0 startup DDL)
- **Portfolio Intelligence result** (Sprint 2.6.1) for concentration, sector/theme allocation
- **Opportunity Intelligence snapshot** (Sprint 2.5.0) for research coverage and overlap data

---

## 2. Architecture

```
portfolio_snapshots + portfolio_position_snapshots
  ↓
portfolio-analytics-service.ts          ← pure computation; no new DB writes
  ↓  (calls)
portfolio-intelligence-service.ts       ← Sprint 2.6.1; optional (graceful fallback)
opportunity-intelligence-service.ts     ← Sprint 2.5.0; optional (graceful fallback)
  ↓
/api/portfolio/:id/analytics            ← GET; period filter; 5-min cache
/api/portfolio/:id/analytics/:symbol    ← GET; per-holding history
  ↓
PortfolioAnalyticsTab                   ← Analytics tab in portfolio.tsx
```

**No new background job** — analytics are computed on demand and cached 5 minutes per (userId, portfolioId, period).

---

## 3. API Reference

### GET `/api/portfolio/:id/analytics`

Returns the full `PortfolioAnalyticsResult` for the requested period.

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `period`  | query string | `30D` | One of: `7D`, `30D`, `90D`, `YTD`, `1Y`, `ALL` |

**Authentication:** Required (session cookie).  
**Ownership:** Enforced — 404 for cross-user portfolio IDs.

**Response:**
```json
{
  "available": true,
  "portfolioId": "...",
  "period": "30D",
  "generatedAt": "...",
  "analytics": { ... PortfolioAnalyticsResult ... }
}
```

**When `available: false`:** No analytics result; `message` explains why (not found, no snapshots, or access denied).

### GET `/api/portfolio/:id/analytics/:symbol`

Returns `HoldingAnalyticsResult` for one holding — a time series of per-position data across snapshots.

| Parameter | Type | Notes |
|-----------|------|-------|
| `symbol`  | path param | 1–10 chars, `[A-Z0-9.^-]` |
| `period`  | query string | Same options as above |

---

## 4. Data Sources & Freshness

| Section | Source | Freshness |
|---------|--------|-----------|
| Value History | `portfolio_snapshots` (aggregate fields) | Snapshot-driven; changes on every new snapshot |
| Position Allocation | Portfolio Intelligence | 15-min cache (Sprint 2.6.1) |
| Sector Allocation | Portfolio Intelligence | 15-min cache |
| Theme Allocation | Portfolio Intelligence | 15-min cache |
| Concentration | Portfolio Intelligence | 15-min cache |
| Research Coverage Trend | `portfolio_snapshots.coverage` JSONB | Snapshot-driven |
| Opportunity Overlap Trend | `portfolio_snapshots.coverage` JSONB | Snapshot-driven |
| Research Change Trend | `portfolio_snapshots.coverage` JSONB | Snapshot-driven |
| Holding Analytics | `portfolio_position_snapshots` JOIN `portfolio_snapshots` | Snapshot-driven |
| Institutional Note | Hardcoded disclosure | N/A |

**Analytics cache TTL:** 5 minutes, keyed by `userId + portfolioId + period`.  
Invalidated by `invalidatePortfolioAnalyticsCache(portfolioId)`.

---

## 5. Performance Terminology Rules

These rules apply to **all** analytics UI surfaces:

| Permitted | Forbidden |
|-----------|-----------|
| Portfolio Value Change | Return, Investment Return |
| Market Value Trend | Performance, Alpha |
| Unrealized Gain / Loss | Outperformance, CAGR |
| Exposure Change | Sharpe, Beta |
| Research Coverage | P&L (profit and loss is ambiguous without transaction accounting) |

---

## 6. Compliance Requirements

1. **Analytics Disclaimer** — rendered on every Analytics tab load.
2. **Cash disclosure** — present on every value history chart: *"Cash balances are not included."*
3. **Portfolio Value Change disclosure** — appears near every `percentChange` figure: *"Not an investment return."*
4. **Theme overlap disclosure** — present on every theme chart: *"Theme percentages may not sum to 100%."*
5. **Concentration labels** — Low/Moderate/High are descriptive. UI must never say "Concentration is too high" or imply a recommendation.
6. **Institutional note** — *"Institutional data reflects Form 13F filings — delayed by up to 45 days."*

---

## 7. Snapshot Requirements for Each Section

| Section | Minimum Snapshots | Notes |
|---------|-------------------|-------|
| Value Summary (metrics) | 1 | Shows latest; no change % |
| Value Change % | 2 | Needs start + end |
| Value History Chart | 2 | LineChart requires ≥2 points |
| Cost Basis Summary | 1 | Only if costBasis populated |
| Position/Sector/Theme Allocation | 1 | Requires Portfolio Intelligence |
| Concentration | 1 | Requires Portfolio Intelligence |
| Coverage Trend | 2 | Time-series requires ≥2 points |
| Overlap Trend | 2 | Time-series requires ≥2 points |
| Research Change Trend | 2 | Only meaningful with ≥2 snapshots |
| Holding Analytics | 1 | Shows single point; trend needs ≥2 |

---

## 8. Limitations Surfaced to Users

The analytics service populates the `limitations[]` array automatically. The UI shows them in the Coverage & Limitations section. Common limitations:

- "No portfolio snapshots available for this period." — Trader hasn't captured a snapshot in range.
- "Only one snapshot captured. Historical trend analytics require additional snapshots." — Encourage capturing more snapshots.
- "Portfolio Intelligence not yet available." — OppIntel snapshot not yet generated.
- "Cost basis available for N of M holdings. Unrealized gain/loss reflects partial coverage only." — Partial import data.
- "Total portfolio market value unavailable — reference prices may not be loaded." — Market data gap.
- "Portfolio Value Change includes the combined effect of market movement and changes in holdings." — Always included.

---

## 9. Glossary Terms Added (Sprint 2.6.2)

New terms added to `shared/research-glossary.ts`:

| Key | Label |
|-----|-------|
| `portfolio_value_change` | Portfolio Value Change |
| `unrealized_gain_loss` | Unrealized Gain / Loss |
| `position_allocation` | Position Allocation |
| `portfolio_weight` | Portfolio Weight |
| `research_coverage_trend` | Research Coverage Trend |
| `opportunity_overlap_trend` | Opportunity Overlap Trend |
| `exposure_change` | Exposure Change |
| `market_value_history` | Market Value History |

---

## 10. Monitoring & Health

Analytics health is tracked in-memory (resets on restart) via `getPortfolioAnalyticsHealth()`.

Metrics:
- `portfoliosWithAnalytics` — distinct portfolios that have been analyzed this session
- `analyticsRequests` — total requests served (cache hits + misses)
- `averageAnalyticsDurationMs` — average compute time (excludes cache hits)
- `latestAnalyticsAt` — ISO timestamp of last analytics computation
- `partialAnalytics` — requests where data was partial or unavailable

Structured logs on every computation:
```json
{
  "event": "portfolio_analytics_completed",
  "period": "30D",
  "durationMs": 142,
  "snapshotCount": 8,
  "positionCount": 10,
  "coveragePercent": 80
}
```

No portfolio values, user identity, symbol names, or cost basis data appear in logs.

---

## 11. Runbook

### Q: Analytics tab shows "Insufficient data" for all charts.

Likely no snapshots exist for the selected period. Ask the trader to capture a snapshot from the History tab and wait for the next Opportunity Intelligence scan.

### Q: Value History chart is empty but metrics show a current value.

Only one snapshot exists for the period. The history chart needs ≥2 snapshots. Prompt the trader to capture another snapshot.

### Q: Position / Sector / Theme allocation is empty.

Portfolio Intelligence has not yet computed for this portfolio, OR the 15-minute cache is stale. Check `/api/portfolio/:id/intelligence` — if it returns `available: false`, the OppIntel scan may not have run yet.

### Q: Unrealized Gain/Loss shows "—".

Either cost basis data is not available (positions imported without cost information), or market value is null (reference price gap). Check the position import source.

### Q: Analytics are slow.

Check if Portfolio Intelligence is also slow — analytics re-computes intelligence on every cache miss. If the intelligence layer is the bottleneck, pre-warm the intelligence cache by hitting `/api/portfolio/:id/intelligence` first.

### Q: Need to clear the analytics cache for a portfolio.

Call `invalidatePortfolioAnalyticsCache(portfolioId)` from the server process, or restart the server (cache is in-memory and does not persist).

---

## 12. Known Gaps (Deferred to Future Sprints)

| Gap | Notes |
|-----|-------|
| Sector / theme exposure history charts populated | Requires storing sector/theme breakdowns in `portfolio_snapshots.coverage` JSONB at capture time (future snapshot enhancement) |
| Benchmark comparison | No stored benchmark data — excluded by architecture decision |
| Cash balance tracking | `cash_value` in `portfolio_snapshots` is declared but never populated — excluded per Sprint 2.6.0 design |
| Per-holding company name in history | `portfolio_position_snapshots` does not store company name — deferred |
| Multi-period R² or correlation | Requires statistical library — not scoped |
| Holding-level export | Deferred to future report format |

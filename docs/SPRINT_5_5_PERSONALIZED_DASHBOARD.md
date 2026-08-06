# Sprint 5.5 — Personalized Morning Dashboard

## 1. Route Behavior

| Path | Authenticated | Unauthenticated |
|------|--------------|-----------------|
| `/dashboard` | Renders the Morning Dashboard | Redirects to `/auth` (AuthPage) |
| `/` | Redirects to `/dashboard` (unless user pinned a custom landing page) | Renders public marketing homepage |
| `/home` | Renders AI Command Center (preserved for deep links and pinned preferences) | Redirects to `/auth` |
| `/command-center` | Renders AI Command Center (preserved) | Redirects to `/auth` |

**Post-login redirect:** `DefaultLanding` checks `/api/user/settings` for `defaultLandingPage`. If unset or pointing to a recognized page, users land on `/dashboard`. Custom pinned pages (e.g. `/scanner`) are preserved.

## 2. Dashboard Architecture

The dashboard uses a single backend orchestration endpoint `GET /api/dashboard` that fans out in parallel using `Promise.allSettled` to all internal data sources. The client fetches this endpoint via React Query (`queryKey: ["/api/dashboard"]`), refetching every 5 minutes with a 60-second stale time.

**Client layer** (`client/src/pages/dashboard.tsx`):
- Independent section components, each accepting props derived from the single `DashboardResponse`
- Section-level `SectionError` component with Retry button (fires `dashboard_section_retry` analytics)
- Loading skeletons via `DashboardSkeleton` while the initial query is pending
- Top-level error card when the entire orchestration call fails

## 3. API Sources

| Endpoint | Section(s) |
|----------|-----------|
| `GET /api/dashboard` (orchestration) | All sections |
| `buildHomeSnapshot(userId)` | Market Snapshot, Growth Watch, Market Events |
| `GET /api/opportunities/latest` | Today's Stock Opportunities (pre-computed by Opportunity Engine) |
| `buildOptionsAvailability(hasBroker)` | Options Availability (boundary descriptor) |
| `buildAiInfraWatch(userId)` | AI Infrastructure Watch |
| `storage.getBrokerConnection(userId)` | Portfolio section |
| `getBrokerPositions(userId)` | Portfolio section |
| `ResearchRecordService.listForUser(userId, { limit: 5 })` | Saved Research |
| `storage.getWatchlists(userId)` | Watchlist Activity |

## 4. Section Contracts

### 4.1 Morning Header
- Source: `useAuth()` user object (`firstName`), `getMarketSessionInfo()` from `@shared/market-session`, `new Date()`
- Displays: greeting, first name (if available), full date, market session label + color indicator
- No hardcoded market status — always derived from ET time logic

### 4.2 Quick Actions
- Seven goal-oriented buttons: Find Growth, Find Income, Find Trade Setups, Analyze a Stock, Review My Portfolio, Continue Saved Research, Understand Markets
- Each routes to an existing product mode or pre-fills an Ask AI prompt via `?q=` URL param
- None submit trades or create orders
- Fires `dashboard_quick_action_clicked` with `{ action }` — no symbols, prompts, or account data

### 4.3 Market Snapshot
- Source: `buildHomeSnapshot(userId)` in `server/routes/home-snapshot.ts`
- Fields: `marketTone`, `marketToneReason`, `indices` (SPY/QQQ/IWM/DIA), `vix`, `sectorLeadership` (11 sector ETFs), `marketRegime`, `topMovers`, `topNews`, `topGrowth`, `dataMode`, `dataSource`, `asOf`
- **Error isolation**: snapshot failure shows section-specific message — "Market Snapshot is temporarily unavailable. Other market data may still be available below." — and **never** blanks Stock Opportunities, AI Infra Watch, Research, or Ask AI.
- `dataMode` values: `"live"` | `"partial"` | `"error"` (never `"simulated"`)
- `dataSource` values: `"broker"` | `"twelve_data"` | `"unavailable"` (never `"fallback"`)

### 4.4 Today's Stock Opportunities (Step 1 — Real Pipeline)

**Status: Implemented (Sprint 5.5 Step 1)**

Replaces the previous three-bucket radar-service section (Growth / Income / Watchlist Movers) with a single deterministic real pipeline.

#### Pipeline

```
Twelve Data stored daily bars
  → MCP rank_market_trade_candidates (deterministic ranking)
  → validateRankedTradeSearch adapter (defensive normalization)
  → buildDashboardStockOpportunities() service
  → /api/dashboard response: stockOpportunities
```

- **No OpenAI in the candidate/ranking path.** OpenAI 429 or outage cannot remove real candidates.
- **No `generateCandidateScenarios`** (radar-service) — that function produces `dataMode:"simulated"` mock data when stored bars are unavailable and no broker is connected. It is no longer called by the dashboard.

#### Response shape

```typescript
stockOpportunities: {
  status: "ok" | "unavailable";
  dataSource: "mcp";                          // always MCP
  dataQuality: "Latest daily market data";   // always this label
  generatedAt: string;
  sourceTimestamp: string;
  reviewedCount: number;    // raw stored opportunities reviewed (pre-confluence)
  qualifiedCount: number;   // post-confluence qualified candidates
  watchCount: number;       // approaching-qualification watch candidates
  excludedCount?: number;   // excluded BEFORE confluence (not rejections)
  unavailableCount: number;
  candidates: RankedTradeCandidate[];      // up to 5, in backend ranking order
  watchCandidates: RankedWatchCandidate[]; // up to 5
  exclusionSummary?: { reason: string; count: number }[];
  warnings: string[];
}
```

#### Rules

- Candidates are shown in **backend ranking order** — the client never reorders.
- **No synthetic options fields** (no generated premium, strike, expiration, OI, bid-ask, Greeks, breakeven, max-gain).
- `status: "unavailable"` when MCP is disabled or fails — no fabricated candidates.
- Zero-qualified result = `status: "ok"` with empty `candidates[]` and honest `reviewedCount` + `exclusionSummary`.
- Watch candidates shown in "Approaching Qualification" subsection only when no qualified candidates exist.

### 4.5 Options Availability (Boundary Descriptor)

```typescript
optionsAvailability: {
  liveChainAvailable: false;         // always false without a live options-chain provider
  source: "broker" | null;
  brokerRequired: true;              // always true
  estimatedStructuresAvailable: boolean;
  message: string;                   // user-facing explanation
}
```

- `liveChainAvailable` is **always false** — live contracts require a supported broker options-chain feed.
- Estimated strategy concepts (e.g. "long call concept") may be shown in a **clearly labeled** separate section: "Estimated structure — no live options chain used." They must **never** appear inside "Today's Stock Opportunities."

### 4.6 AI Infrastructure Watch
- Symbols: NVDA, AMD, MU, AVGO, MRVL, CRDO, ANET, TSM
- Source: stored daily bars + news sentiment from `buildAiInfraWatch(userId)`
- Per-ticker: `trend` (up/down/flat), `trendLabel`, `sentiment` (bullish/bearish/neutral), `technicalScore`
- `{ status: "unavailable" }` when no stored bars available (never mock data)

### 4.7 Portfolio Section
- Only shown when `brokerConnected === true`
- Positions sanitized server-side: `symbol`, `qty`, `costBasis`, `marketPrice`, `unrealizedPnl` only
- Account identifiers and raw balances **never** returned to client

### 4.8 Saved Research
- Source: `ResearchRecordService.listForUser(userId, { limit: 5, archived: false })`
- Fields: `id`, `symbol`, `title`, `domain`, `verdict`, `confidence`, `generatedAt`

### 4.9 Watchlist Activity
- Source: `storage.getWatchlists(userId)`

## 5. Data-Source Status API (`GET /api/data-source/status`)

### Capability-based shape (Step 1)

The endpoint now returns **capability-based fields** in addition to the legacy fields:

```json
{
  "activeSource": "twelve_data",
  "isLive": false,
  "hasBrokerConnection": false,
  "dailyCloseEntitled": true,

  "underlyingMarketData": {
    "available": true,
    "source": "twelve_data",
    "quality": "daily_close"
  },
  "stockAnalysis": {
    "available": true,
    "deterministic": true,
    "source": "mcp"
  },
  "liveOptionsData": {
    "available": false,
    "source": null,
    "brokerRequired": true
  },
  "portfolioContext": {
    "available": false,
    "brokerConnected": false
  },
  "execution": {
    "available": false,
    "brokerConnected": false
  }
}
```

**Key change from pre-Step-1:** `activeSource` is no longer `"mock"` for a user with Twelve Data access. A disconnected user who is entitled to daily-close data now sees `activeSource: "twelve_data"`. The broker and Twelve Data are separate capability dimensions.

## 6. Sentiment Isolation Audit (Step 1 §9)

**Audit result: No confirmed cross-symbol defect found.**

Trace:
- `sentimentAggregationService.aggregateByTicker` groups records by `r.symbol.toUpperCase()` — symbol-keyed, no cross-contamination.
- `news-score-adapter.loadSnapshotsForRadar(symbols)` calls `storage.getTickerSnapshotsForSymbols(symbols)` — rows are stored per-symbol and queried by symbol set.
- Cache keys in `getTickerSnapshotsForSymbols` are the normalized uppercase ticker symbol.
- **Risk exists upstream**: if article classification assigned the wrong symbol (e.g., a GOOGL article mis-classified as AAPL), that article's sentiment enters AAPL's bucket. This is a data-quality concern, not a code bug in the aggregation layer.
- **No code fix required.** Monitoring: if cross-ticker article classification rates become significant, a dedupe pass in the classification step would be the fix.

## 7. Failure Isolation Rules

| Section fails | Impact |
|---|---|
| `buildHomeSnapshot` throws | `marketSnapshot.status = "unavailable"` — stock opps, AI infra, research, watchlists unaffected |
| `buildDashboardStockOpportunities` throws | `stockOpportunities.status = "unavailable"` — snapshot and all other sections unaffected |
| `buildAiInfraWatch` throws | `aiInfraWatch.status = "unavailable"` — all other sections unaffected |
| `ResearchRecordService.listForUser` throws | `savedResearch.status = "unavailable"` — all other sections unaffected |
| `storage.getWatchlists` throws | `watchlists.status = "unavailable"` — all other sections unaffected |
| MCP `rank_market_trade_candidates` times out | `stockOpportunities.status = "unavailable"` — OpenAI not involved; no cascade |
| OpenAI outage | Zero effect on stock opportunities (OpenAI not in the ranking pipeline) |

## 8. Test Coverage

| File | Count |
|------|-------|
| `server/routes/dashboard.test.ts` | ~50 unit tests |
| `server/routes/dashboard-opportunities.test.ts` | ~40 tests (7 categories per spec) |

Categories:
- A. Disconnected user — real opportunities without broker
- B. Stock opportunity integrity — MCP pipeline, no simulated fields
- C. Options boundary — no fabricated contracts
- D. Data-source status — capability-based, Twelve Data ≠ broker
- E. Failure isolation — section-level, no cascades
- F. Sentiment isolation — symbol isolation audit
- G. Regression — no OpenAI dependency, ordering, field caps

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

The dashboard uses a single backend orchestration endpoint `GET /api/dashboard` that fans out in parallel using `Promise.allSettled` to six internal data sources. The client fetches this endpoint via React Query (`queryKey: ["/api/dashboard"]`), refetching every 5 minutes with a 60-second stale time.

**Client layer** (`client/src/pages/dashboard.tsx`):
- Ten independent section components, each accepting props derived from the single `DashboardResponse`
- Section-level `SectionError` component with Retry button (fires `dashboard_section_retry` analytics)
- Loading skeletons via `DashboardSkeleton` while the initial query is pending
- Top-level error card when the entire orchestration call fails

## 3. Reused APIs

| Endpoint | Section(s) |
|----------|-----------|
| `GET /api/dashboard` (new orchestration) | All sections |
| `buildHomeSnapshot(userId)` (extracted from `home-snapshot.ts`) | Market Snapshot, Growth & Income, Market Events |
| `generateCandidateScenarios(userId, filters)` | Today's Opportunities |
| `storage.getBrokerConnection(userId)` | Portfolio Intelligence |
| `getBrokerPositions(userId)` | Portfolio Intelligence |
| `ResearchRecordService.listForUser(userId, { limit: 5 })` | Saved Research |
| `storage.getWatchlists(userId)` | Watchlist Activity |

The `/api/home/snapshot` route was refactored to call the extracted `buildHomeSnapshot()` function — no duplicate logic.

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
- Source: `dashboard.marketSnapshot` (from `buildHomeSnapshot`)
- Displays: market tone badge, tone reason, index tiles (SPY/QQQ/IWM), top movers, data-mode badge (live/delayed), timestamp
- Missing field fallback: "Data currently unavailable" — never a fabricated value
- `status: "unavailable"` → `SectionError` with retry

### 4.4 Today's Opportunities
- Source: `dashboard.opportunities` (from `generateCandidateScenarios`)
- Backend ranking order is preserved — no client-side resorting, no GPT reordering
- Bounded to 3–5 candidates
- Each card shows: symbol, company name, strategy type, bias, grade badge, main reason, Open Analysis CTA
- Empty state: deterministic message + Open Scanner button
- No demonstration cards (no preview data in authenticated dashboard)

### 4.5 Portfolio Intelligence
- Source: `dashboard.portfolio` (broker connection + positions)
- `brokerConnected: false` → compact Connect Broker prompt (fires `dashboard_connect_broker_clicked`)
- `brokerConnected: true, status: "ok"` → neutral observations (position count, unrealized P/L, largest concentration note)
- Never shows account numbers, broker identifiers, or buy/sell directions
- Explicit compliance disclaimer at the bottom of the section

### 4.6 Watchlist Activity
- Source: `dashboard.watchlists`
- Existing watchlists → bounded list with symbol counts and Scan CTA per watchlist
- No watchlists → polished Create Watchlist empty state (routes to `/scanner`)
- Does not claim "since yesterday" — no historical change-state data exists

### 4.7 Growth & Income
- Source: `dashboard.marketSnapshot.data.topGrowth` / `bestIncome`
- Clearly labeled with data-mode badge (live context vs. reference context)
- Income section carries an "Estimated structure" badge when data mode is not live — users are never shown estimated contracts as executable
- CTAs route to Ask AI prompts, not to order placement

### 4.8 Saved Research
- Source: `dashboard.savedResearch` — 5 most recent non-archived records
- Shows: title, symbol, verdict (from stored record label — no raw enums), date
- Open Research CTA → `/research/:id`; Open Journal CTA deferred to the detail page
- Empty state: descriptive message + "Start Research" button → `/ask`

### 4.9 Market Events
- Source: `dashboard.marketSnapshot.data.topNews`
- Empty when no news items available — section hidden (not errored)
- Every item shows: impact badge, symbol, why-it-matters text, Ask AI shortcut
- No invented events — renders only what the news-sentiment storage returns

### 4.10 Ask AI Panel
- Six suggested prompts rendered as buttons → route to `/ask?q=<prompt>`
- "Open Ask AI" button → `/ask`
- Does not add a second chat implementation

## 5. Failure Isolation

```
market snapshot unavailable  →  opportunities, portfolio, research, ask AI all render
portfolio unavailable        →  market snapshot, research, ask AI all render
ranking unavailable          →  market context, portfolio, research all render
saved research failure       →  ask AI, market snapshot, opportunities all render
total data unavailability    →  top-level error card; individual features remain via nav
```

Each section:
- Shows a truthful `SectionError` component (not a GPT-generated guess)
- Provides a Retry button that fires `dashboard_section_retry` analytics and calls `dashboardQuery.refetch()`
- Never propagates its failure to adjacent sections

## 6. Personalization Boundary

Personalized data:
- User's first name (from `useAuth()`)
- Broker connection state
- Portfolio positions (neutral observation only — no account IDs)
- Saved research records (user-owned data)
- Watchlists (user-owned data)

**Not personalized:**
- Risk profile (not inferred)
- Age, income, investment horizon, or suitability
- GPT-generated permanent user profile

## 7. Broker-Connected and Disconnected Behavior

**Connected:**
- Market Snapshot may show live index quotes (broker data) instead of Twelve Data reference
- Portfolio section shows position count, unrealized P/L, largest concentration note
- Top movers derived from watchlist symbols via broker quotes

**Disconnected:**
- Portfolio section shows compact Connect Broker prompt
- Market Snapshot falls back to Twelve Data reference quotes or simulated fallback
- All other sections continue to render normally

## 8. Analytics

Events are fired via `track()` from `client/src/lib/analytics.ts`. No symbols, account values, position details, prompts, tokens, or MCP payloads are included in props.

| Event | Fires when | Props |
|-------|-----------|-------|
| `dashboard_viewed` | Dashboard mounts | (none) |
| `dashboard_quick_action_clicked` | Quick Action button clicked | `{ action: string }` |
| `dashboard_opportunity_opened` | Open Analysis clicked | `{ symbol, grade }` |
| `dashboard_research_opened` | Research record opened | (none) |
| `dashboard_section_retry` | Section Retry clicked | `{ section: string }` |
| `dashboard_connect_broker_clicked` | Connect Broker prompt clicked | (none) |

## 9. Accessibility

- All sections have `aria-labelledby` pointing to their heading
- All icon-only elements have `aria-hidden="true"` 
- Interactive elements have `aria-label` descriptions
- Opportunity cards use `role="article"` with `aria-label`
- List containers use `role="list"` / `role="listitem"` where appropriate
- Loading skeleton has `aria-busy="true"` and `aria-label`
- Retry buttons have explicit `aria-label`
- Color is never the only indicator of meaning (badges always include text)
- Focus-visible ring on all keyboard-interactive elements

## 10. Known Limitations

- **Watchlist status changes** (newly qualified / no longer qualifying) are not implemented. The section shows the watchlist names and symbol counts only — no historical change-state data exists. This is by design per §9 of the spec.
- **Market calendar** (earnings this week, economic events, Fed events) is not implemented. `topNews` from the news-sentiment layer is used instead. A dedicated earnings/events calendar endpoint does not exist.
- **Sector strength and breadth** are not in the snapshot payload. The spec mentions them as examples but no existing endpoint provides them.
- **Concierge summary** ("AI Market Summary" from command-center.tsx) is not included — it requires a dedicated backend summary endpoint that does not exist per the existing code boundary comment.

## 10. Data-Source Matrix (Sprint 5.5A)

| Section | Backend Source | dataSource / mode | User-facing label |
|---------|---------------|-------------------|-------------------|
| Market Snapshot — indices | Broker API (when connected) | `"broker"` | Broker data |
| Market Snapshot — indices | Twelve Data quote API (fallback) | `"twelve_data"` | Latest daily close |
| Market Snapshot — indices | Hardcoded FALLBACK_INDICES | `"fallback"` | Demonstration data |
| Market Snapshot — news | `storage.getTrendingNewsSentiment` | snapshot | (shown via news items) |
| Today's Opportunities | `generateCandidateScenarios` (live) | `"live"` or `"mixed"` | (no simulated badge) |
| Today's Opportunities | `generateCandidateScenarios` (hash-based) | `"simulated"` | Demonstration data (section banner) |
| Portfolio Intelligence | Broker positions API | n/a | Broker data (connected) |
| Growth Watch | `getTrendingNewsSentiment` top bullish | `growthSource: "sentiment"` | News-sentiment context |
| Growth Watch | `FALLBACK_GROWTH[day % n]` | `growthSource: "fallback"` | Reference context |
| Income Idea to Explore | `FALLBACK_INCOME[day % n]` (always) | `incomeSource: "fallback"` | Estimated structure |
| Saved Research | `ResearchRecordService.listForUser` | user data | (no freshness badge) |
| Market Events | `storage.getTrendingNewsSentiment` | news sentiment | "High attention" / "Elevated activity" / "Low activity" |

**Key rules:**
- Market-session status (Regular / Pre-market / After-hours / Closed) and data freshness are separate concepts. A market-open session does NOT imply live data.
- Twelve Data's quote endpoint returns latest-day close / end-of-day cached prices — not streaming real-time. It must never be labeled "Live."
- Broker-connected data may be real-time or delayed depending on the broker plan — we label it "Broker data" and let the broker's own disclosure apply.

## 11. Data-Quality Label Policy (Sprint 5.5A)

All user-facing freshness / provenance badges use the unified mapping in `client/src/lib/data-quality.ts` (mirrored inline in `dashboard.tsx`):

| Key | User-facing label | When used |
|-----|------------------|-----------|
| `LIVE` | Live | Reserved — currently unused on the dashboard (no streaming feed) |
| `BROKER_CONNECTED` | Broker data | Index prices from connected broker |
| `DAILY_CLOSE` | Latest daily close | Index prices from Twelve Data |
| `SNAPSHOT` | Market snapshot | Generic snapshot context |
| `SIMULATED` | Demonstration data | Hash-derived prices; no real data available |
| `ESTIMATED` | Estimated structure | Income ideas (no chain/ownership validation) |
| `UNAVAILABLE` | Data unavailable | Section error states |
| `UNKNOWN` | Source not verified | Fallback when provenance is unclear |
| `DELAYED` | Delayed | Available for broker-delayed feeds |

Raw enum keys are never exposed in the UI.

## 12. Simulated / Demo Data Policy (Sprint 5.5A)

- When `opportunities.dataMode === "simulated"`: section is renamed **"Sample Opportunities"**, a violet "Demonstration data" banner appears at the top, description reads "Demonstration candidates showing how ranked stock and options opportunities appear in VCP Trader AI."
- When `opportunities.dataMode === "live"` or `"mixed"`: section is "Today's Opportunities" with the standard description.
- Per-card "Demonstration data" badges appear only when the section is NOT already fully simulated (i.e., mixed mode — real and estimated candidates together).
- The two states are never mixed without differentiation.

## 13. Growth Watch vs. Opportunity (Sprint 5.5A)

`topGrowth` is derived from news-sentiment rankings or a hardcoded reference list — not from a deterministic technical or fundamental qualification.

- Section renamed from **"Growth Opportunity"** → **"Growth Watch"**
- When `growthSource === "sentiment"`: headline reads "SYMBOL is receiving elevated positive news attention. Run a full analysis to evaluate technical and long-term conditions."
- When `growthSource === "fallback"`: original reference headline is shown (e.g., "AI infrastructure spend remains a multi-quarter tailwind.")
- CTA changed from "Analyze SYMBOL" → "Run Full Analysis" — routes to Ask AI with a growth-analysis prompt
- Badge shows "News-sentiment context" or "Reference context" — never a freshness label

## 14. Income Idea to Explore (Sprint 5.5A)

`bestIncome` is always a hardcoded reference item from `FALLBACK_INCOME[day % n]`. No share ownership, options chain, liquidity, assignment risk, or earnings risk has been evaluated.

- Section renamed from **"Income Opportunity"** → **"Income Idea to Explore"**
- Headline always reads: "SYMBOL may support dividend and covered-call analysis. Connect a broker or open the income workflow to evaluate share ownership, options liquidity, risk, and current contracts."
- Badge shows "Estimated structure" in all cases
- This copy applies even when a broker is connected (no deterministic qualification has run)

## 15. Market Events Labels (Sprint 5.5A)

Impact badges in Market Events & News Context now use explicit labels:
- `"high"` → **"High attention"**
- `"medium"` → **"Elevated activity"**
- `"low"` → **"Low activity"**

A secondary sentiment badge appears per item:
- `"bullish"` → **"Positive sentiment"**
- `"bearish"` → **"Mixed / bearish sentiment"**
- `"neutral"` → **"Neutral context"**

Section subtitle: "Recent news attention and sentiment context. This does not indicate that a setup qualifies."

## 16. Result Reuse — Sprint 5.5B

### Problem

Every dashboard card CTA navigated to `/ask?q=Analyze SYMBOL`, which re-fired the full MCP + GPT-4o-mini pipeline on every click — including double-clicks, back-navigation remounts, and React StrictMode double-renders.

### Solution: Server-Side Per-Symbol Cache

**`server/services/analysis-result-cache.ts`** — in-memory Map keyed by `(userId, symbol)`:
| Parameter | Value |
|-----------|-------|
| TTL (absolute) | 30 minutes |
| Stale threshold | 10 minutes (triggers "older data" banner) |
| Max entries per user | 5 (LRU eviction) |
| Global cap | 500 entries |

Only results containing meaningful analysis sections are cached (`multiStrategyAnalysis`, `vcpAnalysis`, `strategyRecommendation`, or `rankedTradeSearch`). `researchSave` handles and portfolio-aware fields are **never** stored.

**`server/routes/analysis-cache.ts`** — three endpoints:
- `GET /api/analysis/cached?symbol=NVDA` → `{ found, symbol, generatedAt, ageSec, isStale, freshnessLabel, canRefresh, result }` or `{ found: false }`
- `GET /api/analysis/cached?symbols=A,B,C` → `{ hits: string[] }` for dashboard batch check
- `DELETE /api/analysis/cached?symbol=NVDA` → explicit eviction on Refresh

**`server/routes/ask.ts`** — after the TraderBrain path builds its `safeResult`, `storeAnalysisResult(userId, primarySymbol, safeResult)` is called before `res.json()`.

### Client Changes

**`client/src/pages/ask.tsx`** — the `?q=` search `useEffect`:
1. Extracts the primary symbol via `extractSymbolFromAnalysisQuery` (matches `"Analyze NVDA"`, `"Analyze AAPL for …"`)
2. Fires `GET /api/analysis/cached?symbol=` before calling `/api/ask`
3. On cache **hit**: sets `cachedResult` state, tracks `analysis_result_cache_hit`, skips the mutation
4. On cache **miss**: tracks `analysis_result_cache_miss`, calls `askMutation.mutate(q)` as before
5. `inFlightRef` prevents duplicate in-flight cache checks (double-click / StrictMode dedup)
6. `displayData = askMutation.data ?? cachedResult?.result` — fresh result always takes priority

A **freshness bar** appears above the result when displaying a cached entry:
- Shows `freshnessLabel` (e.g. "Analyzed 4 minutes ago")
- Shows an amber "older data" warning when `isStale === true`
- Provides a **Refresh Analysis** button that evicts the cache entry and re-fires the pipeline

**`client/src/pages/dashboard.tsx`** — `OpportunitiesSection`:
- Batch-checks `GET /api/analysis/cached?symbols=...` once on mount (React Query, 30s stale time)
- Passes `hasCachedResult: boolean` to each `OpportunityCard`
- CTA label: **"Open Analysis"** (cache hit) · **"Run Full Analysis"** (miss) · **"Open Example"** (demo/simulated)

### Freshness Policy

**`client/src/lib/freshness-policy.ts`** — typed `FreshnessCategory` with per-category stale thresholds:

| Category | Stale after | Notes |
|----------|-------------|-------|
| `intraday_setup` | 10 min | Scanner picks, full analysis |
| `news_sentiment` | 30 min | Context-only Growth Watch / Income Idea |
| `daily_swing` | 24 h | Daily bar context |
| `market_snapshot` | 2 h | Macro overview |
| `saved_research` | never | Immutable user artifact |
| `demonstration` | never | Simulated data — no live analysis |

### Action Labels (spec §11)

| Situation | CTA label |
|-----------|-----------|
| Cache hit (full analysis) | **Open Analysis** |
| Cache miss (any) | **Run Full Analysis** |
| Explicit refresh click | **Refresh Analysis** |
| Demo / simulated card | **Open Example** |
| Saved research record | **Open Saved Research** |
| Context-only card (Growth Watch, Income Idea) | **Run Full Analysis** |

### Analytics (no symbols, prompts, or account values in event properties)

| Event | When fired |
|-------|-----------|
| `dashboard_existing_result_opened` | CTA click when `hasCachedResult=true` |
| `dashboard_full_analysis_requested` | CTA click when `hasCachedResult=false` |
| `analysis_result_cache_hit` | ask.tsx: cache check returned a result |
| `analysis_result_cache_miss` | ask.tsx: cache check returned 404 |
| `analysis_refresh_requested` | Refresh Analysis button clicked |
| `duplicate_analysis_request_suppressed` | `inFlightRef` blocked a double-fire |

### Security

- Cache is **user-scoped**: `lookupAnalysisResult(userId, symbol)` returns 404 for any other userId.
- `researchSave` handles are stripped before storage.
- Portfolio-aware fields (`portfolioAwareness`, `portfolioTradePlan`) are excluded from the cached payload.
- The DELETE eviction endpoint requires authentication (same `isAuthenticated` middleware as all other `/api/analysis/cached` routes).

## 17. Deferred Work

- **Watchlists — change-state tracking**: Requires a `previousState` snapshot stored server-side to derive "newly qualified" / "no longer qualifying" status.
- **Daily Intelligence brief**: A cached AI-generated morning brief needs a dedicated `/api/home/ai-brief` endpoint built from stored scan results.
- **Market calendar**: A dedicated earnings-this-week + economic-events endpoint.
- **Sector ETF tiles**: Sector strength via SPDRs (XLK, XLE, XLF, etc.) requires a separate quote batch.
- **"Pin Dashboard" option**: `/dashboard` should be added to `LANDING_PAGE_OPTIONS` in the UI's Set Default Page flow (it is already in the schema).

# Database-First Market History Architecture

> Sprint 1 Final — VCP Trader AI  
> Status: Production-ready, feature-flagged  
> Date: 2026-08-06

---

## Overview

Historical market data for deterministic scanning is now served primarily from
**validated bars stored in PostgreSQL** (`market_daily_bars`) rather than by
issuing live HTTP requests to Twelve Data during every scan.

The external Twelve Data provider is used to **populate and refresh** stored
history via the scheduled ingestion job — not as a live data proxy during scans.

```
Scheduled ingestion (Twelve Data)
  → validate bars
  → upsert into market_daily_bars
  → (PostgreSQL is the authoritative history store)

MCP scan request
  → GET /api/internal/market/history
  → market-history-service.ts
  → read market_daily_bars            ← primary source
  → (no external HTTP call in normal path)
  → return candles to MCP

MCP scan result
  → stored opportunity snapshot
  → dashboard reads snapshot
```

---

## Approved External Market-Data Sources

### Production-approved

| Source | Use case |
|---|---|
| **Twelve Data** | Scheduled ingestion, missing-history backfill, bar refresh when stored history absent or stale |
| **Tradier** (when connected) | Current quotes, options chains, live order status — user-specific paths only |
| **TradeStation** (when connected) | Same as Tradier |
| **Future established broker integrations** | Via `BrokerProvider.getHistoricalBars()` — user-specific paths only |

### Disallowed in production

- Yahoo Finance
- Mock / synthetic / fabricated OHLCV
- Hash-generated prices
- Undocumented fallback providers
- Simulated values presented as current data
- Any provider whose name matches `mock*` or `fake*`

The disallowed-provider guard in `market-history-service.ts` (`assertProviderAllowed()`) enforces this at runtime.

---

## Architecture Components

### `server/services/market-history-service.ts` (canonical service)

The single entry point for all deterministic history requests.

```
getHistoricalBars({
  symbol,
  outputSize,
  purpose: "scan" | "user" | "regime",
  allowExternalRefresh?,   // false for global scans
  caller?
}) → HistoricalBarsResult
```

**Provider precedence — `purpose: "scan"` (Opportunity Engine, MCP):**

1. Fresh validated PostgreSQL bars → return immediately (`sourceType: "stored"`)
2. Twelve Data refresh if bars missing/stale AND `allowExternalRefresh=true` AND `MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED=true`
3. Stale stored bars → return with `freshnessStatus: "stale"` (`sourceType: "stored_stale"`)
4. Throw `MarketDataProviderError("EMPTY")` → 404 `NO_DATA`

**Provider precedence — `purpose: "user"` (Ask AI, Advanced Trade Builder):**

1. Fresh validated PostgreSQL bars
2. Twelve Data refresh when stale/missing
3. Stale stored bars
4. Broker history (future: when `BrokerProvider.getHistoricalBars()` is implemented)

**Global scan safety (`purpose: "scan"`):**

`allowExternalRefresh` defaults to `false` for scan purpose. This means the
Opportunity Engine scan never triggers N simultaneous external Twelve Data requests
for N symbols. The ingestion job is the only approved mechanism for populating
stored bars before a scan.

### `server/routes/internal-market.ts` (MCP-facing route)

`GET /api/internal/market/history` is now a canonical-service endpoint, not a
Twelve Data proxy. In the normal path (stored bars fresh) it makes **zero external HTTP requests**.

The response shape is backward-compatible with additive metadata:

```json
{
  "symbol": "NVDA",
  "interval": "1day",
  "candles": [ ... ],
  "sourceType": "stored",
  "freshnessStatus": "fresh",
  "latestBarDate": "2026-08-05",
  "provider": "twelve_data"
}
```

MCP consumers that only read `candles` continue to work without changes.

### `server/services/daily-market-data/ingestion.ts`

Unchanged in behavior. Now also exports `persistValidatedBars()` so the
market-history-service can write freshly-fetched bars to the database without
triggering a full ingestion run.

---

## Stored-Bar Schema

Table: **`market_daily_bars`**

| Column | Type | Notes |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `symbol` | text | Uppercase ticker |
| `trade_date` | date | YYYY-MM-DD |
| `open / high / low / close` | numeric(18,6) | Validated: finite, positive, OHLC order |
| `adjusted_close` | numeric(18,6) | Nullable |
| `volume` | bigint | ≥ 0 |
| `data_provider` | text | `twelve_data`, `tradier`, etc. |
| `provider_timestamp` | text | Raw datetime from provider |
| `ingested_at` | timestamp | When first inserted |
| `updated_at` | timestamp | Last update |
| `validated_at` | timestamp | When `validateBar()` was run |
| `is_complete` | boolean | False for partial intraday candle |
| `is_adjusted` | boolean | Split-adjusted flag |
| `data_version` | integer | Incremented on close-price change (split detection) |
| `checksum` | text | Reserved for future integrity check |

**Unique constraint:** `uq_mdb_symbol_date_provider` on `(symbol, trade_date, data_provider)`

**Indexes:** `idx_mdb_symbol_date`, `idx_mdb_trade_date`, `idx_mdb_symbol_complete`

**Note:** No `interval` column — the table stores daily bars only. Future
intraday support would require adding an `interval` column and updating the
unique constraint.

---

## Freshness Policy (Daily Bars)

Freshness is measured in **weekday distance**, not wall-clock hours. This
prevents Friday's bar from appearing stale on Saturday morning.

```
mostRecentWeekday(refDate) → most recent Mon-Fri calendar date
weekdayDistance(barDate, refDate) → count of weekdays between them
```

| Purpose | Stale threshold | Rationale |
|---|---|---|
| `scan` (Opportunity Engine) | 3 weekdays | Covers weekend + one US federal holiday |
| `user` (Ask AI, Analysis) | 5 weekdays | More relaxed; data labeled with freshness |

**No market-holiday calendar dependency.** The 3-weekday threshold absorbs
single-day US federal holidays (which always land on Monday or Friday) without
requiring a maintained holiday list. Multi-day exchange closures (e.g. Hurricane Sandy)
would exceed the threshold and produce `freshnessStatus: "stale"` — acceptable behavior.

---

## History Depth Requirements

| Constant | Bars | Covers |
|---|---|---|
| `HISTORY_DEPTH.FULL_TECHNICAL` | 260 | SMA-200 + 50-bar warm-up, 52-week high lookback |
| `HISTORY_DEPTH.STANDARD_SCAN` | 120 | SMA-50, EMA-21, RSI-14, ATR-14, VCP base |
| `HISTORY_DEPTH.MINIMUM` | 30 | Minimum for any computable indicator |

Scans that receive fewer bars than `MINIMUM` report the symbol as `unavailable`
rather than computing misleading indicators from undersized data.

---

## Scan Readiness Check

Before launching a broad Opportunity Engine scan, call `checkScanReadiness()`.

```typescript
const readiness = await checkScanReadiness();
// {
//   universeSize: 20,
//   readySymbols: 18,
//   staleSymbols: 1,
//   missingSymbols: 1,
//   coveragePercent: 90,
//   latestCompletedBarDate: "2026-08-05",
//   dataSourceSummary: "PostgreSQL market_daily_bars (source: twelve_data)",
//   checkedAt: "2026-08-06T..."
// }

if (!isScanCoverageAdequate(readiness)) {
  // Preserve previous valid snapshot — do not run scan on sparse data
}
```

**Minimum coverage threshold:** `MIN_SCAN_COVERAGE_PCT = 70%`  
When fewer than 70% of universe symbols have fresh bars, the scan is skipped
and the previous valid snapshot is preserved.

---

## Error Classification

The `MarketDataProviderError` class now uses explicit codes. Credit/rate-limit
errors are **never** collapsed into the generic `PROVIDER_ERROR` 502.

| Code | HTTP | Meaning |
|---|---|---|
| `UNSUPPORTED_SYMBOL` | 404 `SYMBOL_NOT_FOUND` | TwelveData does not support this symbol |
| `EMPTY` | 404 `NO_DATA` | No bars available (not in any source) |
| `TIMEOUT` | 504 `PROVIDER_TIMEOUT` | Provider HTTP request timed out |
| `RATE_LIMITED` | 429 `PROVIDER_RATE_LIMITED` | Per-minute credit safety limit |
| `DAILY_LIMIT` | 503 `PROVIDER_DAILY_LIMIT` | Daily credit safety limit exhausted |
| `WAIT_TIMEOUT` | 503 `PROVIDER_WAIT_TIMEOUT` | Credit reservation wait exceeded |
| `QUOTA` | 503 `PROVIDER_QUOTA` | Generic quota (legacy; use RATE_LIMITED or DAILY_LIMIT) |
| `AUTH` | 503 `PROVIDER_UNAVAILABLE` | API key missing or rejected |
| `DISABLED` | 503 `PROVIDER_UNAVAILABLE` | Provider disabled by configuration |
| `MALFORMED` | 502 `PROVIDER_BAD_RESPONSE` | Non-JSON or metadata mismatch |
| `BAD_RESPONSE` | 502 `PROVIDER_BAD_RESPONSE` | Structurally invalid response |
| `NETWORK` | 502 `PROVIDER_ERROR` | TCP/DNS failure |
| `UNKNOWN` | 502 `PROVIDER_ERROR` | Unclassified provider error |

---

## Global vs User-Specific Data Policy

**Global Opportunity Engine scans** must use a consistent, user-independent
historical dataset. Scanner results must not vary based on which broker an
individual user has connected.

```
✓ getHistoricalBars({ purpose: "scan" })
   → always reads market_daily_bars (same for all users)

✗ Using a connected user's broker to supply history for a global scan
   → would produce user-dependent rankings (forbidden)
```

**User-specific analysis** (Ask AI, Advanced Trade Builder) may supplement
stored historical bars with a current quote from any established connected broker.
The source must be labeled accurately.

---

## Broker Capability Abstraction

`BrokerProvider` in `server/broker/types.ts` now includes optional capability flags:

```typescript
interface BrokerCapabilities {
  // existing
  nativeTrailingStop: boolean;
  stocks: boolean;
  options: boolean;
  spreads: boolean;
  // new (all optional)
  quotes?: boolean;           // real-time/delayed quote
  extendedHoursQuotes?: boolean;
  historicalBars?: boolean;   // may supply OHLCV history (user paths only)
  optionsChain?: boolean;
  greeks?: boolean;
}
```

`BrokerProvider` also includes an optional `getHistoricalBars()` method.
Implementations set `capabilities.historicalBars = true` to indicate support.

---

## Feature Flags

| Variable | Default | Effect |
|---|---|---|
| `MARKET_HISTORY_DATABASE_FIRST` | `"true"` | Serve stored bars first; false = legacy direct TwelveData |
| `MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED` | `"true"` | Allow on-demand refresh for stale/missing bars |

**Emergency rollback:** set `MARKET_HISTORY_DATABASE_FIRST=false` on Railway
to revert to the previous behavior (direct Twelve Data proxy). Do not use Yahoo
or mock as a rollback.

---

## Ingestion and Backfill

**Existing behavior preserved** — no changes to the ingestion scheduler or run logic.

- Scheduled daily refresh: fetches recent bars (last 7 days) per symbol, upserts idempotently
- Backfill: configurable per symbol via `market_data_symbols.backfill_years` (default 2)
- Incremental: fetches only from `latest_stored_date - 7d`, not full re-download
- Credit-aware: uses `reserveCreditsBlocking()` with new explicit error codes
- Failure isolation: one symbol failure does not abort the entire batch
- Advisory lock: `INGESTION_LOCK_KEY = 774_412_001` prevents concurrent runs

New: `persistValidatedBars(symbol, bars)` exported from `ingestion.ts` for
use by `market-history-service.ts` when an on-demand refresh succeeds.

---

## Schema Changes

**None.** The existing `market_daily_bars` table fully supports the
database-first architecture. No migration is required.

---

## Deployment Sequence

1. Deploy with `MARKET_HISTORY_DATABASE_FIRST=true` (default — no Railway variable change needed)
2. Verify Railway logs show `sourceType: "stored"` in market history responses
3. If issues: set `MARKET_HISTORY_DATABASE_FIRST=false` to revert to legacy path instantly
4. Run ingestion to ensure `market_daily_bars` is populated before disabling external refresh

**Railway variables to add (optional overrides):**

| Variable | Recommended value | Notes |
|---|---|---|
| `MARKET_HISTORY_DATABASE_FIRST` | (omit — defaults true) | |
| `MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED` | (omit — defaults true) | Set false to prevent any on-demand refresh |

---

## Production Readiness Audit

Run before every deployment that touches the Opportunity Engine or market data pipeline:

```bash
DATABASE_URL=<prod-url> npx tsx scripts/audit-market-history-readiness.ts
```

Exit code: **0** = GO or CONDITIONAL_GO, **1** = NO_GO, **2** = database error.

Output is sanitized — never prints DATABASE_URL, credentials, or raw candle data.

### Readiness Thresholds

| Verdict | Rule |
|---|---|
| **GO** | ≥ 95% READY or STALE_BUT_USABLE · all regime symbols READY · 0 INVALID bars |
| **CONDITIONAL_GO** | 85–94.99% coverage · regime symbols not MISSING · 0 INVALID bars · previous valid snapshot exists · backfill actively running |
| **NO_GO** | < 85% coverage · any regime symbol MISSING or INSUFFICIENT · any INVALID bars · universe empty |

Regime symbols that must be READY for GO: **SPY, QQQ, IWM, DIA**

### Per-Symbol Readiness Statuses

| Status | Criteria |
|---|---|
| `READY` | barCount ≥ 320 · latest bar ≤ 3 weekdays old · 0 OHLC violations · 0 duplicate timestamps |
| `STALE_BUT_USABLE` | barCount ≥ 50 · latest bar 4–10 weekdays old · 0 violations |
| `INSUFFICIENT_HISTORY` | 0 < barCount < 50, OR barCount ≥ 50 but data > 10 weekdays old |
| `MISSING` | 0 bars in market_daily_bars |
| `INVALID` | OHLC violations (high < low, etc.) or duplicate trade_date |

### Production Universe

**20 symbols** (configured in `market_data_symbols` via `SEED_SYMBOLS` in `ingestion.ts`):

| Symbol | Type | Role |
|---|---|---|
| SPY | ETF | Market regime (required) |
| QQQ | ETF | Market regime (required) |
| IWM | ETF | Market regime (required) |
| DIA | ETF | Market regime (required) |
| NVDA | Equity | Semiconductor / AI infrastructure |
| MSFT | Equity | Mega-cap tech |
| AAPL | Equity | Mega-cap tech |
| AMZN | Equity | Mega-cap tech |
| GOOGL | Equity | Mega-cap tech |
| META | Equity | Mega-cap tech |
| AVGO | Equity | Semiconductor |
| AMD | Equity | Semiconductor |
| MU | Equity | Semiconductor |
| PLTR | Equity | Software / data |
| ORCL | Equity | Software |
| JPM | Equity | Financials |
| COST | Equity | Consumer |
| WMT | Equity | Consumer |
| TSLA | Equity | EV / diversified |
| XOM | Equity | Energy |

**VIX is not in the universe.** The Opportunity Engine calls `getMarketRegime()` non-fatally; the regime service does not depend on stored VIX bars.

> The MCP `rank_market_trade_candidates` tool has its own server-side universe and does not accept a symbol list from the engine. The 20-symbol ingestion universe is the database-first coverage target; MCP results may include additional symbols not in this set.

### Minimum History Requirements

| Depth | Bars | Covers |
|---|---|---|
| Scanner request (`REQUIRED_BARS`) | 320 | Full technical indicator suite |
| Scanner minimum (`MINIMUM_BARS`) | 50 | VCP evaluation, SMA-50, EMA-21 |
| SMA-200 warm-up | 250 | Deep trend confirmation |
| `HISTORY_DEPTH.MINIMUM` (service) | 30 | Any computable indicator |

### Ingestion Scheduling

| Property | Value |
|---|---|
| Schedule | `15 19 * * 1-5` — 7:15 PM ET weekdays (node-cron, `server/index.ts:533`) |
| Gate | `isExpectedTradingDay()` check before running |
| Concurrency | Sequential, 1 symbol at a time |
| Advisory lock | PostgreSQL key `774_412_001` (multi-instance safe) |
| Incremental window | Latest stored date − 7 calendar days (covers corrections) |
| Initial backfill | `backfill_years` column (default 2 years) |
| Credit safety | 7/min, 750/day via `reserveCreditsBlocking()` |
| Error isolation | One symbol failure does not stop the batch |
| Quota stop | `DAILY_LIMIT` / `QUOTA` codes halt the run (resumes next day) |
| Structured events | `daily_bar_ingestion_started`, `daily_bar_ingestion_completed`, `daily_bar_ingestion_partial`, `daily_bar_ingestion_failed` |

### Deployment Gate

1. Run `npx tsx scripts/audit-market-history-readiness.ts` against production DB
2. Verify exit code is **0** (GO or CONDITIONAL_GO)
3. If CONDITIONAL_GO: confirm previous valid opportunity snapshot exists + backfill is running
4. If NO_GO: do not enable `MARKET_HISTORY_DATABASE_FIRST=true` on this deploy; ensure ingestion has populated bars first
5. Deploy with `MARKET_HISTORY_DATABASE_FIRST=true` (default — no Railway variable change needed)

### Recommended Railway Variable Values (Initial Production)

| Variable | Value | Notes |
|---|---|---|
| `MARKET_HISTORY_DATABASE_FIRST` | (omit) | Defaults true |
| `MARKET_HISTORY_EXTERNAL_REFRESH_ENABLED` | (omit) | Defaults true; set false to block all on-demand refresh |
| `OPPORTUNITY_SCAN_TIMEOUT_MS` | 90000 | 90s scan deadline |
| `OPPORTUNITY_SCAN_INTERVAL_MINUTES` | 240 | 4h scan cadence |

### Rollback Conditions

Roll back to legacy mode (`MARKET_HISTORY_DATABASE_FIRST=false`) when:
- Internal route returns `sourceType:"external_refresh"` for > 20% of symbols (stored bars absent)
- Opportunity Engine snapshot shows 0 stock opportunities for 2+ consecutive scans
- Credit logs show unexpected burst during a scan window
- Railway deployment shows repeated 502 PROVIDER_ERROR on `/api/internal/market/history`

## Rollback Plan

1. Set `MARKET_HISTORY_DATABASE_FIRST=false` on Railway → immediate fallback to direct TwelveData proxy
2. No database changes to roll back (no schema was modified)
3. Redeploy is not required — env var change takes effect on process startup

---

## Known Limitations

1. **No holiday calendar**: freshness uses weekday distance. A multi-day exchange closure
   would cause all bars to appear stale. Mitigated by the 3-weekday threshold.
2. **No interval column**: `market_daily_bars` stores only daily bars. Intraday support
   requires a schema change.
3. **No split-adjusted flag on API response**: `is_adjusted` is stored in the DB but not
   exposed in `NormalizedDailyBar`. Currently all stored bars are unadjusted.
4. **External refresh is synchronous**: On-demand refresh blocks the MCP request. For
   scan purpose, `allowExternalRefresh=false` avoids this entirely; backfill is async.
5. **Broker `getHistoricalBars()` not yet wired**: The interface is defined and capability
   flags are set, but the user-facing history path does not yet try broker bars as a source.

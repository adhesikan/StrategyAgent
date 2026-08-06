---
name: Database-First Market History Architecture
description: Sprint 1 final task — canonical stored-bar service replacing direct TwelveData proxy in the internal MCP route.
---

## Rule
All historical bar requests must go through `server/services/market-history-service.ts::getHistoricalBars()`. Never construct `TwelveDataDailyProvider` directly in a route or scanner.

**Why:** Direct provider construction caused scan-time HTTP request storms (one external request per symbol × number of concurrent MCP scan calls = burst credit exhaustion → 502 PROVIDER_ERROR cascade).

## How to apply
- Scan/Opportunity Engine paths: `purpose: "scan"`, `allowExternalRefresh: false` (stored bars only — no external calls during scans)
- User-facing analysis: `purpose: "user"`, `allowExternalRefresh: true`
- Feature flag emergency rollback: `MARKET_HISTORY_DATABASE_FIRST=false` on Railway → reverts to direct TwelveData proxy immediately

## Key contracts
- `persistValidatedBars()` exported from `ingestion.ts` — wraps private `upsertBars`; used by service to write fresh bars without triggering a full ingestion run
- `validateBar()` is called on every bar from external refresh — invalid bars are silently dropped (warnings logged); persist failure is non-fatal
- Freshness: weekday distance, not wall-clock hours; 3 weekdays for scan, 5 for user
- `checkScanReadiness()` — one SQL query; `MIN_SCAN_COVERAGE_PCT = 70%`; when below threshold, preserve previous snapshot

## Error codes (credit manager now throws MarketDataProviderError, not plain Error)
- `DAILY_LIMIT` → HTTP 503 PROVIDER_DAILY_LIMIT (normalized to "QUOTA" in ingestion.ts item status)
- `RATE_LIMITED` → HTTP 429 PROVIDER_RATE_LIMITED
- `WAIT_TIMEOUT` → HTTP 503 PROVIDER_WAIT_TIMEOUT
- `BAD_RESPONSE` → HTTP 502 PROVIDER_BAD_RESPONSE

## Disallowed providers (runtime guard in market-history-service.ts)
yahoo, yahoo_finance, mock, synthetic, fake, test_data, mock*, fake*
These throw MarketDataProviderError(DISABLED) which is caught and treated as a bar rejection.

## Broker capability flags
`BrokerCapabilities` in `server/broker/types.ts` now has optional: `quotes`, `extendedHoursQuotes`, `historicalBars`, `optionsChain`, `greeks`.
`BrokerProvider` has optional `getHistoricalBars()` method.
Broker history is user-specific — NEVER use in global Opportunity Engine scans.

## Tests
62 new tests:
- `server/services/market-history-service.test.ts` — 38 tests (groups A-H)
- `server/routes/internal-market.test.ts` — 24 tests (rewritten to mock getHistoricalBars)
